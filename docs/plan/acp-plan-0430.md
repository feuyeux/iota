# ACP 统一接入层实现规划

> 日期: 2026-04-30
> 状态: 已实现（双栈运行中）
> 依赖: iota-engine v0.1.x, ACP Protocol v0.11+

## 1. 背景与目标

### 1.1 现状分析

当前 iota-engine 有 4 个后端适配器，采用两种截然不同的协议模型:

| 适配器 | 进程模型 | 协议 | ACP 支持 |
|--------|----------|------|----------|
| ClaudeCodeAdapter | per-execution | stream-json NDJSON | ❌ `acp: false` |
| CodexAdapter | per-execution | NDJSON | ❌ `acp: false` |
| GeminiAdapter | per-execution | stream-json NDJSON | ❌ `acp: false` |
| HermesAdapter | long-lived | ACP JSON-RPC 2.0 | ✅ `acp: true` |

**问题**: 只有 Hermes 使用 ACP 协议。Claude Code、Codex、Gemini 各自用私有 NDJSON 格式，每个都有独立的 `mapNativeEvent` 实现，事件映射逻辑分散、难以维护。

### 1.2 目标

将所有后端统一到 ACP 协议层，使 iota-engine 拥有单一的北向标准通讯协议:

1. **原生 ACP 后端** (Gemini CLI `--acp`、Hermes `acp`、OpenCode `acp`) → 直接对接
2. **适配器后端** (Claude Code、Codex CLI) → 通过 adapter shim 桥接到 ACP
3. **统一事件映射** — 所有后端产出标准 ACP notification，engine 只需一套 `mapAcpEvent`
4. **双向通信** — 统一 approval、MCP tool result 的回写通道

---

## 2. ACP 协议核心抽象

### 2.1 协议层 (`iota-engine/src/protocol/acp.ts`)

现有实现已有基础:

```typescript
// 已有
interface AcpMessage extends JsonRpcLikeMessage { jsonrpc: "2.0" }
function encodeAcp(message): string
function isAcpMessage(value): boolean
```

**需要扩展**:

```typescript
// ═══ ACP 标准方法定义 ═══
export const ACP_METHODS = {
  // Client → Agent (Requests)
  INITIALIZE: "initialize",
  SESSION_NEW: "session/new",
  SESSION_PROMPT: "session/prompt",
  SESSION_INTERRUPT: "session/interrupt",
  SESSION_DESTROY: "session/destroy",

  // Agent → Client (Notifications)
  SESSION_UPDATE: "session/update",
  SESSION_COMPLETE: "session/complete",
  SESSION_REQUEST_PERMISSION: "session/request_permission",
  SESSION_MEMORY: "session/memory",
  SESSION_FILE_DELTA: "session/file_delta",
} as const;

// ═══ ACP 消息内容类型 ═══
export interface AcpContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "image";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  output?: string;
  error?: string;
}

export interface AcpSessionUpdate {
  sessionId: string;
  type: "agent_message" | "agent_thought" | "tool_call" | "tool_result" | "file_delta";
  content?: AcpContentBlock[];
  metadata?: Record<string, unknown>;
}

export interface AcpSessionComplete {
  sessionId: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "interrupted" | "error";
  usage?: AcpUsage;
  finalMessage?: string;
}

export interface AcpUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface AcpPermissionRequest {
  requestId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  description?: string;
}
```

### 2.2 统一事件映射器 (`iota-engine/src/backend/acp-event-mapper.ts`)

**新文件** — 将 ACP notification 统一映射为 RuntimeEvent:

```typescript
export function mapAcpNotificationToEvent(
  backend: BackendName,
  request: RuntimeRequest,
  message: AcpMessage,
): RuntimeEvent | null {
  switch (message.method) {
    case "session/update":
      return mapSessionUpdate(backend, request, message.params as AcpSessionUpdate);
    case "session/complete":
      return mapSessionComplete(backend, request, message.params as AcpSessionComplete);
    case "session/request_permission":
      return mapPermissionRequest(backend, request, message.params as AcpPermissionRequest);
    case "session/memory":
      return mapMemoryEvent(backend, request, message.params);
    case "session/file_delta":
      return mapFileDelta(backend, request, message.params);
    default:
      return mapExtensionEvent(backend, request, message);
  }
}
```

---

## 3. 后端迁移路线

### Phase 1: 抽象 AcpBackendAdapter 基类（已完成）

从 `SubprocessBackendAdapter` 派生出 `AcpBackendAdapter`，提供:

- 标准化 `initialize` → `session/new` → `session/prompt` 生命周期
- 统一 `mapAcpNotificationToEvent` 事件映射
- 内置 approval response / MCP tool result 双向写入
- session 映射 (iota sessionId ↔ agent sessionId)

```text
SubprocessBackendAdapter (existing)
  └── AcpBackendAdapter (new base)
        ├── HermesAcpAdapter     (refactored from HermesAdapter)
        ├── GeminiAcpAdapter     (new, uses `gemini --acp`)
        ├── OpenCodeAcpAdapter   (new, uses `opencode acp`)
        ├── ClaudeCodeAcpAdapter (new, uses adapter shim)
        └── CodexAcpAdapter      (new, uses adapter shim)
```

### Phase 2: Gemini CLI ACP 适配 (原生)（已完成，待真实 Gemini --acp 验证）

**优先级: 高** — Gemini CLI 有原生 `--acp` 模式，是最容易验证的原生 ACP 迁移目标。

```yaml
runtime: gemini-cli
protocol: acp
support_level: native
command: gemini
args: ["--acp"]
transport: stdio
message_format: json-rpc
```

**变更点**:

- 新建 `iota-engine/src/backend/gemini-acp.ts`
- 进程模型改为 `long-lived` (ACP 模式下 gemini 作为常驻进程)
- 移除 `--prompt` 命令行传参，改用 `session/prompt` 消息
- 复用统一 `mapAcpNotificationToEvent`
- 保留现有 `GeminiAdapter` 作为 fallback (stream-json 模式)

### Phase 3: Hermes 重构（已完成）

**优先级: 高** — 当前已是 ACP，但耦合在 constructor 闭包中。

**变更点**:

- 将 `HermesAdapter` 重构为 `HermesAcpAdapter extends AcpBackendAdapter`
- 将 session 映射、deferred prompt 逻辑上移到 `AcpBackendAdapter`
- `mapHermesEvent` 逻辑迁移到统一 `mapAcpNotificationToEvent` + Hermes 特化补丁
- 保持 `prepareHermesBackendConfig` 不变

### Phase 4: Claude Code ACP 适配 (adapter-backed)（骨架已完成，待 adapter 包验证）

**优先级: 中** — 需要外部 adapter 可执行文件。

```yaml
runtime: claude-code
protocol: acp
support_level: adapter
command: npx
args: ["@anthropic-ai/claude-code-acp"]   # 或社区 adapter
transport: stdio
message_format: json-rpc
```

**变更点**:

- 新建 `iota-engine/src/backend/claude-acp.ts`
- adapter shim 负责将 Claude Agent SDK → ACP 协议
- Engine 层无需关心 Claude 私有协议
- 保留现有 `ClaudeCodeAdapter` 作为 fallback (无 adapter 环境降级)

### Phase 5: Codex CLI ACP 适配 (adapter-backed)（骨架已完成，待 adapter 包验证）

**优先级: 中** — 类似 Claude，需 adapter 桥接。

```yaml
runtime: codex-cli
protocol: acp
support_level: adapter
command: npx
args: ["@openai/codex-acp"]   # 或社区 adapter
transport: stdio
message_format: json-rpc
```

### Phase 6: OpenCode ACP 适配 (原生)（骨架已完成，待真实 opencode acp 验证）

**优先级: 低** — OpenCode 有 `opencode acp` 原生命令，但生态优先级较低。

```yaml
runtime: opencode
protocol: acp
support_level: native
command: opencode
args: ["acp"]
transport: stdio
message_format: json-rpc
```

---

## 4. 配置层扩展

### 4.1 BackendName 类型扩展

```typescript
// iota-engine/src/event/types.ts
export type BackendName =
  | "claude-code"
  | "codex"
  | "gemini"
  | "hermes"
  | "opencode";       // 新增
```

### 4.2 后端协议配置 schema

在 `iota-engine/src/config/schema.ts` 中扩展:

```typescript
interface BackendSection {
  executable: string;
  timeoutMs: number;
  env: Record<string, string>;
  // ═══ 新增 ACP 配置 ═══
  protocol?: "native" | "acp";           // 默认 native (向后兼容)
  acpAdapter?: string;                    // adapter 命令 (仅 protocol=acp + adapter-backed)
  acpAdapterArgs?: string[];              // adapter 额外参数
  processMode?: "per-execution" | "long-lived";  // ACP 模式统一为 long-lived
}
```

### 4.3 iota.config.yaml 示例

```yaml
backends:
  gemini:
    executable: gemini
    protocol: acp                # 启用 ACP 模式
    processMode: long-lived
  claude-code:
    executable: npx
    protocol: acp
    acpAdapter: "@anthropic-ai/claude-code-acp"
  hermes:
    executable: hermes
    protocol: acp                # 已是 ACP (无变化)
    processMode: long-lived
  codex:
    executable: codex
    protocol: native             # 暂不迁移，保留 NDJSON
```

---

## 5. 后端选择与降级策略

```text
engine.selectBackend(name, config):
  1. 检查 config.protocol
  2. if protocol === "acp":
       a. 检查 support_level: native → 直接 spawn `<cmd> --acp` / `<cmd> acp`
       b. 检查 support_level: adapter → spawn adapter shim
       c. 验证 ACP handshake (initialize) 成功
       d. 失败 → fallback 到 native 协议 adapter (现有实现)
  3. if protocol === "native" 或 fallback:
       使用现有 ClaudeCodeAdapter / CodexAdapter / GeminiAdapter
```

---

## 6. 统一双向通信通道

### 6.1 Approval 响应流

```text
App UI → Agent WS (approval_decision) → Engine.resolveApproval()
  → AcpBackendAdapter.sendApprovalResponse(requestId, approved)
    → encodeAcp({ id: requestId, result: { approved } })
    → writeToStdin()
```

**所有 ACP 后端共享同一实现**，不再每个 adapter 单独处理。

### 6.2 MCP Tool Result 回写

```text
Engine SkillRunner → MCP tool execution → tool_result
  → AcpBackendAdapter.sendToolResult(toolCallId, output, error)
    → encodeAcp({ id: toolCallId, result: { output, error } })
    → writeToStdin()
```

---

## 7. 测试计划

### 7.1 单元测试

| 测试文件 | 覆盖范围 |
|---------|----------|
| `acp-event-mapper.test.ts` | 所有 ACP notification → RuntimeEvent 映射 |
| `acp-backend-adapter.test.ts` | 生命周期: init → session/new → prompt → complete → destroy |
| `gemini-acp.test.ts` | Gemini `--acp` 模式启动与交互 |
| `claude-acp.test.ts` | Adapter shim 启动与协议桥接 |
| `hermes-acp.test.ts` | 重构后的 Hermes 对等验证 |
| `acp-fallback.test.ts` | ACP 失败 → native 降级 |

### 7.2 集成验证

```bash
# Phase 2 验证
cd iota-cli && node dist/index.js run --backend gemini --trace "ping"

# Phase 3 验证
cd iota-cli && node dist/index.js run --backend hermes --trace "ping"

# Phase 4 验证
cd iota-cli && node dist/index.js run --backend claude-code --trace "ping"
```

---

## 8. 实施时间线

| 阶段 | 内容 | 前置依赖 |
|------|------|----------|
| P1 | `AcpBackendAdapter` 基类 + 统一事件映射 | 已完成 |
| P2 | Gemini CLI `--acp` 原生适配 | 已完成，待真实后端验证 |
| P3 | Hermes 重构到 AcpBackendAdapter | 已完成 |
| P4 | Claude Code adapter-backed 适配 | 骨架已完成，待 adapter 包验证 |
| P5 | Codex adapter-backed 适配 | 骨架已完成，待 adapter 包验证 |
| P6 | OpenCode 原生适配 | 骨架已完成，待真实后端验证 |
| P7 | 废弃旧 native adapters (可选) | 待定，P2-P5 稳定运行后 |

---

## 9. 文件变更清单

```text
新增:
  iota-engine/src/backend/acp-backend-adapter.ts    — ACP 基类
  iota-engine/src/backend/acp-event-mapper.ts       — 统一 ACP→RuntimeEvent 映射
  iota-engine/src/backend/gemini-acp.ts             — Gemini ACP 适配器
  iota-engine/src/backend/claude-acp.ts             — Claude ACP 适配器
  iota-engine/src/backend/codex-acp.ts              — Codex ACP 适配器
  iota-engine/src/backend/opencode-acp.ts           — OpenCode ACP 适配器
  iota-engine/src/backend/acp-event-mapper.test.ts  — 映射测试
  iota-engine/src/backend/acp-backend-adapter.test.ts

修改:
  iota-engine/src/protocol/acp.ts           — 扩展 ACP 类型定义
  iota-engine/src/backend/hermes.ts         — 重构为 extends AcpBackendAdapter
  iota-engine/src/backend/interface.ts      — BackendCapabilities.acpMode 字段
  iota-engine/src/config/schema.ts          — protocol/acpAdapter 配置字段
  iota-engine/src/event/types.ts            — BackendName 扩展 "opencode"

保留 (不删除，作为 fallback):
  iota-engine/src/backend/claude-code.ts
  iota-engine/src/backend/codex.ts
  iota-engine/src/backend/gemini.ts
```

---

## 10. 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Claude/Codex adapter 包尚未发布或不稳定 | 保留现有 native adapter 作为 fallback，config 中 `protocol: native` 即可回退 |
| ACP 协议版本不兼容 (v0.11 vs 未来版本) | `initialize` 握手中协商 `protocolVersion`，基类处理版本差异 |
| long-lived 进程内存泄漏 | 复用 SubprocessBackendAdapter 的 idle timeout (10min)，定期 GC |
| Gemini `--acp` 模式行为与文档不一致 | Phase 2 先做 spike 验证，确认后再全面迁移 |
| 双向 approval 流在 adapter-backed 模式下延迟 | adapter shim 层异步队列，超时按 denied 处理 |

---

## 11. 核心设计原则

1. **渐进式迁移** — 新 ACP 适配器与旧 native 适配器共存，配置决定使用哪个
2. **单一映射层** — 所有 ACP 后端共享 `mapAcpNotificationToEvent`，特化逻辑通过 hook 注入
3. **协议版本协商** — `initialize` 握手确保前后兼容
4. **故障降级** — ACP handshake 失败自动回退到 native 模式
5. **不破坏现有** — 默认 `protocol: native`，升级完全 opt-in
