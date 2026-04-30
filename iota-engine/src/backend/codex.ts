import { SubprocessBackendAdapter } from "./subprocess.js";
import { composeEffectivePrompt } from "./prompt-composer.js";
import { buildCodexMcpConfigArgs } from "./mcp-config.js";
import { ErrorCode } from "../error/codes.js";
import type {
  BackendName,
  McpServerDescriptor,
  RuntimeEvent,
  RuntimeRequest,
} from "../event/types.js";

// ─── Narrow interface types for native Codex NDJSON events ───────────────────

/** A message object nested inside Codex events. */
interface CodexMessage {
  content?: string;
  [key: string]: unknown;
}

/** An item object within item.started / item.completed events. */
interface CodexItem {
  type?: string;
  id?: string;
  tool?: string;
  server?: string;
  arguments?: Record<string, unknown>;
  error?: string;
  result?: CodexMcpResult;
  [key: string]: unknown;
}

/** MCP result payload returned inside a completed mcp_tool_call item. */
interface CodexMcpResult {
  content?: CodexMcpContentPart[];
  [key: string]: unknown;
}

/** A single content part inside MCP result content array. */
interface CodexMcpContentPart {
  text?: string;
  [key: string]: unknown;
}

/** OpenAI-compatible usage statistics. */
interface CodexUsage {
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
  output_tokens?: number;
  outputTokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  reasoning_output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; [key: string]: unknown };
  [key: string]: unknown;
}

/** Metadata payload attached to memory events. */
interface CodexMetadataPayload {
  [key: string]: unknown;
}

/**
 * @deprecated Legacy native fallback. Prefer `protocol: acp` once the ACP adapter is available.
 * CodexAdapter — Section 7.3
 * Uses codex exec command for per-execution mode.
 * Reads distributed backend config and only passes non-secret settings as -c flags.
 * Secrets must stay in process env so they do not appear in the child process argv.
 */
export class CodexAdapter extends SubprocessBackendAdapter {
  private configuredModel?: string;

  constructor(private readonly mcpServers: McpServerDescriptor[] = []) {
    super({
      name: "codex",
      defaultExecutable: "codex",
      processMode: "per-execution",
      capabilities: {
        sandbox: true,
        mcp: true,
        mcpResponseChannel: false,
        acp: false,
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 200_000,
        promptOnlyInput: true,
      },
      protocol: {
        name: "ndjson",
        stdinMode: "prompt",
        stdoutMode: "ndjson",
        stderrCaptured: true,
      },
      buildArgs: (request) => this.buildCodexArgs(request),
      buildInput: (request) => composeEffectivePrompt(request, this),
      mapNativeEvent: mapCodexEvent,
    });
  }

  private buildCodexArgs(_request: RuntimeRequest): string[] {
    const args = ["exec", "--json"];
    if (this.mcpServers.length > 0) {
      // Codex exec cancels external MCP calls in sandboxed non-interactive runs.
      // iota-fun is already the configured MCP boundary, so allow the child MCP
      // server to run its local language runtimes.
      args.push("--sandbox", "danger-full-access");
    }
    args.push(...buildCodexMcpConfigArgs(this.mcpServers));
    try {
      const config = this.requireConfig();
      const env = config.env ?? {};

      if (env.OPENAI_MODEL) {
        args.push("-c", `model=${env.OPENAI_MODEL}`);
        this.configuredModel = env.OPENAI_MODEL;
      }

      // Prefer a named provider registered in ~/.codex/config.toml
      // ([model_providers.<name>]). This is the only way to set wire_api,
      // env_key, retries, etc. Falling back to `openai_base_url` alone
      // would keep the default "chat" wire_api which many OpenAI-compatible
      // proxies (e.g. 9router with wire_api = "responses") do not implement.
      if (env.CODEX_MODEL_PROVIDER) {
        args.push("-c", `model_provider=${env.CODEX_MODEL_PROVIDER}`);
      } else if (env.OPENAI_BASE_URL) {
        args.push("-c", `openai_base_url=${env.OPENAI_BASE_URL}`);
      }
    } catch {
      // Config not initialized yet — fall back to defaults
    }
    return args;
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }
}

// ─── Codex native event mapper ────────────────────────────────

import { stringProp } from "./text-utils.js";

function extractCodexText(value: Record<string, unknown>): string | undefined {
  const text = stringProp(value, "text") ?? stringProp(value, "content");
  if (text) return text;
  if (typeof value.message === "string") return value.message;
  if (
    typeof value.message === "object" &&
    value.message !== null &&
    typeof (value.message as CodexMessage).content === "string"
  ) {
    return (value.message as CodexMessage).content as string;
  }
  return undefined;
}

/**
 * Map Codex NDJSON events to RuntimeEvents.
 * Handles OpenAI-compatible usage fields (prompt_tokens, completion_tokens, total_tokens).
 */
function mapCodexEvent(
  backend: BackendName,
  request: RuntimeRequest,
  value: Record<string, unknown>,
): RuntimeEvent | null {
  const type = stringProp(value, "type") ?? stringProp(value, "event");

  // Extract usage from any event that carries it (typically "result" or final output)
  const usage = value.usage as CodexUsage | undefined;

  if (type === "thread.started" || type === "turn.started") {
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: { name: "codex_lifecycle", payload: value },
    };
  }

  if (type === "item.completed") {
    const item =
      typeof value.item === "object" && value.item !== null
        ? (value.item as CodexItem)
        : ({} as CodexItem);
    if (item.type === "mcp_tool_call") {
      return mapCodexMcpToolCall(backend, request, item);
    }
    if (item.type === "agent_message") {
      const text = extractCodexText(item as Record<string, unknown>);
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
          },
        };
      }
    }
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: { name: "codex_item", payload: value },
    };
  }

  if (type === "item.started") {
    const item =
      typeof value.item === "object" && value.item !== null
        ? (value.item as CodexItem)
        : ({} as CodexItem);
    if (item.type === "mcp_tool_call") {
      const toolName =
        stringProp(item as Record<string, unknown>, "tool") ?? "unknown";
      const serverName =
        stringProp(item as Record<string, unknown>, "server") ?? "unknown";
      const toolArguments =
        typeof item.arguments === "object" && item.arguments !== null
          ? (item.arguments as Record<string, unknown>)
          : {};
      if (
        toolName === "unknown" &&
        serverName === "unknown" &&
        Object.keys(toolArguments).length === 0
      ) {
        return {
          type: "extension",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend,
          sequence: 0,
          timestamp: Date.now(),
          data: { name: "codex_item", payload: value },
        };
      }
      return {
        type: "tool_call",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        sequence: 0,
        timestamp: Date.now(),
        data: {
          toolCallId:
            stringProp(item as Record<string, unknown>, "id") ??
            `${request.executionId}:mcp`,
          toolName,
          rawToolName: `${serverName}/${toolName}`,
          arguments: toolArguments,
          approvalRequired: false,
        },
      };
    }
  }

  if (type === "turn.completed") {
    return {
      type: "output",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        role: "assistant",
        content: "",
        format: "markdown",
        final: true,
        ...(usage ? { usage: extractUsage(usage) } : {}),
      },
    };
  }

  if (type === "memory") {
    const metadata =
      typeof value.metadata === "object" && value.metadata !== null
        ? (value.metadata as CodexMetadataPayload)
        : undefined;
    return {
      type: "memory",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp:
        typeof value.timestamp === "number" ? value.timestamp : Date.now(),
      data: {
        nativeType:
          typeof value.nativeType === "string"
            ? value.nativeType
            : "session_history",
        content: extractCodexText(value) ?? "",
        metadata,
      },
    };
  }

  if (type === "error" || value.error) {
    const message =
      stringProp(value, "message") ??
      stringProp(value, "error") ??
      "Codex error";
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

  // Result/completed events
  if (type === "result" || type === "completed" || type === "done") {
    const text = extractCodexText(value) ?? "";
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
        ...(usage ? { usage: extractUsage(usage) } : {}),
      },
    };
  }

  // Message delta / streaming output
  if (type === "message_delta" || type === "content_block_delta") {
    const text = extractCodexText(value);
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
          format: "text",
          ...(usage ? { usage: extractUsage(usage) } : {}),
        },
      };
    }
  }

  // Fall through to generic mapper
  return null;
}

function mapCodexMcpToolCall(
  backend: BackendName,
  request: RuntimeRequest,
  item: CodexItem,
): RuntimeEvent {
  const error = item.error;
  return {
    type: "tool_result",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: {
      toolCallId:
        stringProp(item as Record<string, unknown>, "id") ??
        `${request.executionId}:mcp`,
      status: error ? "error" : "success",
      output: extractCodexMcpResultText(item.result),
      error: error ?? undefined,
    },
  };
}

function extractCodexMcpResultText(
  result: CodexMcpResult | undefined,
): string | undefined {
  if (!result) return undefined;
  const content = result.content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((part: CodexMcpContentPart) =>
      typeof part.text === "string" ? part.text : "",
    )
    .filter(Boolean)
    .join("\n");
}

function extractUsage(usage: CodexUsage): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
} {
  const inputTokens =
    typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : undefined;
  const outputTokens =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : typeof usage.outputTokens === "number"
          ? usage.outputTokens
          : undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      typeof usage.total_tokens === "number"
        ? usage.total_tokens
        : inputTokens != null && outputTokens != null
          ? inputTokens + outputTokens
          : undefined,
    reasoningTokens:
      typeof usage.reasoning_tokens === "number"
        ? usage.reasoning_tokens
        : typeof usage.reasoning_output_tokens === "number"
          ? usage.reasoning_output_tokens
          : undefined,
    cacheReadTokens:
      typeof usage.cache_read_input_tokens === "number"
        ? usage.cache_read_input_tokens
        : typeof usage.prompt_tokens_details === "object" &&
            usage.prompt_tokens_details !== null &&
            typeof usage.prompt_tokens_details?.cached_tokens === "number"
          ? usage.prompt_tokens_details.cached_tokens
          : undefined,
    cacheWriteTokens:
      typeof usage.cache_creation_input_tokens === "number"
        ? usage.cache_creation_input_tokens
        : undefined,
  };
}
