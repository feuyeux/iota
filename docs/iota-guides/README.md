# Iota 文档中心

**版本:** 2.0  
**最后更新:** 2026-04-30

本目录是 Iota 项目的统一文档，涵盖架构、组件指南、存储、可观测性、记忆系统和技术规划。

## 文档索引

| 文档 | 主题 |
|------|------|
| [01-architecture.md](./01-architecture.md) | 架构概览、组件边界、分层图、系统拓扑 |
| [02-engine.md](./02-engine.md) | Engine 核心运行时：执行流、内部结构、配置、Redis 数据结构 |
| [03-backend-adapters.md](./03-backend-adapters.md) | Backend 适配器：ACP 统一层、legacy fallback、进程模型 |
| [04-cli-tui.md](./04-cli-tui.md) | CLI 命令与 TUI 交互模式 |
| [05-agent.md](./05-agent.md) | Agent HTTP/WebSocket 服务 |
| [06-app.md](./06-app.md) | App Web 前端：React UI、状态管理、读取模型 |
| [07-visibility-trace.md](./07-visibility-trace.md) | Visibility 可观测性与 Trace 追踪系统 |
| [08-memory.md](./08-memory.md) | Memory 记忆系统：分类、存取、召回、跨后端延续 |
| [09-skill-fun.md](./09-skill-fun.md) | Skill 结构化技能与 iota-fun 多语言执行器 |
| [10-deployment.md](./10-deployment.md) | 部署、初始化、环境排错 |
| [11-acp-plan.md](./11-acp-plan.md) | ACP 统一接入层技术规划 |
| [12-memory-plan.md](./12-memory-plan.md) | Memory 优化技术规划 |

## 工具链约定

- 使用 `bun` 进行依赖安装、构建、类型检查、测试、lint、format 和开发态运行
- 使用 `node` 运行已构建的 JavaScript 产物（`dist/` 下的 CLI 或其他可执行入口）
- Backend 后端发现统一使用 `bash deployment/scripts/ensure-backends.sh --check-only`

## 快速开始

```bash
# 1) 启动基础设施
cd deployment/scripts && bash start-storage.sh

# 2) 构建全部包
cd iota-engine && bun install && bun run build
cd ../iota-cli && bun install && bun run build
cd ../iota-agent && bun install && bun run build
cd ../iota-app && bun install && bun run build

# 3) 验证后端
cd ../iota-cli && node dist/index.js run --backend claude-code --trace "ping"
```
