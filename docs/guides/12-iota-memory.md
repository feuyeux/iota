# Iota Memory 技术分享：跨后端上下文流转与持久化验证

**版本：** 1.0
**最后更新：** 2026-04-29
**验证环境：** Windows workspace `D:\coding\creative\iota`

这篇文档记录 Iota Memory 在多后端（Claude Code, Codex, Gemini CLI, Hermes）间切换时的记忆写入、持久化与注入机制验证实验。它不仅是一个测试清单，更是为了回答一个核心架构问题：如何在无缝切换 AI 后端时，保证上下文不丢失，并按不同记忆维度精准流转。

## 核心结论

Iota Memory 解决的不是简单的“保存历史聊天记录”问题，而是要实现**跨后端的结构化上下文流转**。

四种维度的记忆：
- `factual` (事实)：用户是谁、客观事实。
- `strategic` (战略)：项目目标、高层指导方针。
- `procedural` (程序)：操作步骤、如何做某事。
- `episodic` (情景)：经历过的对话和复盘叙事。

通过在不同后端间穿插执行，我们验证了：
1. **记忆类型的隔离与提取**：不同类型的记忆被独立提取并存储在 Redis 中，不会互相污染（如 R1 的 `factual` 与 R2 的 `strategic` 独立存储）。
2. **跨后端的无缝注入**：由 Claude Code 写入的记忆，在 Codex 或 Gemini 接管时，能够被正确召回（`selectedCount > 0`）并注入到 Prompt 中，使新后端完全感知前序后端的上下文。
3. **身份更新与持久化**：记忆可以随时间追加和更新（如 R7 增加“产品经理”身份），并在后续的综合复盘（R8）中准确体现。

一句话概括：
```text
Memory Types = Factual + Strategic + Procedural + Episodic
Engine       = Extract + Store (Redis) + Recall + Inject
Backend      = Replaceable execution engine, sharing the same external brain
```

## 为什么要做跨后端多轮实验？

在多智能体或多模型架构中，最痛点的问题是“记忆割裂”。通常每个工具或模型实例维护自己的 Session，一旦切换底层大模型（比如因为配额限制、专长不同或离线/在线切换），之前的上下文就全部丢失。

我们的实验设计，就是为了证明 Iota 的架构将记忆状态从模型内部抽取到了 Engine 层面。

实验路径设计为 8 轮（R1-R8），刻意让每个动作（写入和读取）由不同的模型完成：
- **Claude Code** 负责初次写入事实（R1）。
- **Codex** 验证能否读到该事实，并写入新的战略方向（R2）。
- **Gemini CLI** 测试能否在总结工作流时，融合前面的事实和战略，生成程序性记忆（R3）。
- **Hermes / Codex / Gemini** 等负责做全局的情景复盘（R4/R8）。

这种“接力赛”式的验证，排除了模型自身缓存上下文的可能，证明完全是 Engine 在通过外部 Redis 完成记忆的存取和注入。

## 执行与验证链路

在 8 轮对话中，Engine 的处理链路如下：

```text
用户 prompt
  -> IotaEngine 接收请求
  -> Memory 模块从 Redis 中召回相关记忆 (Recall)
  -> 组装 Prompt，注入记忆上下文 (Inject)
  -> 选择 backend adapter (Claude / Codex / Gemini / Hermes) 执行
  -> 模型返回结果
  -> Memory 模块分析结果，提取新记忆 (Extract)
  -> 分类为 factual / strategic / procedural / episodic 并持久化到 Redis (Store)
```

在 2026-04-29 的 Windows 环境下（因 Hermes 支持限制，R4/R8 使用 Claude Code 和 Codex 替代），我们跑通了全部 8 轮验证：

| 轮次 | 负责后端 | 操作与结果摘要 | 验证类型与状态 |
| ---- | -------- | -------------- | -------------- |
| R1 | `claude-code` | 「我叫张明…架构师」 | 写入 `factual=1` ✓ |
| R2 | `codex` | 「项目战略目标…」 | 注入 R1，写入 `strategic=1` ✓ |
| R3 | `gemini` | 「请用 3 步总结…」 | 注入 R1+R2，写入 `procedural=1` ✓ |
| R4 | `claude-code` | 「请回顾…复盘」 | 读取前 3 轮，写入 `episodic=1` ✓ |
| R5 | `claude-code` | 「我是谁？战略是什么？」| 跨后端正确读取 `factual` + `strategic` ✓ |
| R6 | `codex` | 「3 步骤分别是什么？」| 跨后端正确读取 `procedural` ✓ |
| R7 | `gemini` | 「兼任产品经理…」 | 更新 `factual`，总数由 2 变 3 ✓ |
| R8 | `codex` | 「综合复盘…」 | 成功输出「架构师+产品经理/战略/3步」 ✓ |

## 通过判据与数据支撑

实验最终的 Redis 存储状态与预期完全一致：

```text
factual      : 3
strategic    : 1
procedural   : 2
episodic     : 2
```

**判据核对结果**：
1. **跨后端读**：R2-R8 的 trace 日志中均显示 `memory.inject selectedCount > 0`，证明外部召回生效。
2. **跨后端写**：四种类型的记忆均被相应的后端成功触发提取与写入。
3. **类型隔离**：4 类前缀 key（`iota:memory:factual:*` 等）同时存在，无数据窜入。
4. **状态可变与更新**：R7 追加身份后，R8 的综合输出包含了最新的混合状态。

## 总结

Iota Memory 证明了“外挂大脑”模式的有效性。无论底层的执行器是哪个大模型的 CLI 或 API，只要遵循同一套记忆分类、提取和注入契约，系统的认知就能保持连贯。这为 Iota 后续支持更多形态的 Agent 和无缝切换模型提供了坚实的底层技术保障。
