import type { JsonRpcLikeMessage } from "./json-rpc-like.js";

export interface AcpMessage extends JsonRpcLikeMessage {
  jsonrpc: "2.0";
}

export interface AcpRequestMessage extends AcpMessage {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface AcpNotificationMessage extends AcpMessage {
  method: string;
  params?: unknown;
  id?: undefined;
}

export interface AcpResponseMessage extends AcpMessage {
  id: string | number | null;
  result?: unknown;
  error?: AcpMessage["error"];
}

export type AcpWireMessage =
  | AcpRequestMessage
  | AcpNotificationMessage
  | AcpResponseMessage;


export const ACP_METHODS = {
  INITIALIZE: "initialize",
  SESSION_NEW: "session/new",
  SESSION_PROMPT: "session/prompt",
  SESSION_INTERRUPT: "session/interrupt",
  SESSION_DESTROY: "session/destroy",
  SESSION_UPDATE: "session/update",
  SESSION_COMPLETE: "session/complete",
  SESSION_REQUEST_PERMISSION: "session/request_permission",
  SESSION_MEMORY: "session/memory",
  SESSION_FILE_DELTA: "session/file_delta",
} as const;

export type AcpContentBlockType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "image";

export interface AcpContentBlock {
  type: AcpContentBlockType;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  output?: string;
  error?: string;
  [key: string]: unknown;
}

export interface AcpSessionUpdate {
  sessionId: string;
  type:
    | "agent_message"
    | "agent_message_chunk"
    | "agent_thought"
    | "agent_thought_chunk"
    | "tool_call"
    | "tool_result"
    | "file_delta";
  content?: AcpContentBlock[];
  metadata?: Record<string, unknown>;
}

export interface AcpUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface AcpSessionComplete {
  sessionId: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "interrupted" | "error";
  usage?: AcpUsage;
  finalMessage?: string;
}

export interface AcpPermissionRequest {
  requestId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  description?: string;
  [key: string]: unknown;
}

export function isAcpMessage(value: unknown): value is AcpMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as AcpMessage;
  if (candidate.jsonrpc !== "2.0") return false;
  const hasMethod = typeof candidate.method === "string";
  const hasResult = Object.prototype.hasOwnProperty.call(candidate, "result");
  const hasError = candidate.error !== undefined;
  if (!hasMethod && !hasResult && !hasError) return false;
  if ((hasResult || hasError) && candidate.id === undefined) return false;
  return true;
}

export function encodeAcp(
  message: Omit<AcpMessage, "jsonrpc"> & { jsonrpc?: "2.0" },
): string {
  return `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;
}
