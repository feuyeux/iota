# Fun Call 函数调用指南

本文档说明 `iota-skill/pet-generator/iota-fun/` 示例函数的底层执行方式，以及它如何通过 `iota-fun` MCP server 暴露给 engine 和 backend。

## 1. 当前调用边界

当前实现有三类合法入口：

- **结构化 skill 入口**：`IotaEngine` 加载 `SKILL.md` frontmatter 后，由通用 `SkillRunner` 匹配 `triggers` 并按 `execution.tools` 通过 `McpRouter` 调用 `fun.*` MCP 工具，`iota-fun-mcp server` 再调用 `IotaFunEngine.execute()`。
- **普通 backend MCP 入口**：backend LLM 调用 `fun.*` MCP 工具，`iota-fun-mcp server` 再调用 `IotaFunEngine.execute()`。
- **底层测试 / 调试入口**：测试代码或调试脚本直接调用 `IotaFunEngine.execute()`。

`IotaEngine` 不直接调用 `IotaFunEngine` 处理用户请求；结构化 skill 也必须经 `McpRouter -> iota-fun-mcp server -> IotaFunEngine` 的进程间调用链路。

---

## 2. 正常请求路径

```text
IotaEngine 或 Backend LLM
  ↓  fun.cpp / fun.python / ...
iota-fun-mcp server
  ↓  tools/call
IotaFunEngine.execute()
  ↓
真实语言运行时 stdout
  ↓
iota-fun-mcp server tool_result
  ↓
IotaEngine 或 Backend LLM 组合最终回答
```

这条路径由 `docs/guides/10-pet-skill-guide.md` 详细描述。

---

## 3. 支持的函数

| 工具名           | language     | 返回属性           |
| ---------------- | ------------ | ------------------ |
| `fun.cpp`        | `cpp`        | 随机动作           |
| `fun.typescript` | `typescript` | 随机颜色           |
| `fun.rust`       | `rust`       | 随机材质           |
| `fun.zig`        | `zig`        | 随机尺寸           |
| `fun.java`       | `java`       | 随机动物           |
| `fun.python`     | `python`     | `1`–`100` 随机整数 |
| `fun.go`         | `go`         | 随机形状           |

源文件位于 `iota-skill/pet-generator/iota-fun/`。

---

## 4. 直接调用 IotaFunEngine

当调用者已经知道要执行的确切语言时，可以直接调用底层执行器。这个入口用于测试、诊断或 MCP server 内部实现，不是用户请求主路径。

```ts
import path from "node:path";
import { IotaFunEngine } from "@iota/engine";

const funEngine = new IotaFunEngine(path.resolve("./src"));

const result = await funEngine.execute({
  language: "python",
  timeoutMs: 30_000,
});

console.log(result.value);
console.log(result.command, result.args);
```

`IotaFunEngine.execute()` 返回：

- `language`：请求的语言
- `command`：最终运行命令
- `args`：命令参数
- `stdout`：原始标准输出
- `stderr`：原始标准错误
- `exitCode`：进程退出码
- `value`：从标准输出解析出的最终值

---

## 5. 语言运行时策略

每种语言根据 `iota-engine/src/fun-engine.ts` 中构建的运行时计划执行。

- `python`：内联 `python -c` 加载 `random_number.py`
- `typescript`：`node runner.js`
- `go`：`go build` 到缓存目录后运行生成的可执行文件
- `rust`：`rustc runner.rs` 到缓存目录后运行生成的可执行文件
- `zig`：`zig build-exe runner.zig` 到缓存目录后运行生成的可执行文件
- `java`：`javac -d <cache-dir>` 到缓存目录后执行 `java -cp <cache-dir> RandomAnimalRunner`
- `cpp`：`g++ random_action_runner.cpp` 到缓存目录后运行生成的可执行文件

编译产物统一写入 `$HOME/.iota/iota-fun`。缓存 key 包含语言、平台、架构、源码路径、源码 mtime 和源码 size；源码未变化时后续 MCP 调用直接运行缓存产物，不重复编译。

---

## 6. 测试

当前相关覆盖：

- `iota-engine/src/fun-engine.test.ts`：验证运行时计划构建。
- `iota-engine/src/engine-fun.test.ts`：验证单个 fun prompt 仍进入 backend 路径，`生成宠物` 通过 `iota-fun` MCP server 产生 7 个工具事件。

运行：

```bash
cd iota-engine
bun run typecheck
bun run test -- src/fun-engine.test.ts src/engine-fun.test.ts
```

---

## 7. 相关文件

- [`iota-engine/src/fun-engine.ts`](../../iota-engine/src/fun-engine.ts)
- [`iota-engine/src/mcp/fun-server.ts`](../../iota-engine/src/mcp/fun-server.ts)
- [`iota-skill/pet-generator/SKILL.md`](../../iota-skill/pet-generator/SKILL.md)
- [`docs/guides/10-pet-skill-guide.md`](10-pet-skill-guide.md)
- [`docs/guides/08-fun-runtime-install-guide.md`](08-fun-runtime-install-guide.md)
