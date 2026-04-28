import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { encodeAcp } from "../protocol/acp.js";
import { ErrorCode } from "../error/codes.js";
import { SubprocessBackendAdapter } from "./subprocess.js";
import { composeEffectivePrompt } from "./prompt-composer.js";
import type { BackendConfig } from "./interface.js";
import type {
  BackendName,
  RuntimeEvent,
  RuntimeRequest,
} from "../event/types.js";

/**
 * HermesAdapter — Section 7.5
 * ACP JSON-RPC 2.0 over stdio, long-lived process.
 *
 * ACP protocol flow (v0.11):
 *   1. initialize        — handshake (sent once on warm-up via initMessage)
 *   2. session/new        — create a session (sent before first prompt)
 *   3. session/prompt     — send user message (content blocks)
 *
 * Notifications from agent → client:
 *   session/update, session/request_permission, session/complete
 */
export class HermesAdapter extends SubprocessBackendAdapter {
  private generatedHermesHome?: string;

  constructor() {
    // Shared state between closures: maps our sessionId → hermes sessionId
    const sessionMap = new Map<string, string>();
    // Pending session/new requests: maps request id → our sessionId
    const pendingNewSessions = new Map<string, string>();
    // Deferred prompts waiting for session/new to resolve
    const deferredPrompts = new Map<string, { id: string; prompt: string }>();
    // Mutable ref to the adapter — set after super() returns
    const self: { adapter?: HermesAdapter } = {};

    super({
      name: "hermes",
      defaultExecutable: "hermes",
      processMode: "long-lived",
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: true,
        acp: true,
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 128_000,
        promptOnlyInput: true,
      },
      protocol: {
        name: "acp",
        stdinMode: "message",
        stdoutMode: "ndjson",
        stderrCaptured: true,
      },
      buildArgs: () => ["acp"],
      // initialize handshake on warm-up
      initMessage: () =>
        encodeAcp({
          id: "init-0",
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "iota-engine", version: "0.1.0" },
          },
        }),
      buildInput: () => undefined,
      buildMessage: (request) => {
        let messages = "";
        // Create session if not mapped yet
        if (!sessionMap.has(request.sessionId)) {
          const newReqId = `${request.executionId}:new`;
          pendingNewSessions.set(newReqId, request.sessionId);
          messages += encodeAcp({
            id: newReqId,
            method: "session/new",
            params: {
              cwd: request.workingDirectory || process.cwd(),
              mcpServers: [],
            },
          });
          // Can't send session/prompt yet — hermes sessionId unknown.
          // Deferred: mapNativeEvent will send it when session/new responds.
          deferredPrompts.set(request.sessionId, {
            id: request.executionId,
            prompt: composeEffectivePrompt(request),
          });
          return messages;
        }
        // Session already mapped — just send prompt
        messages += encodeAcp({
          id: request.executionId,
          method: "session/prompt",
          params: {
            sessionId: sessionMap.get(request.sessionId)!,
            prompt: [{ type: "text", text: composeEffectivePrompt(request) }],
          },
        });
        return messages;
      },
      mapNativeEvent: (backend, request, value) => {
        // Intercept session/new responses to capture the real sessionId
        if (value.result !== undefined && value.id !== undefined) {
          const id = String(value.id);
          const ourSessionId = pendingNewSessions.get(id);
          if (ourSessionId) {
            pendingNewSessions.delete(id);
            const result = value.result as Record<string, unknown>;
            const hermesSessionId =
              typeof result.sessionId === "string"
                ? result.sessionId
                : ourSessionId;
            sessionMap.set(ourSessionId, hermesSessionId);

            // Send deferred prompt now via sendNativeResponse (writes to stdin)
            const deferred = deferredPrompts.get(ourSessionId);
            if (deferred) {
              deferredPrompts.delete(ourSessionId);
              const promptMsg = encodeAcp({
                id: deferred.id,
                method: "session/prompt",
                params: {
                  sessionId: hermesSessionId,
                  prompt: [{ type: "text", text: deferred.prompt }],
                },
              });
              self.adapter?.writeToStdin(deferred.id, promptMsg);
            }
            // Don't emit session/new response as user-visible event
            return null;
          }
          // Suppress initialize response
          if (id === "init-0") {
            return null;
          }
        }
        return mapHermesEvent(backend, request, value);
      },
      buildNativeResponse: (event) => {
        // Approval response for Hermes request_permission
        if (
          event.type === "extension" &&
          event.data.name === "approval_decision"
        ) {
          const approved = event.data.payload?.approved === true;
          const requestId = event.data.payload?.requestId;
          return encodeAcp({
            id:
              typeof requestId === "string" || typeof requestId === "number"
                ? requestId
                : null,
            result: { approved },
          });
        }
        // MCP tool result
        if (event.type === "tool_result") {
          return encodeAcp({
            id: event.data.toolCallId as string,
            result: {
              output: event.data.output ?? event.data.error ?? "",
              error:
                event.data.status === "error" ? event.data.error : undefined,
            },
          });
        }
        return undefined;
      },
    });
    self.adapter = this;
  }

  async init(config: BackendConfig): Promise<void> {
    this.cleanupGeneratedHermesHome();
    const prepared = prepareHermesBackendConfig(config);
    this.generatedHermesHome = prepared.generatedHermesHome;
    return super.init(prepared.config);
  }

  async destroy(): Promise<void> {
    await super.destroy();
    this.cleanupGeneratedHermesHome();
  }

  private cleanupGeneratedHermesHome(): void {
    if (!this.generatedHermesHome) return;
    fs.rmSync(this.generatedHermesHome, { recursive: true, force: true });
    this.generatedHermesHome = undefined;
  }
}

export function prepareHermesBackendConfig(config: BackendConfig): {
  config: BackendConfig;
  generatedHermesHome?: string;
} {
  const env = { ...(config.env ?? {}) };
  const hermesConfig = resolveHermesDistributedConfig(env);
  if (!hermesConfig) {
    return { config };
  }

  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "iota-hermes-"));
  fs.chmodSync(hermesHome, 0o700);
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    yaml.dump(
      {
        model: {
          default: hermesConfig.model,
          provider: hermesConfig.provider,
          base_url: hermesConfig.baseUrl,
        },
        toolsets: ["hermes-acp"],
        terminal: {
          backend: "local",
          cwd: ".",
        },
      },
      { lineWidth: -1, noRefs: true },
    ),
    { mode: 0o600 },
  );

  return {
    generatedHermesHome: hermesHome,
    config: {
      ...config,
      env: {
        ...env,
        HERMES_HOME: hermesHome,
        HERMES_INFERENCE_PROVIDER: hermesConfig.provider,
        ...renderHermesProviderEnv(hermesConfig),
      },
    },
  };
}

interface HermesDistributedConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

function resolveHermesDistributedConfig(
  env: Record<string, string>,
): HermesDistributedConfig | undefined {
  const apiKey = firstNonEmpty(env.HERMES_API_KEY, env.HERMES_AUTH_TOKEN);
  const baseUrl = firstNonEmpty(env.HERMES_BASE_URL, env.HERMES_ENDPOINT);
  const model = firstNonEmpty(env.HERMES_MODEL, env.HERMES_DEFAULT_MODEL);
  const explicitProvider = firstNonEmpty(
    env.HERMES_PROVIDER,
    env.HERMES_INFERENCE_PROVIDER,
  );

  if (!apiKey && !baseUrl && !model && !explicitProvider) {
    return undefined;
  }

  const provider = explicitProvider || inferHermesProvider(baseUrl);
  return {
    provider,
    model: model || "MiniMax-M2.7",
    baseUrl: baseUrl || defaultHermesBaseUrl(provider),
    apiKey,
  };
}

function inferHermesProvider(baseUrl: string): string {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes("minimaxi.com")) return "minimax-cn";
  if (normalized.includes("minimax.io")) return "minimax";
  if (normalized.includes("anthropic.com")) return "anthropic";
  return "custom";
}

function defaultHermesBaseUrl(provider: string): string {
  switch (provider) {
    case "minimax-cn":
      return "https://api.minimaxi.com/anthropic";
    case "minimax":
      return "https://api.minimax.io/anthropic";
    case "anthropic":
      return "https://api.anthropic.com";
    default:
      return "";
  }
}

function renderHermesProviderEnv(
  config: HermesDistributedConfig,
): Record<string, string> {
  const env: Record<string, string> = {
    HERMES_INFERENCE_PROVIDER: config.provider,
    HERMES_MODEL: config.model,
  };

  if (config.provider === "minimax-cn") {
    env.MINIMAX_CN_API_KEY = config.apiKey;
    env.MINIMAX_CN_BASE_URL = config.baseUrl;
  } else if (config.provider === "minimax") {
    env.MINIMAX_API_KEY = config.apiKey;
    env.MINIMAX_BASE_URL = config.baseUrl;
  } else if (config.provider === "anthropic") {
    env.ANTHROPIC_API_KEY = config.apiKey;
    env.ANTHROPIC_TOKEN = config.apiKey;
    env.ANTHROPIC_BASE_URL = config.baseUrl;
  } else {
    env.OPENAI_API_KEY = config.apiKey;
    env.OPENAI_BASE_URL = config.baseUrl;
  }

  for (const [key, value] of Object.entries(env)) {
    if (value.length === 0) {
      delete env[key];
    }
  }

  return env;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? "";
}

function mapHermesEvent(
  backend: BackendName,
  request: RuntimeRequest,
  value: Record<string, unknown>,
): RuntimeEvent | null {
  const method = typeof value.method === "string" ? value.method : undefined;
  const params =
    typeof value.params === "object" && value.params !== null
      ? (value.params as Record<string, unknown>)
      : {};

  // ACP session/update
  if (method === "session/update" || method === "session_update") {
    const update =
      typeof params.update === "object" && params.update !== null
        ? (params.update as Record<string, unknown>)
        : undefined;
    const sessionUpdate = update?.sessionUpdate as string | undefined;
    const content =
      typeof update?.content === "object" && update?.content !== null
        ? (update.content as Record<string, unknown>)
        : undefined;
    const text =
      (content?.text as string | undefined) ??
      (typeof params.content === "string" ? params.content : undefined) ??
      (typeof params.text === "string" ? params.text : undefined) ??
      (typeof params.message === "string" ? params.message : undefined);

    if (
      text &&
      (sessionUpdate === "agent_message_chunk" ||
        sessionUpdate === "agent_message")
    ) {
      return {
        type: "output",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        sequence: 0,
        timestamp: Date.now(),
        data: { role: "assistant", content: text, format: "markdown" },
      };
    }
    if (
      text &&
      (sessionUpdate === "agent_thought_chunk" ||
        sessionUpdate === "agent_thought")
    ) {
      return {
        type: "extension",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        sequence: 0,
        timestamp: Date.now(),
        data: { name: "thinking", payload: { text } },
      };
    }
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: { name: "hermes_session_update", payload: value },
    };
  }

  // ACP session/request_permission → approval
  if (
    method === "session/request_permission" ||
    method === "request_permission" ||
    method === "permission/request"
  ) {
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        name: "approval_request",
        payload: {
          operationType:
            typeof params.type === "string" ? params.type : "shell",
          requestId: value.id ?? null,
          ...params,
        },
      },
    };
  }

  if (method === "session/memory") {
    const memory =
      typeof params.memory === "object" && params.memory !== null
        ? (params.memory as Record<string, unknown>)
        : {};
    return {
      type: "memory",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp:
        typeof memory.timestamp === "number"
          ? memory.timestamp
          : Date.now(),
      data: {
        nativeType:
          typeof memory.nativeType === "string"
            ? memory.nativeType
            : "dialogue_memory",
        content:
          typeof memory.content === "string" ? memory.content : "",
        metadata:
          typeof memory.metadata === "object" && memory.metadata !== null
            ? (memory.metadata as Record<string, unknown>)
            : undefined,
      },
    };
  }

  // ACP session/complete — terminal event
  if (method === "session/complete" || method === "session_complete") {
    const text =
      typeof params.content === "string"
        ? params.content
        : typeof params.text === "string"
          ? params.text
          : typeof params.result === "string"
            ? params.result
            : typeof params.message === "string"
              ? params.message
              : "";
    // Extract native usage from session/complete (Section 5.3)
    const usage = params.usage as Record<string, unknown> | undefined;
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
        ...(usage
          ? {
              usage: {
                inputTokens:
                  typeof usage.inputTokens === "number"
                    ? usage.inputTokens
                    : typeof usage.input_tokens === "number"
                      ? usage.input_tokens
                      : undefined,
                outputTokens:
                  typeof usage.outputTokens === "number"
                    ? usage.outputTokens
                    : typeof usage.output_tokens === "number"
                      ? usage.output_tokens
                      : undefined,
              },
            }
          : {}),
      },
    };
  }

  // ACP tool call
  if (method?.includes("tool") && !method.includes("result")) {
    const toolName =
      typeof params.name === "string"
        ? params.name
        : typeof params.tool === "string"
          ? params.tool
          : "unknown";
    return {
      type: "tool_call",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId:
          typeof value.id === "string" || typeof value.id === "number"
            ? String(value.id)
            : `${request.executionId}:${Date.now()}`,
        toolName,
        rawToolName: toolName,
        arguments: (typeof params.arguments === "object" &&
        params.arguments !== null
          ? params.arguments
          : (params.input ?? {})) as Record<string, unknown>,
        approvalRequired: false,
      },
    };
  }

  // ACP tool result
  if (method?.includes("tool") && method.includes("result")) {
    return {
      type: "tool_result",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId:
          typeof value.id === "string" || typeof value.id === "number"
            ? String(value.id)
            : `${request.executionId}:${Date.now()}`,
        status: params.error ? "error" : "success",
        output:
          typeof params.output === "string"
            ? params.output
            : typeof params.result === "string"
              ? params.result
              : undefined,
        error: typeof params.error === "string" ? params.error : undefined,
      },
    };
  }

  // JSON-RPC response (result to our request)
  if (value.result !== undefined && value.id !== undefined) {
    const result = value.result as Record<string, unknown>;
    const text =
      typeof result === "string"
        ? result
        : typeof result.content === "string"
          ? result.content
          : typeof result.output === "string"
            ? result.output
            : undefined;
    // session/prompt response with stopReason is terminal
    const stopReason =
      typeof result.stopReason === "string" ? result.stopReason : undefined;
    if (stopReason) {
      const usage =
        typeof result.usage === "object" && result.usage !== null
          ? (result.usage as Record<string, unknown>)
          : undefined;
      return {
        type: "output",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        sequence: 0,
        timestamp: Date.now(),
        data: {
          role: "assistant",
          content: text ?? "",
          format: "markdown",
          final: true,
          ...(usage
            ? {
                usage: {
                  inputTokens:
                    typeof usage.inputTokens === "number"
                      ? usage.inputTokens
                      : typeof usage.input_tokens === "number"
                        ? usage.input_tokens
                        : undefined,
                  outputTokens:
                    typeof usage.outputTokens === "number"
                      ? usage.outputTokens
                      : typeof usage.output_tokens === "number"
                        ? usage.output_tokens
                        : undefined,
                  totalTokens:
                    typeof usage.totalTokens === "number"
                      ? usage.totalTokens
                      : typeof usage.total_tokens === "number"
                        ? usage.total_tokens
                        : undefined,
                  cacheReadTokens:
                    typeof usage.cachedReadTokens === "number"
                      ? usage.cachedReadTokens
                      : typeof usage.cache_read_input_tokens === "number"
                        ? usage.cache_read_input_tokens
                        : undefined,
                },
              }
            : {}),
        },
      };
    }
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
          content: text as string,
          format: "markdown",
          final: true,
        },
      };
    }
  }

  // JSON-RPC error response
  if (value.error !== undefined && value.id !== undefined) {
    const error = value.error as Record<string, unknown>;
    return {
      type: "error",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        code: ErrorCode.EXECUTION_FAILED,
        message:
          typeof error.message === "string"
            ? error.message
            : "Hermes ACP error",
        details: { native: value },
      },
    };
  }

  // Preserve unknown
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
