import type {
  BackendName,
  ExecutionTrace,
  TraceAggregation,
  TraceAggregationOptions,
  TraceSpanNode,
} from "@iota/engine";
import { withEngine } from "./shared.js";

export interface TraceCommandOptions {
  execution?: string;
  session?: string;
  backend?: BackendName;
  since?: string;
  until?: string;
  limit?: string;
  offset?: string;
  aggregate?: boolean;
  json?: boolean;
}

export async function traceCommand(
  options: TraceCommandOptions,
): Promise<void> {
  await withEngine(async (engine) => {
    if (options.execution && !options.aggregate) {
      const trace = await engine.getExecutionTrace(options.execution);
      if (!trace) {
        console.error(
          `No trace data found for execution: ${options.execution}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        options.json ? JSON.stringify(trace, null, 2) : formatTrace(trace),
      );
      return;
    }

    const query = parseTraceOptions(options);
    const aggregate = await engine.aggregateTraces(query);
    console.log(
      options.json
        ? JSON.stringify(aggregate, null, 2)
        : formatAggregate(aggregate),
    );
  });
}

function parseTraceOptions(
  options: TraceCommandOptions,
): TraceAggregationOptions {
  return {
    sessionId: options.session,
    executionId: options.execution,
    backend: options.backend,
    since: parseTimeOption(options.since, "since"),
    until: parseTimeOption(options.until, "until"),
    offset: options.offset ? Number(options.offset) : undefined,
    limit: options.limit ? Number(options.limit) : undefined,
  };
}

function parseTimeOption(
  value: string | undefined,
  fieldName: string,
): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(
      `--${fieldName} must be a Unix timestamp in milliseconds or an ISO date`,
    );
  }
  return timestamp;
}

function formatTrace(trace: ExecutionTrace): string {
  const lines = [
    `Trace: ${trace.traceId}`,
    `Execution: ${trace.executionId}`,
    `Session: ${trace.sessionId}`,
    `Backend: ${trace.backend ?? "unknown"}`,
    `Status: ${trace.status}`,
    `Duration: ${formatDuration(trace.durationMs)}`,
    `Spans: ${trace.spans.length}`,
    "",
  ];
  for (const node of trace.tree) {
    renderNode(node, lines, 0);
  }
  return lines.join("\n");
}

function renderNode(node: TraceSpanNode, lines: string[], depth: number): void {
  const span = node.span;
  const indent = "  ".repeat(depth);
  const duration =
    span.endedAt !== undefined ? span.endedAt - span.startedAt : undefined;
  const attrs = formatAttrs(span.attributes);
  lines.push(
    `${indent}- ${span.kind} ${span.status} ${formatDuration(duration)} #${shortId(span.spanId)}${attrs ? ` ${attrs}` : ""}`,
  );
  for (const child of node.children) {
    renderNode(child, lines, depth + 1);
  }
}

function formatAggregate(aggregate: TraceAggregation): string {
  const lines = [
    `Trace Executions: ${aggregate.totalExecutions}`,
    `Trace Spans: ${aggregate.totalSpans}`,
    `Errors: ${aggregate.errorSpans}`,
    `Cancelled: ${aggregate.cancelledSpans}`,
    `Duration: min=${formatDuration(aggregate.durationMs.min)} avg=${formatDuration(aggregate.durationMs.avg)} max=${formatDuration(aggregate.durationMs.max)}`,
    "",
    "By Backend:",
    ...formatCounts(aggregate.byBackend),
    "",
    "By Span Kind:",
    ...formatCounts(aggregate.bySpanKind),
    "",
    "Executions:",
    ...aggregate.executions.map(
      (execution) =>
        `  ${execution.executionId} ${execution.backend ?? "unknown"} ${execution.status} ${formatDuration(execution.durationMs)} spans=${execution.spanCount}`,
    ),
  ];
  return lines.join("\n");
}

function formatCounts(counts: Record<string, number>): string[] {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return ["  (none)"];
  return entries.map(([key, value]) => `  ${key}: ${value}`);
}

function formatAttrs(attrs: Record<string, unknown>): string {
  const entries = Object.entries(attrs).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  if (entries.length === 0) return "";
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

function formatDuration(durationMs: number | undefined): string {
  return durationMs === undefined ? "n/a" : `${durationMs}ms`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
