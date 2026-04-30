# iota App

`iota-app` 是 iota 的前端应用，使用 React 19 + Vite + Zustand + TanStack Query。它通过 HTTP 和 WebSocket 连接 `iota-agent`，展示会话对话、执行追踪、可见性信息和审批交互。

## 技术栈

| 技术 | 用途 |
|---|---|
| React 19 | UI 框架 |
| Zustand | Session / execution / WebSocket 状态管理 |
| TanStack Query | HTTP 服务端状态缓存 |
| TanStack Virtual | 对话长列表虚拟化 |
| Tailwind CSS 4 | 样式 |
| Recharts | 图表 |
| react-markdown | Markdown 渲染 |
| lucide-react | 图标 |

## 运行依赖

- `iota-agent` 运行在 `9666`
- App 开发服务器运行在 `9888`
- Redis 由 Agent / Engine 使用，App 本身不直接访问 Redis

## 数据边界

- App 主数据源是 Agent 的 session snapshot、execution snapshot 和 WebSocket delta
- App 通过 `subscribe_app_session` 订阅会话级增量（conversation、tracing、memory、tokens、summary）
- App 通过 `subscribe_visibility` 订阅指定 execution 的 visibility 派生增量
- App 通过 `approval_decision` WebSocket 消息向 Agent 提交审批决定
- App 不依赖 backend 原生协议结构

## 核心组件

| 组件 | 路径 | 功能 |
|---|---|---|
| ChatTimeline | `src/components/chat/` | 对话历史、流式输出、审批卡片 |
| InspectorPanel | `src/components/inspector/` | Visibility 面板（tracing、memory、tokens、summary） |
| Header | `src/components/layout/` | 顶部导航、backend 选择器、session 信息 |
| IotaLogo | `src/components/brand/` | 品牌标识 |

## 审批闭环

审批流程已完整实现：

1. Engine 触发 approval → Agent 推送 `app_delta` 审批卡片到 App
2. App ChatTimeline 展示审批卡片
3. 用户点击批准/拒绝 → App 发送 `approval_decision` WebSocket 消息
4. Agent 调用 `engine.resolveApproval()` → 返回 `approval_result`

## 当前已实现的主要界面

- Chat Timeline
- Inspector / Tracing
- Workspace Explorer
- Session Sidebar
- Execution Replay Modal

## 开发命令

```bash
bun install
bun run dev
bun run build    # tsc -b && vite build
```

## 本地启动

先启动 Agent：

```bash
cd ../iota-agent
bun run dev
```

再启动 App：

```bash
cd ../iota-app
bun run dev
```

浏览器访问：`http://localhost:9888`

## 相关代码位置

- `src/hooks/useWebSocket.ts`: WebSocket 连接、订阅与 approval_decision 发送
- `src/store/useSessionStore.ts`: session snapshot / delta 合并逻辑
- `src/lib/api.ts`: HTTP API 客户端
- `src/types/index.ts`: 前端类型定义（AppSessionSnapshot、AppVisibilityDelta 等）
- `src/components/chat/ChatTimeline.tsx`: 聊天与 approval 卡片展示
- `src/components/inspector/InspectorPanel.tsx`: 执行详情、trace、tokens、memory

## 约束

- 前端主界面消费 Agent read model，不直接消费 raw backend event schema
- 架构图中所有箭头都必须清楚标注 source box 和 target box
