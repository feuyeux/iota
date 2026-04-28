# Iota Memory System 完整设计

> 日期：2026-04-27
> 状态：设计参考 / 核心已实现（更新于 2026-04-28）
> 参考文档：[4.iota_engine_design_0425.md](4.iota_engine_design_0425.md)

## 实现状态说明（2026-04-28）

**详细实现状态对比见：** `docs/requirement/IMPLEMENTATION_STATUS.md`

**核心完成度：** ~90% | **验收完成度：** ~75%

✅ **已实现核心功能：**
- MemoryMapper（四后端原生类型到统一类型映射）
- MemoryStorage（Redis 存储和检索）
- MemoryInjector（构建上下文和 visibility）
- 四种统一记忆类型（episodic/procedural/factual/strategic）
- Backend 映射规则（Claude/Codex/Gemini/Hermes）
- Redis key patterns 和 TTL 自动过期
- 单元测试覆盖（mapper/storage/injector）

🔄 **部分实现：**
- Backend 协议扩展（设计已定义，adapter 实现未完全对接）
- CLI/API（设计已定义，未实现）

❌ **未实现：**
- Phase 2: Memory extraction from output
- Phase 3: Metrics/Dashboard
- Phase 4: Semantic memory/Consolidation/Collaborative memory
- 集成测试：跨 execution 记忆注入和提取

---

## Executive Summary

本文档定义 **Iota Memory System** 的完整设计，实现四个后端（Claude Code、Codex、Gemini CLI、Hermes Agent）原生记忆类型到 Iota 统一记忆类型的确定性映射。

### 四种统一记忆类型

| Type | Chinese | Purpose | Scope | TTL |
|------|---------|---------|-------|-----|
| episodic | 情节记忆 | Specific events, conversations | Session | 7 days |
| procedural | 程序记忆 | Reusable how-to, code patterns | Project | 30 days |
| factual | 事实记忆 | Objective facts about user/project | User | 180 days |
| strategic | 战略记忆 | Goals, decisions, architecture | Project | 180 days |

---

## 1. Memory Type System

### 1.1 Four Standard Memory Types

#### Episodic Memory (情节记忆)
- Scope: Session (sessionId)
- TTL: 7 days
- Volume: High - generated frequently
- Examples: User asked about Redis config, Fixed bug in adapter.ts

#### Procedural Memory (程序记忆)
- Scope: Project (projectId)
- TTL: 30 days
- Volume: Moderate
- Examples: To deploy run docker-compose up, Use redis-cli HGETALL

#### Factual Memory (事实记忆)
- Scope: User (userId)
- TTL: 180 days
- Volume: Low - significant facts only
- Examples: User is a senior backend engineer, Project uses TypeScript

#### Strategic Memory (战略记忆)
- Scope: Project (projectId)
- TTL: 180 days
- Volume: Low - major decisions only
- Examples: Decided to use Redis for config, Plan to add OpenTelemetry

### 1.2 Memory Lifecycle

[*] --> Generated: Backend emits memory event
Generated --> Mapped: MemoryMapper translates native type
Mapped --> Validated: Check confidence threshold
Validated --> Stored: Write to Redis with TTL
Stored --> Retrieved: Context injection
Retrieved --> Injected: Add to prompt context
Injected --> Accessed: Backend uses in response
Accessed --> Updated: Update lastAccessedAt
Updated --> Stored
Stored --> Expired: TTL reached
Expired --> [*]

---

## 2. Backend Native Types

### 2.1 Complete Mapping Table

| Backend | Native Type | Unified Type | Confidence | Scope | TTL |
|---------|-------------|--------------|------------|-------|-----|
| Claude Code | conversation_context | episodic | 0.95 | session | 7d |
| Claude Code | code_context | procedural | 0.90 | project | 30d |
| Claude Code | user_preferences | factual | 0.95 | user | 180d |
| Claude Code | project_context | strategic | 0.90 | project | 180d |
| Codex | session_history | episodic | 0.90 | session | 7d |
| Codex | tool_usage | procedural | 0.88 | project | 30d |
| Codex | codebase_facts | factual | 0.92 | user | 180d |
| Codex | task_planning | strategic | 0.85 | project | 180d |
| Gemini | interaction_log | episodic | 0.88 | session | 7d |
| Gemini | execution_patterns | procedural | 0.85 | project | 30d |
| Gemini | entity_knowledge | factual | 0.90 | user | 180d |
| Gemini | goal_tracking | strategic | 0.85 | project | 180d |
| Hermes | dialogue_memory | episodic | 0.92 | session | 7d |
| Hermes | skill_memory | procedural | 0.88 | project | 30d |
| Hermes | profile_memory | factual | 0.93 | user | 180d |
| Hermes | intention_memory | strategic | 0.87 | project | 180d |

---

## 3. Unified Mapping Layer

### 3.1 MemoryMapper Implementation

File: iota-engine/src/memory/mapper.ts

```typescript
import type { BackendName, MemoryKind } from "../event/types.js";

export interface BackendMemoryEvent {
  backend: BackendName;
  nativeType: string;
  content: string;
  metadata?: Record<string, unknown>;
  confidence?: number;
  timestamp?: number;
}

export interface UnifiedMemory {
  type: MemoryKind;
  content: string;
  source: { backend: BackendName; nativeType: string; executionId: string };
  metadata: Record<string, unknown>;
  confidence: number;
  timestamp: number;
}

interface MappingRule {
  unifiedType: MemoryKind;
  defaultConfidence: number;
  scope: "session" | "project" | "user";
  ttlDays: number;
}

export class MemoryMapper {
  private mappingRules: Map<BackendName, Map<string, MappingRule>>;

  constructor() {
    this.mappingRules = new Map([
      ["claude-code", new Map([
        ["conversation_context", { unifiedType: "episodic", defaultConfidence: 0.95, scope: "session", ttlDays: 7 }],
        ["code_context", { unifiedType: "procedural", defaultConfidence: 0.90, scope: "project", ttlDays: 30 }],
        ["user_preferences", { unifiedType: "factual", defaultConfidence: 0.95, scope: "user", ttlDays: 180 }],
        ["project_context", { unifiedType: "strategic", defaultConfidence: 0.90, scope: "project", ttlDays: 180 }],
      ])],
      ["codex", new Map([
        ["session_history", { unifiedType: "episodic", defaultConfidence: 0.90, scope: "session", ttlDays: 7 }],
        ["tool_usage", { unifiedType: "procedural", defaultConfidence: 0.88, scope: "project", ttlDays: 30 }],
        ["codebase_facts", { unifiedType: "factual", defaultConfidence: 0.92, scope: "user", ttlDays: 180 }],
        ["task_planning", { unifiedType: "strategic", defaultConfidence: 0.85, scope: "project", ttlDays: 180 }],
      ])],
      ["gemini", new Map([
        ["interaction_log", { unifiedType: "episodic", defaultConfidence: 0.88, scope: "session", ttlDays: 7 }],
        ["execution_patterns", { unifiedType: "procedural", defaultConfidence: 0.85, scope: "project", ttlDays: 30 }],
        ["entity_knowledge", { unifiedType: "factual", defaultConfidence: 0.90, scope: "user", ttlDays: 180 }],
        ["goal_tracking", { unifiedType: "strategic", defaultConfidence: 0.85, scope: "project", ttlDays: 180 }],
      ])],
      ["hermes", new Map([
        ["dialogue_memory", { unifiedType: "episodic", defaultConfidence: 0.92, scope: "session", ttlDays: 7 }],
        ["skill_memory", { unifiedType: "procedural", defaultConfidence: 0.88, scope: "project", ttlDays: 30 }],
        ["profile_memory", { unifiedType: "factual", defaultConfidence: 0.93, scope: "user", ttlDays: 180 }],
        ["intention_memory", { unifiedType: "strategic", defaultConfidence: 0.87, scope: "project", ttlDays: 180 }],
      ])],
    ]);
  }

  map(event: BackendMemoryEvent, executionId: string): UnifiedMemory {
    const backendRules = this.mappingRules.get(event.backend);
    if (!backendRules) throw new Error("No mapping rules for backend: " + event.backend);
    const rule = backendRules.get(event.nativeType);
    if (!rule) {
      console.warn("Unknown native type: " + event.nativeType);
      return { type: "episodic", content: event.content, source: { backend: event.backend, nativeType: event.nativeType, executionId }, metadata: { ...event.metadata, mappingFallback: true }, confidence: 0.5, timestamp: event.timestamp ?? Date.now() };
    }
    return { type: rule.unifiedType, content: event.content, source: { backend: event.backend, nativeType: event.nativeType, executionId }, metadata: { ...event.metadata, scope: rule.scope, ttlDays: rule.ttlDays }, confidence: event.confidence ?? rule.defaultConfidence, timestamp: event.timestamp ?? Date.now() };
  }

  validateCoverage(backend: BackendName): { complete: boolean; missing: MemoryKind[] } {
    const rules = this.mappingRules.get(backend);
    if (!rules) return { complete: false, missing: ["episodic", "procedural", "factual", "strategic"] };
    const covered = new Set<MemoryKind>();
    for (const rule of rules.values()) covered.add(rule.unifiedType);
    const allTypes: MemoryKind[] = ["episodic", "procedural", "factual", "strategic"];
    return { complete: allTypes.every(t => covered.has(t)), missing: allTypes.filter(t => !covered.has(t)) };
  }
}

export const memoryMapper = new MemoryMapper();
```

---

## 4. Backend Protocol Extensions

### 4.1 Common Memory Event Structure

```typescript
interface MemoryEvent {
  type: "memory";
  timestamp: number;
  nativeType: string;
  content: string;
  metadata?: { confidence?: number; tags?: string[]; [key: string]: unknown };
}
```

### 4.2 Claude Code (stream-json)

{ "type": "memory", "timestamp": 1777280000000, "nativeType": "conversation_context", "content": "User asked about Redis", "metadata": { "confidence": 0.95 } }

### 4.3 Codex (NDJSON)

{"type":"memory","timestamp":1777280000000,"nativeType":"tool_usage","content":"To verify: iota status","metadata":{"confidence":0.88}}

### 4.4 Gemini (stream-json)

{ "type": "memory", "timestamp": 1777280000000, "nativeType": "goal_tracking", "content": "Plan to add memory system", "metadata": { "confidence": 0.85 } }

### 4.5 Hermes (ACP JSON-RPC)

{ "jsonrpc": "2.0", "method": "session/memory", "params": { "memory": { "nativeType": "profile_memory", "content": "User is backend engineer", "metadata": { "confidence": 0.90 } } } }

---

## 5. Storage Architecture

### 5.1 Redis Key Patterns

iota:memory:{type}:{memoryId}                    # Individual memory
iota:memories:episodic:{sessionId}              # Index by session
iota:memories:procedural:{projectId}            # Index by project
iota:memories:factual:{userId}                  # Index by user
iota:memories:strategic:{projectId}             # Index by project
iota:memory:by-backend:{backend}                # Index by backend
iota:memory:by-tag:{tag}                        # Index by tag

### 5.2 MemoryStorage Implementation

File: iota-engine/src/memory/storage.ts

```typescript
import type { Redis } from "ioredis";
import type { UnifiedMemory } from "./mapper.js";
import { nanoid } from "nanoid";

export interface StoredMemory extends UnifiedMemory {
  id: string; createdAt: number; lastAccessedAt: number; accessCount: number; expiresAt: number;
}

export class MemoryStorage {
  constructor(private redis: Redis) {}

  async store(memory: UnifiedMemory, scopeId: string): Promise<string> {
    const memoryId = nanoid();
    const now = Date.now();
    const ttlMs = this.getTTLMilliseconds(memory.type);
    const key = "iota:memory:" + memory.type + ":" + memoryId;
    const indexKey = "iota:memories:" + memory.type + ":" + scopeId;

    await this.redis.hset(key, {
      type: memory.type, content: memory.content,
      "source.backend": memory.source.backend, "source.nativeType": memory.source.nativeType, "source.executionId": memory.source.executionId,
      "metadata.confidence": memory.confidence.toString(), "metadata.tags": JSON.stringify(memory.metadata.tags ?? []),
      "metadata.scope": memory.metadata.scope as string, "metadata.ttlDays": memory.metadata.ttlDays as string,
      timestamp: memory.timestamp.toString(), createdAt: now.toString(), lastAccessedAt: now.toString(), accessCount: "0", expiresAt: (now + ttlMs).toString(),
    });

    await this.redis.pexpire(key, ttlMs);
    await this.redis.zadd(indexKey, this.getIndexScore(memory.type, memory), memoryId);
    await this.redis.sadd("iota:memory:by-backend:" + memory.source.backend, memoryId);
    await this.redis.zadd("iota:memory:by-confidence:" + memory.type, memory.confidence, memoryId);
    for (const tag of (memory.metadata.tags as string[]) ?? []) await this.redis.sadd("iota:memory:by-tag:" + tag, memoryId);
    return memoryId;
  }

  async retrieve(type: string, scopeId: string, options: { limit?: number; minConfidence?: number; tags?: string[] } = {}): Promise<StoredMemory[]> {
    const indexKey = "iota:memories:" + type + ":" + scopeId;
    const memoryIds = await this.redis.zrevrange(indexKey, 0, (options.limit ?? 50) - 1);
    if (memoryIds.length === 0) return [];
    const memories: StoredMemory[] = [];
    for (const memoryId of memoryIds) {
      const key = "iota:memory:" + type + ":" + memoryId;
      const data = await this.redis.hgetall(key);
      if (Object.keys(data).length === 0) { await this.redis.zrem(indexKey, memoryId); continue; }
      const memory = this.deserializeMemory(memoryId, data);
      if (options.minConfidence && memory.confidence < options.minConfidence) continue;
      if (options.tags?.length && !options.tags.some(tag => (memory.metadata.tags as string[] ?? []).includes(tag))) continue;
      await this.updateAccess(key);
      memories.push(memory);
    }
    return memories;
  }

  private updateAccess(key: string) { const now = Date.now(); this.redis.hincrby(key, "accessCount", 1); this.redis.hset(key, "lastAccessedAt", now.toString()); }
  private getTTLMilliseconds(type: string): number { const m = { episodic: 7, procedural: 30, factual: 180, strategic: 180 }; return (m[type as keyof typeof m] ?? 7) * 86400000; }
  private getIndexScore(type: string, memory: UnifiedMemory): number { return type === "episodic" ? memory.timestamp : memory.confidence * 1000 + memory.timestamp / 1000000; }
  private deserializeMemory(memoryId: string, data: Record<string, string>): StoredMemory { return { id: memoryId, type: data.type as any, content: data.content, source: { backend: data["source.backend"] as any, nativeType: data["source.nativeType"], executionId: data["source.executionId"] }, metadata: { confidence: parseFloat(data["metadata.confidence"]), tags: JSON.parse(data["metadata.tags"]), scope: data["metadata.scope"], ttlDays: parseInt(data["metadata.ttlDays"]) }, confidence: parseFloat(data["metadata.confidence"]), timestamp: parseInt(data.timestamp), createdAt: parseInt(data.createdAt), lastAccessedAt: parseInt(data.lastAccessedAt), accessCount: parseInt(data.accessCount), expiresAt: parseInt(data.expiresAt) }; }

  async delete(type: string, memoryId: string, scopeId: string): Promise<void> {
    const key = "iota:memory:" + type + ":" + memoryId;
    const data = await this.redis.hgetall(key);
    if (Object.keys(data).length === 0) return;
    await this.redis.zrem("iota:memories:" + type + ":" + scopeId, memoryId);
    await this.redis.srem("iota:memory:by-backend:" + data["source.backend"], memoryId);
    await this.redis.zrem("iota:memory:by-confidence:" + type, memoryId);
    for (const tag of JSON.parse(data["metadata.tags"])) await this.redis.srem("iota:memory:by-tag:" + tag, memoryId);
    await this.redis.del(key);
  }
}
```

---

## 6. Retrieval and Context Injection

### 6.1 Retrieval Strategy

| Type | Strategy | Limit | Sort |
|------|----------|-------|------|
| episodic | Recent N from session | 20 | timestamp |
| procedural | Top N by relevance | 10 | confidence x recency |
| factual | All for user | 50 | confidence |
| strategic | All for project | 30 | confidence |

### 6.2 MemoryInjector Implementation

File: iota-engine/src/memory/injector.ts

```typescript
import type { MemoryStorage, StoredMemory } from "./storage.js";
import type { ExecutionContext } from "../execution/types.js";

export interface MemoryContext { episodic: StoredMemory[]; procedural: StoredMemory[]; factual: StoredMemory[]; strategic: StoredMemory[]; }

export class MemoryInjector {
  constructor(private storage: MemoryStorage) {}

  async buildContext(context: ExecutionContext): Promise<MemoryContext> {
    return Promise.all([
      this.storage.retrieve("episodic", context.sessionId, { limit: 20, minConfidence: 0.7 }),
      this.storage.retrieve("procedural", context.projectId ?? context.workingDirectory, { limit: 10, minConfidence: 0.75 }),
      this.storage.retrieve("factual", context.userId ?? "default", { limit: 50, minConfidence: 0.8 }),
      this.storage.retrieve("strategic", context.projectId ?? context.workingDirectory, { limit: 30, minConfidence: 0.8 }),
    ]).then(([episodic, procedural, factual, strategic]) => ({ episodic, procedural, factual, strategic }));
  }

  formatAsPrompt(memoryContext: MemoryContext): string {
    const sections: string[] = [];
    if (memoryContext.factual.length > 0) { sections.push("# Factual Memory\n"); for (const m of memoryContext.factual) sections.push("- " + m.content); sections.push(""); }
    if (memoryContext.strategic.length > 0) { sections.push("# Strategic Memory\n"); for (const m of memoryContext.strategic) sections.push("- " + m.content); sections.push(""); }
    if (memoryContext.procedural.length > 0) { sections.push("# Procedural Memory\n"); for (const m of memoryContext.procedural) sections.push("- " + m.content); sections.push(""); }
    if (memoryContext.episodic.length > 0) { sections.push("# Episodic Memory\n"); for (const m of memoryContext.episodic) sections.push("- [" + new Date(m.timestamp).toISOString() + "] " + m.content); sections.push(""); }
    return sections.join("\n");
  }
}
```

---

## 7. Implementation Details

### 7.1 File Structure

iota-engine/src/memory/
- mapper.ts      # MemoryMapper
- storage.ts     # MemoryStorage
- injector.ts    # MemoryInjector
- types.ts      # Type definitions
- index.ts      # Public exports

iota-engine/src/backend/
- claude-code.ts # + memory event handling
- codex.ts       # + memory event handling
- gemini.ts      # + memory event handling
- hermes.ts      # + memory event handling
- interface.ts   # + emitMemoryEvent()

### 7.2 Implementation Phases

- Phase 1 (Week 1-2): MemoryMapper + MemoryStorage + Backend adapters + Unit tests
- Phase 2 (Week 3-4): MemoryInjector + Integration + Event listeners
- Phase 3 (Week 5-6): CLI commands + Agent API + WebSocket events
- Phase 4 (Week 7-8): Metrics + Dashboard + Performance optimization

---

## 8. Testing Strategy

### 8.1 Unit Tests

```typescript
describe("MemoryMapper", () => {
  it("maps Claude Code conversation_context to episodic", () => {
    const result = memoryMapper.map({ backend: "claude-code", nativeType: "conversation_context", content: "Test", timestamp: Date.now() }, "exec_1");
    expect(result.type).toBe("episodic");
  });
  it("handles unknown native types with fallback", () => {
    const result = memoryMapper.map({ backend: "claude-code", nativeType: "unknown", content: "Test", timestamp: Date.now() }, "exec_2");
    expect(result.type).toBe("episodic");
    expect(result.confidence).toBe(0.5);
  });
});
```

### 8.2 Integration Tests

```typescript
it("captures and injects memory across executions", async () => {
  await executor.execute({ prompt: "My name is John", sessionId: "s1" });
  await new Promise(r => setTimeout(r, 100));
  const result = await executor.execute({ prompt: "What is my name?", sessionId: "s1" });
  expect(result.enhancedPrompt).toContain("John");
});
```

---

## 9. Migration Plan

### 9.1 Strategy: Parallel run with gradual cutover

1. Deploy new system alongside old extractor
2. Compare outputs, validate correctness
3. Switch to new system, keep old as fallback
4. Remove old extractor after 2 weeks

### 9.2 Feature Flag

```typescript
export const MEMORY_CONFIG = {
  useNewSystem: process.env.MEMORY_USE_NEW_SYSTEM === "true",
  fallbackToOld: process.env.MEMORY_FALLBACK_TO_OLD === "true",
  minConfidence: parseFloat(process.env.MEMORY_MIN_CONFIDENCE ?? "0.7"),
};
```

---

## 10. Operations and Monitoring

### 10.1 Metrics (Prometheus)

memory_stored_total{type, backend, native_type}
memory_retrieved_total{type, scope}
memory_expired_total{type}
memory_confidence_avg{type, backend}
memory_store_duration_ms{type}
memory_retrieve_duration_ms{type}
memory_count{type, scope}

### 10.2 Logging

Log levels:
- debug: Detailed memory events, mapping decisions
- info: Memory stored, retrieved, deleted
- warn: Low confidence, unknown native types, fallbacks
- error: Storage failures, mapping errors

---

## 11. CLI and API Reference

### CLI Commands

iota memory list [--type <type>] [--scope <id>] [--limit <n>]
iota memory show <memory-id>
iota memory delete <memory-id>
iota memory stats
iota memory clear --scope <scope-id> [--type <type>]

### Agent API

GET  /api/memory
GET  /api/memory/:id
DELETE /api/memory/:id
GET  /api/memory/stats
GET  /api/memory/by-scope/:scope

### WebSocket Events

memory_stored    # Emitted when new memory is stored
memory_retrieved # Emitted when memory is retrieved
memory_deleted   # Emitted when memory is deleted
memory_updated   # Emitted when memory access count is updated

---

## 12. Performance and Scalability

| Operation | Target | Max |
|-----------|--------|-----|
| Memory Store | < 10ms | 50ms |
| Memory Retrieve (single) | < 5ms | 20ms |
| Memory Retrieve (1000) | < 100ms | 250ms |
| Context Injection | < 20ms | 50ms |

### Capacity Planning

| Memory Type | Avg Size | TTL | Max Per Scope |
|-------------|----------|-----|---------------|
| episodic | 200B | 7d | 1000 |
| procedural | 500B | 30d | 500 |
| factual | 300B | 180d | 200 |
| strategic | 400B | 180d | 100 |

---

## 13. Security and Privacy

- Confidence threshold: Only store memories >= 0.7
- User consent: Users can opt out of factual/strategic memory
- Data redaction: Auto-redact API keys, tokens, passwords
- Scope isolation: Memories cannot cross scope boundaries

---

## 14. Future Enhancements

- **Semantic Memory**: Vector embeddings for semantic search
- **Memory Consolidation**: Periodic consolidation of low-value memories
- **Collaborative Memory**: Shared project memories across team
- **Advanced Analytics**: Memory effectiveness metrics
