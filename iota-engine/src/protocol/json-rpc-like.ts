export interface JsonRpcLikeMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code?: number | string;
    message: string;
    data?: unknown;
  };
}

export function isJsonRpcLikeMessage(
  value: unknown,
): value is JsonRpcLikeMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as JsonRpcLikeMessage;
  return (
    candidate.method !== undefined ||
    candidate.result !== undefined ||
    candidate.error !== undefined
  );
}

export function encodeJsonRpcLike(message: JsonRpcLikeMessage): string {
  // Ensure JSON-RPC 2.0 compliance: always include jsonrpc field
  const wire = { jsonrpc: "2.0", ...message };
  return `${JSON.stringify(wire)}\n`;
}

export function makeRequest(
  id: string | number,
  method: string,
  params?: unknown,
): JsonRpcLikeMessage {
  return { jsonrpc: "2.0", id, method, params };
}

export function makeResponse(
  id: string | number | null,
  result: unknown,
): JsonRpcLikeMessage {
  return { jsonrpc: "2.0", id, result };
}
