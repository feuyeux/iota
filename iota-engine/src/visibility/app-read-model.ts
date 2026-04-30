import type { BackendName } from "../event/types.js";

// ─── App Read Model types (Section 3.2, 9.4) ───────────────────

export interface ConversationListItem {
  sessionId: string;
  executionId?: string;
  title: string;
  updatedAt: number;
  lastMessagePreview?: string;
  activeBackend?: BackendName;
}

export interface ConversationTimelineView {
  items: ConversationTimelineItem[];
  state:
    | "idle"
    | "queued"
    | "running"
    | "waiting_approval"
    | "completed"
    | "failed"
    | "interrupted";
}

export interface ConversationTimelineItem {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  executionId?: string;
  eventSequence?: number;
  metadata?: Record<string, unknown>;
}

export interface BackendStatusView {
  backend: BackendName;
  label: string;
  status: "online" | "offline" | "busy" | "degraded" | "circuit_open";
  active: boolean;
  capabilities: {
    streaming: boolean;
    mcp: boolean;
    mcpResponseChannel: boolean;
    memoryVisibility: boolean;
    tokenVisibility: boolean;
    chainVisibility: boolean;
  };
}

export interface SessionTracingView {
  live: boolean;
  totalDurationMs?: number;
  steps: TraceStepView[];
  tabs: {
    overview: TraceOverviewView;
    detail: TraceDetailView;
    performance: TracePerformanceView;
  };
}

export interface TraceOverviewView {
  requestMs?: number;
  backendMs?: number;
  responseMs?: number;
  completedMs?: number;
}

export interface TraceDetailView {
  command?: string;
  protocol?: string;
  nativeEventCount: number;
  runtimeEventCount: number;
  parseErrorCount: number;
  approvalCount: number;
  mcpProxyCount: number;
}

export interface TracePerformanceView {
  latencyMs: { p50: number; p95: number; p99: number };
  memoryHitRatio?: number;
  contextBudgetUsedRatio?: number;
  parseLossRatio?: number;
}

export interface TraceStepView {
  key:
    | "request"
    | "base_engine"
    | "response"
    | "complete"
    | "approval"
    | "mcp"
    | "workspace"
    | "memory";
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  durationMs?: number;
  count?: number;
  error?: string;
}

export interface MemoryPanelView {
  tabs: {
    longTerm: MemoryCardView[];
    session: MemoryCardView[];
    knowledge: MemoryCardView[];
  };
  hitCount: number;
  selectedCount: number;
  trimmedCount: number;
}

export interface MemoryPanelDelta {
  added?: MemoryCardView[];
  updated?: MemoryCardView[];
  removedIds?: string[];
  selectedCount?: number;
  trimmedCount?: number;
}

export interface MemoryCardView {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  updatedAt?: number;
  source: "dialogue" | "working" | "store" | "milvus" | "redis" | "in_memory";
  visibleToBackend: boolean;
  tokenEstimate?: number;
}

export interface TokenStatsView {
  inputTokens: number;
  cacheTokens?: number;
  outputTokens: number;
  totalTokens: number;
  confidence: "native" | "mixed" | "estimated";
  byBackend?: Partial<Record<BackendName, number>>;
  bySegment?: Array<{ label: string; tokens: number; kind: string }>;
}

export interface SessionSummaryView {
  text: string;
  createdAt: number;
  messageCount: number;
  totalDurationMs?: number;
  lastExecutionId?: string;
}

export interface AppExecutionSnapshot {
  sessionId: string;
  executionId: string;
  backend: BackendName;
  conversation: ConversationTimelineView;
  tracing: SessionTracingView;
  memory: MemoryPanelView;
  tokens: TokenStatsView;
  summary: SessionSummaryView;
}

export interface ActiveFile {
  path: string;
  estimatedTokens?: number;
  pinned?: boolean;
}

export interface McpServerDescriptor {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string> | string[];
}

export interface AppSessionSnapshot {
  session: {
    id: string;
    title?: string;
    activeBackend: BackendName;
    workingDirectory: string;
    createdAt: number;
    updatedAt: number;
  };
  backends: BackendStatusView[];
  conversations: ConversationListItem[];
  mcpServers?: McpServerDescriptor[];
  activeExecution?: AppExecutionSnapshot;
  activeFiles: ActiveFile[];
  memory: MemoryPanelView;
  tokens: TokenStatsView;
  tracing: SessionTracingView;
  summary: SessionSummaryView;
}

export type AppVisibilityDelta =
  | {
      type: "conversation_delta";
      executionId: string;
      item: ConversationTimelineItem;
    }
  | { type: "trace_step_delta"; executionId: string; step: TraceStepView }
  | { type: "memory_delta"; executionId: string; memory: MemoryPanelDelta }
  | { type: "token_delta"; executionId: string; tokens: TokenStatsView }
  | { type: "summary_delta"; executionId: string; summary: SessionSummaryView };
