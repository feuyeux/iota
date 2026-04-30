# 后端初始化与环境配置

**版本:** 1.0  
**最后更新:** 2026-04-30

本文档是 iota **全部 5 个后端**的初始化配置唯一参考。其他指南中的后端配置操作均引用此处。

---

## 1. 前置条件

### 1.1 启动 Redis

所有后端都依赖 Redis 存储凭证、模型、endpoint 等分布式配置：

```bash
cd deployment/scripts && bash start-storage.sh
```

> 完整模式（Redis + MinIO + Milvus）和高可用模式见 [10-deployment.md](./10-deployment.md)。

### 1.2 构建各包

```bash
cd iota-engine && bun install && bun run build
cd ../iota-cli  && bun install && bun run build
cd ../iota-agent && bun install && bun run build
cd ../iota-app   && bun install && bun run build
```

---

## 2. 后端安装

| Backend | 版本 | 安装命令 | 平台 |
|---------|------|----------|------|
| Claude Code | 2.1.x | `npm i -g @anthropic-ai/claude-code` | 全平台 |
| Codex | 0.125.x | `npm i -g @openai/codex` | 全平台 |
| Gemini CLI | 0.39.x | `npm i -g @google/gemini-cli` | 全平台 |
| Hermes | latest | 见下方安装脚本 | Linux/macOS/WSL2 |
| OpenCode | latest | 见下方安装方式 | 全平台 |

### Hermes 安装

```bash
# Linux / macOS / WSL2
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc   # 或 source ~/.zshrc

# 配置向导
hermes setup

# 更新
hermes update
```

> ⚠️ Windows 不支持原生安装，必须在 WSL2 中运行。

### OpenCode 安装

```bash
# 安装脚本（macOS / Linux）
curl -fsSL https://opencode.ai/install | bash

# 或 npm 全局安装（全平台）
npm i -g opencode-ai@latest

# 或 Homebrew（macOS / Linux）
brew install anomalyco/tap/opencode

# Windows: choco install opencode 或 scoop install opencode

# 更新
opencode upgrade
```

发现已安装后端：

```bash
bash deployment/scripts/ensure-backends.sh --check-only
```

---

## 3. 后端登录与账号切换

**安装完成后、写入 Redis 配置之前**，必须为每个要使用的后端完成登录或账号切换。iota 在运行时检测到 `BACKEND_AUTH_REQUIRED`（401/403、`Authentication not implemented`、token 过期）会立即终止子进程并打印中文 Hint，但前提是凭证至少已经存在；如果完全未登录，运行期提示只能告诉你「请先登录」，无法替代本节操作。

> iota 不会代你执行交互式登录。下列命令都需要在终端里手动跑一次，按提示完成 OAuth 跳转或粘贴 API Key。

### 3.1 是否需要登录

| Backend | 登录所需 | 命令 | 何时需要切换账号 |
|---------|----------|------|------------------|
| Claude Code | OAuth 或 API Key | `claude login` / `claude /login` | 切换 Anthropic 账号、切换组织、Token 过期 |
| Codex | OAuth 或 API Key | `codex login` | 切换 OpenAI 账号、配额耗尽换号、轮换 Key |
| Gemini CLI | OAuth 或 API Key | `gemini auth login` | 切换 Google 账号、`MODEL_CAPACITY_EXHAUSTED` 频繁出现需换号 |
| Hermes | API Key（写到 `hermes config`） | `hermes setup` 或 `hermes config edit` | 切换 provider / model / base_url |
| OpenCode | OAuth 或多 provider 凭证 | `opencode auth login` | 切换 GitHub Copilot / Anthropic / OpenAI / 自部署 provider |

### 3.2 操作步骤（每个要用的后端都要做一次）

```bash
# Claude Code —— 弹浏览器走 OAuth；或先 export ANTHROPIC_API_KEY 后再登录
claude login
claude /status        # 验证账号 / 计划 / 配额

# Codex —— OAuth 或 API Key
codex login
codex --version       # 简单连通性检查

# Gemini CLI —— OAuth；不想 OAuth 就 export GEMINI_API_KEY
gemini auth login
gemini auth list      # 确认当前账号

# Hermes —— 交互式向导，写 ~/.config/hermes/config.toml
hermes setup
hermes config show    # 检查 model.provider / model.base_url

# OpenCode —— 选择 provider 后登录
opencode auth login   # 选择 anthropic / github-copilot / openai / 自部署
opencode auth list    # 确认凭证存在
```

### 3.3 账号切换

配额耗尽（`BACKEND_QUOTA_EXCEEDED`）或换组织时，**先**在这里切完，再回到运行时：

```bash
# Claude / Codex / Gemini：登出再登入即可切号
claude logout && claude login
codex logout && codex login
gemini auth logout && gemini auth login

# OpenCode：每个 provider 单独管理
opencode auth logout    # 选要登出的 provider
opencode auth login     # 重新选 provider 并登录

# Hermes：直接编辑配置或重跑向导
hermes config edit
# 或
hermes setup
```

切换后用 `claude /status` / `codex --version` / `gemini auth list` / `opencode auth list` / `hermes config show` 当场确认；**不要**等到第 7 节 traced request 才发现还在旧号上。

### 3.4 逐后端登录成功校验

运行后端自带的检查命令，确认凭证能走通。这些命令不经过 iota，目的是隔离后端 CLI 本身的登录问题与 iota 配置问题。

```bash
# Claude Code——账号、计划、剩余额度一次列出
claude /status
# 预期：显示 Account / Plan / Usage；出现 "Not logged in" 就重跑 claude login

# Codex——主动发一条最小请求
printf 'reply with: pong' | codex exec -
# 预期：输出 pong；出现 401/Unauthorized 或要求登录 → 重跑 codex login

# Gemini CLI——验证账号与一次 prompt
gemini auth list
echo "reply with: pong" | gemini --output-format text --skip-trust
# 预期：auth list 列出当前账号，请求返回 pong；出现 RESOURCE_EXHAUSTED / 429 说明额度耗尽，需换号

# Hermes——检查配置 + 最小 ACP 握手
hermes config show
hermes status   # 如果子命令不存在则跳过
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.1.0"}}\n' | hermes acp
# 预期：返回一行含 protocolVersion 的 JSON-RPC 响应即可

# OpenCode——凭证列表 + 最小 ACP 握手
opencode auth list
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.1.0","clientCapabilities":{}}}\n' | opencode acp
# 预期：auth list 至少一个 provider，ACP 返回含 protocolVersion 的响应
```

> Hermes / OpenCode 的 ACP 进程是长连接。上面的最小握手验证只发一条 `initialize`，拿到响应后手动 Ctrl+C 退出即可。

### 3.5 验收清单（进入第 4 节之前必须全绿）

- [ ] 计划要用的每个后端都已成功登录 / 写入 API Key
- [ ] `bash deployment/scripts/ensure-backends.sh --check-only` 5 行均为 `ok`
- [ ] Hermes 的 `model.provider` 不是死配置 `custom`，`model.base_url` 不是未运行的本地网关
- [ ] OpenCode `opencode auth list` 至少有一个目标 provider 的凭证
- [ ] 当前账号 / 组织就是你要用的那一个（已确认配额未耗尽）

任何一项不通过就停下来在本节修，不要继续往下走。

---

## 4. 后端 Redis 配置

Backend 凭证、模型、endpoint 通过 Redis 分布式配置管理，**不要**使用本地 `.env` 文件。本节只配置 iota 自己读取的环境变量；后端 CLI 自身的登录态由第 3 节负责。

### 4.1 Claude Code

```bash
iota config set env.ANTHROPIC_AUTH_TOKEN "<redacted>" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_MODEL "MiniMax-M2.7" --scope backend --scope-id claude-code
```

### 4.2 Codex

```bash
iota config set env.OPENAI_MODEL "gpt-5.5" --scope backend --scope-id codex
```

### 4.3 Gemini CLI

```bash
iota config set env.GEMINI_MODEL "gemini-2.5-flash" --scope backend --scope-id gemini
```

> 不要用 `auto-gemini-3` / `gemini-3.x-pro-preview`：服务端长期 `MODEL_CAPACITY_EXHAUSTED`，会让请求卡在 429 重试循环。`gemini-2.5-flash` 是已验证可用的稳定型号；如需更强模型，先用 `gemini -m <model> -p ping` 当场确认有容量再写入 Redis。

### 4.4 Hermes

```bash
iota config set env.HERMES_API_KEY "<redacted>" --scope backend --scope-id hermes
iota config set env.HERMES_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id hermes
iota config set env.HERMES_MODEL "MiniMax-M2.7" --scope backend --scope-id hermes
iota config set env.HERMES_PROVIDER "minimax-cn" --scope backend --scope-id hermes
```

### 4.5 OpenCode

```bash
iota config set env.OPENCODE_MODEL "MiniMax-M2.7" --scope backend --scope-id opencode
```

> ⚠️ OpenCode ACP 会读 `~/.config/opencode/opencode.json` 里的 `model` 字段作为默认会话模型，它**不读** `OPENCODE_MODEL` 环境变量，`opencode acp` 也不接受 `-m` 标志。如果该字段设为一个未运行的 provider（常见默认 `ollama/gemma4`），iota 的 `session/new` 会返回但 prompt 永远不响应。检查并修改：
>
> ```powershell
> $cfg = "$env:USERPROFILE\.config\opencode\opencode.json"
> $j = Get-Content $cfg -Raw | ConvertFrom-Json
> $j.model = "minimax-cn-coding-plan/MiniMax-M2.7"   # 换为你实际认证过的 provider/model
> ($j | ConvertTo-Json -Depth 50) | Set-Content $cfg -Encoding UTF8
> ```
>
> Linux/macOS 同文件路径：`~/.config/opencode/opencode.json`。可用的 model id 在 `opencode auth list` 里看 provider，与 `opencode models <provider>` 联动查询。

---

## 5. ACP 协议切换

Claude Code、Codex、Gemini 默认使用 legacy native 协议。如需切换到 ACP 模式：

```bash
iota config set protocol acp --scope backend --scope-id claude-code
iota config set protocol acp --scope backend --scope-id codex
iota config set protocol acp --scope backend --scope-id gemini
```

Hermes 和 OpenCode 是 ACP-only backend，无需手动切换。

---

## 6. 配置查询

### CLI 查询

```bash
# 查看单个 backend 全部配置
iota config get --scope backend --scope-id claude-code

# 查看特定配置项
iota config get env.ANTHROPIC_MODEL --scope backend --scope-id claude-code

# 列出全局配置
iota config list --scope global
```

### Redis 直查

```bash
docker exec iota-redis redis-cli HGETALL iota:config:backend:claude-code
docker exec iota-redis redis-cli HGETALL iota:config:backend:hermes
```

---

## 7. 验证

> 验证不能停在可执行文件发现或 `iota status`。切换后端后必须跑一次真实 traced request。
>
> 如果这里出现 `BACKEND_AUTH_REQUIRED` / `BACKEND_QUOTA_EXCEEDED`，说明第 3 节没做透 —— 回去重新登录或换号，不要在 Redis 配置里硬塞 Key。

### 7.1 逐后端验证

```bash
cd iota-cli
node dist/index.js run --backend claude-code --trace "ping"
node dist/index.js run --backend codex --trace "ping"
node dist/index.js run --backend gemini --trace "ping"
node dist/index.js run --backend hermes --trace "ping"
node dist/index.js run --backend opencode --trace "ping"
```

### 7.2 Hermes 特殊检查

Hermes 切换后需额外验证：

```bash
hermes config show
```

- 拒绝死配置 `model.provider: custom`
- 如果 `model.base_url` 指向本地网关，必须确认网关正在运行

### 7.3 Windows 开发注意

- Hermes 必须在 WSL2 中运行
- Redis CLI 使用 `docker exec iota-redis redis-cli`（Windows 无本地 `redis-cli`）

---

## 8. 清理与重置

```bash
# 清除特定 backend 配置
docker exec iota-redis redis-cli DEL iota:config:backend:hermes

# 清除所有 memory 数据
docker exec iota-redis sh -c 'redis-cli --scan --pattern "iota:memory:*" | xargs -r redis-cli DEL'
```

更多清理操作见 [10-deployment.md](./10-deployment.md)。
