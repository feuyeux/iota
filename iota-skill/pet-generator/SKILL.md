---
name: pet-generator
description: 当用户请求"生成宠物"时，并行调用 iota-skill/pet-generator/iota-fun 下的 7 个多语言工具函数，将真实结果组合成宠物描述。
---

# Pet Generator

## Purpose

当请求中包含"生成宠物"时，通过**并行调用 `fun.*` 工具**获取真实的随机属性值，组合成一只完整的宠物描述。

**重要：不要凭空编造属性值，不要使用文档中的示例值。** 每个属性必须来自对应工具的真实调用结果。

## Available Tools

以下工具位于 `iota-skill/pet-generator/iota-fun/` 目录下，由 iota-engine 提供，可在执行时直接调用：

| 工具名 | 返回属性 | 示例输出 |
|--------|---------|---------|
| `fun.cpp` | action（动作） | `睡觉` / `奔跑` / `喝水` / `吃饭` / `捕捉` / `发呆` |
| `fun.typescript` | color（颜色） | `red` / `blue` / `green` / `yellow` / `black` / `white` |
| `fun.rust` | material（材质） | `wood` / `metal` / `glass` / `plastic` / `stone` |
| `fun.zig` | size（尺寸） | `大` / `中` / `小` |
| `fun.java` | animal（动物） | `猫` / `狗` / `鸟` |
| `fun.python` | lengthCm（数字） | `1`–`100` 的随机整数 |
| `fun.go` | toyShape（形状） | `circle` / `square` / `triangle` / `star` / `hexagon` |

## Execution Instructions

**重要：直接在当前会话中调用这些 MCP 工具，不要使用 `terminal`、`execute_code`、`delegate` 或任何 shell 命令来模拟工具调用结果。`fun.*` 工具必须通过 MCP 工具调用执行，不可用 echo 或其他命令替代。**

1. **在当前会话中直接调用** MCP 工具，调用全部 7 个：`fun.cpp`、`fun.typescript`、`fun.rust`、`fun.zig`、`fun.java`、`fun.python`、`fun.go`
2. 等待所有工具返回真实结果
3. 用真实结果组合宠物描述（见 Output Contract）
4. 如某个工具调用失败，在输出中明确标注，不要用默认值替代

## Output Contract

默认输出两部分：

1. **自然语言描述**（保留各工具输出的原始词形，不要翻译）
2. **属性清单**

示例格式（值必须来自真实工具调用，不要使用下面的占位符）：

```
一只正在{action}的、{color}的、{material}感的、{size}号的{animal}，抱着一个 {lengthCm} 厘米、{toyShape} 的飞盘。

属性：
- action: {fun.cpp 的实际返回值}
- color: {fun.typescript 的实际返回值}
- material: {fun.rust 的实际返回值}
- size: {fun.zig 的实际返回值}
- animal: {fun.java 的实际返回值}
- lengthCm: {fun.python 的实际返回值}
- toyShape: {fun.go 的实际返回值}
```

## Guardrails

- 不要伪造工具输出；每个属性都应来自对应工具的真实调用结果
- 不要擅自翻译：`猫` 不改成 `cat`，`circle` 不改成 `圆形`，除非用户明确要求
- 工具调用失败时明确说明，不静默补默认值
- 不要输出调试信息或命令行堆栈
- 输出中的单位统一用 `厘米` 或 `cm`，不要混用
