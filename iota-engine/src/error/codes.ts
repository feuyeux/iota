export enum ErrorCode {
  BACKEND_NOT_FOUND = "BACKEND_NOT_FOUND",
  BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE",
  BACKEND_CRASHED = "BACKEND_CRASHED",
  BACKEND_TIMEOUT = "BACKEND_TIMEOUT",
  BACKEND_PROTOCOL_ERROR = "BACKEND_PROTOCOL_ERROR",
  EXECUTION_FAILED = "EXECUTION_FAILED",
  EXECUTION_INTERRUPTED = "EXECUTION_INTERRUPTED",
  IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT",
  APPROVAL_DENIED = "APPROVAL_DENIED",
  APPROVAL_TIMEOUT = "APPROVAL_TIMEOUT",
  WORKSPACE_LOCKED = "WORKSPACE_LOCKED",
  WORKSPACE_OUTSIDE_ROOT = "WORKSPACE_OUTSIDE_ROOT",
  SNAPSHOT_FAILED = "SNAPSHOT_FAILED",
  MEMORY_RETRIEVAL_FAILED = "MEMORY_RETRIEVAL_FAILED",
  MCP_SERVER_FAILED = "MCP_SERVER_FAILED",
  CONFIG_INVALID = "CONFIG_INVALID",
  STORAGE_ERROR = "STORAGE_ERROR",
}

export interface RuntimeError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export class IotaError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(error: RuntimeError) {
    super(error.message);
    this.name = "IotaError";
    this.code = error.code;
    this.details = error.details;
    this.retryable = error.retryable ?? false;
  }

  toRuntimeError(): RuntimeError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

export function toRuntimeError(
  error: unknown,
  fallbackCode = ErrorCode.EXECUTION_FAILED,
): RuntimeError {
  if (error instanceof IotaError) {
    return error.toRuntimeError();
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
      details: { name: error.name },
    };
  }

  return {
    code: fallbackCode,
    message: String(error),
  };
}
