import crypto from "node:crypto";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import spawn from "cross-spawn";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import which from "which";
import { ErrorCode, toRuntimeError } from "../error/codes.js";
import type {
  BackendConfig,
  BackendSnapshot,
  HealthStatus,
  RuntimeBackend,
} from "./interface.js";
import type {
  BackendName,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
} from "../event/types.js";
import type { VisibilityCollector } from "../visibility/collector.js";
import {
  contentHash,
  emptyRedaction,
  makePreview,
  redactText,
  summarizeEnv,
  redactArgs,
} from "../visibility/redaction.js";
import type {
  NativeEventRef,
  EventMappingVisibility,
} from "../visibility/types.js";

/** Normalized usage data extracted from output events for visibility forwarding. */
interface NativeUsageData {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  [key: string]: unknown;
}

/** stderr handling config per Section 7.6 */
const STDERR_MAX_BYTES = 64 * 1024;

const BACKEND_CONFIG_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "CODEX_MODEL_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "GOOGLE_GEMINI_API_KEY",
  "GOOGLE_GEMINI_BASE_URL",
  "GOOGLE_GEMINI_MODEL",
  "GOOGLE_API_KEY",
  "ANTHROPIC_TOKEN",
  "HERMES_API_KEY",
  "HERMES_AUTH_TOKEN",
  "HERMES_BASE_URL",
  "HERMES_DEFAULT_MODEL",
  "HERMES_ENDPOINT",
  "HERMES_INFERENCE_PROVIDER",
  "HERMES_MODEL",
  "HERMES_PROVIDER",
  "MINIMAX_API_KEY",
  "MINIMAX_BASE_URL",
  "MINIMAX_CN_API_KEY",
  "MINIMAX_CN_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
];

/** Known stderr error patterns */
const STDERR_ERROR_PATTERNS: Array<{ pattern: RegExp; code: ErrorCode }> = [
  { pattern: /out of memory/i, code: ErrorCode.BACKEND_CRASHED },
  { pattern: /ECONNREFUSED/i, code: ErrorCode.BACKEND_UNAVAILABLE },
  { pattern: /permission denied/i, code: ErrorCode.APPROVAL_DENIED },
  { pattern: /rate limit/i, code: ErrorCode.BACKEND_UNAVAILABLE },
  { pattern: /timeout/i, code: ErrorCode.BACKEND_TIMEOUT },
];

export type ProcessMode = "long-lived" | "per-execution";

type NativeMappedEvent = RuntimeEvent | RuntimeEvent[] | null;

export interface SubprocessAdapterOptions {
  name: BackendName;
  capabilities: RuntimeBackend["capabilities"];
  defaultExecutable: string;
  processMode: ProcessMode;
  /** Protocol metadata for visibility records */
  protocol?: {
    name: "ndjson" | "stream-json" | "json-rpc-2.0" | "acp";
    stdinMode: "prompt" | "json_rpc" | "message" | "none";
    stdoutMode: "ndjson" | "json_rpc" | "text";
    stderrCaptured: boolean;
  };
  buildArgs(request: RuntimeRequest): string[];
  buildInput?(request: RuntimeRequest): string | undefined;
  /** For long-lived processes, send a new message without closing stdin */
  buildMessage?(request: RuntimeRequest): string | undefined;
  /** Build a native protocol response to send back to the subprocess stdin (e.g. approval response) */
  buildNativeResponse?(event: RuntimeEvent): string | undefined;
  /** Map a native JSON object to a RuntimeEvent using backend-specific protocol knowledge */
  mapNativeEvent?(
    backend: BackendName,
    request: RuntimeRequest,
    value: Record<string, unknown>,
  ): NativeMappedEvent;
  /** Optional initialization message to send after warm process starts */
  initMessage?(): string | undefined;
}

export class SubprocessBackendAdapter implements RuntimeBackend {
  readonly name: BackendName;
  readonly capabilities: RuntimeBackend["capabilities"];
  private config?: BackendConfig;
  private startedAt = 0;
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  private lastError?: string;
  /**
   * Per-execution visibility collectors, keyed by executionId.
   * Avoids cross-write when concurrent executions share the same adapter.
   */
  private visibilityCollectors = new Map<string, VisibilityCollector>();

  /** Long-lived warm process */
  private warmProcess?: ChildProcessWithoutNullStreams;
  private warmProcessReady = false;
  private warmStderrBuffer = "";
  /**
   * Per-execution line callbacks keyed by executionId.
   * For long-lived backends, only one execution owns stdin at a time;
   * activeWarmExecution tracks which one currently receives stdout lines.
   */
  private warmLineCallbacks = new Map<string, (line: string) => void>();
  private activeWarmExecution?: string;
  /** Resolvers waiting for the warm process to become available. */
  private warmReleaseResolvers: (() => void)[] = [];
  private warmIdleTimer?: ReturnType<typeof setTimeout>;

  /** Default idle timeout for warm processes: 10 minutes */
  private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;

  constructor(protected readonly options: SubprocessAdapterOptions) {
    this.name = options.name;
    this.capabilities = options.capabilities;
  }

  /** Set the visibility collector for a specific execution. */
  setVisibilityCollector(
    collector: VisibilityCollector | undefined,
    executionId?: string,
  ): void {
    if (!executionId) return;
    if (collector) {
      this.visibilityCollectors.set(executionId, collector);
    } else {
      this.visibilityCollectors.delete(executionId);
    }
  }

  /** Get the visibility collector for a specific execution. */
  private getVc(executionId: string): VisibilityCollector | undefined {
    return this.visibilityCollectors.get(executionId);
  }

  async init(config: BackendConfig): Promise<void> {
    this.config = config;
    this.startedAt = Date.now();
    // Long-lived backends are warmed lazily on first stream(). Engine startup
    // initializes every adapter, so eager warm-up would make unrelated backend
    // executions pay Hermes ACP startup cost.
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeEvent> {
    if (this.options.processMode === "long-lived") {
      yield* this.streamLongLived(request);
    } else {
      yield* this.streamPerExecution(request);
    }
  }

  async execute(request: RuntimeRequest): Promise<RuntimeResponse> {
    const events: RuntimeEvent[] = [];
    const chunks: string[] = [];
    let failed = false;

    for await (const event of this.stream(request)) {
      events.push(event);
      if (event.type === "output") {
        chunks.push(event.data.content);
      }
      if (event.type === "error") {
        failed = true;
      }
    }

    return {
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend: this.name,
      status: failed ? "failed" : "completed",
      output: chunks.join(""),
      events,
      error: events.find((event) => event.type === "error")?.data,
    };
  }

  async interrupt(executionId: string): Promise<void> {
    // For long-lived: release execution ownership but don't kill warm process
    if (this.options.processMode === "long-lived") {
      if (this.activeWarmExecution === executionId) {
        // Remove line callback to stop dispatching
        this.warmLineCallbacks.delete(executionId);
        this.activeWarmExecution = undefined;
      }
      this.active.delete(executionId);
      return;
    }

    // For per-execution: graceful SIGINT → grace period → SIGKILL
    const child = this.active.get(executionId);
    if (!child) return;

    return new Promise<void>((resolve) => {
      const graceMs = this.config?.timeoutMs
        ? Math.min(5000, this.config.timeoutMs)
        : 5000;
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          this.active.delete(executionId);
          resolve();
        }
      };

      child.once("exit", cleanup);

      // Step 1: SIGINT
      child.kill("SIGINT");

      // Step 2: SIGKILL after grace period
      const killTimer = setTimeout(() => {
        if (this.active.has(executionId)) {
          child.kill("SIGKILL");
        }
        // Resolve even if exit hasn't fired yet
        cleanup();
      }, graceMs);
      killTimer.unref();
    });
  }

  async snapshot(sessionId: string): Promise<BackendSnapshot> {
    return {
      sessionId,
      backend: this.name,
      createdAt: Date.now(),
      payload: { activeExecutions: this.active.size, warm: !!this.warmProcess },
    };
  }

  async probe(): Promise<HealthStatus> {
    const config = this.requireConfig();
    const executable = config.executable ?? this.options.defaultExecutable;
    const available = commandExists(executable, config.env);
    const lastError = available
      ? this.lastError
      : `Executable not found: ${executable}`;
    return {
      healthy: available && !this.lastError,
      status: available
        ? this.lastError
          ? "degraded"
          : this.active.size > 0
            ? "busy"
            : "ready"
        : "degraded",
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      activeExecutions: this.active.size,
      lastError,
    };
  }

  async destroy(): Promise<void> {
    // Kill warm process
    if (this.warmProcess) {
      this.warmProcess.kill("SIGINT");
      this.warmProcess = undefined;
      this.warmProcessReady = false;
    }
    if (this.warmIdleTimer) {
      clearTimeout(this.warmIdleTimer);
      this.warmIdleTimer = undefined;
    }
    // Kill active per-execution processes
    for (const child of this.active.values()) {
      child.kill("SIGINT");
    }
    this.active.clear();
  }

  /**
   * Send a native protocol response back to the backend subprocess stdin.
   * Used for approval decisions, MCP tool results, etc.
   * The adapter's buildNativeResponse converts a RuntimeEvent to the backend's wire format.
   */
  sendNativeResponse(executionId: string, event: RuntimeEvent): boolean {
    if (!this.options.buildNativeResponse) return false;
    const response = this.options.buildNativeResponse(event);
    if (!response) return false;

    return this.writeToStdin(executionId, response);
  }

  /** Write raw data to the process stdin (long-lived warm process or per-execution child). */
  protected writeToStdin(executionId: string, data: string): boolean {
    if (process.env.IOTA_DEBUG_ACP === "true") {
      process.stderr.write(`[acp:stdin] ${data.slice(0, 300)}\n`);
    }
    // Record visibility for stdin writes
    const vc = this.getVc(executionId);
    if (vc) {
      const policy = vc.getPolicy();
      const spanId = vc.startSpan("backend.stdin.write", {
        byteLength: Buffer.byteLength(data),
      });
      const rawPreview =
        policy.rawProtocol !== "off"
          ? makePreview(data, policy.previewChars)
          : undefined;
      const { text: finalPreview, redaction } =
        rawPreview && policy.redactSecrets
          ? redactText(rawPreview)
          : { text: rawPreview, redaction: emptyRedaction() };
      vc.appendNativeEventRef({
        refId: `stdin-${executionId}-${Date.now()}`,
        direction: "stdin",
        timestamp: Date.now(),
        rawHash: contentHash(data),
        preview: finalPreview,
        redaction,
      });
      vc.endSpan(spanId);
    }

    // For long-lived: write to warm process
    if (this.options.processMode === "long-lived" && this.warmProcess) {
      this.warmProcess.stdin.write(data);
      return true;
    }
    // For per-execution: write to the active child
    const child = this.active.get(executionId);
    if (child) {
      child.stdin.write(data);
      return true;
    }
    return false;
  }

  // ─── Long-lived process management ─────────────────────────────

  private async ensureWarmProcess(): Promise<ChildProcessWithoutNullStreams> {
    if (this.warmProcess && this.warmProcessReady) {
      this.resetIdleTimer();
      return this.warmProcess;
    }

    const config = this.requireConfig();
    const executable = config.executable ?? this.options.defaultExecutable;
    const resolvedExecutable = await resolveExecutable(executable, config.env);

    // For long-lived, buildArgs is called with a dummy request just for startup args
    const child = spawn(
      resolvedExecutable,
      this.options.buildArgs({} as RuntimeRequest),
      {
        stdio: "pipe",
        cwd: config.workingDirectory,
        env: buildBackendProcessEnv(config.env),
        windowsHide: true,
      },
    ) as ChildProcessWithoutNullStreams;

    // Setup stderr monitoring (Section 7.6)
    child.stderr.on("data", (chunk: Buffer) => {
      this.warmStderrBuffer += chunk.toString("utf8");
      if (this.warmStderrBuffer.length > STDERR_MAX_BYTES) {
        this.warmStderrBuffer = this.warmStderrBuffer.slice(-STDERR_MAX_BYTES);
      }
    });

    child.once("error", (error) => {
      this.lastError = error.message;
      this.warmProcess = undefined;
      this.warmProcessReady = false;
    });

    child.once("close", (code, _signal) => {
      if (code !== 0 && code !== null) {
        const stderr = this.warmStderrBuffer.trim();
        const hint = stderr ? `\n  stderr: ${stderr.split("\n").pop()}` : "";
        this.lastError = `Warm process exited with code ${code}${hint}`;
      }
      this.warmProcess = undefined;
      this.warmProcessReady = false;
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (process.env.IOTA_DEBUG_ACP === "true") {
        process.stderr.write(`[acp:stdout] ${line}\n`);
      }
      // Dispatch only to the execution that currently owns stdin
      const execId = this.activeWarmExecution;
      if (execId) {
        const cb = this.warmLineCallbacks.get(execId);
        cb?.(line);
      }
    });

    // Wait for spawn
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (err) => reject(err));
    });

    // Send initialization message if provided
    if (this.options.initMessage) {
      const initMsg = this.options.initMessage();
      if (initMsg) {
        child.stdin.write(initMsg);
      }
    }

    this.warmProcess = child;
    this.warmProcessReady = true;
    this.resetIdleTimer();
    return child;
  }

  private resetIdleTimer(): void {
    if (this.warmIdleTimer) {
      clearTimeout(this.warmIdleTimer);
    }
    this.warmIdleTimer = setTimeout(() => {
      if (this.warmProcess && this.active.size === 0) {
        this.warmProcess.kill("SIGINT");
        this.warmProcess = undefined;
        this.warmProcessReady = false;
      }
    }, SubprocessBackendAdapter.IDLE_TIMEOUT_MS);
    this.warmIdleTimer.unref();
  }

  private async *streamLongLived(
    request: RuntimeRequest,
  ): AsyncIterable<RuntimeEvent> {
    let child: ChildProcessWithoutNullStreams;
    const reusedWarmProcess = !!this.warmProcess && this.warmProcessReady;
    try {
      child = await this.ensureWarmProcess();
    } catch (error) {
      this.lastError = (error as Error).message;
      yield this.errorEvent(
        request,
        ErrorCode.BACKEND_UNAVAILABLE,
        this.lastError,
      );
      return;
    }

    // Detect early crash before we acquire the execution lock.
    let crashedBeforeStart = false;
    const earlyCrashHandler = () => {
      crashedBeforeStart = true;
      // Wake anyone waiting for warm release so they can re-check.
      for (const resolve of this.warmReleaseResolvers.splice(0)) resolve();
    };
    child.once("exit", earlyCrashHandler);

    // Serialize: only one execution may own the warm process at a time.
    // Wait using a promise-based queue instead of polling.
    if (this.activeWarmExecution) {
      await new Promise<void>((resolve) => {
        this.warmReleaseResolvers.push(resolve);
      });
    }

    // If the process crashed while we were waiting, bail out.
    if (crashedBeforeStart) {
      yield this.errorEvent(
        request,
        ErrorCode.BACKEND_UNAVAILABLE,
        "Warm process exited before execution started",
      );
      return;
    }
    child.removeListener("exit", earlyCrashHandler);

    this.active.set(request.executionId, child);
    this.activeWarmExecution = request.executionId;
    const config = this.requireConfig();

    // Record link visibility for long-lived process (P0-2)
    const vc = this.getVc(request.executionId);
    const execStartedAt = Date.now();
    const processSpanId = vc?.startSpan("backend.resolve", {
      scope: "process",
      processMode: "long-lived",
      warmPid: child.pid,
      warmState: reusedWarmProcess ? "ready" : "starting",
      reusedWarmProcess,
    });
    const executionSpanId = vc?.startSpan("backend.resolve", {
      scope: "execution",
      processMode: "long-lived",
      warmPid: child.pid,
      warmState: "busy",
    });
    if (vc) {
      const executable = config.executable ?? this.options.defaultExecutable;
      const { args: redactedArgsArr } = redactArgs(
        this.options.buildArgs({} as RuntimeRequest),
      );
      vc.setLinkCommand({
        command: {
          executable,
          args: redactedArgsArr,
          envSummary: summarizeEnv(config.env ?? {}),
          workingDirectory: config.workingDirectory ?? process.cwd(),
        },
        protocol: {
          name: "acp",
          stdinMode: "message",
          stdoutMode: "ndjson",
          stderrCaptured: true,
        },
      });
      vc.setLinkProcess({
        pid: child.pid,
        startedAt: execStartedAt,
      });
    }

    // Streaming queue: events are pushed by the line callback, consumed by the generator
    const queue: RuntimeEvent[] = [];
    let wake: (() => void) | undefined;
    let done = false;

    const finish = () => {
      if (!done) {
        done = true;
        this.warmLineCallbacks.delete(request.executionId);
        if (this.activeWarmExecution === request.executionId) {
          this.activeWarmExecution = undefined;
          // Wake the next queued execution.
          const next = this.warmReleaseResolvers.shift();
          if (next) next();
        }
        // End warm-process and execution-level resolve spans separately.
        if (vc && executionSpanId) {
          vc.endSpan(executionSpanId, {
            attributes: { warmPid: child.pid, executionDone: true },
          });
        }
        if (vc && processSpanId) {
          vc.endSpan(processSpanId, {
            attributes: {
              warmPid: child.pid,
              warmState: this.warmProcessReady ? "ready" : "degraded",
            },
          });
        }
        wake?.();
      }
    };

    const timeoutHandle = setTimeout(() => {
      queue.push(
        this.errorEvent(
          request,
          ErrorCode.BACKEND_TIMEOUT,
          `Backend ${this.name} timed out`,
        ),
      );
      finish();
    }, config.timeoutMs);

    // Register per-execution line callback
    this.warmLineCallbacks.set(request.executionId, (line: string) => {
      if (done) return;
      const mapped = this.mapLine(line, request);
      const events = normalizeMappedEvents(mapped);
      if (events.length > 0) {
        queue.push(...events);
        if (events.some(isTerminalEvent)) {
          finish();
        }
        wake?.();
      }
    });

    // Handle process crash
    const exitHandler = () => finish();
    child.once("exit", exitHandler);

    try {
      // Send message via stdin without closing it
      const message =
        this.options.buildMessage?.(request) ??
        this.options.buildInput?.(request);
      if (message) {
        // Record stdin NativeEventRef for long-lived mode
        if (vc) {
          const policy = vc.getPolicy();
          const rawPreview =
            policy.rawProtocol !== "off"
              ? makePreview(message, policy.previewChars)
              : undefined;
          const { text: finalPreview, redaction } =
            rawPreview && policy.redactSecrets
              ? redactText(rawPreview)
              : { text: rawPreview, redaction: emptyRedaction() };
          vc.appendNativeEventRef({
            refId: `stdin-${request.executionId}-0`,
            direction: "stdin",
            timestamp: Date.now(),
            rawHash: contentHash(message),
            preview: finalPreview,
            redaction,
          });
        }
        child.stdin.write(message);
      }

      // Yield events as they arrive
      while (!done || queue.length > 0) {
        if (queue.length === 0 && !done) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
        while (queue.length > 0) {
          yield queue.shift()!;
        }
      }
    } catch (error) {
      const runtimeError = toRuntimeError(
        error,
        ErrorCode.BACKEND_PROTOCOL_ERROR,
      );
      this.lastError = runtimeError.message;
      yield this.errorEvent(
        request,
        runtimeError.code,
        runtimeError.message,
        runtimeError.details,
      );
    } finally {
      clearTimeout(timeoutHandle);
      finish();
      child.removeListener("exit", exitHandler);
      this.active.delete(request.executionId);
      this.resetIdleTimer();
    }
  }

  // ─── Per-execution process (Gemini style) ──────────────────────

  private async *streamPerExecution(
    request: RuntimeRequest,
  ): AsyncIterable<RuntimeEvent> {
    const config = this.requireConfig();
    const executable = config.executable ?? this.options.defaultExecutable;
    const resolvedExecutable = await resolveExecutable(executable, config.env);
    const child = spawn(resolvedExecutable, this.options.buildArgs(request), {
      stdio: "pipe",
      cwd: request.workingDirectory,
      env: buildBackendProcessEnv(config.env),
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.active.set(request.executionId, child);

    // Record link visibility: command and process info
    const vc = this.getVc(request.executionId);
    const spawnSpanId = vc?.startSpan("backend.spawn", {
      executable: resolvedExecutable,
      args: redactArgs(this.options.buildArgs(request)).args,
    });
    const processStartedAt = Date.now();
    if (vc) {
      const { args: redactedArgsArr } = redactArgs(
        this.options.buildArgs(request),
      );
      vc.setLinkCommand({
        command: {
          executable: resolvedExecutable,
          args: redactedArgsArr,
          envSummary: summarizeEnv(config.env ?? {}),
          workingDirectory: request.workingDirectory,
        },
        protocol: this.options.protocol ?? {
          name: this.name === "hermes" ? "acp" : "stream-json",
          stdinMode: this.options.buildInput ? "prompt" : "none",
          stdoutMode: "ndjson",
          stderrCaptured: true,
        },
      });
    }

    const timeout = setTimeout(() => {
      this.lastError = `Backend ${this.name} timed out`;
      child.kill("SIGKILL");
    }, config.timeoutMs);
    const spawnError = new Promise<Error | null>((resolve) => {
      child.once("error", (error) => resolve(error));
      child.once("spawn", () => resolve(null));
    });
    const exitResult = new Promise<[number | null, NodeJS.Signals | null]>(
      (resolve) => {
        child.once("exit", (code, signal) => resolve([code, signal]));
      },
    );

    try {
      const input = this.options.buildInput?.(request);
      if (input) {
        const stdinSpanId = vc?.startSpan("backend.stdin.write", {
          byteLength: Buffer.byteLength(input),
        });
        // Record stdin NativeEventRef for visibility
        if (vc) {
          const policy = vc.getPolicy();
          const rawPreview =
            policy.rawProtocol !== "off"
              ? makePreview(input, policy.previewChars)
              : undefined;
          const { text: finalPreview, redaction } =
            rawPreview && policy.redactSecrets
              ? redactText(rawPreview)
              : { text: rawPreview, redaction: emptyRedaction() };
          vc.appendNativeEventRef({
            refId: `stdin-${request.executionId}-0`,
            direction: "stdin",
            timestamp: Date.now(),
            rawHash: contentHash(input),
            preview: finalPreview,
            redaction,
          });
        }
        child.stdin.write(input);
        if (stdinSpanId) vc!.endSpan(stdinSpanId);
      }
      child.stdin.end();

      // stderr handling per Section 7.6
      let stderrBuffer = "";
      const stderrSpanId = vc?.startSpan("backend.stderr.read", {});
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString("utf8");
        if (stderrBuffer.length > STDERR_MAX_BYTES) {
          stderrBuffer = stderrBuffer.slice(-STDERR_MAX_BYTES);
        }
      });

      const stdoutSpanId = vc?.startSpan("backend.stdout.read", {});
      const rl = readline.createInterface({ input: child.stdout });
      let lineCount = 0;
      for await (const line of rl) {
        lineCount++;
        const mapped = this.mapLine(String(line), request);
        for (const event of normalizeMappedEvents(mapped)) {
          yield event;
        }
      }
      if (stdoutSpanId)
        vc!.endSpan(stdoutSpanId, { attributes: { lineCount } });

      const startupError = await spawnError;
      if (startupError) {
        throw startupError;
      }

      const [code, signal] = await exitResult;

      if (stderrSpanId) {
        vc!.endSpan(stderrSpanId, {
          attributes: { byteLength: stderrBuffer.length },
          status: code === 0 ? "ok" : "error",
        });
      }
      // Record stderr NativeEventRef if there was output
      if (vc && stderrBuffer.length > 0) {
        const policy = vc.getPolicy();
        const rawPreview =
          policy.rawProtocol !== "off"
            ? makePreview(stderrBuffer, policy.previewChars)
            : undefined;
        const { text: finalPreview, redaction } =
          rawPreview && policy.redactSecrets
            ? redactText(rawPreview)
            : { text: rawPreview, redaction: emptyRedaction() };
        vc.appendNativeEventRef({
          refId: `stderr-${request.executionId}-0`,
          direction: "stderr",
          timestamp: Date.now(),
          rawHash: contentHash(stderrBuffer),
          preview: finalPreview,
          redaction,
        });
      }

      // Record process exit in visibility
      if (vc) {
        vc.setLinkProcess({
          pid: child.pid,
          startedAt: processStartedAt,
          exitedAt: Date.now(),
          exitCode: code,
          signal: signal ?? undefined,
        });
        if (spawnSpanId)
          vc.endSpan(spawnSpanId, {
            status: code === 0 ? "ok" : "error",
            attributes: { exitCode: code, signal },
          });
      }

      if (code !== 0) {
        // Check stderr for known patterns
        const stderrError = matchStderrPattern(stderrBuffer);
        const errorCode = stderrError?.code ?? ErrorCode.BACKEND_CRASHED;
        const message =
          stderrBuffer.trim() ||
          `Backend exited with code ${code ?? signal ?? "unknown"}`;
        this.lastError = message;
        yield this.errorEvent(request, errorCode, message);
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      const runtimeError = toRuntimeError(
        error,
        nodeError.code === "ENOENT"
          ? ErrorCode.BACKEND_UNAVAILABLE
          : ErrorCode.BACKEND_PROTOCOL_ERROR,
      );
      this.lastError = runtimeError.message;
      if (spawnSpanId) {
        vc?.endSpan(spawnSpanId, {
          status: "error",
          attributes: { error: runtimeError.message },
        });
      }
      yield this.errorEvent(
        request,
        runtimeError.code,
        runtimeError.message,
        runtimeError.details,
      );
    } finally {
      clearTimeout(timeout);
      this.active.delete(request.executionId);
    }
  }

  // ─── Line parsing ──────────────────────────────────────────────

  protected mapLine(
    line: string,
    request: RuntimeRequest,
  ): NativeMappedEvent {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    // Build NativeEventRef for visibility
    const vc = this.getVc(request.executionId);
    let nativeRefId: string | undefined;
    let nativeRef: NativeEventRef | undefined;
    if (vc) {
      const policy = vc.getPolicy();
      const refId = crypto.randomUUID();
      nativeRefId = refId;
      // Apply redaction to preview (P0-5)
      const rawPreview =
        policy.rawProtocol !== "off"
          ? makePreview(trimmed, policy.previewChars)
          : undefined;
      const { text: redactedPreview, redaction } =
        rawPreview && policy.redactSecrets
          ? redactText(rawPreview)
          : { text: rawPreview, redaction: emptyRedaction() };
      nativeRef = {
        refId,
        direction: "stdout",
        timestamp: Date.now(),
        rawHash: contentHash(trimmed),
        preview: redactedPreview,
        redaction,
      };
      vc.appendNativeEventRef(nativeRef);
    }

    let mapped: NativeMappedEvent = null;
    let mappingRule = "generic";
    let parsedAs: NativeEventRef["parsedAs"] = "ignored";

    const parseSpanId = vc?.startSpan("adapter.parse", {
      lineLength: trimmed.length,
    });

    try {
      const value = JSON.parse(trimmed);
      // If parsed value is a JSON primitive (string, number, boolean, null),
      // treat it as plain text output rather than a structured event.
      if (typeof value !== "object" || value === null) {
        mapped = {
          type: "output",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: this.name,
          sequence: 0,
          timestamp: Date.now(),
          data: {
            role: "assistant",
            content: `${String(value)}\n`,
            format: "text",
          },
        };
        mappingRule = "json_primitive_to_output";
      } else {
        // Use backend-specific mapper if provided, otherwise fall back to generic
        if (this.options.mapNativeEvent) {
          mapped = this.options.mapNativeEvent(this.name, request, value);
          mappingRule = `${this.name}_native_mapper`;
        } else {
          mapped = mapNativeJsonToEvent(this.name, request, value);
          mappingRule = "generic_json_mapper";
        }
      }
      const events = normalizeMappedEvents(mapped);
      parsedAs = events[0]?.type ?? "ignored";
      if (parseSpanId) {
        vc!.endSpan(parseSpanId, {
          attributes: {
            mappingRule,
            eventType: events.length === 0 ? "ignored" : events.map((event) => event.type).join(","),
          },
        });
      }
    } catch {
      mapped = {
        type: "output",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend: this.name,
        sequence: 0,
        timestamp: Date.now(),
        data: { role: "assistant", content: `${line}\n`, format: "text" },
      };
      mappingRule = "parse_error_to_text";
      parsedAs = "parse_error";
      if (parseSpanId) {
        vc!.endSpan(parseSpanId, {
          status: "error",
          attributes: { mappingRule },
        });
      }
    }

    // Forward native usage from output events to visibility collector (Fix #1)
    // This ensures adapters don't need to call setNativeUsage() directly —
    // any event with a .data.usage field gets forwarded automatically.
    const events = normalizeMappedEvents(mapped);
    if (vc) {
      for (const event of events) {
        if (event.type !== "output" || !event.data.usage) continue;
        const u = event.data.usage as NativeUsageData;
        vc.setNativeUsage({
          backend: this.name,
          inputTokens:
            typeof u.inputTokens === "number" ? u.inputTokens : undefined,
          outputTokens:
            typeof u.outputTokens === "number" ? u.outputTokens : undefined,
          totalTokens:
            typeof u.totalTokens === "number" ? u.totalTokens : undefined,
          reasoningTokens:
            typeof u.reasoningTokens === "number" ? u.reasoningTokens : undefined,
          cacheReadTokens:
            typeof u.cacheReadTokens === "number" ? u.cacheReadTokens : undefined,
          cacheWriteTokens:
            typeof u.cacheWriteTokens === "number"
              ? u.cacheWriteTokens
              : undefined,
        });
      }
    }

    // Record EventMappingVisibility
    if (vc && nativeRefId) {
      const info = vc.getExecutionInfo();
      const mappingEvents = events.length > 0 ? events : [undefined];
      for (const event of mappingEvents) {
        const mapping: EventMappingVisibility = {
          sessionId: info.sessionId,
          executionId: info.executionId,
          backend: info.backend,
          nativeRefId,
          runtimeEventType: event?.type ?? "ignored",
          mappingRule,
          lossy: events.length === 0 || mappingRule === "parse_error_to_text",
        };
        vc.appendEventMapping(mapping);
      }

      // Backfill parsedAs on the NativeEventRef (P0-4)
      if (nativeRef) {
        nativeRef.parsedAs = parsedAs;
      }
    }

    return mapped;
  }

  protected errorEvent(
    request: RuntimeRequest,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): RuntimeEvent {
    return {
      type: "error",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend: this.name,
      sequence: 0,
      timestamp: Date.now(),
      data: { code, message, details },
    };
  }

  protected requireConfig(): BackendConfig {
    if (!this.config) {
      throw new Error(`Backend ${this.name} is not initialized`);
    }
    return this.config;
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function normalizeMappedEvents(mapped: NativeMappedEvent): RuntimeEvent[] {
  if (!mapped) return [];
  return Array.isArray(mapped) ? mapped : [mapped];
}

function isTerminalEvent(event: RuntimeEvent): boolean {
  if (event.type === "state") {
    return (
      event.data.state === "completed" ||
      event.data.state === "failed" ||
      event.data.state === "interrupted"
    );
  }
  if (event.type === "output" && event.data.final) {
    return true;
  }
  if (event.type === "error") {
    return true;
  }
  return false;
}

function matchStderrPattern(
  stderr: string,
): { pattern: RegExp; code: ErrorCode } | undefined {
  for (const entry of STDERR_ERROR_PATTERNS) {
    if (entry.pattern.test(stderr)) {
      return entry;
    }
  }
  return undefined;
}

function commandExists(
  command: string,
  env: Record<string, string> | undefined,
): boolean {
  if (command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command);
  }

  const pathValue = env?.PATH ?? process.env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = path.join(
        directory,
        process.platform === "win32"
          ? `${command}${extension.toLowerCase()}`
          : command,
      );
      const candidateUpper = path.join(
        directory,
        process.platform === "win32"
          ? `${command}${extension.toUpperCase()}`
          : command,
      );
      if (fs.existsSync(candidate) || fs.existsSync(candidateUpper)) {
        return true;
      }
    }
  }
  return false;
}

function buildBackendProcessEnv(
  configEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of BACKEND_CONFIG_ENV_KEYS) {
    delete env[key];
  }
  return { ...env, ...configEnv };
}

async function resolveExecutable(
  command: string,
  env: Record<string, string> | undefined,
): Promise<string> {
  // If absolute path, return as-is
  if (command.includes("/") || command.includes("\\")) {
    return command;
  }

  // Use which to resolve the full path
  try {
    return await which(command, { path: env?.PATH ?? process.env.PATH });
  } catch {
    // Fallback to original command if which fails
    return command;
  }
}

/** Generic fallback mapper for backends without a specific protocol mapper */
export function mapNativeJsonToEvent(
  backend: BackendName,
  request: RuntimeRequest,
  value: Record<string, unknown>,
): RuntimeEvent {
  const toolName =
    stringProp(value, "name") ??
    stringProp(value, "toolName") ??
    stringProp(value, "tool_name");
  const type =
    stringProp(value, "type") ??
    stringProp(value, "event") ??
    stringProp(value, "method");

  if (type?.includes("tool") && toolName && !type.includes("result")) {
    return {
      type: "tool_call",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId:
          stringProp(value, "id") ?? `${request.executionId}:${Date.now()}`,
        toolName,
        rawToolName: toolName,
        arguments:
          objectProp(value, "input") ?? objectProp(value, "arguments") ?? {},
        approvalRequired: Boolean(value.approvalRequired),
      },
    };
  }

  if (type?.includes("tool") && type.includes("result")) {
    return {
      type: "tool_result",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId:
          stringProp(value, "id") ??
          stringProp(value, "toolCallId") ??
          `${request.executionId}:${Date.now()}`,
        status: value.error ? "error" : "success",
        output: extractText(value),
        error: typeof value.error === "string" ? value.error : undefined,
      },
    };
  }

  if (type === "result" || type === "completed" || type === "done") {
    const text = extractText(value);
    if (text) {
      return {
        type: "output",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        sequence: 0,
        timestamp: Date.now(),
        data: {
          role: "assistant",
          content: text,
          format: "markdown",
          final: true,
        },
      };
    }
  }

  if (type?.includes("error") || value.error) {
    const message =
      typeof value.error === "string"
        ? value.error
        : (stringProp(value, "message") ?? "Backend error");
    return {
      type: "error",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        code: ErrorCode.EXECUTION_FAILED,
        message,
        details: { native: value },
      },
    };
  }

  const text = extractText(value);
  if (text) {
    return {
      type: "output",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        role: "assistant",
        content: text,
        format: "markdown",
        final: type === "result",
      },
    };
  }

  return {
    type: "extension",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: { name: "native_event", payload: value },
  };
}

import { extractText, stringProp } from "./text-utils.js";

function objectProp(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return typeof value[key] === "object" &&
    value[key] !== null &&
    !Array.isArray(value[key])
    ? (value[key] as Record<string, unknown>)
    : undefined;
}
