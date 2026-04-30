# Iota

Iota 是一个可插拔的 AI Coding Agent 运行时工程。它通过统一的 `iota-engine`、`iota-cli`、`iota-agent` 与 `iota-app`，编排 Claude Code、Codex、Gemini CLI、Hermes Agent 与 OpenCode，并把原生后端协议归一化为统一的运行时事件、可见性数据和 App Read Model。

## 仓库结构

```text
iota/
├── docs/              # 指南与设计文档
│   ├── iota-guides/   # 架构、Engine、Backend、CLI、Agent、App、Visibility、Memory、Skill、部署
│   └── performance/   # 延迟基准测试、对比报告
├── deployment/        # Redis / Docker / MinIO / Milvus 相关部署文件
├── iota-engine/       # 核心运行时库 (@iota/engine v0.1.0)
├── iota-cli/          # 命令行工具 (@iota/cli v0.1.0)
├── iota-agent/        # HTTP / WebSocket 服务 (@iota/agent v0.1.0)
├── iota-app/          # 前端应用 (Vite + React 19 + Zustand + TanStack Query)
└── iota-skill/        # 结构化技能与 iota-fun 多语言执行器
```

## 当前实现边界

- `iota-engine` 是唯一的协议适配层，后端协议代码只允许放在 `iota-engine/src/backend/`。
- `iota-agent` 负责 REST 查询接口和 WebSocket 会话流，不直接实现后端协议转换。
- `iota-app` 只应消费 Agent 的 snapshot / delta 接口，不应直接依赖原生 backend event schema。
- 后端认证、模型、endpoint 统一走 Redis distributed config；不再使用 backend 本地 `.env` 文件作为正式配置入口。

## 已实现的主路径

- CLI 通过 `iota-engine` 直接执行 prompt，支持 `run`、`interactive`、`status`、`switch`、`config`、`logs`、`trace`、`visibility`、`gc`。
- Agent 提供 session、execution、logs、config、visibility、cross-session、app snapshot 与 WebSocket `/api/v1/stream`。
- App 通过 HTTP + WebSocket 读取会话快照、执行快照和增量更新，展示对话时间线、Inspector 面板（tracing、memory、tokens、summary）、审批卡片。
- Engine 已实现 memory injection、workspace snapshot / delta、visibility store、trace spans、approval policy、audit、Redis config、MCP skill execution。
- 审批闭环已完整实现：App 发送 `approval_decision` → Agent WebSocket → `engine.resolveApproval()` → 执行继续。
- iota-fun 支持 7 种语言：python, typescript, go, rust, zig, java, cpp。

## 当前已知待改进点

- `iota-app/README.md` 仍是 Vite 模板，未反映真实产品结构。
- `visibility`、`trace`、`replay` 已实现，但缺少端到端集成测试。
- Memory GC 和 Embedding 向量检索仍依赖外部服务（Milvus / Ollama）可用性，缺少降级路径测试。
- iota-skill 当前只有 `pet-generator` 一个示例，尚未有真实生产 skill 参考实现。

## 快速开始

### 1. 启动基础设施

开发环境至少需要 Redis（通过 Docker 运行）：

**前置条件**: 确保 Docker Desktop 已启动并运行

```bash
# 验证 Docker 是否运行
docker ps

# 如果失败，请先启动 Docker Desktop，然后继续
```

启动 Redis 和其他存储服务：

```bash
cd deployment/scripts
bash start-storage.sh
redis-cli ping
```

如果遇到 `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified` 错误，说明 Docker Desktop 未运行，请先启动 Docker Desktop。

### 2. 安装依赖并构建

```bash
cd iota-engine && bun install && bun run build
cd ../iota-cli && bun install && bun run build
cd ../iota-agent && bun install
cd ../iota-app && bun install
```

### 3. 准备后端配置文件

在将配置路径写入 Redis 之前，需要先准备各后端的配置文件。

#### 3.1 Claude Code Settings

确保 Claude Code settings 文件存在（通常在 `~/.claude/settings.json` 或自定义路径）：

```json
{
    "env": {
        "ANTHROPIC_AUTH_TOKEN": "your-api-key",
        "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
        "ANTHROPIC_MODEL": "claude-sonnet-4-6",
        "API_TIMEOUT_MS": "3000000"
    }
}
```

#### 3.2 Codex Config

创建 Codex 配置文件（如果使用 9Router 或其他供应商）：

```bash
mkdir -p ~/.codex-iota
cat > ~/.codex-iota/config.toml <<'EOF'
model = "gh/gpt-5.4"
model_provider = "ninerouter"

model_reasoning_effort = "high"
model_verbosity = "medium"

[model_providers.ninerouter]
name = "9Router"
base_url = "http://localhost:20128/v1"
env_key = "ROUTER_API_KEY"
wire_api = "responses"
stream_idle_timeout_ms = 600000

[agents.subagent]
description = "General-purpose helper agent for delegated subtasks"
model = "gh/gpt-5.4"
EOF
```

#### 3.3 Gemini CLI

Gemini CLI 使用本机 OAuth 登录态，无需额外配置文件。确保已运行 `gemini auth login`。

#### 3.4 Hermes Agent

Hermes 配置通过 Redis 环境变量传递，无需本地配置文件。

#### 3.5 OpenCode

OpenCode 使用自身的 provider 配置系统。确保已通过 `opencode providers login` 配置好所需的 AI provider 认证。OpenCode 支持 Anthropic、OpenAI、Google、GitHub Copilot、Azure、OpenRouter 等 75+ 个 provider。

### 4. 配置后端到 Redis

**配置流程**: 将本地已有的后端配置文件路径写入 Redis，Engine 运行时会从 Redis 读取路径并加载配置文件。

```bash
# Claude Code - 将 settings 文件路径写入 Redis
iota config set env.CLAUDE_SETTINGS_PATH "$HOME/.claude/settings-minimax.json" --scope backend --scope-id claude-code

# Codex - 将 CODEX_HOME 路径和 API key 写入 Redis
iota config set env.CODEX_HOME "$HOME/.codex-iota" --scope backend --scope-id codex
iota config set env.ROUTER_API_KEY "sk_9router" --scope backend --scope-id codex

# Gemini - 配置模型名称
iota config set env.GEMINI_MODEL "auto-gemini-3" --scope backend --scope-id gemini

# Hermes - 配置认证和模型信息
iota config set env.HERMES_API_KEY "<redacted>" --scope backend --scope-id hermes
iota config set env.HERMES_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id hermes
iota config set env.HERMES_MODEL "MiniMax-M2.7" --scope backend --scope-id hermes
iota config set env.HERMES_PROVIDER "minimax-cn" --scope backend --scope-id hermes

# OpenCode - 使用自身 provider 系统，可选配置模型
iota config set env.OPENCODE_MODEL "anthropic/claude-sonnet-4-6" --scope backend --scope-id opencode
```

**运行时流程**：

- Engine 从 Redis 读取配置路径（如 `env.CLAUDE_SETTINGS_PATH`、`env.CODEX_HOME`）
- 启动后端时，Engine 传递配置文件路径或设置环境变量
- 后端进程从各自的配置文件中读取实际的认证信息和模型配置

说明：

- Claude Code 使用自定义 settings 文件配置所有环境变量和模型设置。
- Codex 使用自定义 `CODEX_HOME` 配置多模型供应商（9Router / OpenAI / Anthropic 等）。
- Gemini 当前验证基线是本机 Gemini OAuth 登录态加 Redis `env.GEMINI_MODEL`。
- Hermes 使用 Redis 中的 provider / model / credential。
- OpenCode 使用自身 provider 认证系统（`opencode providers login`），可通过 Redis `env.OPENCODE_MODEL` 指定模型。
- 不要把后端密钥写入仓库文件或示例 `.env`。

### 4.5 检测并安装五个 backend CLI

仓库提供了一个统一脚本，用于检测 Claude Code、Codex、Gemini CLI、Hermes Agent、OpenCode 是否已安装；如果缺失，可以按脚本提示直接安装：

```bash
bash deployment/scripts/ensure-backends.sh
```

只做检测、不安装：

```bash
bash deployment/scripts/ensure-backends.sh --check-only
```

只检查或安装部分 backend：

```bash
bash deployment/scripts/ensure-backends.sh codex gemini
```

当前脚本的安装策略：

- `claude-code` -> `npm install -g @anthropic-ai/claude-code`
- `codex` -> `npm install -g @openai/codex`
- `gemini` -> `npm install -g @google/gemini-cli`
- `hermes` -> `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash`
- `opencode` -> `npm install -g opencode-ai@latest`

说明：

- `hermes` 来源是 GitHub 上的 `NousResearch/hermes-agent`，**没有发布到 PyPI**；不要再用 `uv tool install hermes-agent` 或 `pip install hermes-agent`，那会失败。
- Hermes 上游官方明确**不支持 Windows 原生 PowerShell / cmd**；在 Windows 上必须改用 WSL2 / Git Bash 来运行安装脚本与 `hermes` 命令。
- 脚本会优先使用 `command -v` 检测当前 shell 的 `PATH`，在 Windows / WSL / Git Bash 场景下还会回退到 `where.exe` 检测 Windows 侧可执行文件，避免把已安装的 `hermes.exe` 误判为未安装。
- 脚本只负责可执行文件发现与缺失安装，不会写入 backend 密钥或 Redis 配置。
- 即使脚本显示五个命令都存在，也不能替代真实运行验证。

`docs/iota-guides/README.md` 已将这个脚本定义为 guides 体系内统一的 backend 检测入口；各 component guide 应引用该入口，而不是重复维护 shell 级的检测命令说明。

### 5. 验证后端健康状态

#### 5.1 检查后端状态

```bash
cd iota-cli
node dist/index.js status
```

预期输出：所有配置的后端显示 `"healthy": true, "status": "ready"`。

#### 5.2 运行 Traced 请求验证

**重要**: 后端验证不能停在 `iota status`。每个后端都必须至少执行一次真实的 traced request。

**详细的 trace 和 visibility 文档请参见 [docs/iota-guides/07-visibility-trace.md](docs/iota-guides/07-visibility-trace.md)。**

```bash
# 验证 Claude Code
node dist/index.js run --backend claude-code --trace "ping"

# 验证 Hermes
node dist/index.js run --backend hermes --trace "ping"

# 验证 Gemini
node dist/index.js run --backend gemini --trace "ping"

# 验证 Codex
node dist/index.js run --backend codex --trace "ping"

# 验证 OpenCode
node dist/index.js run --backend opencode --trace "ping"
```

**预期结果**：

- Claude Code: 应返回简短响应，使用 settings 文件中配置的模型
- Hermes: 应返回 "pong" 或类似响应
- Gemini: 可能会探索代码库，但最终应成功响应
- Codex: 应返回响应（可能提示某些命令被策略阻止，但后端本身正常工作）
- OpenCode: 应返回简短响应，使用配置的 provider/model

**常见问题**：

- Claude Code 提示 "Not logged in": 运行 `claude login` 进行认证
- Hermes 显示 `model.provider: custom` 或本地 `model.base_url`: 检查 `hermes config show`，确保配置正确
- Codex 连接失败: 确保 9Router 或配置的 base_url 服务正在运行

### 6. 运行 CLI

```bash
cd iota-cli
node dist/index.js run "What is 2+2?"
```

### 7. 启动 Agent 和 App

```bash
cd iota-agent
bun run dev

cd ../iota-app
bun run dev
```

- Agent 默认端口：`9666`
- App 默认端口：`9888`

## 开发命令

在变更过的包目录内执行：

- `bun run build`
- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run format`

## 文档入口

- [文档总览](docs/iota-guides/README.md)
- [环境配置](docs/iota-guides/00-setup.md)
- [架构概览](docs/iota-guides/01-architecture.md)
- [Engine 核心](docs/iota-guides/02-engine.md)
- [Backend 适配器](docs/iota-guides/03-backend-adapters.md)
- [CLI / TUI 指南](docs/iota-guides/04-cli-tui.md)
- [Agent 服务](docs/iota-guides/05-agent.md)
- [App 前端](docs/iota-guides/06-app.md)
- [Visibility & Trace](docs/iota-guides/07-visibility-trace.md)
- [Memory 记忆](docs/iota-guides/08-memory.md)
- [Skill & iota-fun](docs/iota-guides/09-skill-fun.md)
- [部署说明](docs/iota-guides/10-deployment.md)
