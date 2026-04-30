import { ErrorCode } from "../error/codes.js";
import {
  ACP_METHODS,
  type AcpMessage,
  type AcpPermissionRequest,
  type AcpSessionComplete,
  type AcpSessionUpdate,
} from "../protocol/acp.js";
import type { BackendName, RuntimeEvent, RuntimeRequest, TokenUsage } from "../event/types.js";

export function mapAcpNotificationToEvent(
  backend: BackendName,
  request: RuntimeRequest,
  message: AcpMessage,
): RuntimeEvent | RuntimeEvent[] | null {
  const method = typeof message.method === "string" ? message.method : undefined;
  const params = asRecord(message.params) ?? {};

  switch (method) {
    case ACP_METHODS.SESSION_UPDATE:
    case "session_update":
      return mapSessionUpdate(backend, request, message, params);
    case ACP_METHODS.SESSION_COMPLETE:
    case "session_complete":
      return mapSessionComplete(backend, request, params);
    case ACP_METHODS.SESSION_REQUEST_PERMISSION:
    case "request_permission":
    case "permission/request":
    case "session/request_permission":
      return mapPermissionRequest(backend, request, message, params);
    case ACP_METHODS.SESSION_MEMORY:
      return mapMemoryEvent(backend, request, params);
    case ACP_METHODS.SESSION_FILE_DELTA:
      return mapFileDelta(backend, request, params);
    default:
      return mapAcpResponseOrExtension(backend, request, message);
  }
}

function mapSessionUpdate(
  backend: BackendName,
  request: RuntimeRequest,
  message: AcpMessage,
  params: Record<string, unknown>,
): RuntimeEvent | null {
  const update = (asRecord(params.update) ?? params) as Partial<
    AcpSessionUpdate & { sessionUpdate: string }
  >;
  const sessionUpdate = stringValue(update.sessionUpdate) ?? stringValue(update.type);
  const content = normalizeContent(update.content ?? params.content);
  const text = extractText(update) ?? extractText(params) ?? content.map((block) => block.text ?? "").join("");

  if (sessionUpdate === "agent_message" || sessionUpdate === "agent_message_chunk") {
    if (!text) return null;
    return outputEvent(backend, request, text, false);
  }

  if (sessionUpdate === "agent_thought" || sessionUpdate === "agent_thought_chunk") {
    return extensionEvent(backend, request, "thinking", { text });
  }

  const toolCall = content.find((block) => block.type === "tool_use") ?? (sessionUpdate === "tool_call" ? asRecord(update) : undefined);
  if (toolCall) {
    const toolName = stringValue(toolCall.toolName) ?? stringValue(toolCall.name) ?? "unknown";
    return {
      type: "tool_call",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId: stringValue(toolCall.toolCallId) ?? stringValue(toolCall.id) ?? idFromMessage(message, request),
        toolName,
        rawToolName: toolName,
        arguments: asRecord(toolCall.arguments) ?? asRecord(toolCall.input) ?? {},
        approvalRequired: Boolean(toolCall.approvalRequired),
      },
    };
  }

  const toolResult = content.find((block) => block.type === "tool_result") ?? (sessionUpdate === "tool_result" ? asRecord(update) : undefined);
  if (toolResult) {
    const error = stringValue(toolResult.error);
    return {
      type: "tool_result",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId: stringValue(toolResult.toolCallId) ?? stringValue(toolResult.id) ?? idFromMessage(message, request),
        status: error ? "error" : "success",
        output: stringValue(toolResult.output) ?? stringValue(toolResult.text),
        error,
      },
    };
  }

  if (sessionUpdate === "file_delta") {
    return mapFileDelta(backend, request, update);
  }

  return extensionEvent(backend, request, "acp_session_update", { ...params });
}

function mapSessionComplete(
  backend: BackendName,
  request: RuntimeRequest,
  params: Record<string, unknown>,
): RuntimeEvent {
  const complete = params as Partial<AcpSessionComplete>;
  const text = stringValue(complete.finalMessage) ?? extractText(params) ?? "";
  const usage = extractUsage(asRecord(complete.usage));
  const stopReason = stringValue(complete.stopReason);
  if (stopReason === "interrupted") {
    return stateEvent(backend, request, "interrupted", "ACP session interrupted");
  }
  if (stopReason === "error") {
    return {
      type: "error",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        code: ErrorCode.EXECUTION_FAILED,
        message: text || "ACP session failed",
        details: { native: params },
      },
    };
  }
  return outputEvent(backend, request, text, true, usage);
}

function mapPermissionRequest(
  backend: BackendName,
  request: RuntimeRequest,
  message: AcpMessage,
  params: Record<string, unknown>,
): RuntimeEvent[] {
  const permission = params as Partial<AcpPermissionRequest> & {
    type?: unknown;
    name?: unknown;
    input?: unknown;
  };
  const payload = {
    operationType: stringValue(permission.type) ?? "shell",
    requestId: permission.requestId ?? message.id ?? null,
    toolName: stringValue(permission.toolName) ?? stringValue(permission.name),
    arguments: asRecord(permission.arguments) ?? asRecord(permission.input) ?? {},
    description: stringValue(permission.description),
    ...params,
  };
  return [
    stateEvent(backend, request, "waiting_approval", "ACP permission requested"),
    extensionEvent(backend, request, "approval_request", payload),
  ];
}

function mapMemoryEvent(
  backend: BackendName,
  request: RuntimeRequest,
  params: Record<string, unknown>,
): RuntimeEvent {
  const memory = asRecord(params.memory) ?? params;
  return {
    type: "memory",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: typeof memory.timestamp === "number" ? memory.timestamp : Date.now(),
    data: {
      nativeType: stringValue(memory.nativeType) ?? "dialogue_memory",
      content: stringValue(memory.content) ?? stringValue(memory.text) ?? "",
      metadata: asRecord(memory.metadata),
    },
  };
}

function mapFileDelta(
  backend: BackendName,
  request: RuntimeRequest,
  params: Record<string, unknown>,
): RuntimeEvent {
  return {
    type: "file_delta",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: {
      path: stringValue(params.path) ?? "",
      operation: normalizeFileOperation(stringValue(params.operation) ?? stringValue(params.type)),
      oldPath: stringValue(params.oldPath),
      hashBefore: stringValue(params.hashBefore),
      hashAfter: stringValue(params.hashAfter),
      sizeBytes: typeof params.sizeBytes === "number" ? params.sizeBytes : undefined,
    },
  };
}

function mapAcpResponseOrExtension(
  backend: BackendName,
  request: RuntimeRequest,
  message: AcpMessage,
): RuntimeEvent | null {
  if (message.error && message.id !== undefined) {
    return {
      type: "error",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        code: ErrorCode.EXECUTION_FAILED,
        message: message.error.message || "ACP error",
        details: { native: message },
      },
    };
  }

  if (message.result !== undefined && message.id !== undefined) {
    const result = asRecord(message.result);
    const text = typeof message.result === "string" ? message.result : result ? extractText(result) : undefined;
    const stopReason = result ? stringValue(result.stopReason) : undefined;
    if (stopReason || text) {
      return outputEvent(backend, request, text ?? "", true, extractUsage(asRecord(result?.usage)));
    }
    return null;
  }

  return extensionEvent(backend, request, "native_event", message as unknown as Record<string, unknown>);
}

function outputEvent(
  backend: BackendName,
  request: RuntimeRequest,
  content: string,
  final: boolean,
  usage?: TokenUsage,
): RuntimeEvent {
  return {
    type: "output",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: {
      role: "assistant",
      content,
      format: "markdown",
      ...(final ? { final: true } : {}),
      ...(usage ? { usage } : {}),
    },
  };
}

function stateEvent(
  backend: BackendName,
  request: RuntimeRequest,
  state: "interrupted" | "waiting_approval",
  message: string,
): RuntimeEvent {
  return {
    type: "state",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: { state, message },
  };
}

function extensionEvent(
  backend: BackendName,
  request: RuntimeRequest,
  name: string,
  payload: Record<string, unknown>,
): RuntimeEvent {
  return {
    type: "extension",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: { name, payload },
  };
}

function normalizeContent(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item));
  }
  const record = asRecord(value);
  return record ? [record] : [];
}

function normalizeFileOperation(value: string | undefined): "created" | "modified" | "deleted" | "renamed" {
  if (value === "created" || value === "deleted" || value === "renamed") return value;
  return "modified";
}

function extractUsage(value: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!value) return undefined;
  const usage: TokenUsage = {
    inputTokens: numberValue(value.inputTokens) ?? numberValue(value.input_tokens),
    outputTokens: numberValue(value.outputTokens) ?? numberValue(value.output_tokens),
    totalTokens: numberValue(value.totalTokens) ?? numberValue(value.total_tokens),
    cacheReadTokens: numberValue(value.cacheReadTokens) ?? numberValue(value.cache_read_tokens) ?? numberValue(value.cache_read_input_tokens),
    cacheWriteTokens: numberValue(value.cacheWriteTokens) ?? numberValue(value.cache_write_tokens) ?? numberValue(value.cache_creation_input_tokens),
    reasoningTokens: numberValue(value.reasoningTokens) ?? numberValue(value.reasoning_tokens) ?? numberValue(value.reasoning_output_tokens),
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function extractText(value: Record<string, unknown>): string | undefined {
  return stringValue(value.text) ?? stringValue(value.content) ?? stringValue(value.message) ?? stringValue(value.result) ?? stringValue(value.output);
}

function idFromMessage(message: AcpMessage, request: RuntimeRequest): string {
  return message.id !== undefined && message.id !== null ? String(message.id) : `${request.executionId}:${Date.now()}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
