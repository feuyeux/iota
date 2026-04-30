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
