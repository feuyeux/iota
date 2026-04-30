import { ClaudeCodeAdapter } from "./claude-code.js";
import { ClaudeCodeAcpAdapter } from "./claude-acp.js";
import { CodexAdapter } from "./codex.js";
import { CodexAcpAdapter } from "./codex-acp.js";
import { GeminiAdapter } from "./gemini.js";
import { GeminiAcpAdapter } from "./gemini-acp.js";
import { HermesAdapter } from "./hermes.js";
import { OpenCodeAcpAdapter } from "./opencode-acp.js";
import { CircuitBreaker } from "../error/circuit-breaker.js";
import { ErrorCode, IotaError } from "../error/codes.js";
import type { BackendName } from "../event/types.js";
import type { BackendSection, IotaConfig } from "../config/schema.js";
import type { RedisConfigStore } from "../config/redis-store.js";
import type {
  BackendCapabilities,
  BackendConfig,
  BackendSnapshot,
  HealthStatus,
  RuntimeBackend,
} from "./interface.js";
import type { VisibilityCollector } from "../visibility/collector.js";
import type {
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
} from "../event/types.js";

export class BackendPool {
  private readonly backends = new Map<BackendName, RuntimeBackend>();
  private readonly fallbackBackends = new Map<BackendName, RuntimeBackend>();
  private readonly breakers = new Map<BackendName, CircuitBreaker>();
  private initialized = false;

  constructor(
    private readonly config: IotaConfig,
    private readonly workingDirectory: string,
    private readonly configStore?: RedisConfigStore,
  ) {
    const mcpServers = config.mcp?.servers ?? [];
    this.backends.set(
      "claude-code",
      config.backend.claudeCode.protocol === "acp"
        ? acpWithFallback(
            "claude-code",
            new ClaudeCodeAcpAdapter(
              mcpServers,
              buildAdapterCommandArgs(config.backend.claudeCode, "@anthropic-ai/claude-code-acp"),
            ),
            new ClaudeCodeAdapter(mcpServers),
            this.fallbackBackends,
          )
        : legacyNativeAdapter("claude-code", () => new ClaudeCodeAdapter(mcpServers)),
    );
    this.backends.set(
      "codex",
      config.backend.codex.protocol === "acp"
        ? acpWithFallback(
            "codex",
            new CodexAcpAdapter(
              mcpServers,
              buildAdapterCommandArgs(config.backend.codex, "@openai/codex-acp"),
            ),
            new CodexAdapter(mcpServers),
            this.fallbackBackends,
          )
        : legacyNativeAdapter("codex", () => new CodexAdapter(mcpServers)),
    );
    this.backends.set(
      "gemini",
      config.backend.gemini.protocol === "acp"
        ? acpWithFallback(
            "gemini",
            new GeminiAcpAdapter(
              mcpServers,
              ["--acp", ...(config.backend.gemini.acpAdapterArgs ?? [])],
            ),
            new GeminiAdapter(mcpServers),
            this.fallbackBackends,
          )
        : legacyNativeAdapter("gemini", () => new GeminiAdapter(mcpServers)),
    );
    this.backends.set("hermes", requireAcpOnlyBackend("hermes", config.backend.hermes, () => new HermesAdapter(mcpServers)));
    this.backends.set("opencode", requireAcpOnlyBackend("opencode", config.backend.opencode, () => new OpenCodeAcpAdapter(mcpServers)));
    for (const name of this.backends.keys()) {
      this.breakers.set(name, new CircuitBreaker());
    }
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initPromises: Promise<void>[] = [];

    for (const [name, backend] of this.backends) {
      if (this.config.routing.disabledBackends.includes(name)) {
        continue;
      }
      const backendConfig = await this.resolveBackendConfig(name);
      initPromises.push(backend.init(toRuntimeBackendConfig(backendConfig, this.workingDirectory)));
      const fallback = this.fallbackBackends.get(name);
      if (fallback) {
        initPromises.push(fallback.init(toFallbackBackendConfig(name, backendConfig, this.workingDirectory)));
      }
    }

    // Initialize all enabled backends (warm processes start during init for long-lived)
    const results = await Promise.allSettled(initPromises);
    for (const result of results) {
      if (result.status === "rejected") {
        // Non-fatal: backend may not be installed
        // The circuit breaker will handle it at execution time
      }
    }

    this.initialized = true;
  }

  get(name: BackendName): RuntimeBackend {
    const backend = this.backends.get(name);
    if (!backend || this.config.routing.disabledBackends.includes(name)) {
      throw new IotaError({
        code: ErrorCode.BACKEND_NOT_FOUND,
        message: `Backend ${name} is not available`,
      });
    }
    const breaker = this.breakers.get(name);
    if (breaker && !breaker.canPass()) {
      throw new IotaError({
        code: ErrorCode.BACKEND_UNAVAILABLE,
        message: `Backend ${name} circuit breaker is open`,
        retryable: true,
      });
    }
    return breaker ? new CircuitBreakerBackend(backend, breaker) : backend;
  }

  async probeAll(): Promise<void> {
    for (const [name, backend] of this.backends) {
      if (this.config.routing.disabledBackends.includes(name)) continue;
      try {
        const health = await backend.probe();
        const breaker = this.breakers.get(name);
        if (breaker) {
          if (health.healthy) {
            breaker.success();
          } else if (health.status === "crashed") {
            breaker.failure();
          }
        }
      } catch {
        this.breakers.get(name)?.failure();
      }
    }
  }

  async status(): Promise<
    Record<BackendName, Awaited<ReturnType<RuntimeBackend["probe"]>>>
  > {
    const result = {} as Record<
      BackendName,
      Awaited<ReturnType<RuntimeBackend["probe"]>>
    >;
    for (const [name, backend] of this.backends) {
      const status = await backend.probe();
      const breakerState = this.breakers.get(name)?.getState();
      result[name] =
        breakerState === "open"
          ? {
              ...status,
              healthy: false,
              status: "degraded",
              lastError: status.lastError ?? "Circuit breaker is open",
            }
          : status;
    }
    return result;
  }

  getCapabilities(): Record<BackendName, BackendCapabilities> {
    const result = {} as Record<BackendName, BackendCapabilities>;
    for (const [name, backend] of this.backends) {
      result[name] = backend.capabilities;
    }
    return result;
  }

  resetBreaker(name: BackendName): boolean {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
      return true;
    }
    return false;
  }

  async destroy(): Promise<void> {
    await Promise.all(
      [...this.backends.values()].map((backend) => backend.destroy()),
    );
    this.initialized = false;
  }

  private backendConfig(name: BackendName): BackendSection {
    switch (name) {
      case "claude-code":
        return this.config.backend.claudeCode;
      case "codex":
        return this.config.backend.codex;
      case "gemini":
        return this.config.backend.gemini;
      case "hermes":
        return this.config.backend.hermes;
      case "opencode":
        return this.config.backend.opencode;
    }
  }

  private async resolveBackendConfig(
    name: BackendName,
  ): Promise<BackendSection> {
    const base = this.backendConfig(name);
    const resolved: BackendSection = {
      ...base,
      env: { ...base.env },
    };
    const scoped = await this.configStore?.get("backend", name);
    if (!scoped) {
      return resolved;
    }

    const sectionKey = backendSectionKey(name);
    const fullPrefix = `backend.${sectionKey}.`;
    for (const [rawKey, rawValue] of Object.entries(scoped)) {
      const key = rawKey.startsWith(fullPrefix)
        ? rawKey.slice(fullPrefix.length)
        : rawKey;
      applyBackendScopedValue(resolved, key, rawValue);
    }
    return resolved;
  }
}





function requireAcpOnlyBackend<T extends RuntimeBackend>(
  backend: BackendName,
  section: BackendSection,
  factory: () => T,
): T {
  if (section.protocol === "native") {
    throw new IotaError({
      code: ErrorCode.BACKEND_NOT_FOUND,
      message: `Backend ${backend} does not provide a native protocol adapter; use protocol: acp`,
    });
  }
  return factory();
}

function acpWithFallback(
  backend: BackendName,
  acp: RuntimeBackend,
  fallback: RuntimeBackend,
  fallbackBackends: Map<BackendName, RuntimeBackend>,
): RuntimeBackend {
  fallbackBackends.set(backend, fallback);
  return new AcpFallbackBackend(backend, acp, fallback);
}

function toRuntimeBackendConfig(
  section: BackendSection,
  workingDirectory: string,
): BackendConfig {
  return {
    executable: section.executable,
    timeoutMs: section.timeoutMs,
    workingDirectory,
    env: section.env,
    protocol: section.protocol,
    acpAdapter: section.acpAdapter,
    acpAdapterArgs: section.acpAdapterArgs,
    processMode: section.processMode,
  };
}

function toFallbackBackendConfig(
  backend: BackendName,
  section: BackendSection,
  workingDirectory: string,
): BackendConfig {
  const nativeExecutable: Partial<Record<BackendName, string>> = {
    "claude-code": "claude",
    codex: "codex",
    gemini: "gemini",
  };
  return {
    ...toRuntimeBackendConfig(section, workingDirectory),
    executable: nativeExecutable[backend] ?? section.executable,
    protocol: "native",
    acpAdapter: undefined,
    acpAdapterArgs: undefined,
    processMode: "per-execution",
  };
}

function legacyNativeAdapter<T extends RuntimeBackend>(
  backend: BackendName,
  factory: () => T,
): T {
  if (process.env.IOTA_DEBUG_ACP === "true") {
    console.warn(
      `[iota-engine] Using legacy native adapter for ${backend}; consider switching to protocol: acp`,
    );
  }
  return factory();
}

function buildAdapterCommandArgs(
  section: BackendSection,
  defaultPackage: string,
): string[] {
  return [section.acpAdapter ?? defaultPackage, ...(section.acpAdapterArgs ?? [])];
}

function backendSectionKey(name: BackendName): keyof IotaConfig["backend"] {
  switch (name) {
    case "claude-code":
      return "claudeCode";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "hermes":
      return "hermes";
    case "opencode":
      return "opencode";
  }
}

function applyBackendScopedValue(
  config: BackendSection,
  key: string,
  value: string,
): void {
  if (key === "executable") {
    config.executable = value;
    return;
  }
  if (key === "protocol") {
    if (value !== "native" && value !== "acp") {
      throw new Error(`Invalid backend protocol: ${value}`);
    }
    config.protocol = value;
    return;
  }
  if (key === "acpAdapter") {
    config.acpAdapter = value;
    return;
  }
  if (key === "acpAdapterArgs") {
    config.acpAdapterArgs = value ? value.split(/\s+/).filter(Boolean) : [];
    return;
  }
  if (key === "processMode") {
    if (value !== "per-execution" && value !== "long-lived") {
      throw new Error(`Invalid backend processMode: ${value}`);
    }
    config.processMode = value;
    return;
  }
  if (key === "timeoutMs" || key === "timeout") {
    const timeoutMs = Number(value);
    if (!Number.isFinite(timeoutMs)) {
      throw new Error(`Invalid backend timeout: ${value}`);
    }
    config.timeoutMs = timeoutMs;
    return;
  }
  if (key.startsWith("env.")) {
    const envKey = key.slice("env.".length);
    if (envKey) {
      config.env[envKey] = value;
    }
  }
}


export class AcpFallbackBackend implements RuntimeBackend {
  constructor(
    private readonly backendName: BackendName,
    private readonly acp: RuntimeBackend,
    private readonly fallback: RuntimeBackend,
  ) {}

  get name(): BackendName {
    return this.acp.name;
  }

  get capabilities(): BackendCapabilities {
    return this.acp.capabilities;
  }

  async init(config: BackendConfig): Promise<void> {
    return this.acp.init(config);
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeEvent> {
    let emitted = false;
    try {
      for await (const event of this.acp.stream(request)) {
        emitted = true;
        yield event;
      }
    } catch (error) {
      // If ACP already emitted events, the caller has partial results — re-throw
      // so it can handle the mid-stream failure. Otherwise, silently degrade to
      // the legacy native subprocess adapter so the request still succeeds.
      if (emitted) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[iota-engine] ACP adapter for backend "${this.backendName}" failed before emitting events (${msg}); falling back to legacy native adapter`,
      );
      yield* this.fallback.stream(request);
    }
  }

  async execute(request: RuntimeRequest): Promise<RuntimeResponse> {
    const events: RuntimeEvent[] = [];
    const chunks: string[] = [];
    let failed = false;
    let usage: RuntimeResponse["usage"];
    for await (const event of this.stream(request)) {
      events.push(event);
      if (event.type === "output") {
        chunks.push(event.data.content);
        if (event.data.usage) usage = event.data.usage;
      }
      if (event.type === "error") failed = true;
    }
    return {
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend: this.name,
      status: failed ? "failed" : "completed",
      output: chunks.join(""),
      events,
      usage,
      error: events.find((event) => event.type === "error")?.data,
    };
  }

  async interrupt(executionId: string): Promise<void> {
    await Promise.all([
      this.acp.interrupt(executionId),
      this.fallback.interrupt(executionId),
    ]);
  }

  async snapshot(sessionId: string): Promise<BackendSnapshot> {
    return this.acp.snapshot(sessionId);
  }

  async probe(): Promise<HealthStatus> {
    return this.acp.probe();
  }

  async destroy(): Promise<void> {
    await Promise.all([this.acp.destroy(), this.fallback.destroy()]);
  }

  setVisibilityCollector(
    collector: VisibilityCollector | undefined,
    executionId?: string,
  ): void {
    this.acp.setVisibilityCollector?.(collector, executionId);
    this.fallback.setVisibilityCollector?.(collector, executionId);
  }

  sendNativeResponse(executionId: string, event: RuntimeEvent): boolean {
    return (
      this.acp.sendNativeResponse?.(executionId, event) ??
      this.fallback.sendNativeResponse?.(executionId, event) ??
      false
    );
  }
}

class CircuitBreakerBackend implements RuntimeBackend {
  constructor(
    private readonly inner: RuntimeBackend,
    private readonly breaker: CircuitBreaker,
  ) {}

  get name(): BackendName {
    return this.inner.name;
  }

  get capabilities(): RuntimeBackend["capabilities"] {
    return this.inner.capabilities;
  }

  async init(config: BackendConfig): Promise<void> {
    return this.inner.init(config);
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeEvent> {
    let failed = false;
    try {
      for await (const event of this.inner.stream(request)) {
        if (event.type === "error") {
          failed = true;
        }
        yield event;
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (failed) {
        this.breaker.failure();
      } else {
        this.breaker.success();
      }
    }
  }

  async execute(request: RuntimeRequest): Promise<RuntimeResponse> {
    const response = await this.inner.execute(request);
    if (response.status === "completed") {
      this.breaker.success();
    } else {
      this.breaker.failure();
    }
    return response;
  }

  async interrupt(executionId: string): Promise<void> {
    return this.inner.interrupt(executionId);
  }

  async snapshot(sessionId: string): Promise<BackendSnapshot> {
    return this.inner.snapshot(sessionId);
  }

  async probe(): Promise<HealthStatus> {
    return this.inner.probe();
  }

  async destroy(): Promise<void> {
    return this.inner.destroy();
  }

  setVisibilityCollector(
    collector: VisibilityCollector | undefined,
    executionId?: string,
  ): void {
    this.inner.setVisibilityCollector?.(collector, executionId);
  }

  sendNativeResponse(executionId: string, event: RuntimeEvent): boolean {
    if (this.inner.sendNativeResponse) {
      return this.inner.sendNativeResponse(executionId, event);
    }
    return false;
  }
}
