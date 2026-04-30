# Skill 结构化技能与 iota-fun

**版本:** 2.1  
**最后更新:** 2026-04-30

## 1. 核心理念

确定性能力不应交给模型每次重新推理。Skill 把触发条件、编排计划和输出模板声明在 `SKILL.md` frontmatter 中，由 Engine 执行，backend 只是可替换的内核。

```text
Skill   = triggers + execution plan + output template
Engine  = load + match + run + observe
MCP     = process boundary
IotaFun = local multi-language executor
Backend = replaceable kernel
```

---

## 2. Skill 声明格式

`iota-skill/pet-generator/SKILL.md`:

```yaml
---
name: pet-generator
description: 通过 iota-fun MCP server 并行调用 7 个多语言工具
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
    一只正在{{action}}的、{{color}}的、{{material}}感的、{{size}}号的{{animal}}，
    抱着一个 {{lengthCm}} 厘米、{{toyShape}} 的飞盘。
failurePolicy: report
---
```

### SkillManifest 接口

```typescript
interface SkillManifest {
  name: string;
  description: string;
  triggers: string[];
  execution: {
    mode: "mcp";
    server: string;
    parallel: boolean;
    tools: { name: string; as: string }[];
  };
  output?: { template?: string };
  failurePolicy: "report" | "fail_fast";
}
```

---

## 3. 执行链路

```text
用户 prompt → IotaEngine.buildRequest()
  → loadSkills(skill.roots) 加载 SKILL.md
  → matchExecutableSkill(prompt, skills) 命中 triggers
  → runSkillViaMcp()
       - 持久化 tool_call events
       - 按 execution.parallel 并行调用 MCP tools/call
  → McpRouter → iota-fun MCP server
  → IotaFunEngine.execute(language)
       - 解释型语言直接运行
       - 编译型语言先编译到 $HOME/.iota/iota-fun，再运行缓存产物
  → 收集 tool results → 填充 output.template → 输出
```

---

## 4. iota-fun 多语言执行器

`iota-fun` 是 Engine 内置的 MCP server，执行 `iota-skill/pet-generator/iota-fun/` 下的多语言工具函数。

### 支持语言

| 语言 | 工具名 | 执行方式 |
|---|---|---|
| C++ | fun.cpp | 编译后运行，缓存到 `$HOME/.iota/iota-fun` |
| TypeScript | fun.typescript | ts-node / bun 直接运行 |
| Rust | fun.rust | 编译后运行，缓存产物 |
| Zig | fun.zig | 编译后运行 |
| Java | fun.java | javac + java |
| Python | fun.python | python3 直接运行 |
| Go | fun.go | go run |

### 编译缓存

- 缓存目录: `$HOME/.iota/iota-fun/`
- 首次调用编译，后续直接运行缓存的可执行文件
- 不提交编译产物到仓库

---

## 5. Skill 加载配置

Engine 从 `skill.roots` 配置路径加载 skill：

```yaml
# iota.config.yaml
skill:
  roots:
    - ./iota-skill
```

若 `skill.roots` 未显式设置，Engine 回退到仓库相邻的 `iota-skill` 目录。

---

## 6. MCP 路由

```typescript
// Engine MCP 配置
mcp: {
  servers: [
    { name: "iota-fun", command: "node", args: ["<iota-engine dist>/mcp/fun-server.js"] }
  ]
}
```

`McpRouter` 将 skill execution plan 中的 `tools/call` 路由到对应 MCP server。

---

## 7. 与 Backend 的关系

结构化 skill 不依赖 backend 自行调用 MCP 工具：

- Engine 直接编排 tool 调用
- Backend 的角色是提供 kernel 能力（如在 skill 之外的自由对话中）
- 同一 skill 在 claude-code / codex / gemini / hermes / opencode 上行为一致

---

## 8. 新增 Skill 步骤

1. 在 `iota-skill/` 下创建目录
2. 编写 `SKILL.md`，定义 triggers、execution、output
3. 如果需要 MCP 工具，在子目录中实现
4. 确保 `skill.roots` 包含父目录
5. 验证: `node iota-cli/dist/index.js run --trace "<trigger phrase>"`，并检查 Engine skill/iota-fun 相关测试
