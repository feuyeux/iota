# Iota Memory 优化规划 (2026-04-30)

## 一、背景与目标

基于 mem0 代码实现对比分析，制定 iota memory 模块的优化路径。核心原则：
- 分类模型对齐认知心理学三类（semantic / episodic / procedural），与 mem0 兼容
- 保留 iota 的 4 桶正交能力，通过 facet 扩展
- 存储层可扩展，接口隔离，无需改业务代码即可切换后端
- 保持低运维门槛（Engine 即中枢的核心叙事）

## 二、分类模型重设计

### 2.1 Type + Facet 二级模型

```typescript
type MemoryType = "semantic" | "episodic" | "procedural";

type SemanticFacet =
  | "identity"      // 姓名/角色/身份 — user scope, TTL 365d, 软过期
  | "preference"    // 偏好/习惯/风格 — user scope, TTL 365d, 软过期
  | "strategic"     // 项目目标/决策   — project scope, TTL 180d
  | "domain";       // 其他领域事实   — project/user scope, TTL 90d
```

对齐关系：

| iota 旧类型 | 新 type | 新 facet | mem0 对应 |
|---|---|---|---|
| factual | semantic | identity / preference / domain | SEMANTIC |
| strategic | semantic | strategic | SEMANTIC (无对应子类) |
| episodic | episodic | — | EPISODIC |
| procedural | procedural | — | PROCEDURAL |

### 2.2 StoredMemory 新 Schema

```typescript
interface StoredMemory {
  id: string;
  type: MemoryType;                    // 三类一级
  facet?: SemanticFacet;               // semantic 子类
  scope: "session" | "project" | "user";
  scopeId: string;
  content: string;
  contentHash: string;                 // md5, 用于去重
  embeddingJson?: string;              // 向量 JSON, 用于相关性召回
  source: MemorySource;
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

### 2.3 迁移兼容

- Redis 中已有 `iota:memory:factual:*` 等 key 需要写迁移脚本
- `MemoryMapper` 的 backend nativeType 映射表仅改 `unifiedType` 字段
- 对外 API（Agent WebSocket / CLI）暴露三类 type，facet 作为可选 filter

## 三、召回策略重设计

### 3.1 分桶独立预算

| facet/type | 召回 limit | minConfidence | 保底 token | 注入顺序 |
|---|---|---|---|---|
| identity | 全量 (≤20) | 0.85 | 256 | 1 (最前) |
| preference | 全量 (≤30) | 0.8 | 512 | 2 |
| strategic | 30 | 0.8 | 共享剩余 | 3 |
| domain | 50 | 0.8 | 共享 | 4 |
| procedural | 10 | 0.75 | 共享 | 5 |
| episodic | 20 | 0.7 | 末尾可截断 | 6 |

总 token 预算仍为 4096（可配置），identity + preference 保底 768 tok，其余共享。

### 3.2 打分公式

```
score = alpha * confidence
       + beta  * recencyDecay(now - lastAccessedAt)
       + gamma * log(1 + accessCount)
       + delta * cosineSimilarity(promptEmbedding, memoryEmbedding)
```

参数默认值：alpha=0.3, beta=0.2, gamma=0.1, delta=0.4
无 embedding 时 delta=0，其余按比例归一化。

### 3.3 便捷 API

```typescript
// 新增导出
export function getUserProfile(userId: string): Promise<{identity: StoredMemory[], preference: StoredMemory[]}>;
```

## 四、存取时机优化

### 4.1 写入（Extract）

**P0: 关键词 hint + hash 去重**
- 保留现有 `resolveNativeMemoryType()` 关键词分类作为 fallback
- 写入前 `SISMEMBER iota:memory:hashes:{type}:{scopeId} {contentHash}` 去重
- 命中则仅 touchAccessCount，不重复写入

**P1: LLM Extractor（新模块 `memory/extractor.ts`）**
- 调用 Engine 内可用 LLM，输出 schema:
  ```json
  {"memories": [{"type": "semantic", "facet": "identity", "content": "...", "confidence": 0.95}]}
  ```
- 与现有 top-5 同桶记忆比对，决策 ADD / UPDATE / SKIP
- 无 LLM 可用时退化为关键词 hint

**P1: History 记录**
- `iota:memory:history:{id}` ZSET，每次 store/update/delete 写一条
- 格式: `{event, oldContent, newContent, timestamp}`

### 4.2 读取（Recall）

执行时机不变（每次 execute 开始），但内部逻辑改为：
1. 并行查 6 个桶（identity/preference/strategic/domain/procedural/episodic）
2. 各桶内按打分公式排序
3. 按保底预算 + 共享预算分配 token

### 4.3 GC 策略

- identity / preference: 软过期（TTL 到期 → confidence 衰减 50%，不删除；下次同主题写入时合并）
- 其他: 硬过期（TTL 到期 + `runMemoryGc` 清理）
- 新增: session close 时触发 episodic compaction（多条 episodic → 1 条 procedural-summary）

## 五、存储后端演进路径

### 接口契约

`MemoryStorageBackend` 是唯一边界，业务代码禁止出现 Redis key 字面量。

接口增强：
```typescript
interface MemoryStorageBackend {
  // 现有
  saveUnifiedMemory(memory: StoredMemory): Promise<void>;
  loadUnifiedMemories(query: MemoryQuery): Promise<StoredMemory[]>;
  deleteUnifiedMemory(type: MemoryType, memoryId: string): Promise<boolean>;
  touchUnifiedMemories(memoryIds: string[], accessedAt: number): Promise<void>;
  // 增强
  searchByVector(vector: number[], query: MemoryQuery, topK: number): Promise<StoredMemory[]>;
  searchUnifiedMemories(query: string, limit?: number, scope?: {...}): Promise<StoredMemory[]>;
  checkHashExists(type: MemoryType, scopeId: string, hash: string): Promise<boolean>;
  addHistory(memoryId: string, event: string, oldContent: string | null, newContent: string): Promise<void>;
}
```

### 三档演进

| 档位 | 后端 | 适用规模 | 触发条件 | 切换成本 |
|---|---|---|---|---|
| L1 | Redis hash+zset + 客户端 cosine | 单 scope ≤ 1k | 默认 | — |
| L2 | Redis Stack RediSearch HNSW | 单租户 ≤ 100k | 召回 P95 > 50ms 或 scope > 1k | 切 image, 加 FT.CREATE 脚本, 业务零改动 |
| L3 | Milvus / Qdrant / Weaviate 适配器 | 单租户 > 1M 或多区域 | 召回 P95 > 200ms 或需混合稀疏稠密 | 新增 `storage/milvus.ts`, 配置切后端, 业务零改动 |

### L2 RediSearch 索引预定义

```redis
FT.CREATE iota:idx:memory ON HASH PREFIX 1 iota:memory:
  SCHEMA
    type TAG
    facet TAG
    scope TAG
    scopeId TAG
    confidence NUMERIC SORTABLE
    expiresAt NUMERIC SORTABLE
    embedding VECTOR HNSW 6 TYPE FLOAT32 DIM 1024 DISTANCE_METRIC COSINE
```

### 不引入 Milvus 的理由（文档化）

1. 运维面积：Milvus 需 etcd + MinIO + Pulsar，从 1 个 compose 变 3-4 组件
2. 量级不匹配：iota 当前单 scope < 500 条，RediSearch 已绰绰有余
3. 叙事契合度：iota 的差异化是"Engine 即中枢 + 低门槛"，重运维破坏核心故事
4. 接口已预留：`searchByVector` 接口在 L1/L2 阶段即可实现，L3 只是换实现文件

## 六、实施阶段

### P0 — 立即可做（1-2 周）

| 任务 | 文件 | 要点 |
|---|---|---|
| T1: type 重命名 + 引入 facet | `memory/types.ts`, `memory/mapper.ts`, `memory/mapper.test.ts` | MemoryKind -> MemoryType, 新增 facet 字段 |
| T2: StoredMemory 增 contentHash + embeddingJson | `memory/types.ts`, `storage/redis.ts` | hash 字段, save 时计算 md5 |
| T3: hash 去重逻辑 | `memory/storage.ts`, `storage/redis.ts` | checkHashExists, 命中则 touch |
| T4: embedding 写入 | `memory/storage.ts`, `memory/embedding.ts` | store 时调 EmbeddingProviderChain.embed, 写 embeddingJson |
| T5: 召回打分公式 | `memory/injector.ts` | 替换 flattenMemoryContext 为 score 排序 |
| T6: identity/preference 保底预算 | `memory/injector.ts` | buildContext 分 6 桶, 独立 budget |
| T7: getUserProfile 便捷 API | `memory/index.ts`, `engine.ts` | 导出便捷方法 |
| T8: 文档 — 存储后端演进路径 | `docs/guides/12-iota-memory.md` | 新增小节 |
| T9: 迁移脚本 | `deployment/scripts/migrate-memory-v2.ts` | factual->semantic 重写 key |

### P1 — 短期（2-4 周）

| 任务 | 文件 | 要点 |
|---|---|---|
| T10: LLM Extractor 模块 | `memory/extractor.ts` (新建) | 替代关键词 hint, 输出 type+facet+content+confidence |
| T11: ADD/UPDATE/SKIP 合并决策 | `memory/extractor.ts` | top-5 召回 + LLM 判断 event |
| T12: History 记录 | `storage/redis.ts`, `memory/storage.ts` | addHistory 接口, ZSET 存储 |
| T13: Session close compaction | `engine.ts` | episodic -> procedural-summary |
| T14: 软过期 GC | `memory/gc.ts` | identity/preference 到期降 confidence, 不删 |
| T15: searchByVector 接口 | `memory/storage.ts`, `storage/redis.ts` | 客户端 cosine 实现 |

### P2 — 中期（按需）

| 任务 | 文件 | 要点 |
|---|---|---|
| T16: Redis Stack 适配 | `storage/redis-search.ts` (新建) | FT.CREATE + FT.SEARCH 实现 |
| T17: 过滤算子下沉 | `memory/types.ts` | MemoryQuery 增 filters 语法 |
| T18: 实体抽取 | `memory/entity.ts` (新建) | 可选 skill, 跨记忆实体连接 |
| T19: Reranker 插件 | `memory/reranker.ts` (新建) | Cohere/BGE 可选 |
| T20: 多 actor 归因 | `memory/types.ts` | metadata 标准化 actor_id/role/attributed_to |

### P3 — 长期（信号驱动）

| 任务 | 触发条件 |
|---|---|
| T21: Milvus 适配器 | 单租户 > 1M 记忆 |
| T22: 混合稀疏稠密检索 | 有明确 BM25+Dense 需求 |
| T23: 跨可用区副本 | 多区域部署需求 |

## 七、并行执行指南

以下任务可由独立 claude 会话并行执行，无文件冲突：

**并行组 A（Schema 层）**: T1 + T2 + T9
- 改 types.ts, mapper.ts, 写迁移脚本
- 完成后其他任务才能开始

**并行组 B（存储层）**: T3 + T4 + T15
- 改 storage.ts, redis.ts, embedding.ts
- 依赖 A 完成

**并行组 C（召回层）**: T5 + T6 + T7
- 改 injector.ts, engine.ts, index.ts
- 依赖 A 完成

**并行组 D（文档）**: T8
- 独立，随时可做

**串行**: T10 → T11 → T13（LLM Extractor 链路）

## 八、验证标准

P0 完成后重跑 8 轮验证矩阵：

| 判据 | 预期改进 |
|---|---|
| R7 不重复写入 | hash 去重命中, factual 计数不再 2→3 |
| R8 综合复盘相关度 | cosine 打分让当前话题相关的记忆排前 |
| identity 不被截断 | 保底 256 tok 确保身份信息永远注入 |
| preference 持久 | 软过期确保长期不用也不丢偏好 |
| 跨后端一致性 | type+facet 模型不依赖任何 backend 特有概念 |
