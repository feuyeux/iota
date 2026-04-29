# Iota 文档指南

**版本：** 1.0
**最后更新：** 2026年4月

## 概述

本指南系列为 Iota 系统提供全面的文档，既是用户文档也是手动验证工具。每篇指南涵盖特定组件，包含详细架构、依赖关系、通信协议和逐步验证流程。

### 目的

这些指南使您能够：

- **理解** 完整的 Iota 架构和组件交互
- **验证** 通过可执行命令和工作流进行手动功能验证
- **排查** 清晰调试流程的问题
- **部署** 具有正确基础设施设置的组件
- **维护** 对系统行为的信心

### 工具链约定

- 使用 `bun` 进行依赖安装、构建、类型检查、测试、lint、format 和开发态运行。
- 使用 `node` 运行已经构建出的 JavaScript 产物，尤其是 `dist/` 下的 CLI 或其他可执行入口。
- 文档中的 `bun run build` 表示构建阶段；文档中的 `node dist/...` 表示产物验证或生产态运行阶段。

### 目标读者

- 从事 Iota 组件开发的开发者
- 部署 Iota 的系统管理员
- 验证功能的贡献者
- 追求深入理解系统的用户

## 快速开始路径

对于新用户，建议按以下验证流程：

### 1. 从架构开始（5-10分钟）

阅读 [00-architecture-overview.md](./00-architecture-overview.md) 了解：

- 系统级架构和组件层次
- Engine 内部架构
- 组件间通信协议
- 数据流和存储模式

### 2. 验证基础设施（5分钟）

测试任何组件前，确保 Redis 正在运行：

```bash
cd deployment/scripts
bash start-storage.sh
redis-cli ping  # 应返回 PONG
```

### 3. 验证 CLI（15-20分钟）

按照 [01-cli-guide.md](./01-cli-guide.md) 验证：

- CLI (Command Line Interface) 命令行接口功能
- 后端配置和切换
- Session 会话和 Execution 执行管理
- 分布式日志访问

使用 `bash deployment/scripts/ensure-backends.sh --check-only` 作为所有指南的共享后端发现步骤。避免在组件指南中重新引入特定 shell 的 `which` / `Get-Command` / `where` 指令，除非需要特定平台例外。

安装缺失的后端：

```bash
bash deployment/scripts/ensure-backends.sh
```

当前安装映射：

- `claude-code` -> `npm install -g @anthropic-ai/claude-code`
- `codex` -> `npm install -g @openai/codex`
- `gemini` -> `npm install -g @google/gemini-cli`
- `hermes` -> `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash`（仅 Linux / macOS / WSL2；Hermes 不在 PyPI，不能 `pip install`）

规则：

- 辅助脚本是 `docs/guides/` 下唯一记录的后端发现入口点
- 可执行文件发现只是第一道关卡；后端验证仍需要真实的 traced request

### 4. 验证 TUI（10-15分钟）

按照 [02-tui-guide.md](./02-tui-guide.md) 验证：

- Interactive Mode 交互模式功能
- Real-time Streaming 实时流式输出
- Approval Workflow 审批工作流
- Session Continuity 会话连续性

### 5. 验证 Agent Service（20-25分钟）

按照 [03-agent-guide.md](./03-agent-guide.md) 验证：

- HTTP REST API 端点
- WebSocket 流式协议
- 分布式配置管理
- 跨 Session 会话数据访问

### 6. 验证 App Interface（15-20分钟）

按照 [04-app-guide.md](./04-app-guide.md) 验证：

- Web UI 组件和工作流
- 通过 WebSocket 实时更新
- 多 Session 可视化
- UI 中后端切换

### 7. 深入 Engine（30-40分钟）

按照 [05-engine-guide.md](./05-engine-guide.md) 验证：

- Backend Adapter 后端适配器实现
- Memory System 记忆系统流程
- Visibility Plane 可见性平面数据结构
- Redis 数据组织

**总时间：** 完整验证约 2-3 小时

## 指南系列

### [00. 架构概览](./00-architecture-overview.md)

**状态：** ✅ 完成
**用途：** 系统级架构参考

**涵盖主题：**

- 高层系统架构图
- 组件概述（CLI、TUI、Agent、App、Engine）
- Engine 内部架构
- 执行流程序列
- 通信协议（HTTP、WebSocket、Redis、stdio）
- 数据流和存储模式
- 部署架构（单机、分布式）

**使用时机：**

- 深入特定组件前
- 理解组件交互时
- 排查跨组件问题时
- 规划系统修改时

---

### [01. CLI 指南](./01-cli-guide.md)

**状态：** ✅ 完成
**用途：** 命令行接口验证

**涵盖主题：**

- CLI 命令参考（`run`、`interactive`、`status`、`switch`、`config`、`gc`、`logs`、`visibility`）
- 依赖（Engine 库、Redis、后端可执行文件）
- 通信协议（TypeScript 导入、Redis TCP、子进程 stdio）
- 每个命令的手动验证流程
- Redis 副作用检查
- 常见 CLI 问题排查

**使用时机：**

- 验证 CLI 功能时
- 调试命令执行时
- 理解 CLI-Engine 交互时
- 测试后端切换时

---

### [02. TUI 指南](./02-tui-guide.md)

**状态：** ✅ 完成
**用途：** 交互模式验证

**涵盖主题：**

- 交互模式启动和导航
- TUI 中的 Session 管理
- Approval Workflow 审批工作流演示
- 键盘快捷键和命令历史
- 多轮对话验证
- 终端兼容性要求

**使用时机：**

- 验证交互模式时
- 测试审批工作流时
- 调试终端渲染时
- 理解会话连续性时

---

### [03. Agent 指南](./03-agent-guide.md)

**状态：** ✅ 完成
**用途：** HTTP/WebSocket API 验证与分布式特性

**涵盖主题：**

- REST API 端点参考（sessions、executions、logs、config、visibility）
- WebSocket 协议文档
- 分布式配置管理
- 跨 Session 查询模式
- 后端隔离验证
- curl 和 WebSocket 客户端示例

**使用时机：**

- 验证 Agent API 时
- 测试分布式特性时
- 调试 WebSocket 连接时
- 理解跨 Session 数据访问时

---

### [04. App 指南](./04-app-guide.md)

**状态：** ✅ 完成
**用途：** Web UI 验证与分布式可视化

**涵盖主题：**

- UI 组件概述（Session Manager、Chat Timeline、Inspector Panel、Workspace Explorer）
- WebSocket 集成模式
- 实时更新验证
- 多 Session 可视化
- UI 中后端切换
- 浏览器 DevTools 检查

**使用时机：**

- 验证 App 功能时
- 测试 UI 工作流时
- 调试 WebSocket 更新时
- 理解多 Session 场景时

---

### [05. Engine 指南](./05-engine-guide.md)

**状态：** ✅ 完成
**用途：** 运行时内部验证与分布式执行

**涵盖主题：**

- Backend Adapter 后端适配器实现详情（Claude Code、Codex、 Gemini CLI、Hermes Agent）
- Memory System 记忆系统流程（提取、存储、检索、注入）
- Visibility Plane 可见性平面数据结构（tokens、spans、memory、context）
- 配置管理内部（RedisConfigStore）
- Redis 数据结构规范
- 协议解析和事件映射

**使用时机：**

- 验证 Engine 内部时
- 调试后端适配器时
- 理解记忆系统时
- 检查 Redis 数据结构时

**注意：** 详细的可见性和追踪文档见 [06-visibility-trace-guide.md](./06-visibility-trace-guide.md)。

---

### [06. 可见性 & 追踪指南](./06-visibility-trace-guide.md)

**状态：** ✅ 完成
**用途：** 全面的可见性和追踪系统文档

**涵盖主题：**

- Visibility Record 可见性记录结构和数据流
- Trace Span 追踪跨度层次和时间分解
- Token Usage Tracking Token 使用跟踪和置信度
- Memory Extraction Visibility 记忆提取可见性
- Native Event Recording 原生事件记录和哈希
- CLI 命令（`iota trace`、`iota visibility`）
- Agent HTTP 和 WebSocket API 用于可见性
- App 消费可见性数据的集成模式
- Engine 记录 span 的实现细节
- 常见 span 名称和排查

**使用时机：**

- 理解执行遥测时
- 调试性能问题时
- 跟踪 Token 使用和成本时
- 在 App 中实现可见性特性时
- 排查追踪数据缺失时
- 通过原生事件分析后端行为时

---

## 指南结构

每篇指南遵循一致的 10 节结构：

1. **引言** - 目的、范围和读者
2. **架构概览** - 组件图和依赖
3. **前置条件** - 必需软件、环境变量、基础设施
4. **安装和设置** - 逐步设置与验证
5. **核心功能** - 功能逐项文档和示例
6. **分布式特性** - 后端配置、跨 Session 访问、分布式存储
7. **手动验证方法** - 检查清单、检查命令、成功标准
8. **问题排查** - 常见问题、诊断、解决方案、预防
9. **清理** - 状态重置、数据清理、环境拆卸
10. **参考** - 相关指南、外部文档、API 参考

## 验证工作流

每篇指南包含遵循此模式的手动验证流程：

### 设置阶段

- 启动必需的基础设施（Redis、Agent、App）
- 构建必要的包
- 配置环境变量
- 验证前置条件

### 执行阶段

- 按文档所示精确运行命令
- 实时观察输出
- 检查退出码和输出格式
- 检查副作用（Redis keys、文件、进程）

### 验证阶段

- 将实际输出与预期输出比较
- 使用 `redis-cli` 验证 Redis 中的数据结构
- 用 `curl` 或浏览器 DevTools 检查 API 响应
- 确认状态更改正确

### 清理阶段

- 从 Redis 删除测试数据
- 停止后台进程
- 将环境重置为干净状态
- 为下一次验证做准备

## 常用验证命令

### Redis 检查

```bash
# 检查 Redis 是否运行
redis-cli ping

# 列出所有 Iota keys
redis-cli KEYS "iota:*"

# 检查 Session 数据
redis-cli HGETALL "iota:session:{sessionId}"

# 检查 Execution 数据
redis-cli HGETALL "iota:exec:{executionId}"

# 查看事件流
redis-cli XRANGE "iota:events:{execId}" - +

# 检查记忆数量
redis-cli ZCARD "iota:memories:{sessionId}"

# 查看可见性数据
redis-cli GET "iota:visibility:tokens:{execId}"
redis-cli LRANGE "iota:visibility:spans:{execId}" 0 -1
```

### Agent API 测试

```bash
# 检查 Agent 健康状态
curl http://localhost:9666/health

# 创建 Session
curl -X POST http://localhost:9666/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workingDirectory":"/tmp"}'

# 获取配置
curl http://localhost:9666/api/v1/config

# 查询日志
curl "http://localhost:9666/api/v1/logs?limit=10"

# 获取后端隔离报告
curl http://localhost:9666/api/v1/backend-isolation
```

### 进程和端口验证

```bash
# 检查 Agent 是否运行
lsof -i :9666

# 检查 App 是否运行
lsof -i :9888

# 检查 Redis 是否运行
lsof -i :6379

# 列出后端进程
ps aux | grep -E "claude|codex|gemini|hermes"
```

## 问题排查快速参考

### Redis 连接问题

**症状：** `ECONNREFUSED 127.0.0.1:6379`
**解决方案：**

```bash
cd deployment/scripts
bash start-storage.sh
redis-cli ping  # 用 PONG 验证
```

### 后端未找到

**症状：** `Backend 'claude-code' not found`
**解决方案：**

```bash
bash deployment/scripts/ensure-backends.sh --check-only
iota status   # 检查后端健康状态
```

如果辅助脚本报告缺失后端，使用 `bash deployment/scripts/ensure-backends.sh` 安装后再继续。

### 端口已被占用

**症状：** `EADDRINUSE: address already in use :::9666`
**解决方案：**

```bash
lsof -i :9666 -t | xargs kill -9
```

### WebSocket 连接失败

**症状：** 浏览器中 WebSocket 连接错误
**解决方案：**

```bash
# 验证 Agent 是否运行
lsof -i :9666
# 如需要重启 Agent
cd iota-agent && bun run dev
```

## 基础设施设置

使用任何指南前，确保基础设施正在运行：

### 启动 Redis

```bash
cd deployment/scripts
bash start-storage.sh
redis-cli ping  # 应返回 PONG
```

### 启动 Agent（用于 API/App 验证）

```bash
cd iota-agent
bun install
bun run dev  # 监听端口 9666
```

### 启动 App（用于 UI 验证）

```bash
cd iota-app
bun install
bun run dev  # 监听端口 9888
```

### 构建包（用于 CLI/TUI 验证）

```bash
# 构建 Engine
cd iota-engine
bun install
bun run build

# 构建 CLI
cd ../iota-cli
bun install
bun run build
```

## 贡献指南

更新指南时：

1. **测试所有命令** - 每个命令必须经过测试并按文档工作
2. **记录实际行为** - 指南反映现实而非愿望
3. **包含预期输出** - 显示用户应该看到的内容
4. **添加问题排查** - 记录您遇到的问题
5. **更新交叉引用** - 保持指南间的链接最新
6. **保持结构一致** - 遵循 10 节模板
7. **使用一致术语** - 在所有指南中匹配术语

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026年4月 | 初始指南系列结构和索引 |

## 相关文档

- [项目 README](../../README.md) - 项目概览和快速开始
- [Engine README](../../iota-engine/README.md) - Engine 专用文档
- [CLI README](../../iota-cli/README.md) - CLI 专用文档
- [Agent README](../../iota-agent/README.md) - Agent 专用文档
- [App README](../../iota-app/README.md) - App 专用文档
- [部署 README](../../deployment/README.md) - 基础设施设置

## 支持

如有问题或疑问：

- 查看相关指南的问题排查部分
- 阅读架构概览以理解系统
- 检查 Redis 数据结构以验证状态
- 使用 `--trace` 标志运行 CLI 命令以获取详细日志

---

**注意：** 本指南系列强调手动验证而非自动化测试。目标是提供清晰、可执行的文档，帮助开发者通过实践探索理解和验证系统行为。
