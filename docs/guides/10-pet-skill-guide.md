# 宠物技能指南

**版本：** 1.0  
**最后更新：** 2026 年 4 月

## 1. 简介

本文档说明 `iota-skill/pet-generator/SKILL.md` 的设计目标、真实数据来源、组合规则，以及后续如何把它接入 Iota 的实际技能执行链路。

这个 skill 的目标不是让模型凭空编造一只宠物，而是要求它调用 `iota-fun/` 下的多语言函数，拼装出一个带多属性的宠物实例。

## 2. 当前位置

技能文件位于：

- [pet-generator SKILL.md](/abs/path/D:/coding/creative/iota/iota-skill/pet-generator/SKILL.md)

技能目录说明位于：

- [iota-skill/README.md](/abs/path/D:/coding/creative/iota/iota-skill/README.md)

## 3. 触发条件

当用户请求中包含 `生成宠物` 时，应匹配这个 skill。

示例：

- `生成宠物`
- `生成宠物，用可爱一点的语气`
- `生成宠物，并输出属性清单`
- `生成宠物，输出 JSON`

## 4. 真实数据来源

这个 skill 必须读取并调用 `iota-fun/` 的真实函数。不能凭示例模板硬编码词汇。

当前实际词表如下。

### `cpp` 动作

文件：[
random_action.cpp](/abs/path/D:/coding/creative/iota/iota-fun/cpp/random_action.cpp)

真实输出集合：

- `睡觉`
- `奔跑`
- `喝水`
- `吃饭`
- `捕捉`
- `发呆`

### `typescript` 颜色

文件：[randomColor.ts](/abs/path/D:/coding/creative/iota/iota-fun/typescript/randomColor.ts)

真实输出集合：

- `red`
- `blue`
- `green`
- `yellow`
- `black`
- `white`

### `rust` 材质

文件：[random_material.rs](/abs/path/D:/coding/creative/iota/iota-fun/rust/random_material.rs)

真实输出集合：

- `wood`
- `metal`
- `glass`
- `plastic`
- `stone`

### `zig` 尺寸

文件：[random_size.zig](/abs/path/D:/coding/creative/iota/iota-fun/zig/random_size.zig)

真实输出集合：

- `大`
- `中`
- `小`

### `java` 动物

文件：[RandomAnimal.java](/abs/path/D:/coding/creative/iota/iota-fun/java/RandomAnimal.java)

真实输出集合：

- `猫`
- `狗`
- `鸟`

### `python` 数字

文件：[random_number.py](/abs/path/D:/coding/creative/iota/iota-fun/python/random_number.py)

真实输出范围：

- `1-100` 的随机整数

### `go` 形状

文件：[random_shape.go](/abs/path/D:/coding/creative/iota/iota-fun/go/random_shape.go)

真实输出集合：

- `circle`
- `square`
- `triangle`
- `star`
- `hexagon`

## 5. 组合规则

收集 7 个真实输出后，组合成一只宠物描述。

推荐模板：

```text
一只正在{cpp动作}的、{typescript颜色}的、{rust材质}感的、{zig尺寸}号的{java动物}，抱着一个 {python数字} 厘米、{go形状} 的飞盘。
```

例如，若真实调用结果分别为：

- `cpp`: `睡觉`
- `typescript`: `red`
- `rust`: `metal`
- `zig`: `大`
- `java`: `猫`
- `python`: `80`
- `go`: `circle`

则输出可以是：

```text
一只正在睡觉的、red 的、metal 感的、大号的猫，抱着一个 80 厘米、circle 的飞盘。
```

## 6. 重要约束

### 不要伪造词表

不允许把模板里的占位词当成真实函数输出。

错误示例：

- 把 `cpp` 当成会返回 `sleeping`
- 把 `java` 当成会返回 `cat`
- 把 `go` 当成会返回 `round`

这些都和当前 `iota-fun/` 的真实实现不一致。

### 不要默认翻译

当前 `iota-fun/` 输出是中英混合的：

- `cpp` / `zig` / `java` 返回中文
- `typescript` / `rust` / `go` 返回英文

默认情况下应该保留这种真实输出风格，不要擅自把：

- `猫` 改成 `cat`
- `大` 改成 `large`
- `circle` 改成 `圆形`

只有在用户明确要求翻译、本地化或统一风格时，才可以做二次转换。

### 失败时要显式说明

如果某个语言运行时缺失，或某一步调用失败，必须明确指出缺失项。

不要静默用默认词替代。

## 7. 推荐输出结构

默认推荐输出两部分：

1. 一段自然语言描述
2. 一份属性清单

示例：

```text
一只正在睡觉的、red 的、metal 感的、大号的猫，抱着一个 80 厘米、circle 的飞盘。

属性：
- action: 睡觉
- color: red
- material: metal
- size: 大
- animal: 猫
- lengthCm: 80
- toyShape: circle
- toy: 飞盘
```

若用户要求 JSON，可以输出：

```json
{
  "description": "一只正在睡觉的、red 的、metal 感的、大号的猫，抱着一个 80 厘米、circle 的飞盘。",
  "pet": {
    "action": "睡觉",
    "color": "red",
    "material": "metal",
    "size": "大",
    "animal": "猫"
  },
  "toy": {
    "name": "飞盘",
    "shape": "circle",
    "lengthCm": 80
  }
}
```

## 8. 当前实现状态

当前仓库里：

- 已创建 skill 规范文件
- 尚未把 `iota-skill/` 自动发现、匹配、执行接入 `iota-engine`

这意味着现在它还是一个技能规范，而不是已经自动生效的 runtime feature。

## 9. 后续接入建议

要让这个 skill 真正生效，下一步通常需要补这几层：

1. `iota-engine` 增加 skill 目录发现逻辑
2. 增加基于请求文本的 skill 匹配逻辑
3. 为 `pet-generator` 增加实际执行器
4. 执行器内部顺序调用 7 个 `iota-fun` 函数
5. 把组合结果回填到标准 `RuntimeEvent` / `tool_call` / `tool_result` 流程

## 10. 相关文档

- [iota-fun README](/abs/path/D:/coding/creative/iota/iota-fun/README.md)
- [fun-intent.ts](/abs/path/D:/coding/creative/iota/iota-engine/src/fun-intent.ts)
- [fun-engine.ts](/abs/path/D:/coding/creative/iota/iota-engine/src/fun-engine.ts)
- [pet-generator SKILL.md](/abs/path/D:/coding/creative/iota/iota-skill/pet-generator/SKILL.md)
