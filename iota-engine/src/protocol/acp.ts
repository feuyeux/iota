import type { JsonRpcLikeMessage } from "./json-rpc-like.js";

export interface AcpMessage extends JsonRpcLikeMessage {
  jsonrpc: "2.0";
}

export function isAcpMessage(value: unknown): value is AcpMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (value as AcpMessage).jsonrpc === "2.0";
}

export function encodeAcp(
  message: Omit<AcpMessage, "jsonrpc"> & { jsonrpc?: "2.0" },
): string {
  return `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;
}
