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

<https://zhuanlan.zhihu.com/p/2032843921303319581>

<p align="center">
  <img src="images/iota-memory.png" alt="iota Memory System" width="700" />
</p>

`DialogueMemory`（最近 50 轮）→ `WorkingMemory`（活跃文件）→ `MemoryExtractor` → `MemoryStorage`（Redis + 可选 Milvus 向量）

Embedding 降级链：`HashEmbedding` → `Ollama` → `OpenAI`

### Skill & MCP 执行

<https://zhuanlan.zhihu.com/p/2032653897177768268>

<p align="center">
  <img src="images/iota-skill-mcp-fn.png" alt="iota Skill MCP Function Execution" width="700" />
</p>

`SkillRunner` → `McpRouter` → 配置的 MCP server。函数源码位于 `iota-skill/pet-generator/iota-fun/`，编译产物缓存在 `~/.iota/iota-fun`。

#### 生成宠物

![gen_pet](images/gen_pet.png)

## 快速开始

完整指南：[docs/iota-guides/README.md](docs/iota-guides/README.md)

| 主题 | 链接 |
|---|---|
| 环境配置 | [00-setup](docs/iota-guides/00-setup.md) |
| 架构概览 | [01-architecture](docs/iota-guides/01-architecture.md) |
| Engine | [02-engine](docs/iota-guides/02-engine.md) |
| Backend 适配器 | [03-backend](docs/iota-guides/03-backend.md) |
| CLI / TUI | [04-cli-tui](docs/iota-guides/04-cli-tui.md) |
| Agent 服务 | [05-agent](docs/iota-guides/05-agent.md) |
| App 前端 | [06-app](docs/iota-guides/06-app.md) |
| Visibility & Trace | [07-visibility-trace](docs/iota-guides/07-visibility-trace.md) |
| Memory | [08-memory](docs/iota-guides/08-memory.md) |
| Skill & iota-fun | [09-skill-fun](docs/iota-guides/09-skill-fun.md) |
| 部署 | [10-deployment](docs/iota-guides/10-deployment.md) |

### 1. CLI

```bash
cd iota-cli
node dist/index.js run --backend claude-code "What is 2+2?"
node dist/index.js run --backend codex "What is 2+2?"
node dist/index.js run --backend gemini "What is 2+2?"
node dist/index.js run --backend hermes "What is 2+2?"
node dist/index.js run --backend opencode "What is 2+2?"
```

### 2. TUI

```bash
$ iota i

      o
   .--|--.
o-- IOTA --o
   '--|--'
      o
iota TUI session e1e7b3ee
Backend: claude-code
Type "help" for commands, "exit" to quit.

claude-code> 天王盖地虎
宝塔镇河妖。😊

这是一个经典的中文暗号，来自梁羽生的武侠小说《七剑下天山》。看来您是在测试我的中文反应能力？

如果您有任何实际的技术问题或需要帮助，请随时告诉我！

claude-code> switch codex
Switched to codex

codex> 江山父老能容我
卷土重来未可知。

codex> switch opencode
Switched to opencode

opencode> 采菊东篱下
悠然见南山。

opencode> switch hermes
Switched to hermes

hermes> 挖掘机哪家强
山东找蓝翔！🏗️

不过说真的，您还有什么技术问题需要我帮忙吗？比如 iota 项目相关的问题？

hermes> switch gemini
Switched to gemini

gemini> 宫廷玉液酒
> 一百八一杯。🥂

看起来你今天心情不错！还有什么关于 iota-cli 的技术问题需要我帮忙吗？
gemini> 
```

> **原则**：密钥不入仓库；详细分项配置见 [00-setup.md §4](docs/iota-guides/00-setup.md)。

### 3. APP

Agent（Fastify HTTP / WebSocket，默认端口 `9666`）：

```powershell
cd iota-agent ; bun run build ; bun run start
```

Vite 前端（默认端口 `9888`，已配置 `/api` 与 `/ws` 代理到 `localhost:9666`）：

<http://localhost:9888>

```bash
cd iota-app ; bun run dev
```

#### claude code

![app_claudecode](images/app_claudecode.png)

#### codex cli

![app_codex](images/app_codex.png)

#### gemini cli

![app_gemini](images/app_gemini.png)

#### opencode

![app_opencode](images/app_opencode.png)

#### hermes agent

![app_hermes](images/app_hermes.png)
