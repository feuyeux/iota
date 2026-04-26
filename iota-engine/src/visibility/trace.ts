import type {
  ExecutionTrace,
  TraceAggregation,
  TraceSpan,
  TraceSpanNode,
} from "./types.js";

export function buildTraceTree(spans: TraceSpan[]): TraceSpanNode[] {
  const sorted = [...spans].sort((a, b) => a.startedAt - b.startedAt);
  const nodes = new Map<string, TraceSpanNode>();
  for (const span of sorted) {
    nodes.set(span.spanId, { span, children: [] });
  }

  const roots: TraceSpanNode[] = [];
  for (const span of sorted) {
    const node = nodes.get(span.spanId);
    if (!node) continue;
    const parent = span.parentSpanId ? nodes.get(span.parentSpanId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function buildExecutionTrace(
  executionId: string,
  spans: TraceSpan[],
): ExecutionTrace | null {
  if (spans.length === 0) return null;
  const sorted = [...spans].sort((a, b) => a.startedAt - b.startedAt);
  const first = sorted[0];
  const endedSpans = sorted.filter((span) => span.endedAt !== undefined);
  const lastEnded = endedSpans.sort(
    (a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0),
  )[0];
  const startedAt = first?.startedAt;
  const endedAt = lastEnded?.endedAt;
  const hasError = sorted.some((span) => span.status === "error");
  const hasCancelled = sorted.some((span) => span.status === "cancelled");

  return {
    traceId: first.traceId,
    sessionId: first.sessionId,
    executionId,
    backend: first.backend,
    startedAt,
    endedAt,
    durationMs:
      startedAt !== undefined && endedAt !== undefined
        ? Math.max(0, endedAt - startedAt)
        : undefined,
    status: hasError ? "error" : hasCancelled ? "cancelled" : "ok",
    spans: sorted,
    tree: buildTraceTree(sorted),
  };
}

export function aggregateExecutionTraces(
  traces: ExecutionTrace[],
): TraceAggregation {
  const durations = traces
    .map((trace) => trace.durationMs)
    .filter((duration): duration is number => duration !== undefined);
  const aggregate: TraceAggregation = {
    totalExecutions: traces.length,
    totalSpans: 0,
    errorSpans: 0,
    cancelledSpans: 0,
    byBackend: {},
    bySpanKind: {},
    byStatus: {},
    durationMs: {
      min: durations.length > 0 ? Math.min(...durations) : undefined,
      max: durations.length > 0 ? Math.max(...durations) : undefined,
      avg:
        durations.length > 0
          ? Math.round(
              durations.reduce((sum, duration) => sum + duration, 0) /
                durations.length,
            )
          : undefined,
    },
    executions: [],
  };

  for (const trace of traces) {
    aggregate.executions.push({
      traceId: trace.traceId,
      sessionId: trace.sessionId,
      executionId: trace.executionId,
      backend: trace.backend,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt,
      durationMs: trace.durationMs,
      status: trace.status,
      spanCount: trace.spans.length,
    });
    increment(aggregate.byStatus, trace.status);
    if (trace.backend) increment(aggregate.byBackend, trace.backend);

    for (const span of trace.spans) {
      aggregate.totalSpans += 1;
      increment(aggregate.bySpanKind, span.kind);
      if (span.status === "error") aggregate.errorSpans += 1;
      if (span.status === "cancelled") aggregate.cancelledSpans += 1;
    }
  }

  return aggregate;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}
