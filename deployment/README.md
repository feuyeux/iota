# Iota Infrastructure Deployment

本目录包含 Iota 项目所有基础设施组件的统一部署配置。使用 Docker Compose **profile** 实现参数化启动。

## 部署模式

| 模式 | 命令 | 服务 | 适用场景 |
|------|------|------|----------|
| **最小** | `bash start-storage.sh` | Redis | 本地开发、CLI/Engine 调试 |
| **完整** | `bash start-storage.sh --full` | Redis + MinIO + Milvus | 生产部署、向量记忆 |
| **高可用** | `bash start-storage.sh --full --ha` | 全部 + Sentinel | 多实例、故障自动切换 |

## 服务组件

| 服务 | 容器名 | 默认端口 | 用途 | Profile |
|:---|:---|:---|:---|:---|
| Redis | `iota-redis` | 6379 | 事件流、锁、审计、分布式配置 | (核心，始终启动) |
| Redis Sentinel | `iota-redis-sentinel` | 26379 | Redis 高可用 | `ha` |
| MinIO | `iota-minio` | 9002 (API), 9003 (Console) | 快照大对象存储 | `full` |
| Milvus | `iota-milvus` | 19530 | 向量记忆搜索 | `full` |

## 快速启动

### 1. 启动存储

```bash
cd deployment/scripts

# 最小启动（仅 Redis，推荐开发使用）
bash start-storage.sh

# 完整启动（Redis + MinIO + Milvus）
bash start-storage.sh --full

# 完整 + 高可用
bash start-storage.sh --full --ha
```

### 2. 健康检查

```bash
bash deployment/scripts/health-check.sh
```

### 3. 停止

```bash
bash deployment/scripts/stop-storage.sh          # 保留数据
bash deployment/scripts/stop-storage.sh --purge  # 清除数据卷
```

## 环境变量

所有端口和凭证可通过环境变量覆盖：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `IOTA_REDIS_PORT` | 6379 | Redis 映射端口 |
| `IOTA_SENTINEL_PORT` | 26379 | Sentinel 映射端口 |
| `IOTA_MINIO_API_PORT` | 9002 | MinIO API 端口 |
| `IOTA_MINIO_CONSOLE_PORT` | 9003 | MinIO Console 端口 |
| `IOTA_MILVUS_PORT` | 19530 | Milvus gRPC 端口 |
| `IOTA_MINIO_USER` | iota | MinIO root 用户 |
| `IOTA_MINIO_PASSWORD` | iotasecret | MinIO root 密码 |

示例：

```bash
IOTA_REDIS_PORT=16379 bash start-storage.sh --full
```

## 使用场景

### 开发模式（最小启动）

适用于 CLI 和 Engine 本地开发，无需 MinIO/Milvus：

```bash
bash deployment/scripts/start-storage.sh

cd iota-cli
node dist/index.js run --backend claude-code "your prompt"
```

### 生产模式（完整启动）

适用于 Agent 服务、向量记忆、快照持久化：

```bash
bash deployment/scripts/start-storage.sh --full

cd iota-agent
IOTA_MODE=production bun run dev
```

## 服务访问

### Redis

```bash
# Linux/macOS
redis-cli -h localhost -p 6379

# Windows (通过 Docker)
docker exec iota-redis redis-cli
```

### MinIO Console (仅 --full 模式)

浏览器访问: <http://localhost:9003>

- 用户名: `iota` (或 `$IOTA_MINIO_USER`)
- 密码: `iotasecret` (或 `$IOTA_MINIO_PASSWORD`)

## 数据持久化

通过 Docker volumes 持久化：

| Volume | 内容 |
|--------|------|
| `redis-data` | Redis AOF 数据 |
| `sentinel-data` | Sentinel 配置 |
| `iota-minio-data` | 快照对象 |
| `milvus-data` | 向量索引 |

## Docker Agent 部署

```bash
# 构建
docker build -t iota-agent:latest -f deployment/docker/Dockerfile.agent .

# 运行（连接 iota-network 中的存储服务）
docker run -p 3000:3000 \
  -e IOTA_MODE=production \
  -e IOTA_DEFAULT_BACKEND=claude-code \
  --network iota-network \
  iota-agent:latest
```

## 故障排查

```bash
# 查看服务日志
cd deployment/docker
docker compose logs -f redis
docker compose --profile full logs -f milvus

# 手动检查单个服务
docker exec iota-redis redis-cli ping
curl -sf http://localhost:9002/minio/health/live
curl -sf http://localhost:9091/healthz
```

详细故障排查见 [`docs/iota-guides/10-deployment.md`](../docs/iota-guides/10-deployment.md)。

### 重启单个服务

```bash
cd deployment/docker
docker-compose restart [service-name]
```

### 常见问题

| 问题 | 原因 | 解决方案 |
|---|---|---|
| Redis 连接失败 | Redis 未启动 | 运行 `deployment/scripts/start-storage.sh` |
| 端口被占用 | 其他服务占用端口 | 检查并停止占用端口的服务，或修改 `docker-compose.yml` 中的端口映射 |
| Docker 资源不足 | 内存/CPU 限制 | 增加 Docker Desktop 资源配置 |

### 检查服务状态

```bash
# 查看所有容器状态
cd deployment/docker
docker-compose ps

# 检查特定服务健康状态
docker-compose exec redis redis-cli ping
docker-compose exec minio mc admin info local
```
