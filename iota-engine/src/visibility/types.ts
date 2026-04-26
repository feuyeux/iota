import type { BackendName, MemoryKind, RuntimeEvent } from "../event/types.js";

// ─── Visibility Policy ───────────────────────────────────────────

export type VisibilityLevel = "off" | "summary" | "preview" | "full";

export interface VisibilityPolicy {
  memory: VisibilityLevel;
  tokens: VisibilityLevel;
  chain: VisibilityLevel;
  rawProtocol: VisibilityLevel;
  previewChars: number;
  persistFullContent: boolean;
  redactSecrets: boolean;
}

export const DEFAULT_VISIBILITY_POLICY: VisibilityPolicy = {
  memory: "preview",
  tokens: "summary",
  chain: "summary",
  rawProtocol: "off",
  previewChars: 240,
  persistFullContent: false,
  redactSecrets: true,
};

// ─── Redaction ───────────────────────────────────────────────────

export interface RedactionSummary {
  applied: boolean;
  fields: string[];
  patterns: string[];
  contentHashBefore?: string;
  contentHashAfter?: string;
}

// ─── Context Manifest ────────────────────────────────────────────

export type ContextSegmentKind =
  | "system_prompt"
  | "user_prompt"
  | "conversation"
  | "injected_memory"
  | "active_files"
  | "workspace_summary"
  | "mcp_server_manifest"
  | "tool_result"
  | "switch_context";

export interface ContextSegment {
  id: string;
  kind: ContextSegmentKind;
  source: "iota" | "user" | "memory_store" | "workspace" | "mcp" | "backend";
  visibleToBackend: boolean;
  contentHash: string;
  preview?: string;
  fullContentRef?: string;
  charCount: number;
  estimatedTokens: number;
  nativeTokens?: number;
  redaction: RedactionSummary;
  metadata?: Record<string, unknown>;
}

export interface ContextManifest {
  sessionId: string;
  executionId: string;
  backend: BackendName;
  createdAt: number;
  policy: VisibilityPolicy;
  segments: ContextSegment[];
  totals: {
    estimatedInputTokens: number;
    maxContextTokens: number;
    budgetUsedRatio: number;
  };
}

// ─── Token Ledger ────────────────────────────────────────────────

export interface TokenUsageBreakdown {
  nativeTokens?: number;
  estimatedTokens: number;
  bySegment: Array<{
    segmentId: string;
    kind:
      | ContextSegmentKind
      | "assistant_output"
      | "tool_output"
      | "native_thinking";
    estimatedTokens: number;
    nativeTokens?: number;
  }>;
}

export interface TokenLedger {
  sessionId: string;
  executionId: string;
  backend: BackendName;
  input: TokenUsageBreakdown;
  output: TokenUsageBreakdown;
  total: {
    nativeTokens?: number;
    estimatedTokens: number;
    billableTokens?: number;
  };
  confidence: "native" | "mixed" | "estimated";
}

export interface NativeUsageVisibility {
  backend: BackendName;
  sourceEventRef?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  raw?: Record<string, unknown>;
}

// ─── Trace Span ──────────────────────────────────────────────────

export type TraceSpanKind =
  | "engine.request"
  | "engine.context.build"
  | "memory.search"
  | "memory.inject"
  | "backend.resolve"
  | "backend.spawn"
  | "backend.stdin.write"
  | "backend.stdout.read"
  | "backend.stderr.read"
  | "adapter.parse"
  | "event.persist"
  | "approval.wait"
  | "mcp.proxy"
  | "workspace.scan"
  | "memory.extract";

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sessionId: string;
  executionId: string;
  backend?: BackendName;
  kind: TraceSpanKind;
  startedAt: number;
  endedAt?: number;
  status: "ok" | "error" | "cancelled";
  attributes: Record<string, unknown>;
  redaction: RedactionSummary;
}

export interface TraceSpanNode {
  span: TraceSpan;
  children: TraceSpanNode[];
}

export interface ExecutionTrace {
  traceId: string;
  sessionId: string;
  executionId: string;
  backend?: BackendName;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  status: "ok" | "error" | "cancelled" | "unknown";
  spans: TraceSpan[];
  tree: TraceSpanNode[];
}

export interface TraceAggregationOptions {
  sessionId?: string;
  executionId?: string;
  backend?: BackendName;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export interface TraceAggregation {
  totalExecutions: number;
  totalSpans: number;
  errorSpans: number;
  cancelledSpans: number;
  byBackend: Record<string, number>;
  bySpanKind: Record<string, number>;
  byStatus: Record<string, number>;
  durationMs: {
    min?: number;
    max?: number;
    avg?: number;
  };
  executions: Array<{
    traceId: string;
    sessionId: string;
    executionId: string;
    backend?: BackendName;
    startedAt?: number;
    endedAt?: number;
    durationMs?: number;
    status: ExecutionTrace["status"];
    spanCount: number;
  }>;
}

// ─── Memory Visibility ──────────────────────────────────────────

export interface MemoryCandidateVisibility {
  memoryId: string;
  type?: MemoryKind;
  source: "dialogue" | "working" | "store" | "milvus" | "redis" | "in_memory";
  score?: number;
  contentHash: string;
  preview?: string;
  charCount: number;
  estimatedTokens: number;
  metadata?: Record<string, unknown>;
}

export interface MemorySelectedVisibility extends MemoryCandidateVisibility {
  injectedSegmentId: string;
  trimmed: boolean;
  trimmedFromTokens?: number;
  trimmedToTokens?: number;
  visibleToBackend: true;
}

export interface MemoryExcludedVisibility extends MemoryCandidateVisibility {
  reason:
    | "low_score"
    | "duplicate"
    | "token_budget_exceeded"
    | "visibility_policy"
    | "session_scope_mismatch"
    | "redacted"
    | "backend_context_limit";
}

export interface MemoryExtractionVisibility {
  extracted: boolean;
  reason?:
    | "output_too_short"
    | "policy_disabled"
    | "backend_failed"
    | "no_signal";
  memoryId?: string;
  type?: MemoryKind;
  contentHash?: string;
  estimatedTokens?: number;
  persistedTo?: Array<"memory_map" | "redis" | "milvus">;
}

export interface MemoryVisibilityRecord {
  sessionId: string;
  executionId: string;
  backend: BackendName;
  createdAt: number;
  query: {
    promptHash: string;
    preview?: string;
    searchTextTokens: number;
  };
  candidates: MemoryCandidateVisibility[];
  selected: MemorySelectedVisibility[];
  excluded: MemoryExcludedVisibility[];
  extraction?: MemoryExtractionVisibility;
}

// ─── Link Visibility ────────────────────────────────────────────

export interface NativeEventRef {
  refId: string;
  direction: "stdin" | "stdout" | "stderr";
  timestamp: number;
  rawHash: string;
  preview?: string;
  parsedAs?: RuntimeEvent["type"] | "ignored" | "parse_error";
  runtimeSequence?: number;
  redaction: RedactionSummary;
}

export interface LinkVisibilityRecord {
  traceId: string;
  sessionId: string;
  executionId: string;
  backend: BackendName;
  command: {
    executable: string;
    args: string[];
    envSummary: Record<string, "present" | "absent" | "redacted">;
    workingDirectory: string;
  };
  process?: {
    pid?: number;
    startedAt: number;
    exitedAt?: number;
    exitCode?: number | null;
    signal?: string | null;
  };
  protocol: {
    name: "ndjson" | "stream-json" | "json-rpc-2.0" | "acp";
    stdinMode: "prompt" | "json_rpc" | "message" | "none";
    stdoutMode: "ndjson" | "json_rpc" | "text";
    stderrCaptured: boolean;
  };
  spans: TraceSpan[];
  nativeEventRefs: NativeEventRef[];
}

// ─── Event Mapping Visibility ───────────────────────────────────

export interface EventMappingVisibility {
  sessionId: string;
  executionId: string;
  backend: BackendName;
  nativeRefId: string;
  runtimeEventType: RuntimeEvent["type"] | "ignored" | "parse_error";
  runtimeSequence?: number;
  mappingRule: string;
  lossy: boolean;
  droppedFields?: string[];
  preservedInExtension?: string[];
}

// ─── Execution Visibility Bundle ────────────────────────────────

export interface ExecutionVisibility {
  context?: ContextManifest;
  memory?: MemoryVisibilityRecord;
  tokens?: TokenLedger;
  link?: LinkVisibilityRecord;
  mappings?: EventMappingVisibility[];
  spans?: TraceSpan[];
}

export interface ExecutionVisibilitySummary {
  executionId: string;
  sessionId: string;
  backend: BackendName;
  createdAt: number;
  hasContext: boolean;
  hasMemory: boolean;
  hasTokens: boolean;
  hasLink: boolean;
  mappingCount: number;
}

export interface VisibilityListOptions {
  limit?: number;
  offset?: number;
  afterTimestamp?: number;
}
