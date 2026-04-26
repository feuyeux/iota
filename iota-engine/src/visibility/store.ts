import type {
  ContextManifest,
  EventMappingVisibility,
  ExecutionVisibility,
  ExecutionVisibilitySummary,
  LinkVisibilityRecord,
  MemoryVisibilityRecord,
  TokenLedger,
  TraceSpan,
  VisibilityListOptions,
} from "./types.js";

/**
 * VisibilityStore — persistence interface for visibility data.
 * Redis implementation for production; local file fallback for development.
 */
export interface VisibilityStore {
  saveContextManifest(manifest: ContextManifest): Promise<void>;
  saveMemoryVisibility(record: MemoryVisibilityRecord): Promise<void>;
  saveTokenLedger(ledger: TokenLedger): Promise<void>;
  saveLinkVisibility(record: LinkVisibilityRecord): Promise<void>;
  appendTraceSpan(span: TraceSpan): Promise<void>;
  appendEventMapping(mapping: EventMappingVisibility): Promise<void>;

  getExecutionVisibility(
    executionId: string,
  ): Promise<ExecutionVisibility | null>;
  listSessionVisibility(
    sessionId: string,
    options?: VisibilityListOptions,
  ): Promise<ExecutionVisibilitySummary[]>;

  /** Optional: remove visibility data older than retentionHours. */
  gc?(retentionHours: number): Promise<{ removed: number }>;
}
