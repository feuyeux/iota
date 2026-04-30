import type {
  ApprovalDecision,
  ApprovalHook,
  ApprovalRequest,
} from "./hook.js";

export type DeferredApprovalRequestListener = (
  requestId: string,
  request: ApprovalRequest,
) => void;

/**
 * An ApprovalHook that defers decisions to an external caller (e.g. WebSocket client).
 *
 * When `requestApproval()` is called by the engine during execution, it registers
 * a pending request and waits until `resolve(requestId, decision)` is called externally.
 * If no decision arrives within `timeoutMs`, the request is auto-denied.
 */
export class DeferredApprovalHook implements ApprovalHook {
  private readonly requestListeners = new Set<DeferredApprovalRequestListener>();
  private readonly pending = new Map<
    string,
    {
      resolve(decision: ApprovalDecision): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    const requestId = `${request.executionId}-${Date.now()}`;

    // Notify listeners so external callers know a request is pending.
    this.onRequest?.(requestId, request);
    for (const listener of this.requestListeners) {
      listener(requestId, request);
    }

    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          decision: "deny",
          reason: `Approval timed out after ${request.timeoutMs}ms`,
        });
      }, request.timeoutMs);

      this.pending.set(requestId, { resolve, timer });
    });
  }

  /**
   * Resolve a pending approval request externally (e.g. from a WebSocket message).
   * Returns true if the request was found and resolved, false if expired/unknown.
   */
  resolve(requestId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(decision);
    return true;
  }

  /** Optional callback invoked when a new approval request is registered. */
  onRequest?: DeferredApprovalRequestListener;

  addRequestListener(listener: DeferredApprovalRequestListener): () => void {
    this.requestListeners.add(listener);
    return () => {
      this.requestListeners.delete(listener);
    };
  }

  /** Cancel all pending requests (e.g. on connection close). */
  cancelAll(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ decision: "deny", reason: "Connection closed" });
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
