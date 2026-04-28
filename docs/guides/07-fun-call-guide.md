# Fun Call 函数调用指南

本指南描述了 `iota-fun/` 示例函数的执行方式、如何通过 `IotaEngine` 路由它们，以及当你需要在代码中进行确定性控制时如何直接调用它们。

## 概述

当前实现包含两个层次：

-  `IotaFunEngine` 位于 `iota-engine/src/fun-engine.ts`
执行 `iota-fun/` 下的具体语言目标。
-  `IotaEngine` 集成位于 `iota-engine/src/engine.ts`
检测匹配的提示词并在正常执行生命周期内将它们路由到 `IotaFunEngine`。

这意味着你可以使用以下任一模式：

1.  当你已经知道目标语言时，直接调用 `IotaFunEngine`。
2.  使用匹配的提示词调用 `IotaEngine.execute()`，让引擎自动路由。

## 支持的函数

当前的语言映射为：

-  `python`: 生成 `1-100` 范围内的随机数字
-  `typescript`: 生成随机颜色
-  `go`: 生成随机形状
-  `rust`: 生成随机材质
-  `zig`: 生成随机尺寸
-  `java`: 生成随机动物
-  `cpp`: 生成随机动作

源文件位于 `iota-fun/` 目录下。

## 直接使用

当调用者已经知道要执行的确切语言时，使用 `IotaFunEngine`。

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

### 结果结构

`IotaFunEngine.execute()` 返回：

-  `language`: 请求的语言
-  `command`: 运行的最终命令
-  `args`: 命令参数
-  `stdout`: 原始标准输出
-  `stderr`: 原始标准错误
-  `exitCode`: 进程退出代码
-  `value`: 从标准输出解析的最终值

## 通过 IotaEngine 的路由使用

`IotaEngine` 现在可以检测 fun 风格的提示词，并在正常后端适配器路径之前将它们发送到 `IotaFunEngine`。

检测逻辑在 `iota-engine/src/fun-intent.ts` 中实现。

路由到 fun 执行的提示词示例：

-  `请用 python 随机生成 1-100 的数字`
-  `请用 typescript 随机生成一种颜色`
-  `请用 go 随机生成一种形状`
-  `请用 rust 随机生成一种材质`
-  `请用 zig 随机生成一种尺寸`
-  `请用 java 随机生成一种动物`
-  `请用 c++ 随机生成一个动作`

### 示例

```ts
import { IotaEngine } from "@iota/engine";

const engine = new IotaEngine({
  workingDirectory: process.cwd(),
});

await engine.init();

const response = await engine.execute({
  sessionId: "session-1",
  prompt: "请用 python 随机生成 1-100 的数字",
});

console.log(response.status);
console.log(response.output);
```

## 主流程行为

当检测到 fun 提示词时，`IotaEngine` 保持正常的执行生命周期结构，而不是绕过它。

路由路径仍然会写入：

-  执行记录
-  状态事件：`排队中`、`启动中`、`执行中`、最终状态
-  一个 `tool_call` 事件
-  一个 `tool_result` 事件
-  成功时的一个最终 `输出` 事件
-  失败时的一个 `错误` 事件

工具命名当前使用以下形式：

-  `fun.python`
-  `fun.typescript`
-  `fun.go`
-  `fun.rust`
-  `fun.zig`
-  `fun.java`
-  `fun.cpp`

这使得 fun 路径在与引擎其余部分相同的事件和审计管道中可见。

## 语言运行时策略

每种语言根据 `iota-engine/src/fun-engine.ts` 中构建的运行时计划执行。

-  `python`: 内联 `python -c` 加载器导入 `iota-fun/python/random_number.py`
-  `typescript`: 内联 `node -e` 加载器读取并评估 `randomColor.ts`
-  `go`: `go run random_shape.go runner.go`
-  `rust`: `rustc` 编译 `runner.rs`，然后运行生成的可执行文件
-  `zig`: `zig run runner.zig`
-  `java`: `javac` 编译源文件，然后 `java RandomAnimalRunner`
-  `cpp`: `g++` 编译 `random_action_runner.cpp`，然后运行生成的可执行文件

对于 C++，引擎将 `C:\ProgramData\mingw64\mingw64\bin` 注入到 `PATH` 中，以便在编译期间可以解析 MinGW 辅助二进制文件。

## 检测规则

意图匹配当前需要同时满足：

-  语言提示
-  匹配的中文任务短语

示例：

-  Python: `python` 和 `随机 ... 1-100`
-  TypeScript: `typescript` 和 `随机 ... 颜色`
-  Go: `go` 和 `随机 ... 形状`
-  Rust: `rust` 和 `随机 ... 材质`
-  Zig: `zig` 和 `随机 ... 尺寸`
-  Java: `java` 和 `随机 ... 动物`
-  C++: `c++` 或 `cpp` 和 `随机 ... 动作`

如果提示词不匹配这些规则，`IotaEngine` 会回退到正常的后端执行路径。

## 测试

当前覆盖范围包括：

-  `iota-engine/src/fun-engine.test.ts`
验证运行时计划构建。
-  `iota-engine/src/fun-intent.test.ts`
验证提示词检测。
-  `iota-engine/src/engine-fun.test.ts`
验证 `new IotaEngine(...).execute()` 通过 `IotaFunEngine` 路由 fun 提示词。

使用以下命令运行相关检查：

```powershell
cd D:\coding\creative\iota\iota-engine
bun run typecheck
bun run test -- src/fun-engine.test.ts src/fun-intent.test.ts src/engine-fun.test.ts
```

## 操作注意事项

-  Fun 执行是本地进程执行，而不是后端适配器执行。
-  fun 路径仍然使用引擎事件存储和执行记录。
-  Java 输出可能在某些 Windows 终端中显示不正确，因为控制台编码问题。
-  C++ 执行依赖于 MinGW 和包含其 bin 目录的有效 `PATH`。
-  当前的 Zig 示例运行器与本工作区中安装的 Zig `0.16.0` 兼容。

## 相关文件

-  `iota-engine/src/fun-engine.ts`
-  `iota-engine/src/fun-intent.ts`
-  `iota-engine/src/engine.ts`
-  `iota-engine/src/engine-fun.test.ts`
-  `docs/guides/08-fun-runtime-install-guide.md`
