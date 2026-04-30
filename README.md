# iota

<p align="center">
  <img src="images/iota.png" alt="iota Architecture" width="800" />
</p>

可插拔 AI Coding Agent 运行时。统一编排 Claude Code、Codex、Gemini CLI、Hermes Agent、OpenCode 五个后端，将原生协议归一化为运行时事件流、可见性数据和 App Read Model。

## 仓库结构

```text
iota/
├── iota-engine/       # 核心运行时 — 协议适配、审批、记忆、可见性、MCP skill 执行
├── iota-cli/          # 命令行交互入口
├── iota-agent/        # Fastify HTTP / WebSocket 服务
├── iota-app/          # Vite + React 19 前端
├── iota-skill/        # 结构化技能 & iota-fun 多语言执行器
├── deployment/        # Docker / Redis / MinIO / Milvus 部署
└── docs/              # 架构指南 & 性能基准
```

## 功能

**CLI** — `run` · `interactive` · `status` · `switch` · `config` · `logs` · `trace` · `visibility` · `gc`

**Agent** — session · execution · logs · config · visibility · cross-session · app snapshot · WebSocket stream

**App** — 对话时间线 · Inspector（tracing / memory / tokens / summary）· 审批卡片

**Engine** — memory injection · workspace snapshot/delta · visibility store · trace spans · approval policy · audit · Redis config · MCP skill execution

**审批闭环** — App `approval_decision` → Agent WebSocket → `engine.resolveApproval()` → 执行继续

**iota-fun** — 支持 python · typescript · go · rust · zig · java · cpp 七种语言

### Memory 系统

<p align="center">
  <img src="images/iota-memory.png" alt="iota Memory System" width="700" />
</p>

`DialogueMemory`（最近 50 轮）→ `WorkingMemory`（活跃文件）→ `MemoryExtractor` → `MemoryStorage`（Redis + 可选 Milvus 向量）

Embedding 降级链：`HashEmbedding` → `Ollama` → `OpenAI`

### Skill & MCP 执行

<p align="center">
  <img src="images/iota-skill-mcp-fn.png" alt="iota Skill MCP Function Execution" width="700" />
</p>

`SkillRunner` → `McpRouter` → 配置的 MCP server。函数源码位于 `iota-skill/pet-generator/iota-fun/`，编译产物缓存在 `~/.iota/iota-fun`。

## 快速开始

### 1. 基础设施

```bash
# 确保 Docker Desktop 运行
docker ps

# 启动 Redis
cd deployment/scripts && bash start-storage.sh
redis-cli ping
```

完整存储（Redis + MinIO + Milvus）：`bash start-storage.sh --full`

### 2. 构建

```bash
cd iota-engine && bun install && bun run build
cd ../iota-cli   && bun install && bun run build
cd ../iota-agent && bun install
cd ../iota-app   && bun install
```

### 3. 后端配置

各后端通过 Redis 统一管理配置路径和凭证：

```bash
# Claude Code
iota config set env.CLAUDE_SETTINGS_PATH "$HOME/.claude/settings.json" \
  --scope backend --scope-id claude-code

# Codex
iota config set env.CODEX_HOME "$HOME/.codex-iota" \
  --scope backend --scope-id codex
iota config set env.ROUTER_API_KEY "sk_xxx" \
  --scope backend --scope-id codex

# Gemini（OAuth 登录态 + 模型名）
iota config set env.GEMINI_MODEL "auto-gemini-3" \
  --scope backend --scope-id gemini

# Hermes
iota config set env.HERMES_API_KEY "<redacted>" \
  --scope backend --scope-id hermes
iota config set env.HERMES_MODEL "MiniMax-M2.7" \
  --scope backend --scope-id hermes

# OpenCode（使用自身 provider 系统）
iota config set env.OPENCODE_MODEL "anthropic/claude-sonnet-4-6" \
  --scope backend --scope-id opencode
```

> **原则**：密钥不入仓库，配置路径写 Redis，后端进程自行读取凭证文件。

### 4. 检测后端 CLI

```bash
bash deployment/scripts/ensure-backends.sh          # 检测 + 安装
bash deployment/scripts/ensure-backends.sh --check-only  # 仅检测
```

### 5. 验证

```bash
cd iota-cli
node dist/index.js status                           # 检查健康状态
node dist/index.js run --backend claude-code --trace "ping"  # 真实请求验证
```

每个后端都必须通过 traced request 验证，不能仅依赖 `status`。

### 6. 运行

```bash
# CLI
cd iota-cli && node dist/index.js run "What is 2+2?"

cd iota-cli
node dist/index.js run --backend claude-code "What is 2+2?"
node dist/index.js run --backend codex "What is 2+2?"
node dist/index.js run --backend gemini "What is 2+2?"
node dist/index.js run --backend hermes "What is 2+2?"
node dist/index.js run --backend opencode "What is 2+2?"
```

## 文档

完整指南：[docs/iota-guides/README.md](docs/iota-guides/README.md)

| 主题 | 链接 |
|---|---|
| 环境配置 | [00-setup](docs/iota-guides/00-setup.md) |
| 架构概览 | [01-architecture](docs/iota-guides/01-architecture.md) |
| Engine | [02-engine](docs/iota-guides/02-engine.md) |
| Backend 适配器 | [03-backend-adapters](docs/iota-guides/03-backend-adapters.md) |
| CLI / TUI | [04-cli-tui](docs/iota-guides/04-cli-tui.md) |
| Agent 服务 | [05-agent](docs/iota-guides/05-agent.md) |
| App 前端 | [06-app](docs/iota-guides/06-app.md) |
| Visibility & Trace | [07-visibility-trace](docs/iota-guides/07-visibility-trace.md) |
| Memory | [08-memory](docs/iota-guides/08-memory.md) |
| Skill & iota-fun | [09-skill-fun](docs/iota-guides/09-skill-fun.md) |
| 部署 | [10-deployment](docs/iota-guides/10-deployment.md) |
