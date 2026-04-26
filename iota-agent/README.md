# Iota Agent

`@iota/agent` 是 Iota 的 Fastify HTTP / WebSocket 服务。它基于 `@iota/engine` 对外提供 session 管理、execution 控制、visibility 查询、app snapshot、execution replay 与实时增量流。

## 包结构

```text
iota-agent/
├── src/
│   ├── index.ts              # Fastify server bootstrap
│   └── routes/
│       ├── config.ts         # distributed config routes
│       ├── cross-session.ts  # cross-session queries
│       ├── execution.ts      # execute, events, interrupt
│       ├── logs.ts           # log query
│       ├── session.ts        # session CRUD and workspace helpers
│       ├── status.ts         # backend status and metrics
│       ├── visibility.ts     # visibility / trace / replay / app-snapshot
│       └── websocket.ts      # /api/v1/stream
├── package.json
└── tsconfig.json
```

## 端口

- Agent 默认监听 `9666`
- WebSocket 路径是 `/api/v1/stream`

## 当前已实现接口

### HTTP

健康检查：

```text
GET /health
GET /healthz
```

主要版本化接口：

```text
GET    /api/v1/status
GET    /api/v1/metrics

POST   /api/v1/sessions
GET    /api/v1/sessions/:sessionId
DELETE /api/v1/sessions/:sessionId
PUT    /api/v1/sessions/:sessionId/context
GET    /api/v1/sessions/:sessionId/workspace/file

POST   /api/v1/execute
GET    /api/v1/executions/:executionId
GET    /api/v1/executions/:executionId/events
POST   /api/v1/executions/:executionId/interrupt

GET    /api/v1/executions/:executionId/visibility
GET    /api/v1/executions/:executionId/visibility/memory
GET    /api/v1/executions/:executionId/visibility/tokens
GET    /api/v1/executions/:executionId/visibility/chain
GET    /api/v1/executions/:executionId/trace
GET    /api/v1/executions/:executionId/app-snapshot
GET    /api/v1/executions/:executionId/replay

GET    /api/v1/sessions/:sessionId/visibility
GET    /api/v1/sessions/:sessionId/visibility/summary
GET    /api/v1/sessions/:sessionId/app-snapshot
GET    /api/v1/traces/aggregate
```

### WebSocket

连接地址：

```text
WS /api/v1/stream
```

当前支持的入站消息：

- `execute`
- `interrupt`
- `subscribe_app_session`
- `subscribe_visibility`

当前主要出站消息：

- `event`
- `app_delta`
- `app_snapshot`
- `visibility_snapshot`
- `complete`
- `error`
- `subscribed`
- `subscribed_visibility`
- `pubsub_event`

## 重要实现边界

- Agent 自己不做 backend protocol conversion，所有后端协议转换都在 `iota-engine`
- App 的主界面数据应该消费 Agent snapshot / delta，而不是 raw visibility bundle 或 raw backend event schema
- 当前代码里不要宣称“前端可通过独立 approval decision WebSocket 消息完成审批闭环”，因为这条协议并未作为清晰独立接口正式实现
- 当前 approval 相关展示主要来自 execution event 映射和 visibility / trace 衍生数据

## 运行命令

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run test
bun run lint
bun run format
```

如果 `@iota/engine` 的类型或导出有变化，先构建 `../iota-engine`。

## 示例

```bash
curl -X POST http://localhost:9666/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workingDirectory":"/path/to/project","backend":"claude-code"}'

curl -X POST http://localhost:9666/api/v1/execute \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId":"session_xxx",
    "prompt":"List files in current directory",
    "backend":"claude-code"
  }'
```

```javascript
const ws = new WebSocket("ws://localhost:9666/api/v1/stream");

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "subscribe_app_session",
    sessionId: "session_xxx",
  }));

  ws.send(JSON.stringify({
    type: "execute",
    sessionId: "session_xxx",
    prompt: "What is 2+2?",
    backend: "claude-code",
  }));
};
```

## 环境变量

```bash
PORT=9666
HOST=0.0.0.0
LOG_LEVEL=info
CORS_ORIGIN=*
```

不要提交包含真实凭据的 env 文件。
