import type IoRedis from "ioredis";
import type { VisibilityStore } from "./store.js";
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

type RedisClient = InstanceType<typeof IoRedis.default>;

/**
 * Redis-backed VisibilityStore.
 *
 * Key layout:
 *   iota:visibility:context:<executionId>       — JSON (ContextManifest)
 *   iota:visibility:memory:<executionId>        — JSON (MemoryVisibilityRecord)
 *   iota:visibility:tokens:<executionId>        — JSON (TokenLedger)
 *   iota:visibility:link:<executionId>          — JSON (LinkVisibilityRecord)
 *   iota:visibility:spans:<executionId>         — List of JSON (TraceSpan[])
 *   iota:visibility:<executionId>:chain         — Hash spanId → JSON (TraceSpan)
 *   iota:visibility:mapping:<executionId>       — List of JSON (EventMappingVisibility[])
 *   iota:visibility:session:<sessionId>         — Sorted Set (executionId by timestamp)
 */
export class RedisVisibilityStore implements VisibilityStore {
  /** Default TTL: 7 days in seconds */
  private static readonly DEFAULT_TTL_SECONDS = 7 * 24 * 3600;
  private readonly ttlSeconds: number;

  constructor(
    private readonly client: RedisClient,
    options?: { retentionHours?: number },
  ) {
    this.ttlSeconds = options?.retentionHours
      ? options.retentionHours * 3600
      : RedisVisibilityStore.DEFAULT_TTL_SECONDS;
  }

  async saveContextManifest(manifest: ContextManifest): Promise<void> {
    const key = `iota:visibility:context:${manifest.executionId}`;
    await this.client.set(key, JSON.stringify(manifest), "EX", this.ttlSeconds);
    await this.indexSession(
      manifest.sessionId,
      manifest.executionId,
      manifest.createdAt,
    );
  }

  async saveMemoryVisibility(record: MemoryVisibilityRecord): Promise<void> {
    const key = `iota:visibility:memory:${record.executionId}`;
    await this.client.set(key, JSON.stringify(record), "EX", this.ttlSeconds);
    await this.indexSession(
      record.sessionId,
      record.executionId,
      record.createdAt,
    );
  }

  async saveTokenLedger(ledger: TokenLedger): Promise<void> {
    const key = `iota:visibility:tokens:${ledger.executionId}`;
    await this.client.set(key, JSON.stringify(ledger), "EX", this.ttlSeconds);
  }

  async saveLinkVisibility(record: LinkVisibilityRecord): Promise<void> {
    const key = `iota:visibility:link:${record.executionId}`;
    await this.client.set(key, JSON.stringify(record), "EX", this.ttlSeconds);
  }

  async appendTraceSpan(span: TraceSpan): Promise<void> {
    const spanJson = JSON.stringify(span);
    const spansKey = `iota:visibility:spans:${span.executionId}`;
    const chainKey = `iota:visibility:${span.executionId}:chain`;
    await this.client
      .multi()
      .rpush(spansKey, spanJson)
      .expire(spansKey, this.ttlSeconds)
      .hset(chainKey, span.spanId, spanJson)
      .expire(chainKey, this.ttlSeconds)
      .exec();
  }

  async appendEventMapping(mapping: EventMappingVisibility): Promise<void> {
    const key = `iota:visibility:mapping:${mapping.executionId}`;
    await this.client.rpush(key, JSON.stringify(mapping));
    await this.client.expire(key, this.ttlSeconds);
  }

  async getExecutionVisibility(
    executionId: string,
  ): Promise<ExecutionVisibility | null> {
    const [
      contextJson,
      memoryJson,
      tokensJson,
      linkJson,
      spanJsons,
      chainSpanMap,
      mappingJsons,
    ] = await Promise.all([
      this.client.get(`iota:visibility:context:${executionId}`),
      this.client.get(`iota:visibility:memory:${executionId}`),
      this.client.get(`iota:visibility:tokens:${executionId}`),
      this.client.get(`iota:visibility:link:${executionId}`),
      this.client.lrange(`iota:visibility:spans:${executionId}`, 0, -1),
      this.client.hgetall(`iota:visibility:${executionId}:chain`),
      this.client.lrange(`iota:visibility:mapping:${executionId}`, 0, -1),
    ]);

    const spans = mergeSpans(spanJsons, Object.values(chainSpanMap));

    if (
      !contextJson &&
      !memoryJson &&
      !tokensJson &&
      !linkJson &&
      spans.length === 0
    ) {
      return null;
    }

    const result: ExecutionVisibility = {};
    if (contextJson)
      result.context = JSON.parse(contextJson) as ContextManifest;
    if (memoryJson)
      result.memory = JSON.parse(memoryJson) as MemoryVisibilityRecord;
    if (tokensJson) result.tokens = JSON.parse(tokensJson) as TokenLedger;
    if (linkJson) {
      const link = JSON.parse(linkJson) as LinkVisibilityRecord;
      link.spans = spans;
      result.link = link;
      result.spans = spans;
    } else if (spans.length > 0) {
      // Spans exist without a link record (engine-level spans)
      result.spans = spans;
    }
    if (mappingJsons.length > 0) {
      result.mappings = mappingJsons.map(
        (m) => JSON.parse(m) as EventMappingVisibility,
      );
    }
    return result;
  }

  async listSessionVisibility(
    sessionId: string,
    options?: VisibilityListOptions,
  ): Promise<ExecutionVisibilitySummary[]> {
    const min = options?.afterTimestamp
      ? String(options.afterTimestamp + 1)
      : "-inf";
    const max = "+inf";
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;

    const execIds = await this.client.zrangebyscore(
      `iota:visibility:session:${sessionId}`,
      min,
      max,
      "LIMIT",
      offset,
      limit,
    );

    const summaries: ExecutionVisibilitySummary[] = [];
    for (const executionId of execIds) {
      const [contextJson, memoryJson, tokensJson, linkJson, mappingCount] =
        await Promise.all([
          this.client.get(`iota:visibility:context:${executionId}`),
          this.client.get(`iota:visibility:memory:${executionId}`),
          this.client.get(`iota:visibility:tokens:${executionId}`),
          this.client.get(`iota:visibility:link:${executionId}`),
          this.client.llen(`iota:visibility:mapping:${executionId}`),
        ]);

      const context = contextJson
        ? (JSON.parse(contextJson) as ContextManifest)
        : null;
      summaries.push({
        executionId,
        sessionId,
        backend: context?.backend ?? "claude-code",
        createdAt: context?.createdAt ?? 0,
        hasContext: contextJson !== null,
        hasMemory: memoryJson !== null,
        hasTokens: tokensJson !== null,
        hasLink: linkJson !== null,
        mappingCount,
      });
    }

    return summaries;
  }

  private async indexSession(
    sessionId: string,
    executionId: string,
    timestamp: number,
  ): Promise<void> {
    const key = `iota:visibility:session:${sessionId}`;
    await this.client.zadd(key, timestamp, executionId);
    await this.client.expire(key, this.ttlSeconds);
  }
}

function mergeSpans(listJsons: string[], hashJsons: string[]): TraceSpan[] {
  const byId = new Map<string, TraceSpan>();
  for (const spanJson of [...listJsons, ...hashJsons]) {
    const span = JSON.parse(spanJson) as TraceSpan;
    byId.set(span.spanId, span);
  }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}
