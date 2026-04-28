# 宠物技能指南

**版本：** 1.0  
**最后更新：** 2026 年 4 月

## 1. 简介

本文档说明 `iota-skill/pet-generator/SKILL.md` 的设计目标、真实数据来源、组合规则，以及后续如何把它接入 Iota 的实际技能执行链路。

这个 skill 的目标不是让模型凭空编造一只宠物，而是要求它调用 `iota-fun/` 下的多语言函数，拼装出一个带多属性的宠物实例。

## 2. 当前位置

技能文件位于：

- [`iota-skill/pet-generator/SKILL.md`](../../iota-skill/pet-generator/SKILL.md)

工具函数位于：

- [`iota-skill/pet-generator/iota-fun/`](../../iota-skill/pet-generator/iota-fun/)

## 3. 触发条件

当用户请求中包含 `生成宠物` 时，engine 自动触发本 skill（在 `runPetSkillExecution` 路径中执行，不经过 backend approval）。

```bash
bun iota-cli/dist/index.js run --backend claude-code "生成宠物"
```

示例：

- `生成宠物`
- `生成宠物，用可爱一点的语气`
- `生成宠物，并输出属性清单`
- `生成宠物，输出 JSON`

## 4. 真实数据来源

这个 skill 必须读取并调用 `iota-skill/pet-generator/iota-fun/` 的真实函数。不能凭示例模板硬编码词汇。

当前实际词表如下。

### `cpp` 动作

文件：[`iota-skill/pet-generator/iota-fun/cpp/random_action.cpp`](../../iota-skill/pet-generator/iota-fun/cpp/random_action.cpp)

真实输出集合：

- `睡觉`
- `奔跑`
- `喝水`
- `吃饭`
- `捕捉`
- `发呆`

### `typescript` 颜色

文件：[`iota-skill/pet-generator/iota-fun/typescript/randomColor.ts`](../../iota-skill/pet-generator/iota-fun/typescript/randomColor.ts)

真实输出集合：

- `red`
- `blue`
- `green`
- `yellow`
- `black`
- `white`

### `rust` 材质

文件：[`iota-skill/pet-generator/iota-fun/rust/random_material.rs`](../../iota-skill/pet-generator/iota-fun/rust/random_material.rs)

真实输出集合：

- `wood`
- `metal`
- `glass`
- `plastic`
- `stone`

### `zig` 尺寸

文件：[`iota-skill/pet-generator/iota-fun/zig/random_size.zig`](../../iota-skill/pet-generator/iota-fun/zig/random_size.zig)

> **运行时状态：** 需要安装 `zig` 编译器。当前开发环境未安装，调用会失败并在输出中明确标注，不静默补默认值。

真实输出集合：

- `大`
- `中`
- `小`

### `java` 动物

文件：[`iota-skill/pet-generator/iota-fun/java/RandomAnimal.java`](../../iota-skill/pet-generator/iota-fun/java/RandomAnimal.java)

真实输出集合：

- `猫`
- `狗`
- `鸟`

### `python` 数字

文件：[`iota-skill/pet-generator/iota-fun/python/random_number.py`](../../iota-skill/pet-generator/iota-fun/python/random_number.py)

真实输出范围：

- `1-100` 的随机整数

### `go` 形状

文件：[`iota-skill/pet-generator/iota-fun/go/random_shape.go`](../../iota-skill/pet-generator/iota-fun/go/random_shape.go)

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

| 语言 | 可执行文件 | 本机状态 | 属性 |
|------|-----------|---------|------|
| cpp | `g++` | ✅ Apple clang 21.0 | action |
| typescript | `node` | ✅ v25.9.0 | color |
| rust | `rustc` | ✅ 1.95.0 | material |
| zig | `zig` | ✅ 0.16.0 | size |
| java | `javac` / `java` | ✅ 25 | animal |
| python | `python3` | ✅ 3.14.4 | lengthCm |
| go | `go` | ✅ 1.26.2 | toyShape |

zig 未安装时，size 属性会在输出中明确标注失败，不静默补默认值。当前所有 7 个语言运行时均已就绪。

> **注意：** zig 0.16.0 标准库移除了 `std.io`，`runner.zig` 改用 libc `write()` 直接写 stdout。

## 9. CLI 使用示例

### 9.1 四种 Backend 的执行方式

#### Claude Code

```bash
cd iota-cli
node dist/index.js run --backend claude-code "生成宠物"
```

#### Codex

```bash
cd iota-cli
node dist/index.js run --backend codex "生成宠物"
```

#### Gemini CLI

```bash
cd iota-cli
node dist/index.js run --backend gemini "生成宠物"
```

#### Hermes Agent

```bash
cd iota-cli
node dist/index.js run --backend hermes "生成宠物"
```

### 9.2 执行日志示例

```
[iota-skill] total skills loaded: 1
[iota-engine] skills active: pet-generator

[iota-pet] starting parallel fun execution for cpp, typescript, rust, zig, java, python, go
[iota-pet] fun.cpp → "奔跑"
[iota-pet] fun.typescript → "black"
[iota-pet] fun.rust → "wood"
[iota-pet] fun.zig → "中"
[iota-pet] fun.java → "鸟"
[iota-pet] fun.python → "10"
[iota-pet] fun.go → "square"

一只正在奔跑的、black 的、wood 感的、中号的鸟，抱着一个 10 厘米、square 的飞盘。
```

## 10. 接入原理与流程图

### 10.1 整体架构

Engine 在 `init()` 时调用 `loadSkills(skillRoot)` 读取 `iota-skill/` 下所有子目录的 `SKILL.md`，构建 `<iota_skills>` 区块并存入 `this.skills`。

### 10.2 执行流程（非 Hermes Backend）

当 `runExecution` 检测到 prompt 包含 `生成宠物` 时，走独立的 `runPetSkillExecution` 路径：

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. CLI 接收用户输入                                                   │
│    iota-cli: node dist/index.js run --backend <name> "生成宠物"      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. IotaEngine 检测 prompt                                            │
│    engine.execute() → detectFunIntent() → 匹配 "生成宠物"            │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. 触发 runPetSkillExecution()                                       │
│    不注入 skill 区块给 LLM，由 Engine 直接控制执行                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. 并发调用 IotaFunEngine.execute() × 7                              │
│    ├─ fun.cpp        → spawn g++ → 编译 → 执行 → "奔跑"              │
│    ├─ fun.typescript → spawn node → 执行 → "black"                   │
│    ├─ fun.rust       → spawn rustc → 编译 → 执行 → "wood"            │
│    ├─ fun.zig        → spawn zig → 执行 → "中"                       │
│    ├─ fun.java       → spawn javac → 编译 → spawn java → "鸟"        │
│    ├─ fun.python     → spawn python → 执行 → "10"                    │
│    └─ fun.go         → spawn go → 执行 → "square"                    │
│                                                                       │
│    每个调用 emit tool_call / tool_result 事件                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. 构建结构化 prompt                                                  │
│    将 7 个真实属性值拼接成 prompt：                                    │
│    "请用以下属性组合宠物描述：action=奔跑, color=black, ..."           │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. 调用 Backend LLM                                                  │
│    backend.execute() → Claude Code / Codex / Gemini CLI              │
│    LLM 接收纯文字 prompt（无 skill 区块，无 shell 调用权限）          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. LLM 生成自然语言描述                                               │
│    "一只正在奔跑的、black 的、wood 感的、中号的鸟，..."               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. 输出事件流回 CLI                                                   │
│    emit output 事件 → CLI 显示结果                                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.3 Hermes Backend 特殊流程

Hermes 使用 MCP (Model Context Protocol) 方式，LLM 可以直接调用 fun.* 工具：

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. CLI 接收用户输入                                                   │
│    iota-cli: node dist/index.js run --backend hermes "生成宠物"      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. HermesAdapter 启动 hermes acp 进程                                 │
│    session/new → 注册 iota-fun-mcp server                            │
│    mcpServers: [{ name: "iota-fun", command: "node",                │
│                   args: ["dist/mcp/fun-server.js"] }]               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. iota-fun-mcp server 启动                                          │
│    监听 stdin，暴露 7 个工具：                                         │
│    fun.cpp, fun.typescript, fun.rust, fun.zig,                      │
│    fun.java, fun.python, fun.go                                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Hermes LLM 接收 prompt "生成宠物"                                  │
│    LLM 理解需要调用 fun.* 工具获取属性                                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. LLM 并发调用 MCP 工具                                              │
│    ├─ MCP call: fun.cpp                                             │
│    │   └─ iota-fun-mcp → IotaFunEngine.execute({language: "cpp"})  │
│    │       └─ spawn g++ → 编译 → 执行 → 返回 "奔跑"                  │
│    ├─ MCP call: fun.typescript                                      │
│    │   └─ iota-fun-mcp → IotaFunEngine.execute({language: "ts"})   │
│    │       └─ spawn node → 执行 → 返回 "black"                      │
│    ├─ MCP call: fun.rust                                            │
│    │   └─ iota-fun-mcp → IotaFunEngine.execute({language: "rust"}) │
│    │       └─ spawn rustc → 编译 → 执行 → 返回 "wood"               │
│    ├─ MCP call: fun.zig                                             │
│    │   └─ iota-fun-mcp → IotaFunEngine.execute({language: "zig"})  │
│    │       └─ spawn zig → 执行 → 返回 "中"                          │
│    ├─ MCP call: fun.java                                            │
│    │   └─ iota-fun-mcp → IotaFunEngine.execute({language: "java"}) │
│    │       └─ spawn javac → 编译 → spawn java → 返回 "鸟"           │
│    ├─ MCP call: fun.python                                          │
│    │   └─ iota-fun-mcp → IotaFunEngine.execute({language: "py"})   │
│    │       └─ spawn python → 执行 → 返回 "10"                       │
│    └─ MCP call: fun.go                                              │
│        └─ iota-fun-mcp → IotaFunEngine.execute({language: "go"})   │
│            └─ spawn go → 执行 → 返回 "square"                       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. LLM 收集所有工具返回值                                              │
│    action=奔跑, color=black, material=wood, size=中,                 │
│    animal=鸟, lengthCm=10, toyShape=square                           │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 7. LLM 生成自然语言描述                                               │
│    "一只正在奔跑的、black 的、wood 感的、中号的鸟，..."               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 8. 输出事件流回 CLI                                                   │
│    session/update → HermesAdapter → emit output → CLI 显示结果       │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.4 关键组件说明

| 组件 | 职责 | 位置 |
|------|------|------|
| `IotaEngine` | 检测 prompt、路由执行、事件编排 | `iota-engine/src/engine.ts` |
| `IotaFunEngine` | 执行多语言函数、管理子进程 | `iota-engine/src/fun-engine.ts` |
| `detectFunIntent` | 识别 "生成宠物" 触发词 | `iota-engine/src/fun-intent.ts` |
| `loadSkills` | 加载 SKILL.md 文件 | `iota-engine/src/skill/loader.ts` |
| `iota-fun-mcp server` | MCP 协议服务器（仅 Hermes） | `iota-engine/src/mcp/fun-server.ts` |
| `HermesAdapter` | Hermes ACP 协议适配器 | `iota-engine/src/backend/hermes.ts` |
| 多语言工具函数 | 7 种语言的随机属性生成器 | `iota-skill/pet-generator/iota-fun/` |

### 10.5 两种模式对比

| 特性 | 非 Hermes Backend | Hermes Backend |
|------|------------------|----------------|
| 工具调用方式 | Engine 直接调用 IotaFunEngine | LLM 通过 MCP 调用 |
| Skill 区块注入 | 不注入（避免 LLM 执行 shell） | 不需要（MCP 工具自动暴露） |
| 并发控制 | Engine 控制并发 | LLM 自主决定并发 |
| 工具可见性 | 对 LLM 不可见 | 对 LLM 可见（tools/list） |
| 适用场景 | 确定性执行流程 | LLM 自主工具编排 |

## 11. 相关文档

- [`iota-skill/pet-generator/iota-fun/README.md`](../../iota-skill/pet-generator/iota-fun/README.md)
- [`iota-engine/src/fun-intent.ts`](../../iota-engine/src/fun-intent.ts)
- [`iota-engine/src/fun-engine.ts`](../../iota-engine/src/fun-engine.ts)
- [`iota-engine/src/skill/loader.ts`](../../iota-engine/src/skill/loader.ts)
- [`iota-engine/src/backend/prompt-composer.ts`](../../iota-engine/src/backend/prompt-composer.ts)
- [`iota-skill/pet-generator/SKILL.md`](../../iota-skill/pet-generator/SKILL.md)
- [`iota-engine/src/mcp/fun-server.ts`](../../iota-engine/src/mcp/fun-server.ts)
- [`iota-engine/src/backend/hermes.ts`](../../iota-engine/src/backend/hermes.ts)
