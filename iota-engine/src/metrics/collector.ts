import type {
  BackendName,
  RuntimeEvent,
  RuntimeResponse,
} from "../event/types.js";
import type { ExecutionVisibility } from "../visibility/types.js";

export interface MetricsSnapshot {
  executions: number;
  success: number;
  failure: number;
  interrupted: number;
  byBackend: Partial<Record<BackendName, number>>;
  backendCrashes: Partial<Record<BackendName, number>>;
  eventCount: number;
  toolCallCount: number;
  approvalCount: number;
  approvalDenied: number;
  approvalTimeout: number;
  latencyMs: LatencyStats;
  // Visibility-derived metrics
  contextBudgetUsed: number[];
  memoryHitRatio: number[];
  nativeTokenTotal: number[];
  parseLossRatio: number[];
}

export interface LatencyStats {
  samples: number[];
  p50: number;
  p95: number;
  p99: number;
}

export class MetricsCollector {
  private executions = 0;
  private success = 0;
  private failure = 0;
  private interrupted = 0;
  private byBackend: Partial<Record<BackendName, number>> = {};
  private backendCrashes: Partial<Record<BackendName, number>> = {};
  private eventCount = 0;
  private toolCallCount = 0;
  private approvalCount = 0;
  private approvalDenied = 0;
  private approvalTimeout = 0;
  private latencySamples: number[] = [];
  private contextBudgetUsed: number[] = [];
  private memoryHitRatio: number[] = [];
  private nativeTokenTotal: number[] = [];
  private parseLossRatio: number[] = [];

  recordExecution(response: RuntimeResponse): void {
    this.executions += 1;
    this.byBackend[response.backend] =
      (this.byBackend[response.backend] ?? 0) + 1;
    this.eventCount += response.events.length;

    if (response.status === "completed") {
      this.success += 1;
    } else if (response.status === "interrupted") {
      this.interrupted += 1;
    } else {
      this.failure += 1;
    }

    // Count tool calls and results
    for (const event of response.events) {
      if (event.type === "tool_call") this.toolCallCount += 1;
    }
  }

  recordBackendCrash(backend: BackendName): void {
    this.backendCrashes[backend] = (this.backendCrashes[backend] ?? 0) + 1;
  }

  recordApproval(denied: boolean, timeout: boolean): void {
    this.approvalCount += 1;
    if (denied) this.approvalDenied += 1;
    if (timeout) this.approvalTimeout += 1;
  }

  recordLatency(ms: number): void {
    this.latencySamples.push(ms);
    // Keep last 1000 samples
    if (this.latencySamples.length > 1000) {
      this.latencySamples = this.latencySamples.slice(-1000);
    }
  }

  recordEvent(_event: RuntimeEvent): void {
    this.eventCount += 1;
  }

  /** Extract visibility-derived metrics from an execution's visibility bundle. */
  recordVisibility(visibility: ExecutionVisibility): void {
    if (visibility.context) {
      this.contextBudgetUsed.push(visibility.context.totals.budgetUsedRatio);
    }
    if (visibility.memory) {
      const candidates = visibility.memory.candidates.length;
      const selected = visibility.memory.selected.length;
      this.memoryHitRatio.push(candidates > 0 ? selected / candidates : 0);
    }
    if (visibility.tokens?.total.nativeTokens != null) {
      this.nativeTokenTotal.push(visibility.tokens.total.nativeTokens);
    }
    if (visibility.link) {
      const total = visibility.link.nativeEventRefs.length;
      const lost = visibility.mappings?.filter((m) => m.lossy).length ?? 0;
      this.parseLossRatio.push(total > 0 ? lost / total : 0);
    }
    // Keep last 1000 samples
    for (const arr of [
      this.contextBudgetUsed,
      this.memoryHitRatio,
      this.nativeTokenTotal,
      this.parseLossRatio,
    ]) {
      if (arr.length > 1000) arr.splice(0, arr.length - 1000);
    }
  }

  getSnapshot(): MetricsSnapshot {
    return {
      executions: this.executions,
      success: this.success,
      failure: this.failure,
      interrupted: this.interrupted,
      byBackend: { ...this.byBackend },
      backendCrashes: { ...this.backendCrashes },
      eventCount: this.eventCount,
      toolCallCount: this.toolCallCount,
      approvalCount: this.approvalCount,
      approvalDenied: this.approvalDenied,
      approvalTimeout: this.approvalTimeout,
      latencyMs: computeLatencyStats(this.latencySamples),
      contextBudgetUsed: [...this.contextBudgetUsed],
      memoryHitRatio: [...this.memoryHitRatio],
      nativeTokenTotal: [...this.nativeTokenTotal],
      parseLossRatio: [...this.parseLossRatio],
    };
  }
}

function computeLatencyStats(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return { samples: [], p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
  };
}
