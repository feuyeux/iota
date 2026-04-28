# 宠物技能指南

**版本：** 1.4
**最后更新：** 2026 年 4 月

本文档说明 `pet-generator` 如何作为一个普通结构化 skill 被加载、匹配并执行。`生成宠物` 不是 engine 内置分支；engine 只读取 `SKILL.md` frontmatter 中的 `triggers`、`execution` 和 `output`，再由通用 `SkillRunner` 调用 MCP 工具。

## 1. 关键文件

| 文件                                                                           | 作用                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| [`iota-skill/pet-generator/SKILL.md`](../../iota-skill/pet-generator/SKILL.md) | 结构化 skill 声明：触发词、MCP 工具计划、输出模板                   |
| [`iota-engine/src/skill/loader.ts`](../../iota-engine/src/skill/loader.ts)     | 加载 `skill.roots`，解析 `SKILL.md` frontmatter                     |
| [`iota-engine/src/skill/runner.ts`](../../iota-engine/src/skill/runner.ts)     | 通用 skill runner，按 `execution` 调用 MCP 并渲染 `output.template` |
| [`iota-engine/src/mcp/fun-server.ts`](../../iota-engine/src/mcp/fun-server.ts) | `iota-fun` MCP stdio server，暴露 7 个 `fun.*` 工具                 |
| [`iota-engine/src/fun-engine.ts`](../../iota-engine/src/fun-engine.ts)         | 本地多语言执行器，负责真实编译/运行函数                             |
| [`iota-engine/src/backend/`](../../iota-engine/src/backend/)                   | 四种 backend 的 MCP 配置注入                                        |

## 2. Skill 声明

`pet-generator/SKILL.md` 的 frontmatter 是执行源头：

```yaml
name: pet-generator
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
```

因此新增类似 skill 时应改 `SKILL.md`，而不是在 engine 中新增专用代码。

## 3. 执行链路

```text
用户 prompt: 生成宠物
  -> IotaEngine.buildRequest()
  -> loadSkills(skill.roots) 已加载 pet-generator
  -> matchExecutableSkill(prompt, skills) 命中 triggers
  -> 选择 backend adapter（claude-code / codex / gemini / hermes）
       - 普通请求会进入大模型 CLI/Agent，由模型决定是否调用工具
       - 本 skill 命中后不等待大模型自行发现 MCP；engine 直接进入 SkillRunner
  -> SkillRunner.runSkillViaMcp()
       - 读取 execution.server = iota-fun
       - 按 execution.tools 产生 tool_call
       - 按 execution.parallel 并行调用 MCP tools/call
  -> iota-fun MCP server
       - fun.cpp / fun.typescript / fun.rust / fun.zig / fun.java / fun.python / fun.go
       - 每个工具内部调用 IotaFunEngine.execute()
  -> SkillRunner 产生 tool_result
  -> SkillRunner 用 output.template 渲染最终 output
  -> IotaEngine 持久化事件、visibility、audit、execution 状态
  -> CLI/App 展示结果
```

关键边界：

- Engine 不包含 `pet-generator` 专用工具清单、触发正则或输出模板。
- `fun.*` 必须经 `McpRouter -> iota-fun MCP server -> IotaFunEngine`，不能用 shell、delegate 或直接源码执行替代。
- 大模型调用环节仍存在于 backend adapter 体系中：普通请求会由 Claude Code / Codex / Gemini / Hermes 模型处理；`生成宠物` 命中结构化 skill 后，工具调用和最终模板输出由通用 `SkillRunner` 确定性完成，不再依赖模型自行发现 `iota-fun` MCP。
- 普通 backend MCP 路径仍可让 backend LLM 自行调用 `fun.*`；skill 路径避免四种 backend 慢速自行发现工具或声称环境受限。
- MCP 返回 `isError: true` 时 execution 失败，并明确列出失败工具，不补默认值。

## 4. 配置来源

`IotaEngine.init()` 先加载本地配置，再合并 Redis 分布式配置。`mcp.servers` 和 `skill.roots` 以 resolved config 为准。

```yaml
mcp:
  servers:
    - name: iota-fun
      command: node
      args:
        - /Users/han/codingx/iota/iota-engine/dist/mcp/fun-server.js
      env: []
skill:
  roots:
    - /Users/han/codingx/iota/iota-skill
```

Redis 中推荐写入同等配置：

```text
mcp.servers=[{"name":"iota-fun","command":"node","args":["/path/to/iota-engine/dist/mcp/fun-server.js"],"env":[]}]
skill.roots=["/path/to/iota-skill"]
```

## 5. 工具与缓存

| 工具             | 输出字段   | 真实来源               |
| ---------------- | ---------- | ---------------------- |
| `fun.cpp`        | `action`   | `iota-fun/cpp/`        |
| `fun.typescript` | `color`    | `iota-fun/typescript/` |
| `fun.rust`       | `material` | `iota-fun/rust/`       |
| `fun.zig`        | `size`     | `iota-fun/zig/`        |
| `fun.java`       | `animal`   | `iota-fun/java/`       |
| `fun.python`     | `lengthCm` | `iota-fun/python/`     |
| `fun.go`         | `toyShape` | `iota-fun/go/`         |

Go / Rust / Zig / Java / C++ 编译产物统一缓存在 `$HOME/.iota/iota-fun`。缓存 key 包含源码路径、mtime、size、平台和架构；源码未变时不会重复编译，也不会把产物写回 `iota-skill/pet-generator/iota-fun/` 源码目录。

## 6. 四种 Backend

四种 backend 都接收同一份 resolved `mcp.servers` 和 `<iota_skills>` prompt：

| Backend      | MCP 注入方式                                                              |
| ------------ | ------------------------------------------------------------------------- |
| Claude Code  | `--mcp-config <json> --strict-mcp-config`，并 allowlist `iota-fun` 工具   |
| Codex        | `codex exec --sandbox danger-full-access -c mcp_servers.<name>.*`         |
| Gemini CLI   | 临时 system settings 写入 `mcpServers`，并传 `--allowed-mcp-server-names` |
| Hermes Agent | ACP `session/new.params.mcpServers`                                       |

对 `生成宠物`，最终工具执行都由通用 `SkillRunner` 经 engine MCP router 完成；backend 注入仍用于普通 MCP 请求。

## 7. 验证

构建 engine 和 CLI：

```bash
cd iota-engine && bun run build
cd ../iota-cli && bun run build
```

跑 engine 验证：

```bash
cd iota-engine
bun run typecheck
bun run test -- src/skill/runner.test.ts src/engine-fun.test.ts src/fun-engine.test.ts
```

四种 backend 的真实 traced request 使用 bun 命令：

```bash
bun iota-cli/dist/index.js run --backend claude-code --trace "生成宠物"
bun iota-cli/dist/index.js run --backend codex --trace "生成宠物"
bun iota-cli/dist/index.js run --backend gemini --trace "生成宠物"
bun iota-cli/dist/index.js run --backend hermes --trace "生成宠物"
```

验收点：

- trace 中有 7 个 `fun.*` `tool_call` / `tool_result`。
- 结果来自 `iota-fun` MCP server，不是模型编造。
- 输出包含自然语言描述和属性清单。
- 工具失败时 execution 失败并列出失败工具。
- 连续验证时 `$HOME/.iota/iota-fun` 缓存命中，不重复编译未变化源码。
- 不应出现“受限环境无法直接调用 `iota-fun` MCP server”这类 backend LLM 自述。

## 8. 相关文档

- [`docs/guides/07-fun-call-guide.md`](07-fun-call-guide.md)
- [`docs/guides/08-fun-runtime-install-guide.md`](08-fun-runtime-install-guide.md)
- [`iota-skill/pet-generator/SKILL.md`](../../iota-skill/pet-generator/SKILL.md)
