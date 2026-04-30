# Iota Skill 技术分享：把确定性能力从模型里拿出来

**版本：** 2.0
**最后更新：** 2026-04-29
**验证环境：** Windows workspace `D:\coding\creative\iota`

这篇文档记录 `pet-generator` 这个结构化 skill 的设计取舍、真实执行链路和本机验证结果。它不是一篇概念介绍：文中的结论来自已验证 backend 的 traced request；新增 OpenCode ACP 后端需在本机可用后补充同类验证，以及 `iota-fun` 下七种语言工具的真实运行。

## 核心结论

`生成宠物` 这类能力不应该交给模型每次重新推理。七个工具要不要调用、是否并行、结果如何拼接，都是确定规则；这些规则应写在 skill 声明里，由 Engine 执行，而不是依赖 Claude Code、Codex、Gemini CLI、Hermes Agent 或 OpenCode 自行发现 MCP 工具。

Iota 在这里验证的是两个边界：

1. backend 可以换，skill 的触发、编排和输出契约不变；
2. 工具可以用不同语言实现，但都通过 MCP 这一条进程边界进入 Engine 的可观测链路。

一句话概括：

```text
Skill   = triggers + execution plan + output template
Engine  = load + match + run + observe
MCP     = process boundary
IotaFun = local multi-language executor
Backend = replaceable kernel, not the source of skill behavior
```

## 为什么不是让模型自己调用工具

最初的自然做法是把 `iota-fun` 暴露成 MCP server，让 backend LLM 自己读说明、自己决定是否调用七个工具。实测中这条路有几个问题：

- 不同 backend 对工具发现和并行调用的行为差异明显；
- 同一件确定性任务会被模型当成开放式推理问题处理；
- 有时模型会生成“受限环境中无法直接调用 MCP server”一类自述，而不是实际调用工具；
- 出错时很难判断失败发生在模型决策、MCP 注入、工具执行还是输出拼接。

`pet-generator` 的关键判断是：这件事不需要模型思考。模型适合处理开放问题；skill 适合处理已经能声明清楚的固定流程。

## Skill 声明

`iota-skill/pet-generator/SKILL.md` 的 frontmatter 是唯一的业务声明源：

```yaml
name: pet-generator
description: 当用户请求"生成宠物"时，通过 iota-fun MCP server 并行调用 7 个多语言工具函数，将真实结果组合成宠物描述。
triggers:
  - 生成宠物
  - generate pet
  - create pet
execution:
  mode: mcp
  server: iota-fun
  parallel: true
  tools:
    - name: fun.cpp
      as: action
    - name: fun.typescript
      as: color
    - name: fun.rust
      as: material
    - name: fun.zig
      as: size
    - name: fun.java
      as: animal
    - name: fun.python
      as: lengthCm
    - name: fun.go
      as: toyShape
output:
  template: |
    一只正在{{action}}的、{{color}}的、{{material}}感的、{{size}}号的{{animal}}，抱着一个 {{lengthCm}} 厘米、{{toyShape}} 的飞盘。

    属性：
    - action: {{action}}
    - color: {{color}}
    - material: {{material}}
    - size: {{size}}
    - animal: {{animal}}
    - lengthCm: {{lengthCm}}
    - toyShape: {{toyShape}}
failurePolicy: report
```

Engine 不包含 `if (prompt === "生成宠物")` 这样的专用分支，也不内置宠物属性清单。新增同类能力时，应新增或修改 `SKILL.md`，而不是把业务逻辑写回 Engine。

## 执行链路

```text
用户 prompt: 生成宠物
  -> IotaEngine.buildRequest()
  -> loadSkills(skill.roots) 加载 pet-generator
  -> matchExecutableSkill(prompt, skills) 命中 triggers
  -> 选择 backend adapter: claude-code / codex / gemini / hermes / opencode（结构化 skill 不依赖后端自行调用工具）
  -> runSkillViaMcp()
       - 持久化 7 个 tool_call
       - 按 execution.parallel 并行调用 MCP tools/call
  -> McpRouter -> iota-fun MCP server
  -> IotaFunEngine.execute(language)
       - 解释型语言直接运行
       - 编译型语言先编译到 $HOME/.iota/iota-fun，再运行缓存产物
  -> 持久化 7 个 tool_result
  -> 渲染 output.template
  -> 持久化 output、visibility、audit、execution 状态
```

命中结构化 skill 后，Engine 不等待 backend LLM 自行发现 `iota-fun`。backend 仍然被记录在 execution 上，普通请求也仍然走各自模型；但 `生成宠物` 的工具编排和最终输出由 `SkillRunner` 确定性完成。

失败策略也在这条链路里收束：任何 MCP tool 返回 `isError: true`，execution 会失败并列出失败工具，不使用默认值补齐。

## 七种工具

| MCP 工具         | 输出字段   | 语言       | 源码目录                                        |
| ---------------- | ---------- | ---------- | ----------------------------------------------- |
| `fun.cpp`        | `action`   | C++        | `iota-skill/pet-generator/iota-fun/cpp/`        |
| `fun.typescript` | `color`    | TypeScript | `iota-skill/pet-generator/iota-fun/typescript/` |
| `fun.rust`       | `material` | Rust       | `iota-skill/pet-generator/iota-fun/rust/`       |
| `fun.zig`        | `size`     | Zig        | `iota-skill/pet-generator/iota-fun/zig/`        |
| `fun.java`       | `animal`   | Java       | `iota-skill/pet-generator/iota-fun/java/`       |
| `fun.python`     | `lengthCm` | Python     | `iota-skill/pet-generator/iota-fun/python/`     |
| `fun.go`         | `toyShape` | Go         | `iota-skill/pet-generator/iota-fun/go/`         |

这些工具对上层只有一个共同契约：通过 `iota-fun` MCP server 被调用，并把真实结果写到 stdout。Engine 不直接读取源码、不直接 shell 执行工具目录，也不绕过 MCP 调 `IotaFunEngine`。

## 工具链版本契约

`iota-fun` 是本地多语言执行器，因此版本必须写死到可复现的范围。当前 Windows 验证环境使用以下版本：

| 工具链  | 当前验证版本                                                  | 执行约束                                                                                         |
| ------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Node.js | `v24.13.1`                                                    | TypeScript runner 使用 `node` 执行 `runner.js`                                                   |
| Python  | `3.14.3`                                                      | Python 使用 `python -c` 加载 `random_number.py`                                                  |
| Go      | `go1.26.2`                                                    | `go build` 编译到 `$HOME/.iota/iota-fun`                                                         |
| Rust    | `rustc 1.92.0`                                                | `rustc runner.rs -o <cached-binary>`                                                             |
| Java    | `javac 21.0.3`                                                | `javac -encoding UTF-8`，运行时固定 `-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8`          |
| Zig     | **`0.16.x`**                                                  | 当前 skill 固定按 Zig 0.16 API/CLI 验证；`runner.zig` 使用 `extern write`，编译必须带 `-lc`      |
| C++     | Windows 使用 Zig `0.16.x` 的 `zig c++`；非 Windows 使用 `g++` | 当前 Windows 环境的 MinGW `g++ 15.2.0` 驱动会无诊断返回 1，因此 Windows C++ 编译固定走 `zig c++` |

Zig 这里必须明确版本：不同 Zig 版本的标准库 API 和链接行为不兼容。本文档和当前实现只承诺 `zig version` 为 `0.16.x` 时的行为；升级 Zig 前要先跑本文末尾的已验证 backend traced request；OpenCode 可用时也应纳入。

## 缓存行为

Go / Rust / Zig / Java / C++ 的编译产物统一写入：

```text
$HOME/.iota/iota-fun
```

缓存 key 包含版本盐、语言、平台、架构、源码路径、源码 mtime 和源码 size。源码或编译参数变更后会生成新缓存；源码未变时后续请求直接运行缓存产物，不把二进制或 `.class` 文件写回源码目录。

本次修复后，第一次 `claude-code` traced request 触发冷编译，`mcp.proxy` 约 27.9s；后续 backend 命中缓存后，`mcp.proxy` 稳定在 241-286ms。

## Backend 验证

验证命令必须使用已构建 CLI 产物，并跑真实 traced request：

```bash
cd iota-cli
node dist/index.js run --backend claude-code --trace "生成宠物"
node dist/index.js run --backend codex --trace "生成宠物"
node dist/index.js run --backend gemini --trace "生成宠物"
node dist/index.js run --backend hermes --trace "生成宠物"
# OpenCode 可用时补充：
node dist/index.js run --backend opencode --trace "生成宠物"
```

2026-04-29 本机最终验证结果：

| Backend       | Trace                                  | Execution                              | engine.request | mcp.proxy     | 状态       |
| ------------- | -------------------------------------- | -------------------------------------- | -------------- | ------------- | ---------- |
| `claude-code` | `b7550089-fe68-4fe8-bebc-d06161eaae58` | `b27a1716-417f-4b2c-8c98-3ad7c278b780` | `ok 27,975ms`  | `ok 27,887ms` | 冷编译完成 |
| `codex`       | `5ac018e7-2a8a-4bb0-982e-cd295dffdb8a` | `7bc200e8-c06c-485c-a982-3a441b238df6` | `ok 356ms`     | `ok 286ms`    | 缓存命中   |
| `gemini`      | `e17ed6d8-39cb-4e06-a6b9-614bbfcfd218` | `7aa18bb8-32d4-495b-921e-b556b18e3a22` | `ok 300ms`     | `ok 241ms`    | 缓存命中   |
| `hermes`      | `c161ef92-6fcc-4683-b9dd-612773559c23` | `cebdac09-64c9-4c1a-99b2-83844736ea1b` | `ok 332ms`     | `ok 262ms`    | 缓存命中   |
| `opencode`    | 待验证                                  | 待验证                                  | 待验证         | 待验证        | ACP 后端待补 |

已验证 trace 都有相同的结构特征：

- `configured servers: iota-fun`
- `loaded skill "pet-generator"`
- `status="completed"`
- `eventCount=19`
- `mcp.proxy ok serverName="iota-fun" skill="pet-generator" toolCount=7 parallel=true`
- `Native Events: (no native events)`

`Native Events` 为空是预期行为：结构化 skill 命中后没有进入 backend 原生模型执行循环，工具调用由 Engine 直接编排并规范化成 `RuntimeEvent`。

## 修复记录

本轮验证开始时，已验证 backend 都失败在相同位置：

```text
pet-generator 执行失败：以下工具没有返回真实结果，未使用默认值补齐。

- fun.cpp: ERROR: Fun execution failed for cpp
- fun.zig: ERROR: Fun execution failed for zig
```

定位结果：

- `fun.zig`：Zig 0.16 对 `extern "c" fn write(...)` 要求显式 libc 链接，原编译命令缺少 `-lc`；
- `fun.cpp`：当前 Windows 环境里 MinGW `g++ 15.2.0` 连最小 C++ 程序也会无诊断返回 1，因此 Windows 路径改为使用 Zig 0.16 的 `zig c++`；
- `fun.java`：Windows 子进程 stdout 会受默认编码影响，运行时增加 `-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8`，确保 `猫/狗/鸟` 不变成替换字符。

修复后单独验证：

```text
cpp="吃饭"
zig="中"
java="狗"
```

## 配置要求

`IotaEngine.init()` 会合并本地配置和 Redis 分布式配置。`skill.roots` 为空时会回退到仓库默认 `../iota-skill`，但 `mcp.servers` 必须显式配置 `iota-fun`。

Windows 示例：

```bash
cd iota-cli
node dist/index.js config set mcp.servers "[{\"name\":\"iota-fun\",\"command\":\"node\",\"args\":[\"D:\\\\coding\\\\creative\\\\iota\\\\iota-engine\\\\dist\\\\mcp\\\\fun-server.js\"],\"env\":[]}]"
node dist/index.js config set skill.roots "[\"D:\\\\coding\\\\creative\\\\iota\\\\iota-skill\"]"
node dist/index.js config get mcp.servers
node dist/index.js config get skill.roots
```

## 验收清单

代码改动后至少运行：

```bash
cd iota-engine
bun run build
bun run test -- src/fun-engine.test.ts

cd ../iota-cli
bun run build
node dist/index.js run --backend claude-code --trace "生成宠物"
node dist/index.js run --backend codex --trace "生成宠物"
node dist/index.js run --backend gemini --trace "生成宠物"
node dist/index.js run --backend hermes --trace "生成宠物"
# OpenCode 可用时补充：
node dist/index.js run --backend opencode --trace "生成宠物"
```

验收点：

- 已验证 backend 都 `status="completed"`；
- trace 中 `mcp.proxy` 为 `ok`，`toolCount=7`，`parallel=true`；
- 输出包含 `action/color/material/size/animal/lengthCm/toyShape` 七个真实工具结果；
- `animal` 中文正常显示为 `猫/狗/鸟`；
- 不出现 `fun.cpp` 或 `fun.zig` 执行失败；
- 不出现模型自述式的 MCP 受限说明；
- 冷编译后再次运行应命中 `$HOME/.iota/iota-fun` 缓存。

## 相关文件

| 文件                                          | 作用                           |
| --------------------------------------------- | ------------------------------ |
| `iota-skill/pet-generator/SKILL.md`           | skill 触发、执行计划和输出模板 |
| `iota-engine/src/skill/loader.ts`             | 加载 `SKILL.md` frontmatter    |
| `iota-engine/src/skill/runner.ts`             | 匹配并执行结构化 MCP skill     |
| `iota-engine/src/mcp/fun-server.ts`           | `iota-fun` MCP stdio server    |
| `iota-engine/src/fun-engine.ts`               | 多语言工具编译、缓存和执行     |
| `iota-engine/src/fun-engine.test.ts`          | 工具执行计划单测               |
| `docs/guides/07-fun-call-guide.md`            | fun-call 底层说明              |
| `docs/guides/08-fun-runtime-install-guide.md` | 本地运行时安装记录             |
