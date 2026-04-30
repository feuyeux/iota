import { ErrorCode } from "../error/codes.js";
import { SubprocessBackendAdapter } from "./subprocess.js";
import { composeEffectivePrompt } from "./prompt-composer.js";
import {
  cleanupGeneratedSettings,
  writeGeminiSystemSettings,
} from "./mcp-config.js";
import type {
  BackendName,
  McpServerDescriptor,
  RuntimeEvent,
  RuntimeRequest,
} from "../event/types.js";

/**
 * @deprecated Legacy native fallback. Prefer `protocol: acp` once the ACP adapter is available.
 * GeminiAdapter — Section 7.4
 * Per-execution subprocess, stdout NDJSON, headless prompt mode.
 * Maps init, message, tool_use, tool_result, result to RuntimeEvent.
 */
export class GeminiAdapter extends SubprocessBackendAdapter {
  private configuredModel?: string;
  private generatedSystemSettingsPath?: string;

  constructor(private readonly mcpServers: McpServerDescriptor[] = []) {
    super({
      name: "gemini",
      defaultExecutable: "gemini",
      processMode: "per-execution",
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: false,
        acp: false,
        streaming: true,
        thinking: true,
        multimodal: true,
        maxContextTokens: 1_000_000,
        promptOnlyInput: true,
      },
      protocol: {
        name: "stream-json",
        stdinMode: "none",
        stdoutMode: "ndjson",
        stderrCaptured: true,
      },
      buildArgs: (request) => this.buildGeminiArgs(request),
      mapNativeEvent: mapGeminiEvent,
    });
  }

  async init(config: import("./interface.js").BackendConfig): Promise<void> {
    cleanupGeneratedSettings(this.generatedSystemSettingsPath);
    this.generatedSystemSettingsPath = writeGeminiSystemSettings(
      this.mcpServers,
    );
    this.configuredModel = config.env?.GEMINI_MODEL || config.env?.GOOGLE_MODEL;
    return super.init({
      ...config,
      env: {
        ...(config.env ?? {}),
        ...(this.generatedSystemSettingsPath
          ? {
              GEMINI_CLI_SYSTEM_SETTINGS_PATH: this.generatedSystemSettingsPath,
            }
          : {}),
      },
    });
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }

  async destroy(): Promise<void> {
    await super.destroy();
    cleanupGeneratedSettings(this.generatedSystemSettingsPath);
    this.generatedSystemSettingsPath = undefined;
  }

  private buildGeminiArgs(request: RuntimeRequest): string[] {
    const args = [
      "--output-format",
      "stream-json",
      "--skip-trust",
      "--prompt",
      composeEffectivePrompt(request, this),
    ];
    for (const server of this.mcpServers) {
      args.push("--allowed-mcp-server-names", server.name);
    }
    return args;
  }
}

function mapGeminiEvent(
  backend: BackendName,
  request: RuntimeRequest,
  value: Record<string, unknown>,
): RuntimeEvent | null {
  const type = typeof value.type === "string" ? value.type : undefined;

  if (type === "init") {
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: { name: "gemini_init", payload: value },
    };
  }

  // Thinking events — Gemini can emit "thought" or "thinking" type events
  if (type === "thought" || type === "thinking") {
    return {
      type: "extension",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        name: "thinking",
        payload: { text: extractGeminiText(value) ?? "" },
      },
    };
  }

  if (type === "message" || type === "text" || type === "content") {
    const text = extractGeminiText(value);
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

  if (type === "tool_use" || type === "function_call") {
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
          : typeof value.args === "object" && value.args !== null
            ? value.args
            : {}) as Record<string, unknown>,
        approvalRequired: false,
      },
    };
  }

  if (type === "tool_result" || type === "function_response") {
    return {
      type: "tool_result",
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
        status: value.error ? "error" : "success",
        output: extractGeminiText(value),
        error: typeof value.error === "string" ? value.error : undefined,
      },
    };
  }

  if (type === "memory") {
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
            : "interaction_log",
        content: extractGeminiText(value) ?? "",
        metadata:
          typeof value.metadata === "object" && value.metadata !== null
            ? (value.metadata as Record<string, unknown>)
            : undefined,
      },
    };
  }

  if (type === "result" || type === "done") {
    const text = extractGeminiText(value);
    // Extract native usage from usageMetadata (Section 5.3) or stats (current CLI)
    const usageMeta = (value.usageMetadata || value.stats) as
      | Record<string, unknown>
      | undefined;

    const inputTokens = usageMeta
      ? (usageMeta.promptTokenCount ??
        usageMeta.input_tokens ??
        usageMeta.input)
      : undefined;
    const outputTokens = usageMeta
      ? (usageMeta.candidatesTokenCount ?? usageMeta.output_tokens)
      : undefined;
    const totalTokens = usageMeta
      ? (usageMeta.totalTokenCount ?? usageMeta.total_tokens)
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
        ...(usageMeta
          ? {
              usage: {
                inputTokens:
                  typeof inputTokens === "number" ? inputTokens : undefined,
                outputTokens:
                  typeof outputTokens === "number" ? outputTokens : undefined,
                totalTokens:
                  typeof totalTokens === "number" ? totalTokens : undefined,
              },
            }
          : {}),
      },
    };
  }

  if (type === "error" || value.error) {
    const message =
      typeof value.error === "string"
        ? value.error
        : typeof value.message === "string"
          ? value.message
          : "Gemini backend error";
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

  // Preserve unknown events
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

function extractGeminiText(value: Record<string, unknown>): string | undefined {
  if (typeof value.content === "string") return value.content;
  if (typeof value.text === "string") return value.text;
  if (typeof value.output === "string") return value.output;
  if (typeof value.result === "string") return value.result;
  if (Array.isArray(value.content)) {
    return value.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          typeof part === "object" &&
          part !== null &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, unknown>).text as string;
        }
        return "";
      })
      .join("");
  }
  return undefined;
}
