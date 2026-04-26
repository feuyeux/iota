import crypto from "node:crypto";
import type {
  BackendName,
  MemoryBlock,
  RuntimeContext,
  RuntimeRequest,
  RuntimeResponse,
} from "../event/types.js";
import { estimateTokens } from "./token-estimator.js";
import {
  contentHash,
  emptyRedaction,
  makePreview,
  redactText,
} from "./redaction.js";
import type { VisibilityStore } from "./store.js";
import type {
  ContextManifest,
  ContextSegment,
  ContextSegmentKind,
  EventMappingVisibility,
  LinkVisibilityRecord,
  MemoryCandidateVisibility,
  MemoryExcludedVisibility,
  MemoryExtractionVisibility,
  MemorySelectedVisibility,
  MemoryVisibilityRecord,
  NativeEventRef,
  NativeUsageVisibility,
  TokenLedger,
  TraceSpan,
  TraceSpanKind,
  VisibilityPolicy,
} from "./types.js";
import { DEFAULT_VISIBILITY_POLICY } from "./types.js";

export interface VisibilityCollectorOptions {
  store: VisibilityStore;
  policy?: Partial<VisibilityPolicy>;
}

/**
 * VisibilityCollector — per-execution orchestrator that builds and persists
 * ContextManifest, TokenLedger, MemoryVisibilityRecord and TraceSpans.
 *
 * Usage:
 *   const vc = new VisibilityCollector({ store });
 *   vc.begin(request);
 *   vc.addContextSegment(kind, text, source);
 *   vc.recordMemoryInjection(candidates, selected, excluded);
 *   vc.endSpan(spanId);
 *   await vc.finalize(response);
 */
export class VisibilityCollector {
  private readonly store: VisibilityStore;
  private readonly policy: VisibilityPolicy;

  private sessionId = "";
  private executionId = "";
  private backend: BackendName = "claude-code";
  private readonly segments: ContextSegment[] = [];
  private readonly outputSegments: Array<{
    segmentId: string;
    kind: "assistant_output" | "tool_output" | "native_thinking";
    estimatedTokens: number;
    nativeTokens?: number;
  }> = [];
  private readonly spans: TraceSpan[] = [];
  private nativeUsage?: NativeUsageVisibility;
  private traceId = "";
  private rootSpanId?: string;

  // Memory visibility
  private memoryCandidates: MemoryCandidateVisibility[] = [];
  private memorySelected: MemorySelectedVisibility[] = [];
  private memoryExcluded: MemoryExcludedVisibility[] = [];
  private memoryExtraction?: MemoryExtractionVisibility;
  private promptHash = "";
  private promptPreview = "";
  private promptTokens = 0;

  // Link visibility
  private nativeEventRefs: NativeEventRef[] = [];
  private eventMappings: EventMappingVisibility[] = [];
  private linkRecord?: Partial<LinkVisibilityRecord>;

  // Event persist tracking
  private persistCount = 0;
  private persistLastSequence = 0;
  private persistFirstAt = 0;
  private persistLastAt = 0;

  constructor(options: VisibilityCollectorOptions) {
    this.store = options.store;
    this.policy = { ...DEFAULT_VISIBILITY_POLICY, ...options.policy };
  }

  /** Start collecting visibility for a new execution. */
  begin(request: RuntimeRequest): void {
    this.sessionId = request.sessionId;
    this.executionId = request.executionId;
    this.backend = request.backend ?? "claude-code";
    this.traceId = crypto.randomUUID();
    this.segments.length = 0;
    this.outputSegments.length = 0;
    this.spans.length = 0;
    this.rootSpanId = undefined;
    this.memoryCandidates = [];
    this.memorySelected = [];
    this.memoryExcluded = [];
    this.memoryExtraction = undefined;
    this.nativeUsage = undefined;
    this.nativeEventRefs = [];
    this.eventMappings = [];
    this.linkRecord = undefined;
    this.persistCount = 0;
    this.persistLastSequence = 0;
    this.persistFirstAt = 0;
    this.persistLastAt = 0;

    this.promptHash = contentHash(request.prompt);
    const rawPreview =
      this.policy.memory !== "off"
        ? makePreview(request.prompt, this.policy.previewChars)
        : "";
    this.promptPreview = this.policy.redactSecrets
      ? redactText(rawPreview).text
      : rawPreview;
    this.promptTokens = estimateTokens(request.prompt, this.backend);
  }

  // ─── Context Manifest building ─────────────────────────────────

  addContextSegment(
    kind: ContextSegmentKind,
    text: string,
    source: ContextSegment["source"],
    opts?: {
      visibleToBackend?: boolean;
      metadata?: Record<string, unknown>;
      id?: string;
    },
  ): string {
    const id = opts?.id ?? crypto.randomUUID();
    const charCount = text.length;
    const estimated = estimateTokens(text, this.backend);
    const { text: redactedPreview, redaction } = this.policy.redactSecrets
      ? redactText(text)
      : { text, redaction: emptyRedaction() };
    const preview =
      this.policy.memory === "off"
        ? undefined
        : makePreview(redactedPreview, this.policy.previewChars);

    const segment: ContextSegment = {
      id,
      kind,
      source,
      visibleToBackend: opts?.visibleToBackend ?? true,
      contentHash: contentHash(text),
      preview,
      charCount,
      estimatedTokens: estimated,
      redaction,
      metadata: opts?.metadata,
    };
    this.segments.push(segment);
    return id;
  }

  /**
   * Build context segments from a RuntimeRequest + RuntimeContext.
   * @param promptOnly — when true (per-execution backends), only user_prompt
   *   is marked visibleToBackend; other segments are engine-side context that
   *   the CLI manages internally.
   * @param selectedMemoryMap — maps memoryId → injectedSegmentId so context
   *   segments use the same IDs as MemorySelectedVisibility records.
   */
  buildContextFromRequest(
    request: RuntimeRequest,
    context: RuntimeContext,
    maxContextTokens: number,
    promptOnly = false,
    selectedMemoryMap?: Map<string, string>,
  ): void {
    if (request.systemPrompt) {
      this.addContextSegment("system_prompt", request.systemPrompt, "iota", {
        visibleToBackend: !promptOnly,
      });
    }
    this.addContextSegment("user_prompt", request.prompt, "user");

    for (const [index, msg] of context.conversation.entries()) {
      const segmentId = this.addContextSegment(
        "conversation",
        msg.content,
        "iota",
        {
          visibleToBackend: !promptOnly,
          metadata: { role: msg.role, timestamp: msg.timestamp },
        },
      );
      this.recordContextMemoryVisibility({
        memoryId: `dialogue:${msg.timestamp ?? index}:${contentHash(msg.content)}`,
        source: "dialogue",
        content: msg.content,
        segmentId,
        visibleToBackend: !promptOnly,
        metadata: { role: msg.role, timestamp: msg.timestamp },
      });
    }

    for (const mem of context.injectedMemory) {
      // Memory is composed into the effective prompt (via prompt-composer),
      // so it's visible to the backend even in promptOnly mode.
      this.addContextSegment("injected_memory", mem.content, "memory_store", {
        visibleToBackend: true,
        id: selectedMemoryMap?.get(mem.id),
        metadata: { memoryId: mem.id, type: mem.type, score: mem.score },
      });
    }

    if (context.workspaceSummary) {
      this.addContextSegment(
        "workspace_summary",
        context.workspaceSummary,
        "workspace",
        { visibleToBackend: !promptOnly },
      );
    }

    if (context.activeFiles && context.activeFiles.length > 0) {
      const activeFilesText = context.activeFiles.join("\n");
      const segmentId = this.addContextSegment(
        "active_files",
        activeFilesText,
        "workspace",
        { visibleToBackend: !promptOnly },
      );
      this.recordContextMemoryVisibility({
        memoryId: `working:${contentHash(activeFilesText)}`,
        source: "working",
        content: activeFilesText,
        segmentId,
        visibleToBackend: !promptOnly,
        metadata: { paths: context.activeFiles, kind: "active_files" },
      });
    }

    if (context.mcpServers && context.mcpServers.length > 0) {
      const manifest = context.mcpServers.map((s) => s.name).join(", ");
      this.addContextSegment("mcp_server_manifest", manifest, "mcp", {
        visibleToBackend: !promptOnly,
      });
    }

    // Store maxContextTokens for finalization
    this._maxContextTokens = maxContextTokens;
  }
  private _maxContextTokens = 128_000;

  // ─── Memory Visibility ─────────────────────────────────────────

  private recordContextMemoryVisibility(options: {
    memoryId: string;
    source: "dialogue" | "working";
    content: string;
    segmentId: string;
    visibleToBackend: boolean;
    metadata?: Record<string, unknown>;
  }): void {
    const redacted = this.policy.redactSecrets
      ? redactText(makePreview(options.content, this.policy.previewChars)).text
      : makePreview(options.content, this.policy.previewChars);
    const candidate = {
      memoryId: options.memoryId,
      source: options.source,
      contentHash: contentHash(options.content),
      preview: this.policy.memory !== "off" ? redacted : undefined,
      charCount: options.content.length,
      estimatedTokens: estimateTokens(options.content, this.backend),
      metadata: options.metadata,
    };

    this.memoryCandidates.push(candidate);
    if (options.visibleToBackend) {
      this.memorySelected.push({
        ...candidate,
        injectedSegmentId: options.segmentId,
        trimmed: false,
        visibleToBackend: true,
      });
    } else {
      this.memoryExcluded.push({
        ...candidate,
        reason: "visibility_policy",
      });
    }
  }

  recordMemoryInjection(
    candidates: MemoryCandidateVisibility[],
    selected: MemorySelectedVisibility[],
    excluded: MemoryExcludedVisibility[],
  ): void {
    this.memoryCandidates.push(...candidates);
    this.memorySelected.push(...selected);
    this.memoryExcluded.push(...excluded);
  }

  recordMemoryExtraction(extraction: MemoryExtractionVisibility): void {
    this.memoryExtraction = extraction;
  }

  // ─── Event Persist Tracking ─────────────────────────────────────

  /** Record that an event was persisted to the event store. */
  recordEventPersist(sequence: number): void {
    const now = Date.now();
    this.persistCount++;
    this.persistLastSequence = sequence;
    if (this.persistFirstAt === 0) this.persistFirstAt = now;
    this.persistLastAt = now;
  }

  // ─── Token Visibility ──────────────────────────────────────────

  addOutputTokens(
    text: string,
    kind:
      | "assistant_output"
      | "tool_output"
      | "native_thinking" = "assistant_output",
  ): void {
    const segmentId = crypto.randomUUID();
    this.outputSegments.push({
      segmentId,
      kind,
      estimatedTokens: estimateTokens(text, this.backend),
    });
  }

  setNativeUsage(usage: NativeUsageVisibility): void {
    this.nativeUsage = usage;
  }

  // ─── Trace Spans ───────────────────────────────────────────────

  startSpan(
    kind: TraceSpanKind,
    attributes: Record<string, unknown> = {},
    options?: { parentSpanId?: string },
  ): string {
    const spanId = crypto.randomUUID();
    const parentSpanId =
      options?.parentSpanId ??
      (kind === "engine.request" ? undefined : this.rootSpanId);
    const span: TraceSpan = {
      traceId: this.traceId,
      spanId,
      parentSpanId,
      sessionId: this.sessionId,
      executionId: this.executionId,
      backend: this.backend,
      kind,
      startedAt: Date.now(),
      status: "ok",
      attributes,
      redaction: emptyRedaction(),
    };
    if (kind === "engine.request" && !this.rootSpanId) {
      this.rootSpanId = spanId;
    }
    this.spans.push(span);
    return spanId;
  }

  endSpan(
    spanId: string,
    opts?: {
      status?: TraceSpan["status"];
      attributes?: Record<string, unknown>;
    },
  ): void {
    const span = this.spans.find((s) => s.spanId === spanId);
    if (span) {
      span.endedAt = Date.now();
      if (opts?.status) span.status = opts.status;
      if (opts?.attributes) Object.assign(span.attributes, opts.attributes);
    }
  }

  // ─── Link Visibility ────────────────────────────────────────────

  /** Record the command/process/protocol metadata for the backend link. */
  setLinkCommand(link: Partial<LinkVisibilityRecord>): void {
    this.linkRecord = { ...this.linkRecord, ...link };
  }

  /** Record process lifecycle info (pid, exit). */
  setLinkProcess(proc: LinkVisibilityRecord["process"]): void {
    if (!this.linkRecord) this.linkRecord = {};
    this.linkRecord.process = proc;
  }

  /** Append a native event reference (one per stdout/stdin line). */
  appendNativeEventRef(ref: NativeEventRef): void {
    this.nativeEventRefs.push(ref);
  }

  /** Append an event mapping record (native → runtime). */
  appendEventMapping(mapping: EventMappingVisibility): void {
    this.eventMappings.push(mapping);
  }

  /**
   * Backfill runtimeSequence on the most recent NativeEventRef and EventMapping
   * after eventStore.append() assigns the final sequence number.
   */
  backfillLastSequence(sequence: number): void {
    const ref = this.nativeEventRefs.find(
      (item) =>
        item.runtimeSequence == null &&
        item.parsedAs != null &&
        item.parsedAs !== "ignored",
    );
    if (ref) {
      ref.runtimeSequence = sequence;
    }
    const mapping = this.eventMappings.find(
      (item) =>
        item.runtimeSequence == null && item.runtimeEventType !== "ignored",
    );
    if (mapping) {
      mapping.runtimeSequence = sequence;
    }
  }

  /** Expose policy for subprocess adapter to check rawProtocol level. */
  getPolicy(): VisibilityPolicy {
    return this.policy;
  }

  /** Expose traceId for link record construction. */
  getTraceId(): string {
    return this.traceId;
  }

  /** Expose the root span for callers that need to build explicit child spans. */
  getRootSpanId(): string | undefined {
    return this.rootSpanId;
  }

  /** Expose sessionId/executionId/backend for external use. */
  getExecutionInfo(): {
    sessionId: string;
    executionId: string;
    backend: BackendName;
  } {
    return {
      sessionId: this.sessionId,
      executionId: this.executionId,
      backend: this.backend,
    };
  }

  // ─── Finalize & Persist ────────────────────────────────────────

  async finalize(response?: RuntimeResponse): Promise<void> {
    if (
      this.policy.tokens === "off" &&
      this.policy.memory === "off" &&
      this.policy.chain === "off"
    ) {
      return;
    }

    // Persist ContextManifest
    const estimatedInputTokens = this.segments.reduce(
      (sum, s) => sum + s.estimatedTokens,
      0,
    );
    const visibleEstimatedInputTokens = this.segments
      .filter((s) => s.visibleToBackend)
      .reduce((sum, s) => sum + s.estimatedTokens, 0);
    const manifest: ContextManifest = {
      sessionId: this.sessionId,
      executionId: this.executionId,
      backend: this.backend,
      createdAt: Date.now(),
      policy: this.policy,
      segments: this.segments,
      totals: {
        estimatedInputTokens,
        maxContextTokens: this._maxContextTokens,
        budgetUsedRatio:
          this._maxContextTokens > 0
            ? estimatedInputTokens / this._maxContextTokens
            : 0,
      },
    };
    await this.store.saveContextManifest(manifest);

    // Persist MemoryVisibilityRecord
    if (this.policy.memory !== "off") {
      const memoryRecord: MemoryVisibilityRecord = {
        sessionId: this.sessionId,
        executionId: this.executionId,
        backend: this.backend,
        createdAt: Date.now(),
        query: {
          promptHash: this.promptHash,
          preview: this.promptPreview || undefined,
          searchTextTokens: this.promptTokens,
        },
        candidates: this.memoryCandidates,
        selected: this.memorySelected,
        excluded: this.memoryExcluded,
        extraction: this.memoryExtraction,
      };
      await this.store.saveMemoryVisibility(memoryRecord);
    }

    // Persist TokenLedger
    if (this.policy.tokens !== "off") {
      const inputBySegment = this.segments.map((s) => ({
        segmentId: s.id,
        kind: s.kind,
        estimatedTokens: s.estimatedTokens,
        nativeTokens: s.nativeTokens,
      }));
      const outputBySegment = this.outputSegments.map((s) => ({
        segmentId: s.segmentId,
        kind: s.kind,
        estimatedTokens: s.estimatedTokens,
        nativeTokens: s.nativeTokens,
      }));

      const estimatedOutputTokens = this.outputSegments.reduce(
        (sum, s) => sum + s.estimatedTokens,
        0,
      );

      // Merge response.usage BEFORE reading native values (P0-1 fix)
      if (response?.usage) {
        if (
          response.usage.inputTokens != null &&
          this.nativeUsage?.inputTokens == null
        ) {
          this.nativeUsage = {
            ...this.nativeUsage,
            backend: this.backend,
            inputTokens: response.usage.inputTokens,
          };
        }
        if (
          response.usage.outputTokens != null &&
          this.nativeUsage?.outputTokens == null
        ) {
          this.nativeUsage = {
            ...this.nativeUsage,
            backend: this.backend,
            outputTokens: response.usage.outputTokens,
          };
        }
        if (
          response.usage.totalTokens != null &&
          this.nativeUsage?.totalTokens == null
        ) {
          this.nativeUsage = {
            ...this.nativeUsage,
            backend: this.backend,
            totalTokens: response.usage.totalTokens,
          };
        }
        if (
          response.usage.cacheReadTokens != null &&
          this.nativeUsage?.cacheReadTokens == null
        ) {
          this.nativeUsage = {
            ...this.nativeUsage,
            backend: this.backend,
            cacheReadTokens: response.usage.cacheReadTokens,
          };
        }
        if (
          response.usage.cacheWriteTokens != null &&
          this.nativeUsage?.cacheWriteTokens == null
        ) {
          this.nativeUsage = {
            ...this.nativeUsage,
            backend: this.backend,
            cacheWriteTokens: response.usage.cacheWriteTokens,
          };
        }
      }

      // Now read merged native values
      const nativeInput = this.nativeUsage?.inputTokens;
      const nativeOutput = this.nativeUsage?.outputTokens;
      const nativeTotal =
        this.nativeUsage?.totalTokens ??
        (nativeInput != null && nativeOutput != null
          ? nativeInput + nativeOutput
          : undefined);

      let confidence: TokenLedger["confidence"] = "estimated";
      if (nativeInput != null && nativeOutput != null) {
        confidence = "native";
      } else if (nativeInput != null || nativeOutput != null) {
        confidence = "mixed";
      }

      const ledger: TokenLedger = {
        sessionId: this.sessionId,
        executionId: this.executionId,
        backend: this.backend,
        input: {
          nativeTokens: nativeInput,
          estimatedTokens: visibleEstimatedInputTokens,
          bySegment: inputBySegment,
        },
        output: {
          nativeTokens: nativeOutput,
          estimatedTokens: estimatedOutputTokens,
          bySegment: outputBySegment,
        },
        total: {
          nativeTokens: nativeTotal,
          estimatedTokens: visibleEstimatedInputTokens + estimatedOutputTokens,
          billableTokens: nativeTotal,
        },
        confidence,
      };
      await this.store.saveTokenLedger(ledger);
    }

    // Persist TraceSpans (including synthetic event.persist span)
    if (this.policy.chain !== "off") {
      // Build event.persist span from accumulated persist stats
      if (this.persistCount > 0) {
        const persistSpan: TraceSpan = {
          traceId: this.traceId,
          spanId: crypto.randomUUID(),
          parentSpanId: this.rootSpanId,
          sessionId: this.sessionId,
          executionId: this.executionId,
          backend: this.backend,
          kind: "event.persist",
          startedAt: this.persistFirstAt,
          endedAt: this.persistLastAt,
          status: "ok",
          attributes: {
            count: this.persistCount,
            lastSequence: this.persistLastSequence,
          },
          redaction: emptyRedaction(),
        };
        this.spans.push(persistSpan);
      }
      for (const span of this.spans) {
        await this.store.appendTraceSpan(span);
      }
    }

    // Persist LinkVisibilityRecord
    if (this.policy.chain !== "off" && this.linkRecord) {
      const link: LinkVisibilityRecord = {
        traceId: this.traceId,
        sessionId: this.sessionId,
        executionId: this.executionId,
        backend: this.backend,
        command: this.linkRecord.command ?? {
          executable: "",
          args: [],
          envSummary: {},
          workingDirectory: "",
        },
        process: this.linkRecord.process,
        protocol: this.linkRecord.protocol ?? {
          name: "ndjson",
          stdinMode: "none",
          stdoutMode: "ndjson",
          stderrCaptured: true,
        },
        spans: this.spans.filter((s) => s.kind.startsWith("backend.")),
        nativeEventRefs: this.nativeEventRefs,
      };
      await this.store.saveLinkVisibility(link);
    }

    // Persist EventMappingVisibility records
    if (this.policy.chain !== "off") {
      for (const mapping of this.eventMappings) {
        await this.store.appendEventMapping(mapping);
      }
    }
  }
}

// ─── Helper to create memory candidate from MemoryBlock ─────────

export function toMemoryCandidateVisibility(
  block: MemoryBlock,
  source: MemoryCandidateVisibility["source"],
  policy: VisibilityPolicy,
): MemoryCandidateVisibility {
  const hash = contentHash(block.content);
  const charCount = block.content.length;
  const estimated = estimateTokens(block.content);
  let preview: string | undefined;
  if (policy.memory !== "off" && policy.memory !== "summary") {
    const raw = makePreview(block.content, policy.previewChars);
    // Always redact secrets from memory previews (P0-5)
    preview = policy.redactSecrets ? redactText(raw).text : raw;
  }

  return {
    memoryId: block.id,
    type: block.type,
    source,
    score:
      block.score ?? (block.metadata?.relevanceScore as number | undefined),
    contentHash: hash,
    preview,
    charCount,
    estimatedTokens: estimated,
    metadata: block.metadata,
  };
}
