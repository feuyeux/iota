# 部署与环境排错

**版本:** 2.1  
**最后更新:** 2026-04-30

## 1. 一分钟自检清单

```bash
# 1) 基础设施
docker ps --format "{{.Names}} {{.Status}}" | grep -E "iota-redis|iota-milvus"

# 2) 后端可执行文件
bash deployment/scripts/ensure-backends.sh --check-only

# 3) Backend 健康
cd iota-cli && node dist/index.js status

# 4) 真实 traced request
node dist/index.js run --backend <name> --trace "ping"
```

---

## 2. 基础设施

### 启动

```bash
cd deployment/scripts
bash start-storage.sh
```

### 预期容器

| 容器名 | 端口 | 必需 |
|--------|------|------|
| `iota-redis` | 6379 | ✅ |
| `iota-milvus` | 19530 | 可选（向量搜索） |
| `iota-minio` | host 9002→container 9000, host 9003→container 9001 | 可选（对象存储） |
| `iota-redis-sentinel` | 26379 | 可选 |

### 验证 Redis

```bash
# Linux/macOS
redis-cli ping

# Windows (通过 Docker)
docker exec iota-redis redis-cli ping
docker exec iota-redis redis-cli --scan --pattern "iota:*" | head -20
```

---

## 3. 后端安装

### 发现

```bash
bash deployment/scripts/ensure-backends.sh --check-only
```

### 安装命令

| Backend | 安装 | 平台 |
|---------|------|------|
| Claude Code | `npm i -g @anthropic-ai/claude-code` | 全平台 |
| Codex | `npm i -g @openai/codex` | 全平台 |
| Gemini CLI | `npm i -g @google/gemini-cli` | 全平台 |
| Hermes | `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh \| bash` | Linux/macOS/WSL2 |
| OpenCode | 按官方说明安装 | 依上游支持 |

### Hermes 注意事项

- **不在 PyPI**：`pip install hermes-agent` 会失败
- **不支持 Windows 原生**：必须在 WSL2 中运行
- 安装后验证: `hermes config show` + `hermes --version`

---

## 4. Redis 配置

共享部署中建议把 backend 凭证存 Redis 分布式配置，不写 `.env` 文件。Engine 实际配置解析是 layered config + Redis overlay：

```bash
# Claude Code
iota config set env.ANTHROPIC_AUTH_TOKEN "<redacted>" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_MODEL "MiniMax-M2.7" --scope backend --scope-id claude-code

# Codex
iota config set env.OPENAI_MODEL "gpt-5.5" --scope backend --scope-id codex

# Gemini
iota config set env.GEMINI_MODEL "auto-gemini-3" --scope backend --scope-id gemini

# Hermes
iota config set env.HERMES_API_KEY "<redacted>" --scope backend --scope-id hermes
iota config set env.HERMES_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id hermes
iota config set env.HERMES_MODEL "MiniMax-M2.7" --scope backend --scope-id hermes
iota config set env.HERMES_PROVIDER "minimax-cn" --scope backend --scope-id hermes

# ACP 协议开关
iota config set protocol acp --scope backend --scope-id gemini
iota config set protocol acp --scope backend --scope-id claude-code
```

直接查 Redis:

```bash
docker exec iota-redis redis-cli HGETALL iota:config:backend:claude-code
```

---

## 5. 真实运行验证

> 验证不能停在 executable discovery 或 `iota status`。必须跑真实 traced request。

```bash
cd iota-cli
node dist/index.js run --backend claude-code --trace "ping"
node dist/index.js run --backend codex --trace "ping"
node dist/index.js run --backend gemini --trace "ping"
node dist/index.js run --backend hermes --trace "ping"   # 仅 WSL2/Linux/macOS
node dist/index.js run --backend opencode --trace "ping"
```

---

## 6. 构建流程

```bash
cd iota-engine && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-cli && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-agent && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-app && bun install && bun run build
```

---

## 7. 故障速查表

| 现象 | 根因 | 修复 |
|------|------|------|
| `Executable not found: hermes` | Hermes 没装/不在 PATH | WSL2 安装 |
| `pip install hermes-agent` 失败 | PyPI 没有此包 | 用 curl 安装脚本 |
| `redis-cli` 找不到 (Windows) | 未安装 | 用 `docker exec iota-redis redis-cli` |
| `Cannot find module` | 未构建 | `bun run build` |
| 401 认证失败 | Redis 配置错误 | `iota config get` 核对 |
| `provider: custom` 失败 | 本地 gateway 未运行 | 改为有效 provider |
| `iota-redis-sentinel Restarting` | 不影响主流程 | 忽略 |

---

## 8. 清理与重置

```bash
# 清除所有 memory
docker exec iota-redis sh -c 'redis-cli --scan --pattern "iota:memory:*" | xargs -r redis-cli DEL'

# 清除特定 backend 配置
docker exec iota-redis redis-cli DEL iota:config:backend:hermes

# 停止存储
cd deployment/scripts && bash stop-storage.sh
```

---

## 9. 多实例部署

Agent 可多实例运行，共享 Redis：

- Redis pub/sub: `iota:execution:events`, `iota:session:updates`, `iota:config:changes`
- 各实例桥接为 WS `pubsub_event`
- App 通过 snapshot resync 保持一致

---

## 10. Windows 开发注意

- Hermes 必须在 WSL2 中运行
- Redis CLI 用 `docker exec`
- 端口检查: `Get-NetTCPConnection -LocalPort 6379`
- 路径使用正斜杠或双反斜杠
