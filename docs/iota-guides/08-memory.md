# Memory 记忆系统

**版本:** 2.1  
**最后更新:** 2026-04-30

## 1. 核心理念

Iota 的 Memory 模块将“记忆”从 backend 内部抽离到 Engine 层，使后端变成可热插拔的执行器。Memory 生命周期由 Engine 管理：Extract → Store → Recall → Inject。

```mermaid
flowchart TD
  User([User Prompt])
  Recall[Recall]
  Inject[Inject]
  Backend[Backend]
  Extract[Extract]
  Store[Store]
  Redis[(Redis memory keys)]

  User --> Recall --> Inject --> Backend
  Backend --> Extract --> Store --> Redis
  Redis --> Recall
```

---

## 2. 分类模型与 Redis 存储

### 类型定义

```typescript
type MemoryType = "semantic" | "episodic" | "procedural";
type SemanticFacet = "identity" | "preference" | "strategic" | "domain";
type MemoryScope = "session" | "project" | "user";
```

| type | facet | 含义 | 默认 scope | 典型 TTL |
|---|---|---|---|---|
| semantic | identity | 用户身份、角色 | user | 365 天 |
| semantic | preference | 偏好、习惯 | user | 365 天 |
| semantic | strategic | 项目目标、决策 | project | 90 天 |
| semantic | domain | 领域事实 | project/user | 90 天 |
| procedural | — | 操作步骤、命令 | project | 30 天 |
| episodic | — | 经历叙事、复盘 | session | 7 天 |

### Redis Key 总览

当前实现在 `iota-engine/src/storage/redis.ts`：

| 数据 | Key 模式 | Redis 类型 | 说明 |
|---|---|---|---|
| Memory 实体 | `iota:memory:{type}:{memoryId}` | Hash | 全部 StoredMemory 字段，带 TTL |
| 类型/作用域索引 | `iota:memories:{type}:{scopeId}[:facet]` | Sorted Set | recall 时按 score 排序读取 |
| 内容哈希去重 | `iota:memory:hashes:{type}:{scopeId}[:facet]:{hash}` | Set | 防止相同内容重复写入 |
| Backend 索引 | `iota:memory:by-backend:{backend}` | Set | 按来源 backend 索引 |
| Tag 索引 | `iota:memory:by-tag:{tag}` | Set | 按标签索引 |
| 变更历史 | `iota:memory:history:{memoryId}` | Sorted Set | ADD/UPDATE 事件记录 |

索引 score 计算：
- episodic: `score = timestamp`（按时间排序）
- 其他: `score = typeWeight + confidence × 1000 + timestamp / 1e6`

### 2.1 semantic / identity — 用户身份

**存入：**

```typescript
await memoryStorage.store({
  type: "semantic", facet: "identity", scope: "user",
  content: "我叫张明，是高级架构师，负责微服务平台",
  confidence: 0.95, ttlDays: 365, timestamp: Date.now(),
  source: { backend: "claude-code", nativeType: "memory", executionId: "exec-001" },
  metadata: { tags: ["profile"] },
}, "user-zhang");
```

**召回：**

```typescript
const memories = await memoryStorage.retrieve({
  type: "semantic", facet: "identity", scope: "user",
  scopeId: "user-zhang", limit: 20, minConfidence: 0.85,
});
```

**Redis 存储格式（所有类型共享此 Hash 字段结构）：**

```bash
HGETALL iota:memory:semantic:a1b2c3d4-...
# id               "a1b2c3d4-..."
# type             "semantic"
# facet            "identity"
# scope            "user"
# scopeId          "user-zhang"
# content          "我叫张明，是高级架构师，负责微服务平台"
# contentHash      "e4d7f1a2..."
# embeddingJson    "[0.012, -0.034, ...]"
# confidence       "0.95"
# sourceBackend    "claude-code"
# sourceNativeType "memory"
# sourceExecutionId "exec-001"
# metadataJson     "{\"tags\":[\"profile\"]}"
# tagsJson         "[\"profile\"]"
# timestamp        "1714492800000"
# ttlDays          "365"
# createdAt        "1714492800000"
# lastAccessedAt   "1714492800000"
# accessCount      "0"
# expiresAt        "1746028800000"

# 索引
ZREVRANGE iota:memories:semantic:user-zhang:identity 0 -1 WITHSCORES
# 去重
SMEMBERS iota:memory:hashes:semantic:user-zhang:identity:e4d7f1a2...
```

### 2.2 semantic / preference — 偏好习惯

**存入：**

```typescript
await memoryStorage.store({
  type: "semantic", facet: "preference", scope: "user",
  content: "偏好中文回答，代码注释用英文，缩进 2 空格",
  confidence: 0.9, ttlDays: 365, timestamp: Date.now(),
  source: { backend: "gemini", nativeType: "memory", executionId: "exec-002" },
  metadata: {},
}, "user-zhang");
```

**召回：**

```typescript
const prefs = await memoryStorage.retrieve({
  type: "semantic", facet: "preference", scope: "user",
  scopeId: "user-zhang", limit: 30, minConfidence: 0.8,
});
```

**Redis key：**`iota:memory:semantic:<uuid>` / `iota:memories:semantic:user-zhang:preference`

### 2.3 semantic / strategic — 项目战略

**存入：**

```typescript
await memoryStorage.store({
  type: "semantic", facet: "strategic", scope: "project",
  content: "项目目标：Q3 将单体架构拆分为 4 个微服务，优先拆分 auth 和 billing",
  confidence: 0.9, ttlDays: 90, timestamp: Date.now(),
  source: { backend: "claude-code", nativeType: "memory", executionId: "exec-003" },
  metadata: { tags: ["architecture"] },
}, "/home/user/project-alpha");
```

**召回：**

```typescript
const strategies = await memoryStorage.retrieve({
  type: "semantic", facet: "strategic", scope: "project",
  scopeId: "/home/user/project-alpha", limit: 30, minConfidence: 0.8,
});
```

**Redis key：**`iota:memory:semantic:<uuid>` / `iota:memories:semantic:/home/user/project-alpha:strategic`

### 2.4 semantic / domain — 领域知识

**存入：**

```typescript
await memoryStorage.store({
  type: "semantic", facet: "domain", scope: "project",
  content: "系统使用 PostgreSQL 15 + Redis 7 作为数据层，API 网关为 Kong",
  confidence: 0.88, ttlDays: 90, timestamp: Date.now(),
  source: { backend: "codex", nativeType: "memory", executionId: "exec-004" },
  metadata: { tags: ["tech-stack"] },
}, "/home/user/project-alpha");
```

**召回：**

```typescript
const domain = await memoryStorage.retrieve({
  type: "semantic", facet: "domain", scope: "project",
  scopeId: "/home/user/project-alpha", limit: 50, minConfidence: 0.8,
});
```

**Redis key：**`iota:memory:semantic:<uuid>` / `iota:memories:semantic:/home/user/project-alpha:domain`

### 2.5 procedural — 操作步骤

> procedural 无 facet，Redis key 中省略 facet 段。

**存入：**

```typescript
await memoryStorage.store({
  type: "procedural", scope: "project",
  content: "部署步骤：1) bun run build  2) docker compose up -d  3) 等待 health check",
  confidence: 0.85, ttlDays: 30, timestamp: Date.now(),
  source: { backend: "hermes", nativeType: "memory", executionId: "exec-005" },
  metadata: { tags: ["deploy"] },
}, "/home/user/project-alpha");
```

**召回：**

```typescript
const procedures = await memoryStorage.retrieve({
  type: "procedural", scope: "project",
  scopeId: "/home/user/project-alpha", limit: 10, minConfidence: 0.75,
});
```

**Redis key：**`iota:memory:procedural:<uuid>` / `iota:memories:procedural:/home/user/project-alpha`

### 2.6 episodic — 经历叙事

> episodic 无 facet；索引 score 直接使用 timestamp（按时间排序），与 semantic/procedural 的加权公式不同。

**存入：**

```typescript
await memoryStorage.store({
  type: "episodic", scope: "session",
  content: "用户在第 3 轮对话中修复了 auth 模块的内存泄漏，根因是未关闭的 Redis 连接",
  confidence: 0.8, ttlDays: 7, timestamp: Date.now(),
  source: { backend: "opencode", nativeType: "memory", executionId: "exec-006" },
  metadata: {},
}, "session-abc123");
```

**召回：**

```typescript
const episodes = await memoryStorage.retrieve({
  type: "episodic", scope: "session",
  scopeId: "session-abc123", limit: 20, minConfidence: 0.7,
});
```

**Redis key：**`iota:memory:episodic:<uuid>` / `iota:memories:episodic:session-abc123`

---

## 3. StoredMemory Schema

```typescript
interface StoredMemory {
  id: string;
  type: MemoryType;
  facet?: SemanticFacet;
  scope: MemoryScope;
  scopeId: string;
  content: string;
  contentHash: string;
  embeddingJson?: string;
  source: { backend, nativeType, executionId };
  metadata: Record<string, unknown>;
  confidence: number;
  timestamp: number;
  ttlDays: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  expiresAt: number;
}
```

---

## 4. 写入：Store / Extract

`MemoryStorage.store()` 当前行为：

1. 计算 `contentHash = md5(trimmed content)`。
2. 通过 `findUnifiedMemoryByHash()` 查重。
3. 如果命中，调用 `touchUnifiedMemories()` 增加访问计数，并写入 `history` 的 `UPDATE` 记录。
4. 如果未命中，调用 `EmbeddingProviderChain.embed()` 生成 embedding，存入 `embeddingJson`。
5. 写入 Redis Hash、type/scope/facet index、hash dedup set、backend/tag index，并写入 `history` 的 `ADD` 记录。

执行完成后的 memory extraction 由 Engine 调用 `MemoryExtractor` 和存储层完成；当前抽取仍以启发式/结构化信号为主，不是完整 LLM merge pipeline。

---

## 5. 读取：Recall + Inject

`MemoryInjector.buildContext()` 当前固定查询 6 个桶，并为每个查询生成 prompt embedding：

| 桶 | Query | limit | minConfidence |
|---|---|---|---|
| identity | semantic/user/default-or-userId | 20 | 0.85 |
| preference | semantic/user/default-or-userId | 30 | 0.8 |
| strategic | semantic/project/projectId-or-workingDirectory | 30 | 0.8 |
| domain | semantic/project/projectId-or-workingDirectory | 50 | 0.8 |
| procedural | procedural/project/projectId-or-workingDirectory | 10 | 0.75 |
| episodic | episodic/session/sessionId | 20 | 0.7 |

`MemoryStorage.retrieve()` 行为：

- 如果 query 带 vector 且 storage 支持 `searchByVector()`，按 cosine similarity 排序。
- 否则调用 `loadUnifiedMemories()`，按 index score 读取。
- 读取后调用 `touchUnifiedMemories()` 更新访问计数。

`injectMemoryWithVisibility()` 负责 token budget：默认 4096，identity 预留 256，preference 预留 512，其余共享；超预算时可截断并记录 visibility。

---

## 6. Embedding 支持

| Provider | 文件 | 说明 |
|---|---|---|
| HashEmbeddingProvider | `memory/embedding.ts` | 默认低依赖向量 |
| OllamaEmbeddingProvider | `memory/embedding.ts` | 本地 Ollama |
| OpenAIEmbeddingProvider | `memory/embedding.ts` | OpenAI-compatible embedding API |
| EmbeddingProviderChain | `memory/embedding.ts` | 按优先级链式调用 |

当前 vector 搜索是 scope 内加载候选后计算 cosine similarity，不是 Milvus/RediSearch 原生索引。

---

## 7. Memory Visibility

每次记忆注入都产生 visibility 记录，存储在 `iota:visibility:memory:{executionId}`：

- candidates：参与候选的记忆
- selected：注入 backend 的记忆及 segmentId
- excluded：被排除的记忆和原因
- extraction：执行结束后的抽取结果

---

## 8. 已实现与待完善

### 已实现

- type + facet + scope memory schema
- Redis Hash + Sorted Set 索引
- contentHash 去重与 touch
- memory history (`ADD` / `UPDATE`)
- embeddingJson 存储
- scope 内 vector scoring fallback
- `getUserProfile()` 便捷 API
- Memory visibility 记录与 App memory delta

### 待完善

- LLM Extractor 的 ADD/UPDATE/NONE 合并决策
- Entity extraction 与实体关联召回增强
- Milvus 或其他大规模向量后端
- Session close episodic compaction
- 更明确的软过期策略：identity/preference 衰减而非硬删
- 召回综合公式参数化：confidence、recency、accessCount、vectorScore 的统一权重

---

## 9. 跨后端延续验证

```bash
cd iota-cli
node dist/index.js run --backend claude-code --trace "我叫张明，是架构师"
node dist/index.js run --backend codex --trace "我是谁？"
node dist/index.js run --backend gemini --trace "我偏好中文回答"
node dist/index.js run --backend hermes --trace "总结你对我的了解"
node dist/index.js run --backend opencode --trace "回顾我之前的对话"
```

关键判断：只要 Extract/Store/Recall/Inject 在 Engine 层，后端可替换而 memory 不应丢失。实际验收要结合 visibility memory 面板和 Redis memory keys 检查。
