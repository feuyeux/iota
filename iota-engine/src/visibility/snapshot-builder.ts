import type { BackendName, RuntimeEvent } from "../event/types.js";
import type { ExecutionVisibility, MemorySelectedVisibility } from "./types.js";
import type {
  AppExecutionSnapshot,
  AppSessionSnapshot,
  BackendStatusView,
  ConversationTimelineItem,
  ConversationTimelineView,
  MemoryCardView,
  MemoryPanelView,
  SessionSummaryView,
  SessionTracingView,
  TokenStatsView,
  TraceDetailView,
  TraceOverviewView,
  TracePerformanceView,
  TraceStepView,
} from "./app-read-model.js";

/**
 * Build an AppExecutionSnapshot from raw visibility data and runtime events.
 * Used by @iota/agent to serve /executions/:id/app-snapshot.
 */
export function buildAppExecutionSnapshot(
  sessionId: string,
  executionId: string,
  backend: BackendName,
  visibility: ExecutionVisibility,
  events: RuntimeEvent[],
  userPrompt?: string,
): AppExecutionSnapshot {
  return {
    sessionId,
    executionId,
    backend,
    conversation: buildConversationTimeline(events, executionId, userPrompt),
    tracing: buildSessionTracing(visibility),
    memory: buildMemoryPanel(visibility),
    tokens: buildTokenStats(visibility),
    summary: buildSessionSummary(sessionId, executionId, events),
  };
}

function buildConversationTimeline(
  events: RuntimeEvent[],
  executionId?: string,
  userPrompt?: string,
): ConversationTimelineView {
  const items: ConversationTimelineItem[] = [];
  let state: ConversationTimelineView["state"] = "idle";

  // Add user prompt as first item if available (P1-2)
  if (userPrompt) {
    items.push({
      id: `${executionId ?? "unknown"}-user`,
      role: "user",
      content: userPrompt,
      timestamp: events[0]?.timestamp ?? Date.now(),
      executionId: executionId ?? "",
      eventSequence: -1,
    });
  }

  for (const event of events) {
    if (event.type === "output") {
      items.push({
        id: `${event.executionId}-${event.sequence}`,
        role:
          event.data.role === "assistant"
            ? "assistant"
            : event.data.role === "tool"
              ? "tool"
              : "system",
        content: event.data.content,
        timestamp: event.timestamp,
        executionId: event.executionId,
        eventSequence: event.sequence,
      });
    }
    if (event.type === "state") {
      const s = event.data.state;
      if (
        s === "completed" ||
        s === "failed" ||
        s === "interrupted" ||
        s === "running" ||
        s === "queued" ||
        s === "waiting_approval"
      ) {
        state = s;
      }
    }
  }

  return { items, state };
}

function buildSessionTracing(
  visibility: ExecutionVisibility,
): SessionTracingView {
  const steps: TraceStepView[] = [];

  // Derive steps from trace spans (standalone or from link visibility)
  const spans = visibility.spans ?? visibility.link?.spans ?? [];

  const requestSpan = spans.find((s) => s.kind === "engine.request");
  const backendSpan = spans.find(
    (s) => s.kind === "backend.spawn" || s.kind === "backend.resolve",
  );
  const parseSpans = spans.filter((s) => s.kind === "adapter.parse");
  const persistSpan = spans.find((s) => s.kind === "event.persist");
  const approvalSpans = spans.filter((s) => s.kind === "approval.wait");
  const mcpSpans = spans.filter((s) => s.kind === "mcp.proxy");
  const memorySpans = spans.filter(
    (s) => s.kind === "memory.search" || s.kind === "memory.inject",
  );
  const workspaceSpans = spans.filter((s) => s.kind === "workspace.scan");

  const toStep = (
    key: TraceStepView["key"],
    label: string,
    span?: { startedAt: number; endedAt?: number; status: string },
    count?: number,
  ): TraceStepView => ({
    key,
    label,
    status: !span
      ? "skipped"
      : span.status === "ok"
        ? "completed"
        : span.status === "error"
          ? "failed"
          : "pending",
    durationMs:
      span?.endedAt && span.startedAt
        ? span.endedAt - span.startedAt
        : undefined,
    count,
  });

  steps.push(toStep("request", "请求处理", requestSpan));
  steps.push(toStep("base_engine", "底座引擎", backendSpan, parseSpans.length));
  steps.push(toStep("response", "响应处理", persistSpan));
  steps.push(toStep("complete", "完成", persistSpan));
  if (approvalSpans.length > 0)
    steps.push(
      toStep("approval", "审批", approvalSpans[0], approvalSpans.length),
    );
  if (mcpSpans.length > 0)
    steps.push(toStep("mcp", "MCP 代理", mcpSpans[0], mcpSpans.length));
  if (workspaceSpans.length > 0)
    steps.push(
      toStep(
        "workspace",
        "工作区扫描",
        workspaceSpans[0],
        workspaceSpans.length,
      ),
    );
  if (memorySpans.length > 0)
    steps.push(
      toStep("memory", "记忆检索", memorySpans[0], memorySpans.length),
    );

  const totalDurationMs =
    requestSpan?.startedAt && persistSpan?.endedAt
      ? persistSpan.endedAt - requestSpan.startedAt
      : undefined;

  const overview: TraceOverviewView = {
    requestMs:
      requestSpan?.endedAt && requestSpan.startedAt
        ? requestSpan.endedAt - requestSpan.startedAt
        : undefined,
    backendMs:
      backendSpan?.endedAt && backendSpan.startedAt
        ? backendSpan.endedAt - backendSpan.startedAt
        : undefined,
    responseMs:
      persistSpan?.endedAt && persistSpan.startedAt
        ? persistSpan.endedAt - persistSpan.startedAt
        : undefined,
    completedMs: totalDurationMs,
  };

  const detail: TraceDetailView = {
    command: visibility.link?.command.executable,
    protocol: visibility.link?.protocol.name,
    nativeEventCount: visibility.link?.nativeEventRefs.length ?? 0,
    runtimeEventCount: visibility.mappings?.length ?? 0,
    parseErrorCount:
      visibility.mappings?.filter(
        (m) => m.mappingRule === "parse_error_to_text",
      ).length ?? 0,
    approvalCount: approvalSpans.length,
    mcpProxyCount: mcpSpans.length,
  };

  const performance: TracePerformanceView = {
    latencyMs: computeLatencyPercentiles(spans),
    memoryHitRatio: visibility.memory
      ? visibility.memory.selected.length /
        Math.max(visibility.memory.candidates.length, 1)
      : undefined,
    contextBudgetUsedRatio: visibility.context?.totals.budgetUsedRatio,
    parseLossRatio: visibility.mappings
      ? visibility.mappings.filter((m) => m.lossy).length /
        Math.max(visibility.mappings.length, 1)
      : undefined,
  };

  return {
    live: false,
    totalDurationMs,
    steps,
    tabs: { overview, detail, performance },
  };
}

function buildMemoryPanel(visibility: ExecutionVisibility): MemoryPanelView {
  const longTerm: MemoryCardView[] = [];
  const session: MemoryCardView[] = [];
  const knowledge: MemoryCardView[] = [];

  const toCard = (sel: MemorySelectedVisibility): MemoryCardView => ({
    id: sel.memoryId,
    title: sel.preview?.slice(0, 50) ?? sel.memoryId,
    preview: sel.preview ?? "",
    tags: sel.type ? [sel.type] : [],
    source: sel.source,
    visibleToBackend: sel.visibleToBackend,
    tokenEstimate: sel.estimatedTokens,
  });

  for (const sel of visibility.memory?.selected ?? []) {
    if (sel.type === "semantic") {
      knowledge.push(toCard(sel));
    } else if (sel.source === "dialogue") {
      session.push(toCard(sel));
    } else {
      longTerm.push(toCard(sel));
    }
  }

  const selectedCount = visibility.memory?.selected.length ?? 0;
  const trimmedCount =
    visibility.memory?.selected.filter((s) => s.trimmed).length ?? 0;

  return {
    tabs: { longTerm, session, knowledge },
    hitCount: visibility.memory?.candidates.length ?? 0,
    selectedCount,
    trimmedCount,
  };
}

function buildTokenStats(visibility: ExecutionVisibility): TokenStatsView {
  const ledger = visibility.tokens;
  if (!ledger) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      confidence: "estimated",
    };
  }

  return {
    inputTokens: ledger.input.nativeTokens ?? ledger.input.estimatedTokens,
    outputTokens: ledger.output.nativeTokens ?? ledger.output.estimatedTokens,
    totalTokens: ledger.total.nativeTokens ?? ledger.total.estimatedTokens,
    confidence: ledger.confidence,
    bySegment: ledger.input.bySegment.map((s) => ({
      label: s.kind,
      tokens: s.nativeTokens ?? s.estimatedTokens,
      kind: s.kind,
    })),
  };
}

function buildSessionSummary(
  _sessionId: string,
  executionId: string,
  events: RuntimeEvent[],
): SessionSummaryView {
  const messageCount = events.filter((e) => e.type === "output").length;
  const first = events[0];
  const last = events[events.length - 1];
  const totalDurationMs =
    first && last ? last.timestamp - first.timestamp : undefined;

  return {
    text: `Execution ${executionId}: ${messageCount} messages`,
    createdAt: first?.timestamp ?? Date.now(),
    messageCount,
    totalDurationMs,
    lastExecutionId: executionId,
  };
}

export function buildAppSessionSnapshot(options: {
  sessionId: string;
  title?: string;
  activeBackend: BackendName;
  workingDirectory: string;
  createdAt: number;
  updatedAt: number;
  backends: BackendStatusView[];
  executionSnapshots: AppExecutionSnapshot[];
  activeFiles: import("../memory/working.js").ActiveFile[];
  mcpServers?: import("./app-read-model.js").McpServerDescriptor[];
}): AppSessionSnapshot {
  const {
    sessionId,
    title,
    activeBackend,
    workingDirectory,
    createdAt,
    updatedAt,
    backends,
    executionSnapshots,
    activeFiles,
    mcpServers,
  } = options;
  const active = executionSnapshots[executionSnapshots.length - 1];

  // Aggregate conversation items across all executions
  const conversations = executionSnapshots
    .map((snap) => ({
      sessionId,
      executionId: snap.executionId,
      title: snap.summary.text,
      updatedAt: snap.summary.createdAt + (snap.summary.totalDurationMs ?? 0),
      lastMessagePreview: snap.conversation.items[
        snap.conversation.items.length - 1
      ]?.content?.slice(0, 100),
      activeBackend: snap.backend,
    }))
    .reverse(); // Show newest first

  // Aggregate token stats
  const totalInput = executionSnapshots.reduce(
    (sum, s) => sum + s.tokens.inputTokens,
    0,
  );
  const totalOutput = executionSnapshots.reduce(
    (sum, s) => sum + s.tokens.outputTokens,
    0,
  );
  // Compute merged confidence: if any execution is native → mixed or native;
  // if all estimated → estimated
  const confidences = executionSnapshots.map((s) => s.tokens.confidence);
  const hasNative = confidences.some((c) => c === "native");
  const hasMixed = confidences.some((c) => c === "mixed");
  const hasEstimated = confidences.some((c) => c === "estimated");
  const mergedConfidence: "native" | "mixed" | "estimated" = hasNative
    ? hasEstimated || hasMixed
      ? "mixed"
      : "native"
    : hasMixed
      ? "mixed"
      : "estimated";

  const tokens: TokenStatsView = {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    totalTokens: totalInput + totalOutput,
    confidence: mergedConfidence,
  };

  const totalMessages = executionSnapshots.reduce(
    (sum, s) => sum + s.summary.messageCount,
    0,
  );
  const firstExec = executionSnapshots[0];
  const lastExec = executionSnapshots[executionSnapshots.length - 1];
  const totalDurationMs =
    firstExec && lastExec
      ? lastExec.summary.createdAt +
        (lastExec.summary.totalDurationMs ?? 0) -
        firstExec.summary.createdAt
      : undefined;

  return {
    session: {
      id: sessionId,
      title,
      activeBackend,
      workingDirectory,
      createdAt,
      updatedAt,
    },
    backends,
    conversations,
    mcpServers,
    activeExecution: active,
    activeFiles: activeFiles.map((f) => ({
      path: f.path,
      pinned: f.pinned,
    })),
    memory: active?.memory ?? {
      tabs: { longTerm: [], session: [], knowledge: [] },
      hitCount: 0,
      selectedCount: 0,
      trimmedCount: 0,
    },
    tokens,
    tracing: active?.tracing ?? {
      live: false,
      steps: [],
      tabs: {
        overview: {},
        detail: {
          nativeEventCount: 0,
          runtimeEventCount: 0,
          parseErrorCount: 0,
          approvalCount: 0,
          mcpProxyCount: 0,
        },
        performance: { latencyMs: { p50: 0, p95: 0, p99: 0 } },
      },
    },
    summary: {
      text: `Session ${sessionId}: ${executionSnapshots.length} executions, ${totalMessages} messages`,
      createdAt: firstExec?.summary.createdAt ?? createdAt,
      messageCount: totalMessages,
      totalDurationMs,
      lastExecutionId: lastExec?.executionId,
    },
  };
}

/** Compute p50/p95/p99 latency from span durations. */
function computeLatencyPercentiles(
  spans: Array<{ startedAt: number; endedAt?: number }>,
): { p50: number; p95: number; p99: number } {
  const durations = spans
    .filter((s) => s.endedAt != null && s.startedAt > 0)
    .map((s) => s.endedAt! - s.startedAt)
    .sort((a, b) => a - b);

  if (durations.length === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }

  const percentile = (p: number): number => {
    const idx = Math.ceil((p / 100) * durations.length) - 1;
    return durations[Math.max(0, idx)];
  };

  return {
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
  };
}
