# Iota 架构概览

**版本：** 1.3
**最后更新：** 2026 年 4 月 29 日

本文档描述 Iota 的整体架构、组件边界、执行链路、存储模型和部署形态，作为 CLI、Agent、App 与 Engine 指南的共同入口。

## 目录

1. [架构总览](#架构总览)
2. [组件边界](#组件边界)
3. [执行与读取模型](#执行与读取模型)
4. [Engine 内部结构](#engine-内部结构)
5. [通信协议](#通信协议)
6. [数据与存储](#数据与存储)
7. [审批与安全边界](#审批与安全边界)
8. [部署形态](#部署形态)
9. [实现成熟度](#实现成熟度)
10. [源码索引](#源码索引)

---

## 架构总览

Iota 是一个可插拔 AI coding assistant runtime。CLI/TUI 和 Agent 都直接导入 `@iota/engine`，Engine 统一负责后端适配、执行生命周期、事件规范化、Redis 持久化、可见性采集、记忆注入和审批策略。

核心约束：

- Backend 协议逻辑只存在于 `iota-engine/src/backend/`。
- Backend 首选 ACP JSON-RPC 2.0；Claude Code、Codex、Gemini 的 legacy native 输出作为降级路径保留，并同样必须先映射为 `RuntimeEvent`。ACP permission request 会同时规范化为 `waiting_approval` state 和 `approval_request` extension。
- App 不消费 backend 原生 payload，只消费 Agent 输出的 App snapshot / delta 读取模型。
- Redis 是当前主存储；backend 凭证、模型、端点从 Redis 分布式配置读取。
- MinIO 只在 production snapshot/artifact 场景中作为可选对象存储。

### 图谱索引

`docs/diagrams` 现在统一使用 Markdown + Mermaid 源文件。重点图谱：

- [分层架构图](../diagrams/01-layered-architecture.md)
- [系统拓扑图](../diagrams/02-system-topology.md)
- [执行与读取模型图](../diagrams/03-execution-read-model.md)
- [Engine 内部结构图](../diagrams/04-engine-internals.md)
- [Backend 适配器图](../diagrams/05-backend-adapters.md)
- [Agent / App WebSocket 图](../diagrams/06-agent-app-websocket.md)
- [存储、Visibility 与 Memory 图](../diagrams/07-storage-visibility-memory.md)

---

## 组件边界

| 包 | 当前职责 | 不负责 |
|---|---|---|
| `iota-engine` | Runtime API、backend pool、adapter、RuntimeEvent、storage、visibility、memory、approval、audit、metrics、workspace snapshot | HTTP server、React UI |
| `iota-cli` | CLI 命令、interactive TUI、CLI approval hook、调用 Engine | 远程 Agent API 的代理层 |
| `iota-agent` | Fastify REST/WS、请求校验、App snapshot/delta 推送、跨实例 pub/sub bridge、创建带 `DeferredApprovalHook` 的 Engine | Backend 协议解析、直接暴露原生 backend payload |
| `iota-app` | React UI、Zustand session store、WebSocket 连接、snapshot/delta 合并、聊天/检查器/工作区视图 | 直接访问 Redis 或 backend CLI |
| `deployment` | Redis、MinIO、Docker/storage 脚本 | 运行时业务逻辑 |

### Backend 适配器

| Backend | ACP 文件 | Legacy native 文件 | 进程模型 | 协议 | 说明 |
|---|---|---|---|---|---|
| Claude Code | `iota-engine/src/backend/claude-acp.ts` | `iota-engine/src/backend/claude-code.ts` | ACP 长运行；native 每次执行子进程 | ACP JSON-RPC 2.0；legacy stream-json NDJSON fallback | `protocol: acp` 时经 adapter shim，失败早期可回退 native |
| Codex | `iota-engine/src/backend/codex-acp.ts` | `iota-engine/src/backend/codex.ts` | ACP 长运行；native 每次执行子进程 | ACP JSON-RPC 2.0；legacy NDJSON fallback | `protocol: acp` 时经 adapter shim，失败早期可回退 native |
| Gemini CLI | `iota-engine/src/backend/gemini-acp.ts` | `iota-engine/src/backend/gemini.ts` | ACP 长运行；native 每次执行子进程 | ACP JSON-RPC 2.0；legacy stream-json NDJSON fallback | `protocol: acp` 使用 `gemini --acp` |
| Hermes Agent | `iota-engine/src/backend/hermes.ts` | n/a | 长运行子进程 | ACP JSON-RPC 2.0 over stdio | 会写隔离 Hermes runtime 配置并复用进程 |
| OpenCode | `iota-engine/src/backend/opencode-acp.ts` | n/a | 长运行子进程 | ACP JSON-RPC 2.0 over stdio | `opencode acp` 原生 ACP 后端 |

---

## 执行与读取模型

一次执行从 CLI、TUI、REST 或 WebSocket 进入 Engine。Engine 生成和持久化 `RuntimeEvent`；Agent 再将 RuntimeEvent 与 Visibility Store 中的最终数据整形成 App 读取模型。

[执行与 App 读取模型图](../diagrams/03-execution-read-model.md)

### 当前执行路径

1. 调用方提交 `RuntimeRequest`，必须包含 `sessionId`、`executionId`、`prompt` 和 `workingDirectory`。
2. Engine 根据请求内容计算 `requestHash`，实现执行幂等。相同 `executionId` 且 hash 一致时，已结束执行会 replay 持久化事件，运行中执行会尝试 join live stream。
3. Engine 通过 Redis 获取 `iota:lock:execution:{executionId}`，同时使用 fencing token 防止过期锁写入。
4. Engine 扫描 workspace，写入本地 workspace snapshot，并创建 `iota:exec:{executionId}`。
5. Engine 依次持久化 `queued -> starting -> running` 状态事件。
6. `BackendPool` 选择 adapter，adapter 启动或复用后端进程，读取 stdout，解析原生协议。
7. Adapter 将原生事件映射为 `RuntimeEvent`。
8. Engine 处理 memory、approval、MCP routing、workspace guard、visibility、audit，然后把事件写入 Redis Stream 并发布到 multiplexer。
9. 执行结束后 Engine 更新 `iota:exec:{executionId}`，写入 `completed`、`failed` 或 `interrupted` 状态，并释放锁。
10. Agent WebSocket 在执行期间推送 `event` 和 `app_delta`，结束后从 Visibility Store 回填 token/memory/summary/trace delta。

### App 读取模型

App 的主数据流是：

```text
RuntimeEvent + ExecutionRecord + VisibilityRecord
  -> buildAppExecutionSnapshot()
  -> buildAppSessionSnapshot()
  -> app_snapshot / app_delta
  -> iota-app/src/store/useSessionStore.ts
```

读取模型的关键形态：

| 类型 | 来源 | 用途 |
|---|---|---|
| `app_snapshot` | `GET /api/v1/sessions/:sessionId/app-snapshot` 或 WS 订阅后推送 | 完整 session 状态同步 |
| `app_delta` | RuntimeEvent 映射 + visibility store 回填 | 低延迟更新 conversation、trace、memory、tokens、summary |
| `visibility_snapshot` | `subscribe_visibility` 后读取 Engine visibility store | Inspector 初始 visibility 数据 |
| `event` | `engine.stream()` 的原始 RuntimeEvent 包装 | 兼容流式输出；App 也会从 output event 合成 conversation delta |
| `pubsub_event` | Redis pub/sub bridge | 多 Agent 实例下触发客户端重新同步快照 |

重要限制：`useSessionStore` 目前只有一个 `activeExecution` 槽位。多个并发执行的底层数据可持久化，但 UI 可能在不同执行之间切换焦点。

---

## Engine 内部结构

[Engine 内部结构图](../diagrams/04-engine-internals.md)

### 关键内部对象

| 对象 | 当前职责 |
|---|---|
| `IotaEngine` | 公共 API、初始化配置、执行编排、锁续租、backend 切换、interrupt、GC |
| `BackendPool` | 初始化 adapter、状态探测、circuit breaker、capabilities、按名称获取 backend |
| `RuntimeEventStore` | 为事件补 sequence/timestamp，追加状态事件和普通事件 |
| `EventMultiplexer` | 持久化事件后 fan-out 给 live subscriber；支持 replay + live subscribe |
| `RedisStorage` | session/execution/event/log/memory/lock/audit 主存储 |
| `RedisConfigStore` | global/backend/session/user 分布式配置；变更通过 Redis pub/sub 发布 |
| `VisibilityCollector` | 记录 context、tokens、trace spans、mapping、memory selection/extraction |
| `MemoryInjector` | 从 Redis 统一记忆检索并注入 prompt，同时产生 memory visibility |
| `DeferredApprovalHook` | Agent 模式下外部决策的等待点；当前 WS 路由尚未处理 `approval_decision` 入站消息 |
| `CliApprovalHook` | CLI/TUI 模式下的交互式审批提示 |

---

## 通信协议

### App / Agent

| 方向 | 协议 | 当前路径 |
|---|---|---|
| App -> Agent | HTTP REST JSON | `/api/v1/sessions/*`、`/api/v1/execute`、`/api/v1/executions/*`、`/api/v1/config/*`、`/api/v1/executions/:id/visibility*`、`/api/v1/sessions/:id/visibility*`、`/api/v1/traces/aggregate` |
| App -> Agent | WebSocket JSON | `/api/v1/stream` |
| Agent -> App | WebSocket JSON | `event`、`complete`、`error`、`app_snapshot`、`app_delta`、`visibility_snapshot`、`pubsub_event` |

当前 WebSocket 入站处理只包含：

```json
{ "type": "execute", "sessionId": "...", "prompt": "..." }
{ "type": "interrupt", "executionId": "..." }
{ "type": "subscribe_app_session", "sessionId": "..." }
{ "type": "subscribe_visibility", "executionId": "..." }
```

`iota-app` 的 `ChatTimeline` 会发送 `approval_decision`，但 `iota-agent/src/routes/websocket.ts` 的入站 union 和 handler 当前没有处理它。因此本文档不把 App approval decision WS API 描述为已完成的一等能力。

### Engine / Backend

| Backend | ACP 命令模型 | Legacy native 命令模型 | 输入输出 |
|---|---|---|---|
| Claude Code | `npx @anthropic-ai/claude-code-acp` | `claude --print --output-format stream-json ...` | ACP JSON-RPC 2.0；legacy stream-json NDJSON |
| Codex | `npx @openai/codex-acp` | `codex exec ...` | ACP JSON-RPC 2.0；legacy NDJSON |
| Gemini CLI | `gemini --acp` | `gemini --output-format stream-json --prompt ...` | ACP JSON-RPC 2.0；legacy stream-json NDJSON |
| Hermes | `hermes acp` | n/a | ACP JSON-RPC 2.0 over stdio，长运行进程 |
| OpenCode | `opencode acp` | n/a | ACP JSON-RPC 2.0 over stdio，长运行进程 |

所有 adapter 最终输出统一为：

```typescript
type RuntimeEvent =
  | OutputEvent
  | StateEvent
  | ToolCallEvent
  | ToolResultEvent
  | FileDeltaEvent
  | ErrorEvent
  | ExtensionEvent
  | MemoryEvent;
```

---

## 数据与存储

Redis 是当前主存储。生产模式可启用 MinIO，但执行、事件、配置、visibility 和 memory 的主路径都在 Redis。

### Redis key 布局

| 数据 | Redis key | 类型 | 说明 |
|---|---|---|---|
| Session | `iota:session:{sessionId}` | Hash | 默认 TTL 7 天；包含 workingDirectory、activeBackend、metadataJson |
| Execution | `iota:exec:{executionId}` | Hash | 包含 backend、status、requestHash、prompt、output/error、时间戳 |
| Session executions | `iota:session-execs:{sessionId}` | Set | session 到 executionId 的索引 |
| All executions | `iota:executions` | Sorted Set | startedAt -> executionId，用于跨 session 查询 |
| Events | `iota:events:{executionId}` | Redis Stream | field `event` 存 RuntimeEvent JSON |
| Config | `iota:config:global` | Hash | 全局配置 |
| Config | `iota:config:backend:{name}` | Hash | backend 作用域配置与凭证 |
| Config | `iota:config:session:{id}` | Hash | session override |
| Config | `iota:config:user:{id}` | Hash | user preference |
| Locks | `iota:lock:execution:{executionId}` | String PX | 执行互斥锁 |
| Fencing | `iota:fencing:execution:{executionId}` | String counter | fencing token |
| Memory | `iota:memory:{type}:{memoryId}` | Hash | 统一记忆实体 |
| Memory index | `iota:memories:{type}:{scopeId}[:facet]` | Sorted Set | 按 type/scope/facet 查询 |
| Memory backend index | `iota:memory:by-backend:{backend}` | Set | backend 来源索引 |
| Memory tag index | `iota:memory:by-tag:{tag}` | Set | tag 索引 |
| Memory hash index | `iota:memory:hashes:{type}:{scopeId}[:facet]:{contentHash}` | Set | content hash 去重索引 |
| Memory history | `iota:memory:history:{memoryId}` | Sorted Set | ADD/UPDATE 历史记录 |
| Audit | `iota:audit` | Sorted Set | 审计 JSON，分数为 timestamp |

### Visibility key 布局

| 数据 | Redis key | 类型 |
|---|---|---|
| Context manifest | `iota:visibility:context:{executionId}` | String JSON |
| Memory visibility | `iota:visibility:memory:{executionId}` | String JSON |
| Token ledger | `iota:visibility:tokens:{executionId}` | String JSON |
| Link visibility | `iota:visibility:link:{executionId}` | String JSON |
| Trace spans | `iota:visibility:spans:{executionId}` | List JSON |
| Chain span hash | `iota:visibility:{executionId}:chain` | Hash spanId -> JSON |
| Event mapping | `iota:visibility:mapping:{executionId}` | List JSON |
| Session visibility index | `iota:visibility:session:{sessionId}` | Sorted Set |

Visibility 默认 TTL 为 7 天，或从 `engine.eventRetentionHours` 派生。Agent 的 `subscribe_visibility` 是混合机制：执行期间从 live RuntimeEvent 映射 trace/conversation delta，后台每 1 秒轮询 Visibility Store，执行结束后再做一次 store-driven delta 回填。

### 持久化边界

| 数据 | 持久化 | 说明 |
|---|---|---|
| Session / Execution / RuntimeEvent | Redis | 跨进程存活，事件可 replay |
| Unified Memory | Redis | semantic/episodic/procedural，semantic 下含 identity/preference/strategic/domain facet，带 TTL/index/hash/embedding |
| Distributed Config | Redis | backend 凭证、模型、端点、approval 配置 |
| Visibility | Redis | 默认 TTL，不应包含未脱敏 secrets |
| DialogueMemory | 进程内 | Agent/CLI 重启后丢失 |
| WorkingMemory active files | 进程内 | App snapshot 可读当前进程状态，重启后丢失 |
| Workspace snapshots | 本地 `${IOTA_HOME}/workspaces/{sessionId}` | 最近 5 个 snapshot；delta journal 按 execution 写入 |
| Audit | 本地 JSONL + Redis sorted set | 写入前脱敏 |

---

## 审批与安全边界

当前审批分两层：

1. **Engine policy/hook**：`approval.shell`、`fileOutside`、`network`、`container`、`mcpExternal`、`privilegeEscalation` 等策略由 Engine 执行路径检查。
2. **Hook 实现**：CLI/TUI 使用 `CliApprovalHook`；Agent 初始化时创建 `DeferredApprovalHook`。

关键事实：

- CLI 审批路径是实际可用路径，`CliApprovalHook` 会在终端交互式询问。
- Engine 可处理 backend 原生 `approval_request` extension，并持久化 `approval_decision` extension 后再尝试写回 backend native response。
- Agent 确实以 `DeferredApprovalHook` 启动，但当前 WebSocket handler 没有处理 `approval_decision` 入站消息，因此 App 上的审批卡片发送决策后不会被服务端消费。
- `approval/guard.ts` 中的 `ApprovalGuard` 类不是主执行路径；当前活跃逻辑在 `engine.ts` 的 `guardEvent` / approval extension 路径中。
- 文档、日志、visibility、snapshot、replay 都必须保持 secret redaction。

---

## 部署形态

### 单机开发

单机开发环境由 Redis、CLI、Agent、App、Engine 和本机 backend 可执行文件组成。CLI 直接导入 Engine；App 通过 Vite 代理访问 Agent；Agent 在进程内调用 Engine；Engine 连接 Redis 并按需启动 backend 子进程。

推荐命令仍按包粒度执行：

```bash
cd iota-engine && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-cli && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-agent && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-app && bun install && bun run build && bun run typecheck
```

Backend 切换后的验证不能停在 `iota status`。需要运行真实 traced request：

```bash
cd iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

Hermes 还必须检查 `hermes config show`，拒绝死的 `model.provider: custom` 或不可达的本地 `model.base_url`。

### 多实例 Agent

Agent 可多实例运行，共享 Redis。当前多实例实时能力是尽力而为：

- Redis pub/sub channel：`iota:execution:events`、`iota:session:updates`、`iota:config:changes`。
- Agent 会把这些 channel 桥接为 WS `pubsub_event`。
- App 对 `pubsub_event` 的处理主要是触发 session snapshot 重新同步，不是细粒度 delta 合并。
- 运行中执行的 live multiplexer 是进程内对象；跨实例 live join 依赖持久化事件和 pub/sub/snapshot 补偿。

---

## 实现成熟度

| 能力 | 状态 | 说明 |
|---|---|---|
| ACP backend layer | 稳定 | `AcpBackendAdapter` 统一 initialize/session/new/prompt、事件映射和 approval/tool result 回写 |
| Claude/Codex/Gemini native fallback | 稳定但 deprecated | 仅作为 `protocol: native` 或 ACP 早期失败降级路径保留 |
| Hermes/OpenCode ACP adapter | 集成中 | ACP JSON-RPC，长运行进程；Hermes 对本地/Redis 配置敏感，OpenCode 需真实后端验证 |
| Redis storage | 稳定 | session/execution/event/memory/log/lock/audit 主路径 |
| Distributed config | 稳定 | global/backend/session/user，backend 凭证来自 Redis |
| RuntimeEvent replay/join | 稳定 | 幂等 requestHash、terminal replay、running join |
| Visibility store | 稳定 | context/tokens/memory/link/spans/mapping，App snapshot 可消费 |
| App snapshot/delta | 稳定但有 UI 限制 | 数据层完整；App 当前单 activeExecution 槽位 |
| CLI approval | 稳定 | `CliApprovalHook` 活跃使用 |
| App approval decision | 未完成 | UI 发送 `approval_decision`，Agent WS 入站未处理 |
| Redis pub/sub bridge | 集成中 | 可转发跨实例事件；App 多以 snapshot resync 消费 |
| Replay | 集成中 | REST 静态查询，不是实时 WS replay |
| MinIO | 可选 | production snapshot/artifact 增强，缺失时不影响主路径 |
| MCP / skill runner | 集成中 | Engine 层路径存在；无专用 Agent REST endpoint |

---

## 源码索引

| 主题 | 主要文件 |
|---|---|
| Engine 主执行流 | `iota-engine/src/engine.ts` |
| RuntimeEvent 类型 | `iota-engine/src/event/types.ts` |
| Event store/multiplexer | `iota-engine/src/event/store.ts`、`iota-engine/src/event/multiplexer.ts` |
| Redis storage | `iota-engine/src/storage/redis.ts` |
| Redis pub/sub | `iota-engine/src/storage/pubsub.ts` |
| Distributed config | `iota-engine/src/config/redis-store.ts`、`iota-engine/src/config/loader.ts` |
| Visibility store/read model | `iota-engine/src/visibility/redis-store.ts`、`iota-engine/src/visibility/snapshot-builder.ts`、`iota-engine/src/visibility/app-read-model.ts` |
| Memory | `iota-engine/src/memory/injector.ts`、`iota-engine/src/memory/storage.ts`、`iota-engine/src/memory/mapper.ts` |
| Approval | `iota-engine/src/approval/*.ts`、`iota-engine/src/engine.ts` |
| Agent bootstrap | `iota-agent/src/index.ts` |
| Agent WebSocket | `iota-agent/src/routes/websocket.ts` |
| Agent REST execution | `iota-agent/src/routes/execution.ts` |
| Agent visibility/snapshot | `iota-agent/src/routes/visibility.ts` |
| App WebSocket client | `iota-app/src/hooks/useWebSocket.ts` |
| App session store | `iota-app/src/store/useSessionStore.ts` |
| App approval UI | `iota-app/src/components/chat/ChatTimeline.tsx` |

---

## 相关指南

- [CLI 指南](./01-cli-guide.md)
- [TUI 指南](./02-tui-guide.md)
- [Agent 指南](./03-agent-guide.md)
- [App 指南](./04-app-guide.md)
- [Engine 指南](./05-engine-guide.md)
- [Visibility Trace 指南](./06-visibility-trace-guide.md)
- [Memory 指南](./12-iota-memory.md)

---
