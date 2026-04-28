# Iota Infrastructure Deployment

本目录包含 Iota 项目所有基础设施组件的统一部署配置，包括 Redis、Milvus、MinIO 等存储服务。

**重要**: 所有 Iota 包（engine、cli、agent、app）使用的基础设施都应从此目录统一管理和启动。

## 部署架构

```
┌─────────────────┐
│  Iota App       │  Frontend (React)
└────────┬────────┘
         │
┌────────▼────────┐
│  Iota Agent     │  HTTP/WebSocket API (Port 3000)
│  (@iota/agent)  │
└────────┬────────┘
         │
┌────────▼────────┐
│  Iota Engine    │  Core Runtime
│  (@iota/engine) │
└────────┬────────┘
         │
┌────────▼────────┐
│  Iota CLI       │  Command Line Interface
│  (@iota/cli)    │
└────────┬────────┘
         │
         └─> Storage Services (from deployment/)
             ├─> Redis (Events, Locks, Memory)
             ├─> Milvus (Vector Search)
             └─> MinIO (Snapshots)
```

## 服务组件

生产模式需要以下存储服务。相关设计说明见 [`../docs/requirement/4.iota_engine_design_0425.md`](../docs/requirement/4.iota_engine_design_0425.md)。

| 服务 | 用途 | 端口 | 使用者 | 发布|
|:---|:---|:---|:---|:---|
| Redis | 事件流存储 (Redis Streams)、锁、审计日志 | 6379 | engine, cli, agent |<https://github.com/redis/redis/releases>|
| Redis Sentinel | Redis 高可用 | 26379 | agent (production) |-|
| Milvus | 工作/事实/情节/程序记忆向量索引 | 19530, 9091 | engine, agent | <https://github.com/milvus-io/milvus/releases> |
| MinIO | 快照大对象存储 | 9002 (API), 9003 (Console) | agent |<https://github.com/minio/minio/releases>|
| etcd | Milvus 元数据存储 | 2379 | milvus |<https://github.com/etcd-io/etcd/releases>|

## 快速启动

### 1. 启动存储服务

```bash
cd deployment/scripts
bash start-storage.sh
```

### 2. 验证服务健康状态

```bash
# 检查存储服务
bash deployment/scripts/health-check.sh

# 检查 Redis
redis-cli -h localhost -p 6379 ping

# 检查 Iota Agent (如果已启动)
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/status
```

如果你还要在这台机器上运行 Iota 的四个 backend CLI，可先执行统一检测脚本：

```bash
bash deployment/scripts/ensure-backends.sh --check-only
```

该脚本会优先检查当前 shell 的 `PATH`，并在 Windows / WSL / Git Bash 环境下回退使用 `where.exe`，避免把 Windows 侧已安装的 `hermes.exe`、`codex`、`gemini` 等可执行文件误判为缺失。

### 3. 停止所有服务

```bash
bash deployment/scripts/stop-storage.sh
```

## 使用场景

### 开发模式 (仅 Redis)

适用于 CLI 和 Engine 本地开发：

```bash
# 启动 Redis
cd deployment/scripts
bash start-storage.sh

# 使用 CLI
cd iota-cli
bun iota-cli/dist/index.js "your prompt"
```

### 生产模式 (完整栈)

适用于 Agent 服务和完整功能测试：

```bash
# 启动完整存储栈
cd deployment/scripts
bash start-storage.sh

# 启动 Agent
cd iota-agent
export IOTA_MODE=production
bun run dev
```

## 服务访问

### Redis

```bash
redis-cli -h localhost -p 6379
```

### MinIO Console

浏览器访问: <http://localhost:9003>

- 用户名: `iota`
- 密码: `iotasecret`

### Milvus

```bash
# 使用 Python SDK
from pymilvus import connections
connections.connect("default", host="localhost", port="19530")
```

## 数据持久化

所有数据通过 Docker volumes 持久化：

- `redis-data`: Redis 数据
- `sentinel-data`: Sentinel 配置
- `etcd-data`: etcd 数据
- `minio-data`: Milvus 使用的 MinIO 数据
- `milvus-data`: Milvus 向量数据
- `iota-minio-data`: Iota 快照存储

### 清理所有数据

```bash
cd deployment/docker
docker-compose down -v
```

## 资源配置

默认资源限制：

- Redis: 2GB 内存
- Milvus: 无限制（建议 4GB+）
- MinIO: 无限制

可在 `docker/docker-compose.yml` 中调整资源限制。

## Docker 部署

### 构建 Iota Agent 镜像

```bash
# 从项目根目录构建
docker build -t iota-agent:latest -f deployment/docker/Dockerfile.agent .
```

### 运行 Iota Agent 容器

```bash
# 开发模式（Redis）
docker run -p 3000:3000 \
  -e IOTA_MODE=development \
  -e IOTA_DEFAULT_BACKEND=claude-code \
  -v ~/.iota:/home/iota/.iota \
  iota-agent:latest

# 生产模式（连接外部存储）
docker run -p 3000:3000 \
  -e IOTA_MODE=production \
  -e IOTA_DEFAULT_BACKEND=claude-code \
  --network host \
  iota-agent:latest
```

### 使用 Docker Compose

```bash
cd deployment/docker
docker-compose up -d
```

## 配置文件

在 Iota 配置文件（`iota.config.yaml`）中使用以下连接信息：

```yaml
storage:
  development:
    redis:
      host: localhost
      port: 6379
      streamPrefix: "iota:events"
  
  production:
    redis:
      sentinels:
        - host: localhost
          port: 26379
      streamPrefix: "iota:events"
    milvus:
      address: "localhost:19530"
    minio:
      endPoint: "localhost"
      port: 9002
      useSSL: false
      bucket: "iota-snapshots"
      accessKey: "iota"
      secretKey: "iotasecret"
```

## 故障排查

### 查看服务日志

```bash
cd deployment/docker
docker-compose logs -f [service-name]
```

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
| Milvus 启动失败 | etcd 或 MinIO 未就绪 | 等待依赖服务启动完成，或查看日志排查 |

### 检查服务状态

```bash
# 查看所有容器状态
cd deployment/docker
docker-compose ps

# 检查特定服务健康状态
docker-compose exec redis redis-cli ping
docker-compose exec minio mc admin info local
```
