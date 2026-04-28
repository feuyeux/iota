# Iota 需求实现状态总结

> 生成日期：2026-04-28
> 基于需求文档：4.iota_engine_design_0425.md, 5.iota_app_design.md, 6.iota_memory_design.md

---

## 执行摘要

经过对当前代码实现与三份需求文档的详细对比，**核心架构和基础功能已基本实现**，但仍有部分高级功能和完整验收标准未达成。

### 总体完成度

| 需求文档 | 核心功能完成度 | 验收完成度 | 状态 |
|---------|--------------|-----------|------|
| 4.iota_engine_design_0425.md | ~85% | ~70% | 🟡 基本可用，需补充测试 |
| 5.iota_app_design.md | ~75% | ~60% | 🟡 基础实现，缺少高级功能 |
| 6.iota_memory_design.md | ~90% | ~75% | 🟢 核心完成，需补充集成测试 |

---

## 1. Engine 可见性机制 (4.iota_engine_design_0425.md)

### ✅ 已实现

#### 1.1 核心基础设施
- ✅ `VisibilityCollector` - 收集 context/memory/token/link 可见性
- ✅ `VisibilityStore` (Redis + Local fallback)
- ✅ `ContextManifest` - 记录上下文段和 token 估算
- ✅ `MemoryVisibilityRecord` - 记录候选/选中/排除/裁剪
- ✅ `TokenLedger` - 支持 native/mixed/estimated confidence
- ✅ `LinkVisibilityRecord` - 记录命令/进程/协议/span
- ✅ `TraceSpan` - 覆盖 engine/backend/adapter/approval/MCP 关键链路
- ✅ `EventMappingVisibility` - 原生事件到 RuntimeEvent 映射
- ✅ `RedactionSummary` - 脱敏 API key/token/secret

#### 1.2 Engine API
- ✅ `IotaEngine.getExecutionVisibility(executionId)`
- ✅ `IotaEngine.listSessionVisibility(sessionId, options)`
- ✅ Visibility 配置段已进入 `IotaConfig`

#### 1.3 四后端适配
- ✅ Claude Code adapter - 基础 mapping 和 usage 提取
- ✅ Codex adapter - 基础 mapping
- ✅ Gemini adapter - 基础 mapping
- ✅ Hermes adapter - 长驻进程 link record，支持 scope=process|execution

#### 1.4 存储与 GC
- ✅ Redis visibility keys 可跟随 `eventRetentionHours`
- ✅ LocalVisibilityStore 已有 GC
- ✅ Metrics 已接入部分 visibility 派生指标

### 🔄 部分实现

#### 1.5 CLI 可见性命令
- ✅ `iota visibility <executionId>` - 基础查询
- ✅ `iota visibility <executionId> --memory/--tokens/--chain/--json`
- ❌ `iota visibility --session <sessionId>` - 会话级汇总（未实现）
- ❌ `iota visibility interactive` - 交互式监控（未实现）
- ❌ `iota visibility list/search` - 列表与搜索（未实现）
- ❌ `iota visibility --export` - 导出功能（未实现）

#### 1.6 Agent HTTP API
- ✅ `GET /executions/:executionId/visibility`
- ✅ `GET /executions/:executionId/visibility/memory|tokens|chain`
- ✅ `GET /sessions/:sessionId/visibility`
- ✅ `GET /executions/:executionId/app-snapshot`
- ✅ `GET /sessions/:sessionId/app-snapshot` (基础聚合)

#### 1.7 WebSocket 实时推送
- ✅ `subscribe_visibility` 已支持订阅
- ✅ Execution 完成后推送 visibility delta
- ⚠️ 跨连接、断线重连、revision 去重测试不足

### ❌ 未实现

#### 1.8 高级功能
- ❌ CLI 架构组件拆分（VisibilityClient/Formatter/Monitor/Exporter 仍为内聚命令模块）
- ❌ `iota interactive` 经 Agent WebSocket（当前仍是本地 CLI 直连 Engine）
- ❌ Visibility full-content 引用的短 TTL 策略
- ❌ OpenTelemetry exporter 预留接口

#### 1.9 测试覆盖
- ❌ Agent WebSocket visibility 订阅集成测试
- ❌ Hermes 长驻进程真实子进程多 execution 串线测试
- ❌ CLI visibility 全命令矩阵测试
- ❌ 四后端真实 CLI 输出样本扩充

---

## 2. App 前端实现 (5.iota_app_design.md)

### ✅ 已实现

#### 2.1 页面结构
- ✅ 左侧导航与会话列表
- ✅ 顶部底座栏（Claude/Codex/Gemini/Hermes 切换）
- ✅ 对话主区（RuntimeEvent 驱动）
- ✅ 右侧可见性面板（Tracing/Memory/Context/MCP/Summary 五个 Tab）
- ✅ Token 使用统计
- ✅ Workspace Explorer 基础视图

#### 2.2 数据获取
- ✅ TanStack Query 管理 REST snapshot
- ✅ Zustand 管理 WebSocket 状态和 delta 合并
- ✅ `useSessionStore` 管理当前 session/backend/execution
- ✅ `useWebSocket` 处理 WebSocket 连接和消息

#### 2.3 Backend Capability 自适应
- ✅ 根据 `BackendStatusView.capabilities` 动态启用/置灰功能
- ✅ `streaming=false` 降级为批量返回模式
- ✅ `mcp=false` MCP Tab 置灰
- ✅ `memoryVisibility=false` Memory Tab 显示不支持提示
- ✅ `tokenVisibility=false` Tokens 显示 estimated 模式

#### 2.4 可见性面板
- ✅ Session Tracing - 显示 request/base_engine/response/complete 阶段
- ✅ Memory - 显示 longTerm/session/knowledge 三类记忆卡片
- ✅ Context - 显示 active files 和 workspace summary
- ✅ MCP - 显示 tool calls（当 backend 支持时）
- ✅ Summary - 显示消息数/耗时/最后执行 ID

### 🔄 部分实现

#### 2.5 Workspace 管理
- ✅ 显示 workingDirectory 和 active files
- ⚠️ Context Files 操作（添加/移除/固定/清空）- 前端 UI 存在，后端持久化接口未完全对接
- ⚠️ File delta 视图 - 基础显示已有，diff 预览未实现
- ⚠️ 上下文预算提示 - token 估算显示已有，超预算裁剪提示未完善

#### 2.6 WebSocket Delta
- ✅ `subscribe_app_session` 基础实现
- ⚠️ 只在同一连接执行任务时从 RuntimeEvent 派生少量 delta
- ❌ 尚未订阅 VisibilityStore 的真实增量
- ❌ Revision 去重、断线重连压力测试不足

#### 2.7 App Snapshot
- ✅ Execution-level app-snapshot 已实现
- ✅ Session-level app-snapshot 已实现（基础聚合）
- ⚠️ Session snapshot 依赖 visibility summary 列表
- ⚠️ Backend capabilities 为静态填充
- ⚠️ Conversation timeline 未包含用户 prompt

### ❌ 未实现

#### 2.8 高级功能
- ❌ Phase 3: Tracing span drill-down 详情页
- ❌ Phase 3: Raw visibility 调试页
- ❌ Phase 3: NativeEventRef 和 EventMappingVisibility 关联展示
- ❌ Phase 3: MCP Servers/Tool Calls/Trace 完整视图
- ❌ Phase 3: 导出脱敏后的 snapshot/visibility
- ❌ Phase 4: 人工审批卡片（Agent 尚未支持入站审批决策）
- ❌ Phase 4: 跨会话记忆浏览/搜索/禁用/固定
- ❌ Phase 4: Active files 后端持久化完整对接
- ❌ Phase 4: Token 成本趋势和 backend 对比

#### 2.9 性能优化
- ⚠️ 对话时间线虚拟列表 - 已引入 @tanstack/react-virtual，但未完全应用
- ❌ TraceSpan/NativeEventRef 虚拟列表（超过 200 条时）
- ❌ Memory cards 分页（超过 100 条时）
- ❌ Token 分段折叠（超过 50 条时）

#### 2.10 测试覆盖
- ❌ App Snapshot 聚合测试（缺失 visibility 时降级视图）
- ❌ App Delta 去重测试（同一 revision 重放幂等性）
- ❌ WebSocket 断线重连和状态恢复测试
- ❌ 1000+ conversation items 性能测试

---

## 3. Memory System (6.iota_memory_design.md)

### ✅ 已实现

#### 3.1 核心组件
- ✅ `MemoryMapper` - 四后端原生类型到统一类型映射
- ✅ `MemoryStorage` - Redis 存储和检索
- ✅ `MemoryInjector` - 构建上下文和格式化 prompt
- ✅ `injectMemoryWithVisibility()` - 返回 candidates/selected/excluded

#### 3.2 四种统一记忆类型
- ✅ `episodic` (情节记忆) - Session scope, 7 days TTL
- ✅ `procedural` (程序记忆) - Project scope, 30 days TTL
- ✅ `factual` (事实记忆) - User scope, 180 days TTL
- ✅ `strategic` (战略记忆) - Project scope, 180 days TTL

#### 3.3 Backend 映射规则
- ✅ Claude Code: conversation_context/code_context/user_preferences/project_context
- ✅ Codex: session_history/tool_usage/codebase_facts/task_planning
- ✅ Gemini: interaction_log/execution_patterns/entity_knowledge/goal_tracking
- ✅ Hermes: dialogue_memory/skill_memory/profile_memory/intention_memory

#### 3.4 存储架构
- ✅ Redis key patterns: `iota:memory:{type}:{memoryId}`
- ✅ Index by scope: `iota:memories:{type}:{scopeId}`
- ✅ TTL 自动过期
- ✅ Access count 和 lastAccessedAt 更新

#### 3.5 检索策略
- ✅ Episodic: Recent N from session (limit 20)
- ✅ Procedural: Top N by relevance (limit 10)
- ✅ Factual: All for user (limit 50)
- ✅ Strategic: All for project (limit 30)

#### 3.6 测试覆盖
- ✅ `MemoryMapper` 单元测试（mapping 规则和 fallback）
- ✅ `MemoryStorage` 单元测试（store/retrieve/delete）
- ✅ `MemoryInjector` 单元测试（buildContext/formatAsPrompt/visibility）

### 🔄 部分实现

#### 3.7 Backend 协议扩展
- ⚠️ 四后端 memory event 处理 - 设计已定义，adapter 实现未完全对接
- ⚠️ Claude Code stream-json memory event - 未见真实样本
- ⚠️ Codex NDJSON memory event - 未见真实样本
- ⚠️ Gemini stream-json memory event - 未见真实样本
- ⚠️ Hermes ACP JSON-RPC memory event - 未见真实样本

#### 3.8 CLI 和 API
- ⚠️ CLI commands (iota memory list/show/delete/stats/clear) - 设计已定义，未实现
- ⚠️ Agent API (GET/DELETE /api/memory/*) - 设计已定义，未实现
- ⚠️ WebSocket events (memory_stored/retrieved/deleted/updated) - 设计已定义，未实现

### ❌ 未实现

#### 3.9 高级功能
- ❌ Phase 2: Memory extraction from backend output
- ❌ Phase 2: Integration with event listeners
- ❌ Phase 3: Metrics (memory_stored_total, memory_confidence_avg, etc.)
- ❌ Phase 3: Dashboard and performance optimization
- ❌ Phase 4: Semantic memory (vector embeddings)
- ❌ Phase 4: Memory consolidation
- ❌ Phase 4: Collaborative memory (team sharing)
- ❌ Phase 4: Advanced analytics

#### 3.10 测试覆盖
- ❌ 集成测试：跨 execution 记忆注入和提取
- ❌ 四后端真实 memory event 样本测试
- ❌ Memory GC 和 TTL 过期测试
- ❌ 并发访问和 race condition 测试

---

## 4. 关键缺失功能汇总

### 4.1 高优先级（影响核心验收）

1. **CLI Visibility 高级命令**
   - 会话级汇总 (`--session`)
   - 交互式监控 (`interactive`)
   - 列表与搜索 (`list`, `search`)
   - 导出功能 (`--export`)

2. **App WebSocket Delta 完整实现**
   - 订阅 VisibilityStore 真实增量
   - Revision 去重和断线重连
   - 跨连接压力测试

3. **四后端真实样本测试**
   - Native usage 提取验证
   - Memory event 协议扩展验证
   - Parse loss 和 lossy mapping 规则验证

4. **App Phase 3 功能**
   - Tracing span drill-down
   - Raw visibility 调试页
   - MCP 完整视图
   - 导出功能

### 4.2 中优先级（影响高级功能）

5. **Workspace 管理完整对接**
   - Context Files 后端持久化 API
   - File delta diff 预览
   - 上下文预算超限裁剪提示

6. **Memory System 集成**
   - Backend memory event 真实对接
   - Memory extraction from output
   - CLI/API 完整实现

7. **性能优化**
   - 长对话虚拟列表
   - TraceSpan/Memory 分页
   - Token 分段折叠

8. **App Phase 4 功能**
   - 人工审批卡片
   - 跨会话记忆管理
   - Token 成本趋势

### 4.3 低优先级（增强功能）

9. **OpenTelemetry 集成**
   - Exporter 预留接口
   - Trace 导出

10. **Memory 高级功能**
    - Semantic search (vector embeddings)
    - Memory consolidation
    - Collaborative memory

11. **Visibility full-content 策略**
    - 短 TTL 引用
    - 加密存储

---

## 5. 建议行动计划

### Phase 1: 补齐核心验收（2-3 周）

**目标：** 让现有功能达到设计文档的验收标准

1. **CLI Visibility 命令完整实现**
   - 实现会话级汇总、交互式监控、列表、搜索、导出
   - 拆分为独立组件（Client/Formatter/Monitor/Exporter）
   - 补充命令级单元测试

2. **四后端真实样本测试**
   - 收集 Claude/Codex/Gemini/Hermes 真实 CLI 输出
   - 验证 native usage 提取
   - 验证 parse loss 和 mapping 规则
   - 补充集成测试

3. **App WebSocket Delta 完善**
   - 实现 VisibilityStore 订阅
   - 实现 revision 去重
   - 实现断线重连和状态恢复
   - 补充压力测试

4. **Hermes 长驻进程测试**
   - 真实 Hermes 子进程多 execution 测试
   - 验证 scope=process|execution 不串线

### Phase 2: 补齐高级功能（3-4 周）

**目标：** 实现 App Phase 3 和 Workspace 完整对接

5. **App Phase 3 功能**
   - Tracing span drill-down 详情页
   - Raw visibility 调试页
   - NativeEventRef/EventMappingVisibility 关联展示
   - MCP Servers/Tool Calls/Trace 完整视图
   - 导出脱敏 snapshot/visibility

6. **Workspace 管理完整对接**
   - 实现 `PUT /api/v1/sessions/:sessionId/context` 持久化
   - 实现 file delta diff 预览
   - 实现上下文预算超限提示

7. **Memory System 集成**
   - Backend adapter 对接 memory event
   - 实现 memory extraction from output
   - 实现 CLI/API (iota memory list/show/delete/stats)

### Phase 3: 性能优化和 Phase 4（4-5 周）

**目标：** 性能优化和 App Phase 4 功能

8. **性能优化**
   - 对话时间线虚拟列表完整应用
   - TraceSpan/Memory 虚拟列表和分页
   - Token 分段折叠
   - 1000+ items 性能测试

9. **App Phase 4 功能**
   - 人工审批卡片（需 Agent 支持入站审批决策）
   - 跨会话记忆浏览/搜索/禁用/固定
   - Token 成本趋势和 backend 对比

10. **测试覆盖补齐**
    - App Snapshot 聚合测试
    - App Delta 去重测试
    - Memory GC 和 TTL 测试
    - 并发访问测试

---

## 6. 需求文档处理建议

### 保留文档（作为设计参考）

**建议保留以下文档，但更新状态标记：**

1. **4.iota_engine_design_0425.md**
   - 更新状态：`草案 / 待实现` → `设计参考 / 部分实现`
   - 添加实现状态章节，标注已实现/部分实现/未实现
   - 保留作为 Engine 可见性机制的完整设计参考

2. **5.iota_app_design.md**
   - 更新状态：`草案 / 待实现` → `设计参考 / 部分实现`
   - 添加实现状态章节，标注 Phase 1/2/3/4 完成度
   - 保留作为 App 前端的完整设计参考

3. **6.iota_memory_design.md**
   - 更新状态：`完整设计 / 待实现` → `设计参考 / 核心已实现`
   - 添加实现状态章节，标注 Phase 1/2/3/4 完成度
   - 保留作为 Memory System 的完整设计参考

### 文档更新建议

在每份文档开头添加实现状态章节：

```markdown
## 实现状态说明

**当前实现状态（2026-04-28）：**

✅ **已实现：**
- [列出已实现的核心功能]

🔄 **部分实现：**
- [列出部分实现的功能和缺失部分]

❌ **未实现：**
- [列出未实现的功能]

详细实现状态对比见：`docs/requirement/IMPLEMENTATION_STATUS.md`
```

### 不建议删除的原因

1. **设计完整性：** 这些文档包含完整的设计思路、架构决策和验收标准，是未来开发的重要参考
2. **未实现功能：** 仍有 30-40% 的高级功能未实现，删除文档会丢失设计细节
3. **测试基准：** 文档中的验收标准是测试覆盖的重要基准
4. **新成员 onboarding：** 完整的设计文档有助于新成员理解系统架构

---

## 7. 结论

**当前状态：** Iota 项目的核心架构和基础功能已基本实现，可以支持四后端统一执行、记忆注入、可见性收集和 App 基础展示。

**主要缺口：**
1. CLI visibility 高级命令（会话级、交互式、导出）
2. App WebSocket delta 完整实现和测试
3. 四后端真实样本集成测试
4. App Phase 3/4 高级功能
5. Workspace 和 Memory 完整对接

**建议：** 保留三份需求文档作为设计参考，更新实现状态标记，按照上述行动计划分三个阶段补齐缺失功能。

**预计完成时间：** 按照上述计划，完整实现所有设计功能需要 9-12 周。如果只补齐核心验收（Phase 1），需要 2-3 周。
