# Iota 初始化与环境排错指南

**版本:** 1.0
**最后更新:** 2026 年 4 月

> 把分散在 `README.md`、`docs/guides/01-cli-guide.md`、`docs/guides/05-engine-guide.md`、`deployment/scripts/ensure-backends.sh` 各处的「装环境 / 排错」描述合并到这一篇。出问题时**只需打开这一篇**就能定位全栈：基础设施、可执行文件、Redis 配置、运行验证。

---

## 0. 一分钟自检清单

按顺序跑下面 4 条命令，任何一步失败就跳到对应章节。

```bash
# 1) 基础设施
docker ps --format "{{.Names}} {{.Status}}" | grep -E "iota-redis|iota-milvus"

# 2) 后端可执行文件
bash deployment/scripts/ensure-backends.sh --check-only

# 3) Backend 健康
cd iota-cli && node dist/index.js status

# 4) 真实 traced request（不能跳过！）
node dist/index.js run --backend <name> --trace "ping"
```

| 步骤 | 失败章节 |
|------|----------|
| 1 | [§1 基础设施](#1-基础设施redis--milvus--minio) |
| 2 | [§2 后端可执行文件](#2-后端可执行文件) |
| 3 | [§3 Redis 中的 Backend 配置](#3-redis-中的-backend-配置) |
| 4 | [§4 真实运行验证](#4-真实运行验证) |

---

## 1. 基础设施（Redis / MinIO；向量后端按需启用）

### 1.1 启动

```bash
cd deployment/scripts
bash start-storage.sh
```

预期容器：

| 容器名 | 状态 | 端口 |
|--------|------|------|
| `iota-redis` | healthy | 6379 |
| `iota-milvus` | healthy | 19530 |
| `iota-minio` | healthy | 9000 / 9001 |
| `iota-milvus-etcd` | healthy | — |
| `iota-milvus-minio` | healthy | — |
| `iota-redis-sentinel` | 可选 | 26379 |

### 1.2 验证 Redis

Windows 原生 PowerShell 没有 `redis-cli`，**用 docker exec 进容器**：

```bash
docker exec iota-redis redis-cli ping            # 预期 PONG
docker exec iota-redis redis-cli --scan --pattern "iota:*" | head -20
```

### 1.3 常见问题

- `iota-redis-sentinel Restarting`：哨兵不影响主 Redis 工作；只在使用 Sentinel 模式时才需要排查 `deployment/docker/redis-sentinel.conf`。
- 端口被占：先检查 `Get-NetTCPConnection -LocalPort 6379`（PowerShell）或 `lsof -i :6379`（Linux/macOS）。

---

## 2. 后端可执行文件

### 2.1 检测

```bash
bash deployment/scripts/ensure-backends.sh --check-only
```

`ensure-backends.sh` 已经是 guides 体系内**唯一约定的**后端发现入口；不要再在各组件文档里复制 `which` / `Get-Command` / `where` 命令。

### 2.2 安装

| Backend | 来源 | 安装命令 | 平台限制 |
|---------|------|----------|----------|
| Claude Code | npm `@anthropic-ai/claude-code` | `npm i -g @anthropic-ai/claude-code` | 全平台 |
| Codex | npm `@openai/codex` | `npm i -g @openai/codex` | 全平台 |
| Gemini CLI | npm `@google/gemini-cli` | `npm i -g @google/gemini-cli` | 全平台 |
| **Hermes** | **GitHub `NousResearch/hermes-agent`** | `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh \| bash` | **Linux / macOS / WSL2 only** |
| OpenCode | OpenCode CLI | 按 OpenCode 官方安装说明安装，并确认 `opencode acp` 可运行 | 依上游支持 |

#### 2.2.1 Hermes 重要事实（容易踩坑）

- **不在 PyPI**：`pip install hermes-agent`、`pip install hermes-acp`、`uv tool install hermes-agent` 都会失败（`No matching distribution found`）。仓库历史上的安装提示是错的，已在 `ensure-backends.sh`、`deployment/docker/Dockerfile`、`README.md`、`docs/guides/README.md` 修正。
- **不支持 Windows 原生**：上游 README 明确写 *Native Windows is not supported. Please install WSL2*。在 PowerShell / cmd 里**不可能**运行 `hermes`。
- 上游来源：<https://github.com/NousResearch/hermes-agent>，安装脚本 `scripts/install.sh` 内部调用 `uv` 创建虚拟环境并 `uv pip install -e ".[all]"`，最终在 `~/.local/bin/hermes` 建立软链。
- 安装完后 `hermes config show` 应能输出 model / provider / api_key 信息。

### 2.3 在 Windows 上跑 Hermes 的两种合规方案

1. **WSL2 内安装并运行**：`wsl --install` → 在 WSL Ubuntu 中跑上面的 curl 安装脚本 → 在 WSL 里调 `node dist/index.js`。Iota 主体（Engine / CLI / Agent / App）跨平台能跑，只是 Hermes 子进程必须在 Linux 侧。
2. **跳过 Hermes**：实验只验证 Claude Code / Codex / Gemini CLI 三个后端。需要在测试脚本里显式 skip 涉及 Hermes 的轮次。

---

## 3. Redis 中的 Backend 配置

Backend 凭证、模型、endpoint **不写本地 `.env` 文件**，全部走 Redis 分布式配置。

### 3.1 写入

```bash
iota config set env.ANTHROPIC_AUTH_TOKEN "<redacted>" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_BASE_URL  "https://api.minimaxi.com/anthropic" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_MODEL     "MiniMax-M2.7" --scope backend --scope-id claude-code

iota config set env.OPENAI_MODEL        "gpt-5.5" --scope backend --scope-id codex
iota config set env.GEMINI_MODEL        "auto-gemini-3" --scope backend --scope-id gemini

iota config set env.HERMES_API_KEY      "<redacted>" --scope backend --scope-id hermes
iota config set env.HERMES_BASE_URL     "https://api.minimaxi.com/anthropic" --scope backend --scope-id hermes
iota config set env.HERMES_MODEL        "MiniMax-M2.7" --scope backend --scope-id hermes
iota config set env.HERMES_PROVIDER     "minimax-cn" --scope backend --scope-id hermes

# ACP 双栈开关
iota config set protocol acp --scope backend --scope-id gemini       # Gemini 原生 ACP，需真实 gemini --acp 验证
iota config set protocol acp --scope backend --scope-id claude-code  # adapter-backed，需 adapter shim 可用
iota config set protocol acp --scope backend --scope-id codex        # adapter-backed，需 adapter shim 可用
iota config set protocol acp --scope backend --scope-id opencode     # OpenCode 原生 ACP，需真实 opencode acp 验证
```

### 3.2 直接查 Redis

```bash
docker exec iota-redis redis-cli HGETALL iota:config:backend:claude-code
docker exec iota-redis redis-cli HGETALL iota:config:backend:hermes
```

### 3.3 配置注意事项（取自 `05-engine-guide.md`）

- Hermes 与 Claude Code 共用 provider 值（如 `minimax-cn`），但用独立的 `HERMES_*` 键。Hermes adapter 已原地重构为复用 `AcpBackendAdapter`；配置生成逻辑位于 `hermes-config.ts`，没有新增 `hermes-acp.ts` 文件。
- Engine 在 `spawn hermes acp` 前会把 Redis 的值转成隔离运行时目录与进程 env，**不再**写临时 `.env` 文件；任何残留的 `iota-engine/claude.env` 或 `codex.env` 都属于历史产物，删掉即可。
- 拒绝下列 Hermes 配置（除非确认本地 gateway 真的在跑）：
  - `model.provider: custom`
  - `model.base_url: http://127.0.0.1:...`
- 不要把密钥提交到仓库；docs / 测试 / log / visibility / snapshot / replay 中的示例都必须脱敏。

---

## 4. 真实运行验证

### 4.1 规则（来自 AGENTS.md）

> 验证不能停在「executable 找到」或 `iota status` 健康。**必须**至少跑一次带 trace 的真实请求。

```bash
cd iota-cli
node dist/index.js run --backend claude-code --trace "ping"
node dist/index.js run --backend codex       --trace "ping"
node dist/index.js run --backend gemini      --trace "ping"
node dist/index.js run --backend hermes      --trace "ping"   # 仅 Linux/macOS/WSL2
node dist/index.js run --backend opencode    --trace "ping"   # 需 OpenCode ACP 可执行文件
```

只要其中任何一个返回非空 assistant 消息且 `trace` 段无红色错误，就视为该后端可用。切换 Gemini/Claude/Codex/OpenCode 到 ACP 后，也必须跑同样的 traced request；不能只依赖 `iota status` 或 executable discovery。

### 4.2 Hermes 额外检查

```bash
hermes config show       # 模型 / provider / api_key 概览
hermes --version         # 当前版本（实验记录基线 v0.8.0+）
```

---

## 5. 故障速查表

| 现象 | 根因 | 修复 |
|------|------|------|
| `iota status` 显示 `lastError: Executable not found: hermes` | Hermes 没装 / 不在当前 shell 的 PATH | §2.2 按平台安装；Windows 原生先转 WSL2 |
| `uv tool install hermes-agent` 报 `not found in registry` | 仓库旧文档误导，PyPI 没有这个包 | 改用 §2.2 的 curl 安装脚本 |
| `pip install hermes-agent` / `hermes-acp` 报 `No matching distribution` | 同上 | 同上 |
| `redis-cli` 找不到（PowerShell） | Windows 没装 redis-cli | 用 `docker exec iota-redis redis-cli ...` |
| `iota-redis-sentinel Restarting` | Sentinel 配置或网络问题 | 不影响主流程；如未启用 Sentinel 模式可忽略 |
| `iota config get` 返回空 | Redis 还没写过该 scope | §3.1 写入；或检查 `--scope` / `--scope-id` 拼写 |
| `node dist/index.js status` 报 `Cannot find module` | 没构建 | `cd iota-engine && bun run build`，再 `cd iota-cli && bun run build` |
| Trace 显示 `provider: custom` 但仍失败 | Hermes 指向不存在的本地 gateway | 改成有效 provider（如 `minimax-cn`）或启动本地 gateway |
| Codex / Claude / Gemini 返回 401 | Redis 中 token / model 配置错误 | §3.2 `HGETALL` 核对 |

---

## 6. 一次性重置

```bash
# 清掉所有 memory（实验前）
docker exec iota-redis sh -c 'redis-cli --scan --pattern "iota:memory:*" | xargs -r redis-cli DEL; redis-cli --scan --pattern "iota:memories:*" | xargs -r redis-cli DEL'

# 清掉某个 backend 的配置
docker exec iota-redis redis-cli DEL iota:config:backend:hermes

# 重建 Engine + CLI
cd iota-engine && bun install && bun run build && cd ..
cd iota-cli    && bun install && bun run build && cd ..
```

---

## 7. 相关文档

- 总入口：[README.md](../../README.md) §4 安装与设置
- 系统架构：[00-architecture-overview.md](./00-architecture-overview.md)
- CLI 命令清单：[01-cli-guide.md](./01-cli-guide.md)
- Engine 内部：[05-engine-guide.md](./05-engine-guide.md)
- Memory 子系统：[12-iota-memory.md](./12-iota-memory.md)
- 后端检测脚本：[deployment/scripts/ensure-backends.sh](../../deployment/scripts/ensure-backends.sh)
