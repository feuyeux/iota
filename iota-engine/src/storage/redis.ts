import IoRedis from "ioredis";
import type { AuditEntry } from "../audit/logger.js";
import type { MemoryKind, RuntimeEvent } from "../event/types.js";
import type {
  MemoryQuery,
  MemoryScope,
  StoredMemory,
} from "../memory/types.js";
import type {
  ExecutionRecord,
  LogAggregation,
  LogQueryOptions,
  LockLease,
  RuntimeLogEntry,
  SessionRecord,
  StorageBackend,
} from "./interface.js";

type RedisClient = InstanceType<typeof IoRedis.default>;

export interface RedisStorageConfig {
  sentinels?: Array<{ host: string; port: number }>;
  masterName?: string;
  password?: string;
  host?: string;
  port?: number;
  streamPrefix: string;
  /** TTL for session records in seconds. Default: 7 days. */
  sessionTtlSeconds?: number;
}

/**
 * Production storage backend using Redis Streams + Sentinel.
 * Section 13.3: Events -> Redis Streams, locks -> Redis Sentinel + fencing token.
 */
export class RedisStorage implements StorageBackend {
  private client!: RedisClient;
  private readonly prefix: string;
  /** Session TTL in seconds — default 7 days. */
  private readonly sessionTtl: number;

  constructor(private readonly config: RedisStorageConfig) {
    this.prefix = config.streamPrefix || "iota:events";
    this.sessionTtl = config.sessionTtlSeconds ?? 7 * 24 * 3600;
  }

  async init(): Promise<void> {
    if (this.config.sentinels && this.config.sentinels.length > 0) {
      this.client = new IoRedis.default({
        sentinels: this.config.sentinels,
        name: this.config.masterName ?? "mymaster",
        password: this.config.password,
        lazyConnect: true,
      });
    } else {
      this.client = new IoRedis.default({
        host: this.config.host ?? "localhost",
        port: this.config.port ?? 6379,
        password: this.config.password,
        lazyConnect: true,
      });
    }
    await this.client.connect();
  }

  async createSession(record: SessionRecord): Promise<void> {
    const key = `iota:session:${record.id}`;
    await this.client.hset(key, {
      id: record.id,
      workingDirectory: record.workingDirectory,
      activeBackend: record.activeBackend ?? "",
      createdAt: String(record.createdAt),
      updatedAt: String(record.updatedAt),
      metadataJson: record.metadata ? JSON.stringify(record.metadata) : "",
    });
    await this.client.expire(key, this.sessionTtl);
  }

  async updateSession(
    record: Partial<SessionRecord> & { id: string },
  ): Promise<void> {
    const key = `iota:session:${record.id}`;
    const fields: Record<string, string> = { updatedAt: String(Date.now()) };
    if (record.workingDirectory !== undefined)
      fields.workingDirectory = record.workingDirectory;
    if (record.activeBackend !== undefined)
      fields.activeBackend = record.activeBackend;
    if (record.metadata !== undefined)
      fields.metadataJson = JSON.stringify(record.metadata);
    await this.client.hset(key, fields);
    await this.client.expire(key, this.sessionTtl);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.del(`iota:session:${sessionId}`);
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const key = `iota:session:${sessionId}`;
    const data = await this.client.hgetall(key);
    if (!data.id) return null;
    return {
      id: data.id,
      workingDirectory: data.workingDirectory,
      activeBackend: data.activeBackend || undefined,
      createdAt: Number(data.createdAt),
      updatedAt: Number(data.updatedAt),
      metadata: data.metadataJson
        ? (JSON.parse(data.metadataJson) as Record<string, unknown>)
        : undefined,
    };
  }

  async appendEvent(event: RuntimeEvent): Promise<void> {
    const streamKey = `${this.prefix}:${event.executionId}`;
    await this.client.xadd(streamKey, "*", "event", JSON.stringify(event));
  }

  async readEvents(
    executionId: string,
    afterSequence = 0,
  ): Promise<RuntimeEvent[]> {
    const streamKey = `${this.prefix}:${executionId}`;
    const entries = await this.client.xrange(streamKey, "-", "+");
    const events: RuntimeEvent[] = [];
    for (const [, fields] of entries) {
      const eventIndex = fields.indexOf("event");
      const eventJson = eventIndex >= 0 ? fields[eventIndex + 1] : undefined;
      if (!eventJson) continue;
      const event = JSON.parse(eventJson) as RuntimeEvent;
      if (event.sequence > afterSequence) {
        events.push(event);
      }
    }
    return events;
  }

  async createExecution(record: ExecutionRecord): Promise<void> {
    const key = `iota:exec:${record.executionId}`;
    await this.client
      .multi()
      .hset(key, serializeExecution(record))
      .sadd(`iota:session-execs:${record.sessionId}`, record.executionId)
      .zadd("iota:executions", record.startedAt, record.executionId)
      .exec();
  }

  async updateExecution(record: ExecutionRecord): Promise<void> {
    const key = `iota:exec:${record.executionId}`;
    await this.client
      .multi()
      .hset(key, serializeExecution(record))
      .zadd("iota:executions", record.startedAt, record.executionId)
      .exec();
  }

  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    const key = `iota:exec:${executionId}`;
    const data = await this.client.hgetall(key);
    if (!data.executionId) return null;
    return deserializeExecution(data);
  }

  async listSessionExecutions(sessionId: string): Promise<ExecutionRecord[]> {
    const members = await this.client.smembers(
      `iota:session-execs:${sessionId}`,
    );
    if (!members.length) return [];
    const records = await Promise.all(
      members.map((id) => this.getExecution(id)),
    );
    return records
      .filter((r): r is ExecutionRecord => r !== null)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  async acquireLock(key: string, ttlMs: number): Promise<LockLease | null> {
    const lockKey = `iota:lock:${key}`;
    const fencingKey = `iota:fencing:${key}`;
    const script = [
      "local lockKey = KEYS[1]",
      "local fencingKey = KEYS[2]",
      "local ttl = tonumber(ARGV[1])",
      'if redis.call("EXISTS", lockKey) == 1 then return nil end',
      'local token = redis.call("INCR", fencingKey)',
      'redis.call("SET", lockKey, token, "PX", ttl)',
      "return token",
    ].join("\n");
    const result = await this.client.eval(
      script,
      2,
      lockKey,
      fencingKey,
      String(ttlMs),
    );
    if (result === null) return null;
    const token = Number(result);
    return { key, token, expiresAt: Date.now() + ttlMs };
  }

  async renewLock(lease: LockLease, ttlMs: number): Promise<boolean> {
    const lockKey = `iota:lock:${lease.key}`;
    const script = [
      'local current = redis.call("GET", KEYS[1])',
      'if current == ARGV[1] then redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2])) return 1 end',
      "return 0",
    ].join("\n");
    const result = await this.client.eval(
      script,
      1,
      lockKey,
      String(lease.token),
      String(ttlMs),
    );
    if (Number(result) === 1) {
      lease.expiresAt = Date.now() + ttlMs;
      return true;
    }
    return false;
  }

  async releaseLock(lease: LockLease): Promise<boolean> {
    const lockKey = `iota:lock:${lease.key}`;
    const script = [
      'local current = redis.call("GET", KEYS[1])',
      'if current == ARGV[1] then redis.call("DEL", KEYS[1]) return 1 end',
      "return 0",
    ].join("\n");
    const result = await this.client.eval(
      script,
      1,
      lockKey,
      String(lease.token),
    );
    return Number(result) === 1;
  }

  async validateFencingToken(key: string, token: number): Promise<boolean> {
    const fencingKey = `iota:fencing:${key}`;
    const current = await this.client.get(fencingKey);
    return current !== null && token === Number(current);
  }

  async appendAuditEntry(entry: AuditEntry): Promise<void> {
    await this.client.zadd(
      "iota:audit",
      entry.timestamp,
      JSON.stringify({ id: `${entry.timestamp}:${cryptoId()}`, entry }),
    );
  }

  async saveUnifiedMemory(memory: StoredMemory): Promise<void> {
    const key = `iota:memory:${memory.type}:${memory.id}`;
    const score = getMemoryIndexScore(memory);
    const tags = Array.isArray(memory.metadata.tags)
      ? memory.metadata.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    await this.client
      .multi()
      .hset(key, {
        id: memory.id,
        scope: memory.scope,
        scopeId: memory.scopeId,
        content: memory.content,
        type: memory.type,
        confidence: String(memory.confidence),
        sourceBackend: memory.source.backend,
        sourceNativeType: memory.source.nativeType,
        sourceExecutionId: memory.source.executionId,
        metadataJson: memory.metadata ? JSON.stringify(memory.metadata) : "",
        tagsJson: JSON.stringify(tags),
        timestamp: String(memory.timestamp),
        ttlDays: String(memory.ttlDays),
        createdAt: String(memory.createdAt),
        lastAccessedAt: String(memory.lastAccessedAt),
        accessCount: String(memory.accessCount),
        expiresAt: String(memory.expiresAt),
      })
      .pexpire(key, Math.max(memory.expiresAt - Date.now(), 1))
      .zadd(
        `iota:memories:${memory.type}:${memory.scopeId}`,
        score,
        memory.id,
      )
      .sadd(`iota:memory:by-backend:${memory.source.backend}`, memory.id)
      .exec();

    for (const tag of tags) {
      await this.client.sadd(`iota:memory:by-tag:${tag}`, memory.id);
    }
  }

  async loadUnifiedMemories(query: MemoryQuery): Promise<StoredMemory[]> {
    const scanLimit = Math.max((query.limit ?? 100) * 5, query.limit ?? 100);
    const ids = await this.client.zrevrange(
      `iota:memories:${query.type}:${query.scopeId}`,
      0,
      Math.max(0, scanLimit - 1),
    );
    const memories: StoredMemory[] = [];
    for (const id of ids) {
      const data = await this.client.hgetall(`iota:memory:${query.type}:${id}`);
      if (!data.id) {
        await this.client.zrem(`iota:memories:${query.type}:${query.scopeId}`, id);
        continue;
      }
      const memory = deserializeStoredMemory(data);
      if (memory.scope !== query.scope || memory.scopeId !== query.scopeId) {
        continue;
      }
      if (
        query.minConfidence !== undefined &&
        memory.confidence < query.minConfidence
      ) {
        continue;
      }
      if (
        query.tags?.length &&
        !query.tags.some((tag) => {
          const tags = Array.isArray(memory.metadata.tags)
            ? memory.metadata.tags
            : [];
          return tags.includes(tag);
        })
      ) {
        continue;
      }
      memories.push(memory);
      if (memories.length >= (query.limit ?? 100)) {
        break;
      }
    }
    return memories;
  }

  async deleteUnifiedMemory(
    type: MemoryKind,
    memoryId: string,
  ): Promise<boolean> {
    const key = `iota:memory:${type}:${memoryId}`;
    const data = await this.client.hgetall(key);
    if (!data.id) {
      return false;
    }

    const tags = data.tagsJson ? (JSON.parse(data.tagsJson) as string[]) : [];
    const pipeline = this.client.multi();
    pipeline.del(key);
    pipeline.zrem(`iota:memories:${type}:${data.scopeId}`, memoryId);
    pipeline.srem(`iota:memory:by-backend:${data.sourceBackend}`, memoryId);
    for (const tag of tags) {
      pipeline.srem(`iota:memory:by-tag:${tag}`, memoryId);
    }
    await pipeline.exec();
    return true;
  }

  async touchUnifiedMemories(
    memoryIds: string[],
    accessedAt: number,
  ): Promise<void> {
    if (memoryIds.length === 0) {
      return;
    }

    for (const memoryId of memoryIds) {
      const keys = await this.scanKeys(`iota:memory:*:${memoryId}`, 10);
      for (const key of keys) {
        await this.client
          .multi()
          .hset(key, "lastAccessedAt", String(accessedAt))
          .hincrby(key, "accessCount", 1)
          .exec();
      }
    }
  }

  async searchUnifiedMemories(
    query: string,
    limit = 10,
    scope?: { scope: MemoryScope; scopeId: string },
  ): Promise<Array<StoredMemory & { score?: number }>> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const keys = scope
      ? await this.scanKeys(
          `iota:memories:*:${escapeScanPattern(scope.scopeId)}`,
          200,
        )
      : await this.scanKeys("iota:memories:*", 1000);
    const results: Array<StoredMemory & { score?: number }> = [];

    for (const indexKey of keys) {
      const parts = indexKey.split(":");
      const type = parts[2];
      const scopeId = parts.slice(3).join(":");
      const memories = await this.loadUnifiedMemories({
        type: type as MemoryKind,
        scope: scope?.scope ?? inferScopeFromType(type as MemoryKind),
        scopeId,
        limit: 100,
      });
      for (const memory of memories) {
        const score = terms.filter((term) =>
          memory.content.toLowerCase().includes(term),
        ).length;
        if (terms.length === 0 || score > 0) {
          results.push({ ...memory, score });
        }
      }
    }

    return results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
  }

  async gc(
    retentionMs: number,
    now = Date.now(),
  ): Promise<{
    removedEvents: number;
    removedAuditEntries: number;
    removedLocks: number;
    removedMemories: number;
  }> {
    const cutoff = now - retentionMs;
    const removedEvents = await this.gcEventStreams(cutoff);
    const removedAuditEntries = await this.client.zremrangebyscore(
      "iota:audit",
      "-inf",
      cutoff,
    );
    const removedMemories = await this.gcMemories(cutoff);
    return {
      removedEvents,
      removedAuditEntries,
      removedLocks: 0,
      removedMemories,
    };
  }

  async listAllSessions(limit = 100): Promise<SessionRecord[]> {
    const keys = await this.scanKeys("iota:session:*", limit);
    const sessions: SessionRecord[] = [];
    for (const key of keys) {
      const sessionId = key.replace("iota:session:", "");
      const session = await this.getSession(sessionId);
      if (session) sessions.push(session);
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getBackendIsolationReport(): Promise<{
    sessions: Array<{
      sessionId: string;
      backend: string;
      executionCount: number;
    }>;
    executions: Array<{
      executionId: string;
      sessionId: string;
      backend: string;
    }>;
    isolation: {
      backendSwitches: number;
      crossBackendSessions: string[];
    };
  }> {
    const sessions = await this.listAllSessions(1000);
    const report: {
      sessions: Array<{
        sessionId: string;
        backend: string;
        executionCount: number;
      }>;
      executions: Array<{
        executionId: string;
        sessionId: string;
        backend: string;
      }>;
      isolation: {
        backendSwitches: number;
        crossBackendSessions: string[];
      };
    } = {
      sessions: [],
      executions: [],
      isolation: {
        backendSwitches: 0,
        crossBackendSessions: [],
      },
    };

    for (const session of sessions) {
      const executions = await this.listSessionExecutions(session.id);
      const backends = new Set(executions.map((e) => e.backend));

      report.sessions.push({
        sessionId: session.id,
        backend: session.activeBackend || "unknown",
        executionCount: executions.length,
      });

      for (const exec of executions) {
        report.executions.push({
          executionId: exec.executionId,
          sessionId: exec.sessionId,
          backend: exec.backend,
        });
      }

      if (backends.size > 1) {
        report.isolation.backendSwitches += backends.size - 1;
        report.isolation.crossBackendSessions.push(session.id);
      }
    }

    return report;
  }

  async queryExecutions(
    options: LogQueryOptions = {},
  ): Promise<ExecutionRecord[]> {
    const limit = clampLimit(options.limit, 100, 5000);
    const offset = Math.max(0, options.offset ?? 0);
    const records = await this.queryExecutionRecords(options);
    return records.slice(offset, offset + limit);
  }

  async queryLogs(options: LogQueryOptions = {}): Promise<RuntimeLogEntry[]> {
    const limit = clampLimit(options.limit, 100, 5000);
    const offset = Math.max(0, options.offset ?? 0);
    const executions = await this.queryExecutionRecords(options);
    const entries: RuntimeLogEntry[] = [];

    for (const execution of executions) {
      const events = await this.readEvents(execution.executionId);
      for (const event of events) {
        if (matchesEventFilters(event, options)) {
          entries.push({ execution, event });
        }
      }
    }

    entries.sort((a, b) => {
      const timeDelta = a.event.timestamp - b.event.timestamp;
      return timeDelta !== 0 ? timeDelta : a.event.sequence - b.event.sequence;
    });
    return entries.slice(offset, offset + limit);
  }

  async aggregateLogs(options: LogQueryOptions = {}): Promise<LogAggregation> {
    const agg: LogAggregation = {
      totalEvents: 0,
      totalExecutions: 0,
      byBackend: {},
      bySession: {},
      byEventType: {},
      byExecution: {},
      byStatus: {},
    };
    const executionsWithEvents = new Set<string>();

    for (const execution of await this.queryExecutionRecords(options)) {
      const events = await this.readEvents(execution.executionId);
      for (const event of events) {
        if (!matchesEventFilters(event, options)) continue;
        agg.totalEvents += 1;
        increment(agg.byBackend, execution.backend);
        increment(agg.bySession, execution.sessionId);
        increment(agg.byEventType, event.type);
        increment(agg.byExecution, execution.executionId);
        increment(agg.byStatus, execution.status);
        executionsWithEvents.add(execution.executionId);
      }
    }

    agg.totalExecutions = executionsWithEvents.size;
    return agg;
  }

  async close(): Promise<void> {
    await this.client?.quit();
  }

  private async scanKeys(pattern: string, limit = 1000): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, batch] = await this.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      keys.push(...batch);
      if (keys.length >= limit) break;
    } while (cursor !== "0");
    return keys.slice(0, limit);
  }

  private async queryExecutionRecords(
    options: LogQueryOptions,
  ): Promise<ExecutionRecord[]> {
    if (options.executionId) {
      const record = await this.getExecution(options.executionId);
      return record && matchesExecutionFilters(record, options) ? [record] : [];
    }

    let ids: string[];
    if (options.sessionId) {
      ids = await this.client.smembers(
        `iota:session-execs:${options.sessionId}`,
      );
    } else {
      ids = await this.listAllExecutionIds(options);
    }

    const records = await Promise.all(ids.map((id) => this.getExecution(id)));
    return records
      .filter((record): record is ExecutionRecord => record !== null)
      .filter((record) => matchesExecutionFilters(record, options))
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  private async listAllExecutionIds(
    options: LogQueryOptions,
  ): Promise<string[]> {
    const min = options.since ?? "-inf";
    const max = options.until ?? "+inf";
    const ids = new Set<string>();
    const indexedIds = await this.client.zrangebyscore(
      "iota:executions",
      min,
      max,
    );
    for (const id of indexedIds) {
      ids.add(id);
    }

    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        "MATCH",
        "iota:exec:*",
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      for (const key of keys) {
        const id = key.slice("iota:exec:".length);
        if (id) ids.add(id);
      }
    } while (cursor !== "0");
    return [...ids];
  }

  private async gcEventStreams(cutoff: number): Promise<number> {
    let cursor = "0";
    let removed = 0;
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        "MATCH",
        `${this.prefix}:*`,
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      for (const key of keys) {
        const entries = await this.client.xrange(key, "-", "+");
        const idsToDelete: string[] = [];
        for (const [id, fields] of entries) {
          const eventIndex = fields.indexOf("event");
          const eventJson =
            eventIndex >= 0 ? fields[eventIndex + 1] : undefined;
          if (!eventJson) continue;
          const event = JSON.parse(eventJson) as RuntimeEvent;
          if (event.timestamp < cutoff) {
            idsToDelete.push(id);
          }
        }
        if (idsToDelete.length > 0) {
          removed += await this.client.xdel(key, ...idsToDelete);
        }
      }
    } while (cursor !== "0");
    return removed;
  }

  private async gcMemories(cutoff: number): Promise<number> {
    let cursor = "0";
    let removed = 0;
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        "MATCH",
        "iota:memories:*",
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      for (const key of keys) {
        const type = getMemoryTypeFromIndexKey(key);
        const ids = await this.client.zrangebyscore(key, "-inf", cutoff);
        if (ids.length === 0) continue;
        const pipeline = this.client.multi();
        pipeline.zrem(key, ...ids);
        for (const id of ids) {
          pipeline.del(`iota:memory:${type}:${id}`);
        }
        await pipeline.exec();
        removed += ids.length;
      }
    } while (cursor !== "0");
    return removed;
  }
}

function cryptoId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function deserializeStoredMemory(data: Record<string, string>): StoredMemory {
  return {
    id: data.id,
    type: data.type as MemoryKind,
    scope: data.scope as StoredMemory["scope"],
    scopeId: data.scopeId,
    content: data.content,
    source: {
      backend: data.sourceBackend as StoredMemory["source"]["backend"],
      nativeType: data.sourceNativeType,
      executionId: data.sourceExecutionId,
    },
    metadata: data.metadataJson
      ? (JSON.parse(data.metadataJson) as Record<string, unknown>)
      : {},
    confidence: Number(data.confidence),
    timestamp: Number(data.timestamp),
    ttlDays: Number(data.ttlDays),
    createdAt: Number(data.createdAt),
    lastAccessedAt: Number(data.lastAccessedAt),
    accessCount: Number(data.accessCount),
    expiresAt: Number(data.expiresAt),
  };
}

function inferScopeFromType(type: MemoryKind): MemoryScope {
  switch (type) {
    case "episodic":
      return "session";
    case "factual":
      return "user";
    case "procedural":
    case "strategic":
    default:
      return "project";
  }
}

function getTypeWeight(type: MemoryKind): number {
  switch (type) {
    case "episodic":
      return 0;
    case "procedural":
      return 1_000_000_000;
    case "factual":
      return 2_000_000_000;
    case "strategic":
      return 3_000_000_000;
  }
}

function getMemoryIndexScore(memory: StoredMemory): number {
  if (memory.type === "episodic") {
    return memory.timestamp;
  }
  return getTypeWeight(memory.type) + memory.confidence * 1000 + memory.timestamp / 1_000_000;
}

function getMemoryTypeFromIndexKey(key: string): MemoryKind {
  const parts = key.split(":");
  return parts[2] as MemoryKind;
}

function escapeScanPattern(value: string): string {
  return value.replace(/([*?\[\]\\])/g, "\\$1");
}

function serializeExecution(r: ExecutionRecord): Record<string, string> {
  return {
    executionId: r.executionId,
    sessionId: r.sessionId,
    backend: r.backend,
    status: r.status,
    requestHash: r.requestHash,
    prompt: r.prompt,
    workingDirectory: r.workingDirectory,
    output: r.output ?? "",
    errorJson: r.errorJson ?? "",
    startedAt: String(r.startedAt),
    finishedAt: r.finishedAt ? String(r.finishedAt) : "",
  };
}

function deserializeExecution(data: Record<string, string>): ExecutionRecord {
  return {
    executionId: data.executionId,
    sessionId: data.sessionId,
    backend: data.backend as ExecutionRecord["backend"],
    status: data.status as ExecutionRecord["status"],
    requestHash: data.requestHash,
    prompt: data.prompt,
    workingDirectory: data.workingDirectory,
    output: data.output || undefined,
    errorJson: data.errorJson || undefined,
    startedAt: Number(data.startedAt),
    finishedAt: data.finishedAt ? Number(data.finishedAt) : undefined,
  };
}

function clampLimit(
  value: number | undefined,
  defaultValue: number,
  maxValue: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.min(Math.max(1, Math.trunc(value)), maxValue);
}

function matchesExecutionFilters(
  record: ExecutionRecord,
  options: LogQueryOptions,
): boolean {
  if (options.sessionId && record.sessionId !== options.sessionId) return false;
  if (options.backend && record.backend !== options.backend) return false;
  if (options.since !== undefined) {
    const end = record.finishedAt ?? record.startedAt;
    if (end < options.since) return false;
  }
  if (options.until !== undefined && record.startedAt > options.until) {
    return false;
  }
  return true;
}

function matchesEventFilters(
  event: RuntimeEvent,
  options: LogQueryOptions,
): boolean {
  if (options.sessionId && event.sessionId !== options.sessionId) return false;
  if (options.backend && event.backend !== options.backend) return false;
  if (options.eventType && event.type !== options.eventType) return false;
  if (options.since !== undefined && event.timestamp < options.since) {
    return false;
  }
  if (options.until !== undefined && event.timestamp > options.until) {
    return false;
  }
  return true;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}
