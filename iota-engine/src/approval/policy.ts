import { ErrorCode, IotaError } from "../error/codes.js";
import type { ApprovalPolicy } from "../event/types.js";
import type { ApprovalHook, ApprovalRequest } from "./hook.js";

/**
 * Section 15.1-15.2: Approval enforcement
 * - auto: approve and audit
 * - ask: synchronous blocking with timeout
 * - deny: reject immediately
 * Timeout defaults to deny with APPROVAL_TIMEOUT (Section 15.2)
 */
export async function enforceApprovalPolicy(
  policy: Required<ApprovalPolicy>,
  hook: ApprovalHook,
  request: Omit<ApprovalRequest, "timeoutMs">,
): Promise<void> {
  const mode = policy[request.operationType];
  if (mode === "auto") {
    return;
  }
  if (mode === "deny") {
    throw new IotaError({
      code: ErrorCode.APPROVAL_DENIED,
      message: `${request.operationType} denied by policy`,
    });
  }

  // ask mode: request approval with timeout
  const timeoutMs = policy.timeoutMs ?? 120_000;
  const fullRequest: ApprovalRequest = { ...request, timeoutMs };

  try {
    const decision = await withTimeout(
      hook.requestApproval(fullRequest),
      timeoutMs,
    );
    if (decision.decision !== "approve") {
      throw new IotaError({
        code: ErrorCode.APPROVAL_DENIED,
        message: decision.reason ?? `${request.operationType} denied`,
      });
    }
  } catch (error) {
    if (error instanceof IotaError) {
      throw error;
    }
    // Timeout or other error → deny (Section 15.2)
    if (error instanceof TimeoutError) {
      throw new IotaError({
        code: ErrorCode.APPROVAL_TIMEOUT,
        message: `Approval timed out after ${timeoutMs}ms — default deny`,
      });
    }
    throw new IotaError({
      code: ErrorCode.APPROVAL_DENIED,
      message: `Approval error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timeout after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
