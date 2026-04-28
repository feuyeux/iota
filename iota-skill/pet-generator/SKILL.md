---
name: pet-generator
description: 当用户请求“生成宠物”时，调用 iota-fun 下的多语言随机函数，组合成一只带丰富属性和玩具描述的宠物。
---

# Pet Generator

## Purpose

当请求中包含“生成宠物”时，这个 skill 负责把 `iota-fun/` 的多语言随机函数拼装成一个完整的宠物实例描述，而不是只返回单个随机值。

## Inputs

触发信号：用户请求包含 `生成宠物`。

用户可以额外给出风格、语气或输出格式要求，例如：

- `生成宠物`
- `生成宠物，用童话风格描述`
- `生成宠物，输出 JSON`

## Required Calls

依次调用 `iota-fun/` 中的各语言函数，收集这些属性：

- `cpp`：动作，真实输出来自 `random_action.cpp`，例如 `睡觉`、`奔跑`、`喝水`、`吃饭`、`捕捉`、`发呆`
- `typescript`：颜色，真实输出来自 `randomColor.ts`，例如 `red`、`blue`、`green`、`yellow`、`black`、`white`
- `rust`：材质，真实输出来自 `random_material.rs`，例如 `wood`、`metal`、`glass`、`plastic`、`stone`
- `zig`：尺寸，真实输出来自 `random_size.zig`，例如 `大`、`中`、`小`
- `java`：动物种类，真实输出来自 `RandomAnimal.java`，例如 `猫`、`狗`、`鸟`
- `python`：数字，例如 `80`
- `go`：形状，真实输出来自 `random_shape.go`，例如 `circle`、`square`、`triangle`、`star`、`hexagon`

## Composition Rule

把这些属性组合成一只宠物，并为它补一个“模型生成的、这只动物喜欢的玩具”。

推荐组合模板：

`一只正在{cpp动作}的、{typescript颜色}的、{rust材质}感的、{zig尺寸}号的{java动物}，抱着一个 {python数字} 厘米、{go形状} 的飞盘。`

这里必须保留各函数的真实输出风格，不要擅自把它们统一翻译。例如：

- `cpp` 当前返回中文动作
- `zig` 当前返回中文尺寸
- `java` 当前返回中文动物
- `typescript` / `rust` / `go` 当前返回英文单词

如果用户要求英文或结构化输出，可以在保持属性来源不变的前提下调整表达形式。

## Output Contract

默认输出一段自然语言描述，并附带属性清单。

示例：

`一只正在睡觉的、red 的、metal 感的、大号的猫，抱着一个 80 厘米、circle 的飞盘。`

属性清单：

- `action`: `睡觉` from `cpp`
- `color`: `red` from `typescript`
- `material`: `metal` from `rust`
- `size`: `大` from `zig`
- `animal`: `猫` from `java`
- `lengthCm`: `80` from `python`
- `toyShape`: `circle` from `go`
- `toy`: `frisbee`

## Guardrails

- 不要伪造 `iota-fun` 输出；每个属性都应来自相应语言函数的真实调用结果。
- 不要把真实输出偷偷改写成另一个词表。例如不要把 `猫` 擅自改成 `cat`，也不要把 `circle` 擅自改成 `圆形`，除非用户明确要求翻译或本地化。
- 如果某个语言运行时缺失或调用失败，明确说明缺失项，不要静默补默认值。
- 除非用户要求，否则不要输出调试信息、命令行或堆栈。
- 输出中的单位统一用 `厘米` 或 `cm`，不要混用。

## Implementation Notes

这个 skill 当前放在 `iota-skill/pet-generator/SKILL.md`，作为技能规范存在。

要真正自动触发它，需要后续把 skill 发现、匹配和执行接入 `iota-engine` / `iota-cli` 的实际技能系统。
