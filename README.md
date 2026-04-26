# Iota

Iota 是一个可插拔的 AI Coding Agent 运行时工程。它通过统一的 `iota-engine`、`iota-cli`、`iota-agent` 与 `iota-app`，编排 Claude Code、Codex、Gemini CLI 与 Hermes Agent，并把原生后端协议归一化为统一的运行时事件、可见性数据和 App Read Model。

## 仓库结构

```text
iota/
├── docs/              # 指南与设计文档
│   ├── guides/        # 架构、CLI、TUI、Agent、App、Engine 指南
│   └── requirement/   # 设计需求与约束文档
├── deployment/        # Redis / Docker / MinIO / Milvus 相关部署文件
├── iota-engine/       # 核心运行时库 (@iota/engine)
├── iota-cli/          # 命令行工具 (@iota/cli)
├── iota-agent/        # HTTP / WebSocket 服务 (@iota/agent)
└── iota-app/          # 前端应用 (Vite + React)
```

## 当前实现边界

- `iota-engine` 是唯一的协议适配层，后端协议代码只允许放在 `iota-engine/src/backend/`。
- `iota-agent` 负责 REST 查询接口和 WebSocket 会话流，不直接实现后端协议转换。
- `iota-app` 只应消费 Agent 的 snapshot / delta 接口，不应直接依赖原生 backend event schema。
- 后端认证、模型、endpoint 统一走 Redis distributed config；不再使用 backend 本地 `.env` 文件作为正式配置入口。

## 已实现的主路径

- CLI 通过 `iota-engine` 直接执行 prompt，支持 `run`、`interactive`、`status`、`switch`、`config`、`logs`、`trace`、`visibility`。
- Agent 提供 session、execution、logs、config、visibility、app snapshot 与 WebSocket `/api/v1/stream`。
- App 通过 HTTP + WebSocket 读取会话快照、执行快照和增量更新。
- Engine 已实现 memory injection、workspace snapshot / delta、visibility store、trace spans、approval policy、audit、Redis config。

## 当前已知不完备点

- App 侧虽然展示 approval 卡片，但当前 Agent / WebSocket 协议没有独立的“前端提交审批决定”闭环接口；当前审批主路径仍以 CLI `CliApprovalHook` 或 Engine 内部 hook 为主。
- WebSocket 已支持 `subscribe_app_session`、`subscribe_visibility`、`execute`、`interrupt`，但右上角架构图里不应把 approval request / decision 画成 App 与 Agent 间独立的确定性双向 WS API，除非后续代码真正补齐该协议。
- `visibility`、`trace`、`app snapshot`、`replay` 已部分实现，但文档和部分 README 仍存在端口、接口、覆盖范围不一致的问题。
- `iota-app/README.md` 仍是 Vite 模板，未反映真实产品结构。

## 快速开始

### 1. 启动基础设施

开发环境至少需要 Redis：

```bash
cd deployment/scripts
bash start-storage.sh
redis-cli ping
```

### 2. 安装依赖并构建

```bash
cd iota-engine && bun install && bun run build
cd ../iota-cli && bun install && bun run build
cd ../iota-agent && bun install
cd ../iota-app && bun install
```

### 3. 配置后端

后端配置统一写入 Redis：

```bash
iota config set env.ANTHROPIC_AUTH_TOKEN "<redacted>" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_MODEL "MiniMax-M2.7" --scope backend --scope-id claude-code

iota config set env.OPENAI_MODEL "gpt-5.5" --scope backend --scope-id codex

iota config set env.GEMINI_MODEL "auto-gemini-3" --scope backend --scope-id gemini

iota config set env.HERMES_API_KEY "<redacted>" --scope backend --scope-id hermes
iota config set env.HERMES_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id hermes
iota config set env.HERMES_MODEL "MiniMax-M2.7" --scope backend --scope-id hermes
iota config set env.HERMES_PROVIDER "minimax-cn" --scope backend --scope-id hermes
```

说明：

- Claude Code 和 Hermes 使用 Redis 中的 provider / model / credential。
- Codex 当前验证基线是本机 Codex ChatGPT 登录态加 Redis `env.OPENAI_MODEL`。
- Gemini 当前验证基线是本机 Gemini OAuth 登录态加 Redis `env.GEMINI_MODEL`。
- 不要把后端密钥写入仓库文件或示例 `.env`。

### 4. 运行 CLI

```bash
cd iota-cli
node dist/index.js run "What is 2+2?"
```

### 5. 启动 Agent 和 App

```bash
cd iota-agent
bun run dev

cd ../iota-app
bun run dev
```

- Agent 默认端口：`9666`
- App 默认端口：`9888`

## 后端验证规则

后端验证不能停在 `which <executable>`、可执行发现或 `iota status`。每次切换 Claude Code、Codex、Gemini 或 Hermes 后，都必须至少执行一次真实 traced request：

```bash
cd iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

Hermes 额外要求：

```bash
hermes config show
```

如果看到死掉的 `model.provider: custom` 或指向本地未运行网关的 `model.base_url`，必须判定为无效配置。

## 开发命令

在变更过的包目录内执行：

- `bun run build`
- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run format`

## 文档入口

- [文档总览](docs/guides/README.md)
- [架构总览](docs/guides/00-architecture-overview.md)
- [CLI 指南](docs/guides/01-cli-guide.md)
- [TUI 指南](docs/guides/02-tui-guide.md)
- [Agent 指南](docs/guides/03-agent-guide.md)
- [App 指南](docs/guides/04-app-guide.md)
- [Engine 指南](docs/guides/05-engine-guide.md)
- [Engine 设计](docs/requirement/4.iota_engine_design_0425.md)
- [App 设计](docs/requirement/5.iota_app_design.md)
- [部署说明](deployment/README.md)

