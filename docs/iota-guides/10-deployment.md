# 部署与运维

**版本:** 3.0  
**最后更新:** 2026-04-30

## 1. 部署模式

Iota 基础设施使用 Docker Compose **profile** 实现参数化启动，按需选择服务组合：

| 模式 | 启动命令 | 服务 | 适用场景 |
|------|----------|------|----------|
| **最小启动** | `bash start-storage.sh` | Redis | 本地开发、CLI 调试、单人使用 |
| **完整启动** | `bash start-storage.sh --full` | Redis + MinIO + Milvus | 生产部署、向量记忆、快照持久化 |
| **高可用** | `bash start-storage.sh --full --ha` | 上述 + Redis Sentinel | 多实例 Agent、故障自动切换 |

### 服务组件说明

| 服务 | 容器名 | 默认端口 | 用途 | 必需？ |
|------|--------|----------|------|--------|
| Redis | `iota-redis` | 6379 | 事件流、锁、审计、分布式配置 | ✅ 所有模式必需 |
| Redis Sentinel | `iota-redis-sentinel` | 26379 | Redis 高可用自动故障转移 | 仅 `--ha` |
| MinIO | `iota-minio` | 9002 (API), 9003 (Console) | 快照大对象存储 | 仅 `--full` |
| Milvus | `iota-milvus` | 19530 | 向量记忆搜索 | 仅 `--full` |

---

## 2. 快速启动

### 最小启动（开发推荐）

```bash
cd deployment/scripts
bash start-storage.sh
```

仅启动 Redis，足够支撑 Engine、CLI、Agent 的核心功能（事件流、配置、审计）。不支持向量记忆和对象快照。

### 完整启动（生产推荐）

```bash
cd deployment/scripts
bash start-storage.sh --full
```

启动 Redis + MinIO + Milvus，支持全部功能。

### 停止

```bash
bash deployment/scripts/stop-storage.sh          # 保留数据
bash deployment/scripts/stop-storage.sh --purge  # 清除所有数据卷
```

### 健康检查

```bash
bash deployment/scripts/health-check.sh
```

---

## 3. 环境变量

所有端口和凭证可通过环境变量覆盖，无需修改 `docker-compose.yml`：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `IOTA_REDIS_PORT` | 6379 | Redis 映射端口 |
| `IOTA_SENTINEL_PORT` | 26379 | Sentinel 映射端口 |
| `IOTA_MINIO_API_PORT` | 9002 | MinIO API 端口 |
| `IOTA_MINIO_CONSOLE_PORT` | 9003 | MinIO 管理界面端口 |
| `IOTA_MILVUS_PORT` | 19530 | Milvus gRPC 端口 |
| `IOTA_MINIO_USER` | iota | MinIO root 用户名 |
| `IOTA_MINIO_PASSWORD` | iotasecret | MinIO root 密码 |

示例：自定义端口启动

```bash
IOTA_REDIS_PORT=16379 IOTA_MINIO_API_PORT=19002 bash start-storage.sh --full
```

---

## 4. 配置文件对应

Engine 通过 `iota.config.yaml` 中的 `storage` 段连接基础设施。不同模式对应不同配置：

### 最小模式

```yaml
engine:
  mode: development

storage:
  development:
    redis:
      host: localhost
      port: 6379
      streamPrefix: "iota:events"
```

### 完整模式

```yaml
engine:
  mode: production

storage:
  production:
    redis:
      host: localhost
      port: 6379
      streamPrefix: "iota:events"
    milvus:
      address: "localhost:19530"
      collectionName: "iota_memories"
      dimension: 1024
    minio:
      endPoint: "localhost"
      port: 9002
      useSSL: false
      accessKey: "iota"
      secretKey: "iotasecret"
      bucket: "iota-snapshots"
```

### 高可用模式

```yaml
storage:
  production:
    redis:
      sentinels:
        - host: localhost
          port: 26379
      masterName: "mymaster"
      streamPrefix: "iota:events"
```

---

## 5. 后端安装与验证

后端安装命令、Redis 配置、ACP 协议切换和 traced request 验证的完整参考见 [00-setup.md](./00-setup.md)。

发现已安装后端：

```bash
bash deployment/scripts/ensure-backends.sh --check-only
```

---

## 6. Redis 分布式配置

共享部署中把 backend 凭证存 Redis，不写本地 `.env` 文件。全部 5 后端的 `iota config set` 命令和查询方式见 [00-setup.md](./00-setup.md#3-后端-redis-配置)。

---

## 7. 构建流程

```bash
cd iota-engine && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-cli && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-agent && bun install && bun run build && bun run typecheck && bun run test
cd ../iota-app && bun install && bun run build
```

---

## 8. Docker 部署 Agent

### 构建镜像

```bash
docker build -t iota-agent:latest -f deployment/docker/Dockerfile.agent .
```

### 运行

```bash
# 最小模式：连接宿主机 Redis
docker run -p 3000:3000 \
  -e IOTA_MODE=development \
  -e IOTA_DEFAULT_BACKEND=claude-code \
  --network iota-network \
  iota-agent:latest

# 完整模式：连接全部存储
docker run -p 3000:3000 \
  -e IOTA_MODE=production \
  -e IOTA_DEFAULT_BACKEND=claude-code \
  --network iota-network \
  iota-agent:latest
```

---

## 9. 多实例部署

Agent 可多实例运行，共享 Redis：

- Redis pub/sub 频道: `iota:execution:events`, `iota:session:updates`, `iota:config:changes`
- 各实例桥接为 WebSocket `pubsub_event`
- App 通过 snapshot resync 保持一致
- 建议启用 `--ha` 模式确保 Redis 高可用

---

## 10. 故障速查表

| 现象 | 根因 | 修复 |
|------|------|------|
| `Executable not found: hermes` | 未安装或不在 PATH | WSL2 中安装 |
| `redis-cli` 找不到 (Windows) | 未安装本地 Redis | 用 `docker exec iota-redis redis-cli` |
| `Cannot find module` | 未构建 | `bun run build` |
| 401 认证失败 | Redis 配置错误 | `iota config get` 核对 |
| `iota-milvus` 启动慢 | 首次拉取+初始化 | 等待 2-3 分钟，用 `health-check.sh` 确认 |
| Milvus 连接拒绝 | 未启动 full 模式 | `bash start-storage.sh --full` |
| Sentinel 不断重启 | 无主节点 | 忽略（开发环境不需要 HA） |
| MinIO bucket 不存在 | 启动脚本被中断 | `docker exec iota-minio mc mb local/iota-snapshots --ignore-existing` |

---

## 11. 清理与重置

```bash
# 清除所有 memory 数据
docker exec iota-redis sh -c 'redis-cli --scan --pattern "iota:memory:*" | xargs -r redis-cli DEL'

# 清除特定 backend 配置
docker exec iota-redis redis-cli DEL iota:config:backend:hermes

# 完全重置（删除所有数据卷）
bash deployment/scripts/stop-storage.sh --purge
```

---

## 12. Windows 开发注意

- Hermes 必须在 WSL2 中运行
- Redis CLI 用 `docker exec iota-redis redis-cli`
- 端口检查: `Get-NetTCPConnection -LocalPort 6379`
- Docker Desktop 需启用 WSL2 backend
- 路径使用正斜杠或双反斜杠
