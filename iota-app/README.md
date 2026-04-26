# Iota App

`iota-app` 是 Iota 的前端应用，使用 React + Vite。它通过 HTTP 和 WebSocket 连接 `iota-agent`，展示会话、聊天时间线、执行追踪、可见性信息、workspace 文件视图，以及 execution replay。

## 技术栈

- React
- TypeScript
- Vite
- Zustand

## 运行依赖

- `iota-agent` 运行在 `9666`
- App 开发服务器运行在 `9888`
- Redis 由 Agent / Engine 使用，App 本身不直接访问 Redis

## 当前前端数据边界

- App 主数据源是 Agent 的 session snapshot、execution snapshot 和 WebSocket delta
- App 通过 `subscribe_app_session` 订阅会话级增量
- App 通过 `subscribe_visibility` 订阅指定 execution 的 visibility 派生增量
- App 不应直接依赖 backend 原生协议结构

## 当前已实现的主要界面

- Chat Timeline
- Inspector / Tracing
- Workspace Explorer
- Session Sidebar
- Execution Replay Modal

## 重要实现说明

- Approval UI 目前主要基于 Agent 从 runtime events 映射出来的 conversation delta / trace step delta
- 当前不要把前端说明成“已经具备独立 approval decision WebSocket 协议闭环”，因为代码层没有清晰的专用消息类型与服务端处理入口
- 右上角架构图或流程图里，每一条带箭头的线都必须明确标出起点框和终点框，不能出现悬空的 WS approval 箭头

## 开发命令

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run lint
bun run format
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

- `src/hooks/useWebSocket.ts`: WebSocket 连接与订阅
- `src/store/useSessionStore.ts`: session snapshot / delta 合并逻辑
- `src/components/chat/ChatTimeline.tsx`: 聊天与 approval 卡片展示
- `src/components/inspector/InspectorPanel.tsx`: 执行详情、trace、tokens、memory
- `src/components/inspector/ExecutionReplayModal.tsx`: execution replay 视图

## 约束

- 前端主界面消费 Agent read model，不直接消费 raw backend event schema
- 避免在 UI 文案或文档里夸大未真正实现的 approval / replay / visibility 能力
- 如果更新架构图，所有箭头都必须清楚标注 source box 和 target box
