Created 5 todos

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory)

Read [](file:///d%3A/coding/creative/iota/mem0/mem0)

Read [](file:///d%3A/coding/creative/iota/docs/guides/12-iota-memory.md)

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/memory)

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/types.ts)

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/index.ts)

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/mapper.ts#1-1), lines 1 to 200

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/injector.ts#1-1), lines 1 to 300

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/storage.ts)

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/dialogue.ts)

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/working.ts)

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/gc.ts)

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/memory/embedding.ts#1-1), lines 1 to 80

Now let me explore mem0's implementation:

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/memory/main.py#1-1), lines 1 to 200

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/memory/base.py)

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/memory/utils.py#1-1), lines 1 to 200

Searched for regex `class MemoryType|MemoryType\.|PROCEDURAL|FACT|EPISODIC` (`**/mem0/mem0/configs/enums.py`), 5 results

Searched for regex `def add\(|def search\(|def update\(|def get\(|def delete\(|def _add_to_vector_store|def _create_procedural` (`**/mem0/mem0/memory/main.py`), 14 results

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/configs/enums.py)

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/memory/main.py#573-573), lines 573 to 760

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/memory/main.py#760-760), lines 760 to 920

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/memory/main.py#1126-1126), lines 1126 to 1300

Searched for regex `FACT_RETRIEVAL_PROMPT|ADDITIVE_EXTRACTION_PROMPT|PROCEDURAL_MEMORY_SYSTEM_PROMPT|UPDATE_MEMORY|^def generate_` (`**/mem0/mem0/configs/prompts.py`), 14 results

Read [](file:///d%3A/coding/creative/iota/mem0/mem0/memory/main.py#1618-1618), lines 1618 to 1700

Searched for regex `memory|injector|Mapper|extract|store` (`**/iota-engine/src/engine.ts`), 20 results

Searched for regex `memoryMapper|memoryInjector|memoryStorage|buildContext|inject|\.store\(|extractMemory|emitMemoryEvent` (`**/iota-engine/src/engine.ts`), 20 results

Searched for regex `memory_extracted|memoryMapper.map|extract|nativeType` (`**/iota-engine/src/engine.ts`), 20 results

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/engine.ts#1610-1610), lines 1610 to 1700

Searched for regex `captureExecutionMemory|classifyMemoryKind|inferNativeType` (`**/iota-engine/src/engine.ts`), 2 results

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/engine.ts#2475-2475), lines 2475 to 2620

Searched for regex `searchUnifiedMemories|loadUnifiedMemories|vector|embedding` (`**/iota-engine/src/storage/redis.ts`), 3 results

Read [](file:///d%3A/coding/creative/iota/iota-engine/src/storage/redis.ts#270-270), lines 270 to 440

我已经分别读完两边的内存实现核心代码，下面给出对比与优化方案。

## 一、核心代码定位

| 关注点 | iota | mem0 |
|---|---|---|
| 类型枚举 | `MemoryKind = factual / strategic / procedural / episodic` (types.ts) | `MemoryType = SEMANTIC / EPISODIC / PROCEDURAL` (enums.py) |
| 存取主入口 | `Engine.captureExecutionMemory()` (engine.ts)；`MemoryInjector.buildContext()` (injector.ts) | `Memory.add()` / `Memory.search()` (main.py) |
| 抽取方式 | 关键词 hint 表 `resolveNativeMemoryType()` (engine.ts) | LLM `ADDITIVE_EXTRACTION_PROMPT` + 现有记忆比对决策 (main.py) |
| 持久化 | Redis hash + zset，按 type/scopeId 索引 (redis.ts) | Vector store + SQLite 历史 + 可选图存储/实体存储 |
| 召回排序 | 时间倒序 + minConfidence (injector.ts) | 向量相似度 + 可选 BM25 + 可选 reranker + 实体加权 |

## 二、记忆分类对比

**iota（4 类，正交且明确分桶）**

- `factual`：稳定身份、偏好（user 作用域，TTL 180d）
- `strategic`：长期目标、决策（project，180d）
- `procedural`：流程、命令（project，30d）
- `episodic`：复盘、对话回顾（session，7d）

每个 backend 的 nativeType 通过 `MemoryMapper` 映射到统一类型，附带默认置信度、作用域和 TTL。这是 iota 的设计亮点：**类型 × 作用域 × TTL 三元组在 schema 上即被绑定**。

**mem0（3 类，但实际几乎等价于 1 类 + 1 个特例）**

- `SEMANTIC`（默认）：所有 `add()` 走 LLM 抽取 → `additive` 决策 → 写入向量库；类型并不写进负载
- `EPISODIC`：仅枚举存在，代码路径与 SEMANTIC 同
- `PROCEDURAL`：唯一显式分支，要求 `agent_id` + `memory_type='procedural_memory'`，由 LLM 把整段会话总结为一条 procedural 写入 (main.py)

**结论**：iota 的"维度化分桶"在概念上更完整、检索时噪声更低；mem0 的"一锅向量 + filter + reranker"在召回相关度上更强但桶之间不隔离。

## 三、各类记忆的存取时机

| 阶段 | iota | mem0 |
|---|---|---|
| 写入触发 | 隐式：每次 `engine.execute` 完成后调用 `captureExecutionMemory`，单条记忆 = `User request: ... \n Result: ...` 截断 2000 字符 | 显式：调用方 `add(messages, …)`，与执行解耦 |
| 抽取 | 关键词 hint（中英混合 list），按 prompt 字面匹配 → 单一 nativeType；置信度 < 0.7 丢弃 | LLM 先抽事实数组 → 与 top-10 现有记忆比对 → 决策 ADD/UPDATE/NONE → 批量 embed/insert，hash 去重 |
| 去重/演化 | 无；R7「兼任产品经理」会作为新 factual 追加，老的不被合并/更新 | hash MD5 一级去重 + LLM 二级合并；`history` 表记 ADD/UPDATE/DELETE |
| 工作记忆 | `DialogueMemory`（每会话最近 50 turn，进程内）、`WorkingMemory`（活跃文件集），都不持久化 | 无对应概念，最近消息靠 `db.get_last_messages(session_scope, limit=10)` |
| 召回触发 | 每次 execute 开始：`MemoryInjector.buildContext` 并行查 4 桶（episodic 20 / procedural 10 / factual 50 / strategic 30），按 token 预算 4096 截断后写进 prompt | 应用层主动 `search(query, filters, top_k, threshold)`，不会自动注入 |
| 召回排序 | **纯时间倒序 + 阈值**，与当前 prompt 无相关性计算 | 向量相似度（必选）+ BM25（可选）+ reranker（可选）+ entity boost |
| GC | TTL 到期 + 定期 `runMemoryGc` 清 zset/hash | 无 TTL；靠 `delete()` 与 LLM 的删除决策 |

## 四、数据结构对比

iota `StoredMemory`（types.ts）：

```
id, type, scope, scopeId, content, source{backend,nativeType,executionId},
metadata, confidence, timestamp, ttlDays,
createdAt, lastAccessedAt, accessCount, expiresAt
```

Redis 布局：`iota:memory:{type}:{id}` (HASH 全字段) + `iota:memories:{type}:{scopeId}` (ZSET, score=timestamp)。`accessCount` / `lastAccessedAt` 已经被记录但**未参与召回打分**。

mem0 vector payload（main.py）：

```
data, hash (md5), text_lemmatized (BM25),
user_id, agent_id, run_id, actor_id, role, attributed_to,
created_at, updated_at, [memory_type]
+ embedding (向量)
+ history 表: memory_id, old_memory, new_memory, event, created_at, is_deleted
+ entity_store (实体 ↔ memory_id 关联)
```

差距：iota 缺 `embedding`、`hash`、`text_lemmatized`、`history`、`entity` 五项。

## 五、优化 iota 的规划方案

按"性价比 / 兼容性"排序，分四个阶段：

### P0 立即可做（改动局部，收益高）

1. **加 hash 去重**：`UnifiedMemory` 增 `contentHash: string`，`storage.ts` 写入前 `SISMEMBER iota:memory:hashes:{type}:{scopeId}`，命中则跳过或合并 `accessCount`。一行 md5 解决 R7 类重复。
2. **召回打分公式化**：把 `flattenMemoryContext` 改成 `score = α·confidence + β·recencyDecay + γ·log(1+accessCount)`，复用已记录但未使用的字段。
3. **召回阶段引入相关性**：用现有 `EmbeddingProviderChain`/`HashEmbeddingProvider` 在 `MemoryStorage.store` 时把 embedding 写进 hash 的 `embeddingJson` 字段；`buildContext` 嵌入当前 prompt → 客户端 cosine 排序。Redis 端无需 RediSearch，scope 内 N≤500 时遍历足够。

### P1 短期（新增模块，与现有兼容）

1. **`MemoryExtractor`（LLM 抽取器）替换关键词分类**：新建 `iota-engine/src/memory/extractor.ts`，调用 Engine 内可用 LLM（或 backend 自身），按四桶 schema 输出 `{type, content, confidence}[]`。关键词 hint 作为 fallback，保留对离线/无 key 场景的支持。这才是 mem0 高质量记忆的关键。
2. **ADD/UPDATE/NONE 合并决策**：`captureExecutionMemory` 增加一步 — 先 `topK=5` 同 type+scopeId 召回，把候选发给 LLM 让它输出 `event`。无 LLM 时退化为 hash + 最长公共子串阈值。
3. **`iota:memory:history:{id}` zset**：每次 store/update/delete 写一条 history 记录（旧值、新值、事件、时间），对应 mem0 的 `add_history`，让 R7 这种"身份演化"可追溯。

### P2 中期（数据面升级）

1. **可选向量存储后端**：抽 `MemoryStorageBackend` 出 `searchByVector(typ, scope, vec, topK)`，提供两个实现：Redis 兼容（KEYS scan + 内存余弦）与 RediSearch / Qdrant 适配器。配置在 `engine.config`。
2. **会话收尾摘要（procedural compaction）**：仿 mem0 `_create_procedural_memory`，在 session close 或 episodic > N 时，触发 LLM 把若干 episodic 压缩成 1 条 procedural-summary，降低长会话的注入噪声。
3. **过滤算子下沉**：把 `MemoryQuery` 增加 `filters: { tags?: {in:[...]}, confidence?: {gte:...}, createdAt?: {gt:...} }`，对齐 mem0 的 eq/ne/in/AND/OR 语法，覆盖 App 端筛选场景。

### P3 长期（生态）

1. **实体抽取与图记忆**：复用 iota-skill 通道，把 mem0 的 `extract_entities_batch` + entity_store 移植成可选 skill，给 strategic/factual 增加跨记忆的实体连接，回答"和 X 项目相关的所有事实"这类问题。
2. **Reranker 接入**：和召回打分公式并存，作为 backend 特有插件（如 Cohere/BGE）。
3. **多 actor / role 归因**：在 `metadata` 中标准化 `actor_id`、`role`、`attributed_to` 字段，与 mem0 对齐，便于多方对话场景。

### 不建议照搬的部分

- mem0 的"3 类型其实只有 1 个真正用"的设计；iota 的 4 桶正交模型更清晰，应保留。
- mem0 默认所有读写都走 LLM；iota 在 CLI/no-LLM 路径下需要保留确定性 fallback。
- mem0 不带 TTL/GC；iota 的 TTL+作用域绑定是优势，应继续坚持。

### 优先级建议

P0（hash 去重 / 召回打分 / embedding 写入）一周内即可上线，立即提升 8 轮验证矩阵的"R7 不重复"与"R8 综合复盘相关度"两个判据。P1 的 LLM 抽取 + 合并决策是质变跃迁，建议作为下个 milestone。P2/P3 视产品形态再排期。

你的规划没有问题，特别地，补充下我要确认的两个点：
1 分类概念上对齐：
procedural 和 episodic 已经同名
factual -> semantic
strategic 如何对齐？
2 存储上是否需要引入milvus？

## 1. 分类对齐方案

mem0 用的是 Tulving 认知心理学分类（semantic / episodic / procedural），三类是"人类记忆"模型，**没有 strategic 这一类**。所以问题本质是：iota 的 strategic 在认知模型里要落到哪。

**结论：strategic 没有同名直译，应作为 iota 对 semantic 的细分（facet）保留。**

理由：

- 认知科学上，"长期目标 / 决策 / 架构方向"属于 semantic memory 的子集（关于"项目世界"的命题性知识）；硬要找学术对应词是 *prospective memory*（前瞻记忆）或 *intentional memory*，但工程社区基本不用。
- mem0 的 `MemoryType` 枚举其实在代码里几乎不读取（只有 procedural 显式分支），它的"分类"主要靠 metadata + filters。所以对齐 mem0 不必把 strategic 删掉。

具体重命名与 schema 调整：

```ts
// 1) 重命名
factual  -> semantic        // 与 mem0 同名
episodic -> episodic        // 不变
procedural -> procedural    // 不变
strategic -> semantic + facet="strategic"   // schema 上变 facet，逻辑上保留

// 2) StoredMemory 增字段
interface StoredMemory {
  type: "semantic" | "episodic" | "procedural";   // 三类，对齐 mem0
  facet?: "identity" | "preference" | "strategic" | "domain";  // iota 扩展
  scope: "session" | "project" | "user";
  ...
}
```

这样：

- 对外（导出 / 与 mem0 互操作 / 业界沟通）只暴露三类；
- 对内召回仍可按 `(type, facet)` 分桶，行为和现在 4 桶等价 —— `MemoryInjector.buildContext` 改成查 4 个 query：`{semantic, identity}` / `{semantic, strategic}` / `procedural` / `episodic`，injectorTTL/作用域规则全部保留。
- `MemoryMapper` 里每个 backend 的 nativeType 映射只改 `unifiedType` 字段，迁移成本是常量级。

如果你坚持四个一级类型，那就承认 strategic 是 iota 私有扩展，在 README/guide 里写一行映射表（`strategic ⊆ semantic`）即可，不要去发明 "intentional" 这种半学术词，反而徒增解释成本。**我推荐第一种（type+facet），对齐 + 不丢能力**。

## 2. 存储是否引入 Milvus

**结论：现阶段不引入。按"能力曲线"分三档演进，Milvus 只在最后一档出现。**

理由（按规模 / 运维 / 收益三个维度）：

| 维度 | 当前 iota | RediSearch (FT.VSS) | Milvus |
|---|---|---|---|
| 单 scope 量级 | < 500 实测 | ~10⁵ 量级稳定 | 10⁶+ 才发挥 |
| 新增运维依赖 | 0（已有 Redis Sentinel） | 0（启用 Redis Stack 模块） | 新集群 + etcd + MinIO/S3 + Pulsar，运维面积翻倍 |
| 与现状契合度 | `iota:memory:*` key 前缀已分桶 | 同一 Redis，同一连接池，FT.CREATE 加索引即可 | 需要新写 `MemoryStorageBackend` 适配器 + 新部署文档 |
| 召回能力 | 时间倒序 | HNSW 向量 + tag filter + numeric filter | HNSW/IVF + 多副本 + 强一致 |

推荐路径（与 P0–P2 匹配）：

- **P0**：embedding 写入 hash 字段 `embeddingJson`，`buildContext` 内做客户端 cosine。`scopeId` 内 ≤1k 条时延 < 5ms，零新依赖，**这一档就能覆盖 iota 当前所有真实负载**。
- **P1**：把 Redis 升级到 Redis Stack，建 RediSearch 索引：

  ```
  FT.CREATE iota:idx:memory ON HASH PREFIX 1 iota:memory:
    SCHEMA type TAG scope TAG scopeId TAG facet TAG
           confidence NUMERIC SORTABLE
           expiresAt NUMERIC SORTABLE
           embedding VECTOR HNSW 6 TYPE FLOAT32 DIM 1024 DISTANCE_METRIC COSINE
  ```

  替换 `loadUnifiedMemories` / `searchUnifiedMemories` 即可，部署仍是同一个 Redis。这一步对齐了 mem0 的"向量 + 元数据 filter"能力。
- **P2（可选）**：仅当出现以下信号才考虑 Milvus 适配器：
  - 单租户 memory 总量 > 10⁶
  - 需要多副本读写分离 / 跨可用区
  - 需要稀疏（BM25）+ 稠密混合检索的硬要求
  
  且要以 `MemoryStorageBackend` 接口扩展，不替换 Redis（Redis 仍承载 hash/zset/锁/事件流）。

**不建议现在就上 Milvus 的关键点**：iota 的卖点是"Engine 即记忆中枢、后端可热插拔"，运维门槛低是这个故事能成立的前提之一。第一阶段用户跑 8 轮验证用 Docker 就能起来；引入 Milvus 会把入门成本从 1 个 compose 变成 3–4 个组件，会直接吃掉 iota 相对于 mem0 的差异化优势。RediSearch 是当下最优解，Milvus 留给"真的有人在生产跑 10⁶ 记忆"那一天。

1 我同意 对齐 + 不丢能力 的方案 特别地 identity | preference 是否也需要拔高？ 比如 用户习惯 用户偏好 个性化 等业务对此较重的依赖？
2 如果可扩展、无需修改代码实现，可以先不考虑milvus，只做文档化--随着规模变大 后续的可扩展方案

## 1. identity / preference 是否拔高

**结论：不拔高为一级 type，但要拔高为"一等公民 facet"，并在召回与 API 上给独立通道。**

理由：

- 一旦把 preference 也升到 type 级，就破坏了刚刚和 mem0 对齐的三类语义（认知模型里 preference 仍是 semantic 子集），后续互操作要再做一次映射。
- 但你说的业务诉求（用户习惯/偏好/个性化）确实是 *跨 session、跨 project、跨 backend* 的最高频召回路径，必须比 "domain semantic" 优先级更高、TTL 更长、永远不被 token budget 截断。

落地方案（在上一轮 type+facet 的 schema 上再细化）：

```ts
type MemoryType = "semantic" | "episodic" | "procedural";

type SemanticFacet =
  | "identity"      // 姓名/角色/身份 — user scope, TTL ∞ (or 365d)
  | "preference"    // 偏好/习惯/风格 — user scope, TTL 365d, 必注入
  | "strategic"     // 项目目标/决策    — project scope, TTL 180d
  | "domain";       // 其他领域事实    — project/user scope, TTL 90d
```

关键策略变化（在 `MemoryInjector.buildContext` 里）：

| facet | 召回 limit | minConfidence | token 预算独立保留 | 注入顺序 |
|---|---|---|---|---|
| identity | 全量（≤20） | 0.85 | 是（保底 256 tok） | 最前 |
| preference | 全量（≤30） | 0.8 | 是（保底 512 tok） | 第二 |
| strategic | 30 | 0.8 | 与 domain 共享剩余 | 第三 |
| domain | 50 | 0.8 | 共享 | 第四 |
| procedural | 10 | 0.75 | 共享 | 第五 |
| episodic | 20 | 0.7 | 末尾，可被截断 | 最后 |

要点：

- **保底预算**：identity + preference 给独立的 token 配额（合计 ~768 tok 上限），其它类共享 budget − 保底。这样长会话里 episodic 涨爆也不会冲掉用户偏好。
- **独立 API**：在 `Memory` 模块导出 `getUserProfile(userId)` 便捷方法，专门返回 `{identity, preference}`，给上层（如 App 用户中心、欢迎语、个性化推荐）直接用，不用每次拼 query。
- **抽取器特殊处理**：P1 的 LLM Extractor 输出 schema 里把 `facet` 作为强约束字段，prompt 里给清晰示例（"我喜欢用中文"= preference，"我叫张明"= identity，"项目目标是云原生"= strategic）。这是后续个性化质量的真正分水岭。
- **GC 例外**：identity / preference 的 TTL 即使到期也走"软过期"——只降低 confidence、不删除，等下次同主题写入再合并。避免用户半年没用就"失忆"。

**对齐性回看**：对外仍然只是三类 type，与 mem0 兼容；对内 facet 是 iota 私有维度。这正是上一轮"type + facet"方案的红利：业务越重，往 facet 上加，不污染顶层模型。

## 2. Milvus 仅做文档化

同意，正式纳入计划。两个工程动作即可保证未来无需改业务代码：

### 接口契约（已有，强化即可）

保持 `MemoryStorageBackend`（storage.ts）作为唯一边界。在 P0/P1 落地时**严禁**业务代码（engine.ts、injector.ts）出现 `iota:memory:*` 这类 Redis key 字面量 —— 这些只允许出现在 redis.ts 实现里。这样 Milvus 适配器未来只是新增一个文件 `storage/milvus.ts` 实现同接口，零业务改动。

具体收紧：

- `searchUnifiedMemories` 入参增加 `vector?: number[]`，让向量检索成为接口能力，不只是关键词。
- `loadUnifiedMemories` 的 `MemoryQuery` 已是结构化的（type/scope/scopeId/minConfidence/tags），保持，不要让上层组装原生 query 字符串。

### 文档化产出

在 12-iota-memory.md 增一节"存储后端演进路径"，明确三档：

| 档位 | 后端 | 适用规模 | 触发条件 | 切换成本 |
|---|---|---|---|---|
| L1 | Redis hash+zset + 客户端 cosine（当前） | 单 scope ≤ 1k | 默认 | — |
| L2 | Redis Stack RediSearch HNSW | 单租户 ≤ 10⁵ | 召回 P95 > 50ms 或 scope > 1k | 切换 deployment image，新增 FT.CREATE 索引脚本，业务零改动 |
| L3 | Milvus（或 Qdrant / Weaviate）适配器 | 单租户 > 10⁶ 或多区域 | 召回 P95 > 200ms 或需多副本 / 混合稀疏稠密 | 实现 `storage/milvus.ts`，配置 `engine.config` 切后端，业务零改动 |

并在文档里写明放弃 / 暂不做的理由（运维面积、当前用户量级、与"Engine 即中枢"叙事的契合度），避免日后被反复问"为什么不上向量库"。

---

这两点定下来后，P0 任务清单可以直接写：

1. type 重命名 + 引入 facet（schema 兼容层 + mapper 调整）
2. identity / preference 保底预算与独立 API
3. hash 去重 + embedding 写入字段
4. 召回打分公式（α·confidence + β·recency + γ·log access + δ·cosine）
5. 文档新增"存储后端演进路径"小节

是否要我现在开始落地 P0？建议从 (1)+(5) 起手——schema 改动和文档先行，后面 (2)(3)(4) 是局部增量。
