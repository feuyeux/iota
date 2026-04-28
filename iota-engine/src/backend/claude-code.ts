import { ErrorCode } from "../error/codes.js";
import { SubprocessBackendAdapter } from "./subprocess.js";
import { composeEffectivePrompt } from "./prompt-composer.js";
import {
  buildClaudeAllowedMcpTools,
  buildClaudeMcpConfig,
} from "./mcp-config.js";
import type {
  BackendName,
  McpServerDescriptor,
  RuntimeEvent,
  RuntimeRequest,
} from "../event/types.js";

/**
 * ClaudeCodeAdapter — Section 7.2
 * Per-execution mode: spawns `claude --print` for each execution.
 * --print mode exits after completion, so long-lived is not supported.
 * Maps SDKMessage, system, result, tool_use, tool_result to RuntimeEvent.
 */
export class ClaudeCodeAdapter extends SubprocessBackendAdapter {
  private configuredModel?: string;

  constructor(private readonly mcpServers: McpServerDescriptor[] = []) {
    super({
      name: "claude-code",
      defaultExecutable: "claude",
      processMode: "per-execution",
      capabilities: {
        sandbox: false,
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
        name: "stream-json",
        stdinMode: "prompt",
        stdoutMode: "ndjson",
        stderrCaptured: true,
      },
      buildArgs: () => this.buildClaudeArgs(),
      buildInput: (request) => composeEffectivePrompt(request, this) + "\n",
      mapNativeEvent: mapClaudeEvent,
    });
  }

  private buildClaudeArgs(): string[] {
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--bare",
      "--permission-mode",
      "auto",
    ];
    const mcpConfig = buildClaudeMcpConfig(this.mcpServers);
    if (mcpConfig) {
      args.push("--mcp-config", mcpConfig, "--strict-mcp-config");
    }
    const allowedTools = buildClaudeAllowedMcpTools(this.mcpServers);
    if (allowedTools.length > 0) {
      args.push("--allowedTools", allowedTools.join(","));
    }
    return args;
  }

  async init(config: import("./interface.js").BackendConfig): Promise<void> {
    // Load settings file if CLAUDE_SETTINGS_PATH is provided
    if (config.env?.CLAUDE_SETTINGS_PATH) {
      try {
        const fs = await import("node:fs/promises");
        const settingsPath = config.env.CLAUDE_SETTINGS_PATH;
        const settingsContent = await fs.readFile(settingsPath, "utf-8");
        const settings = JSON.parse(settingsContent);

        // Merge env vars from settings file into config.env
        if (settings.env && typeof settings.env === "object") {
          if (!config.env) {
            config.env = {};
          }
          config.env = { ...settings.env, ...config.env };
        }
      } catch (error) {
        const settingsPath = config.env?.CLAUDE_SETTINGS_PATH ?? "unknown";
        console.warn(
          `[claude-code] Failed to load settings from ${settingsPath}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // Map ANTHROPIC_AUTH_TOKEN to ANTHROPIC_API_KEY for Claude CLI --bare mode
    if (config.env?.ANTHROPIC_AUTH_TOKEN && !config.env.ANTHROPIC_API_KEY) {
      config.env.ANTHROPIC_API_KEY = config.env.ANTHROPIC_AUTH_TOKEN;
    }

    // Extract model from env
    this.configuredModel =
      config.env?.ANTHROPIC_MODEL || config.env?.CLAUDE_MODEL;

    return super.init(config);
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }
}

// Note: buildNativeResponse removed — per-execution mode with --permission-mode auto
// does not require sending approval responses or MCP tool results back via stdin.
// If future Claude Code versions support interactive stdin, this can be restored.

function mapClaudeEvent(
  backend: BackendName,
  request: RuntimeRequest,
  value: Record<string, unknown>,
): RuntimeEvent | null {
  const type = typeof value.type === "string" ? value.type : undefined;

  // Claude stream-json message types: system, assistant, result, tool_use, tool_result, control_request
  if (type === "system" || type === "init") {
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: { name: "claude_system", payload: value },
    };
  }

  // Thinking events — Claude stream-json emits "thinking" type or content_block_delta with thinking_delta
  if (
    type === "thinking" ||
    (type === "content_block_delta" &&
      typeof value.delta === "object" &&
      value.delta !== null &&
      (value.delta as Record<string, unknown>).type === "thinking_delta")
  ) {
    const delta =
      typeof value.delta === "object" && value.delta !== null
        ? (value.delta as Record<string, unknown>)
        : {};
    const thinkingText =
      typeof delta.thinking === "string"
        ? delta.thinking
        : typeof delta.text === "string"
          ? delta.text
          : typeof value.content === "string"
            ? value.content
            : typeof value.thinking === "string"
              ? value.thinking
              : "";
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: { name: "thinking", payload: { text: thinkingText } },
    };
  }

  if (
    type === "assistant" ||
    type === "text" ||
    type === "content_block_delta"
  ) {
    const text = extractClaudeText(value);
    if (text) {
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
  }

  if (type === "tool_use") {
    const toolName = typeof value.name === "string" ? value.name : "unknown";
    return {
      type: "tool_call",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId:
          typeof value.id === "string"
            ? value.id
            : `${request.executionId}:${Date.now()}`,
        toolName,
        rawToolName: toolName,
        arguments: (typeof value.input === "object" && value.input !== null
          ? value.input
          : {}) as Record<string, unknown>,
        approvalRequired: false,
      },
    };
  }

  if (type === "tool_result") {
    return {
      type: "tool_result",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId:
          typeof value.tool_use_id === "string"
            ? value.tool_use_id
            : typeof value.id === "string"
              ? value.id
              : `${request.executionId}:${Date.now()}`,
        status: value.is_error ? "error" : "success",
        output: extractClaudeText(value),
        error:
          value.is_error && typeof value.content === "string"
            ? value.content
            : undefined,
      },
    };
  }

  if (type === "result") {
    const text = extractClaudeText(value);
    const events: RuntimeEvent[] = [];

    // Extract native usage from result event (Section 5.3)
    const usage = value.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage === "object") {
      events.push({
        type: "extension",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        sequence: 0,
        timestamp: Date.now(),
        data: {
          name: "native_usage",
          payload: {
            inputTokens:
              typeof usage.input_tokens === "number"
                ? usage.input_tokens
                : undefined,
            outputTokens:
              typeof usage.output_tokens === "number"
                ? usage.output_tokens
                : undefined,
            cacheReadTokens:
              typeof usage.cache_read_input_tokens === "number"
                ? usage.cache_read_input_tokens
                : undefined,
            cacheWriteTokens:
              typeof usage.cache_creation_input_tokens === "number"
                ? usage.cache_creation_input_tokens
                : undefined,
          },
        },
      });
    }

    // Return final output — note: we can only return one event from mapNativeEvent
    // so we attach usage as metadata on the output event
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
                  typeof usage.input_tokens === "number"
                    ? usage.input_tokens
                    : undefined,
                outputTokens:
                  typeof usage.output_tokens === "number"
                    ? usage.output_tokens
                    : undefined,
                cacheReadTokens:
                  typeof usage.cache_read_input_tokens === "number"
                    ? usage.cache_read_input_tokens
                    : undefined,
                cacheWriteTokens:
                  typeof usage.cache_creation_input_tokens === "number"
                    ? usage.cache_creation_input_tokens
                    : undefined,
              },
            }
          : {}),
      },
    };
  }

  if (type === "control_request") {
    // Claude approval request — propagated as extension for engine to handle
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        name: "approval_request",
        payload: { ...value, requestId: value.id ?? null },
      },
    };
  }

  if (type === "memory") {
    const nativeType =
      typeof value.nativeType === "string"
        ? value.nativeType
        : "conversation_context";
    const content = extractClaudeText(value) ?? "";
    return {
      type: "memory",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp:
        typeof value.timestamp === "number" ? value.timestamp : Date.now(),
      data: {
        nativeType,
        content,
        metadata:
          typeof value.metadata === "object" && value.metadata !== null
            ? (value.metadata as Record<string, unknown>)
            : undefined,
      },
    };
  }

  if (type === "error" || value.error) {
    const message =
      typeof value.error === "string"
        ? value.error
        : typeof value.message === "string"
          ? value.message
          : "Claude backend error";
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

  // Unknown event — preserve as extension, don't discard
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

function extractClaudeText(value: Record<string, unknown>): string | undefined {
  if (typeof value.content === "string") return value.content;
  if (typeof value.text === "string") return value.text;
  if (typeof value.delta === "object" && value.delta !== null) {
    const delta = value.delta as Record<string, unknown>;
    if (typeof delta.text === "string") return delta.text;
  }
  if (Array.isArray(value.content)) {
    return value.content
      .map((block) => {
        if (typeof block === "string") return block;
        if (
          typeof block === "object" &&
          block !== null &&
          typeof (block as Record<string, unknown>).text === "string"
        ) {
          return (block as Record<string, unknown>).text as string;
        }
        return "";
      })
      .join("");
  }
  if (typeof value.result === "string") return value.result;
  return undefined;
}
