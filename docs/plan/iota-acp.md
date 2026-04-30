在构建统一的多 AI 运行时引擎时，如果说 MCP（Model Context Protocol）负责标准化南向的数据与工具侧接入，那么 **ACP（Agent Client Protocol）** 则确立了北向的 IDE 与客户端通讯标准。它利用 stdio 上的 JSON-RPC 或 HTTP/WS 协议，使得底层异构的可插拔后端能够被统一调度和解耦。

以下是这 5 款核心工具的 ACP 协议支持现状及架构实现细节：

### ACP 接入状态矩阵

| 运行时 / Agent | ACP 支持状态 | 接入实现层 | 架构特征 |
| :--- | :--- | :--- | :--- |
| **Gemini CLI** | 🟢 原生支持 (基准) | CLI 原生 (`--acp`) | 官方参考实现。在后台作为常驻进程运行并直接基于 ACP 交互，无缝承接代码生成与会话生命周期。 |
| **Claude Code** | 🟢 适配器支持 | 专用适配器桥接 | 需通过生态适配器（如 `@zed-industries/claude-agent-acp`）对齐 Claude Agent SDK，支持 Slash Commands 路由与子代理分配。 |
| **Codex CLI** | 🟢 适配器支持 | 专用适配器桥接 | 依赖包装层（如 `@zed-industries/codex-acp`）抹平协议差异，内置环境变量及外部 Token 鉴权透传机制。 |
| **OpenCode** | 🟢 兼容支持 | 泛化后端兼容 | 具备标准 ACP 后端能力，可被外部控制平面（如 OpenClaw 或 VS Code ACP Client 扩展）通过 `/acp spawn` 等指令拉起并注入上下文。 |
| **Hermes Agent** | 🔵 双向支持 (C/S) | `providers.py` 路由 | 兼具服务端与客户端能力。可作为统一的入口网关，利用标准化规范将请求反向路由给 Claude、Gemini 等异构目标引擎。 |

---

### 核心运行时解析

* **Gemini CLI**：作为标准定义的最佳实践，它不需要额外的协议转换层。直接挂载 `--acp` 标志即可将其进程转为纯粹的 RPC 监听状态，系统级通讯开销最小，状态流转最为直接。
* **Claude Code & Codex CLI**：它们的底层逻辑依然保持独立闭环，主要依赖于代理模式（Proxy Pattern）。适配网关负责拦截并转换 ACP 协议流，使得顶层的调度引擎无需感知底层究竟是通过系统子进程直连，还是通过封装的 SDK 进行交互。
* **Hermes Agent 的动态编排**：Hermes 在其架构中设计了泛化的 ACP 客户端（Generalized ACP Client）。它有效避免了生硬的二进制子进程拉起模式，通过传入例如 `hermes --provider claude-acp` 的环境指令，Hermes 可以接管并路由任何指向 `acp://{agent}` 的资源请求，从而在单一引擎层面上实现了真正的多智能体运行时聚合。

[Model Context Protocol (MCP) and Agent Connect Protocol (ACP)](https://www.youtube.com/watch?v=X0nhy6uQ7w0)
This overview explores the architectural interplay between multi-agent connection frameworks and context protocols, illustrating how standardizing communication layers is critical to scaling robust, decoupled AI workflows.

----

下面按 **“这些工具能否作为 ACP Agent / Server，被 IDE 或 iota 这类上层 Runtime 接入”** 来判断。ACP 这里指 **Agent Client Protocol**，用于让编辑器/IDE 与 AI coding agent 通过标准协议互通；Zed 文档称 ACP 是让任意 agent 与任意编辑环境集成的开放标准。([Zed][1])

| 工具                             | ACP 支持结论 | 支持方式                               | 典型启动/接入方式                                                 | 备注                                                                                                                                                                                          |
| ------------------------------ | -------- | ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code / Claude Agent** | ✅ 支持     | **通过 Adapter**                     | Claude Agent / Claude Code 走 Zed/Claude Agent SDK adapter | ACP 官方 Agents 列表写的是 **Claude Agent via Zed’s SDK adapter**；Zed 文档也说明 Claude Agent 通过 adapter 与 ACP 通信，底层运行 Claude Code。([Agent Client Protocol][2])                                         |
| **OpenCode**                   | ✅ 支持     | **原生 ACP 命令**                      | `opencode acp`                                            | OpenCode 官方文档明确写明支持 ACP，并说明该命令会启动 ACP-compatible subprocess，通过 JSON-RPC over stdio 与编辑器通信。([OpenCode][3])                                                                                   |
| **Codex CLI**                  | ✅ 支持     | **通过 Adapter / community adapter** | 常见为 Codex ACP adapter，例如 Zed/社区 adapter                   | ACP 官方 Agents 列表写明 **Codex CLI via Zed’s adapter**；Zed 的 Codex CLI ACP 页面也标注为 **Community adapter**。([Agent Client Protocol][2])                                                            |
| **Gemini CLI**                 | ✅ 支持     | **原生 ACP mode**                    | `gemini --acp`                                            | Gemini CLI 文档明确写明 ACP mode 使用 JSON-RPC over stdio，并可用 `gemini --acp` 启动；Zed 也称 Gemini CLI 是 reference ACP implementation。([Gemini CLI][4])                                                  |
| **Hermes Agent**               | ✅ 支持     | **原生 ACP server**                  | `pip install -e '.[acp]'` 后运行 `hermes acp` / `hermes-acp` | Hermes 官方文档明确写明 Hermes Agent 可作为 ACP server，让 ACP-compatible editors 通过 stdio 访问，并支持 chat、tool activity、file diffs、terminal commands、approval prompts、streamed chunks 等。([Hermes Agent][5]) |

## 结论排序

**原生支持最好接入：Gemini CLI、OpenCode、Hermes Agent。**
这三个都有清晰的 ACP server/mode 入口：`gemini --acp`、`opencode acp`、`hermes acp`。

**需要 adapter 的：Claude Code、Codex CLI。**
它们在 ACP 生态中可用，但工程上要把 adapter 当成单独运行时组件管理：版本、认证、stdio 协议兼容、错误映射都要纳入 iota 的 Runtime Adapter 层。

## 对 iota 的建议抽象

可以把 ACP 作为一类标准 Runtime Backend：

```text
iota-engine
  └── AcpRuntimeAdapter
        ├── claude-code-acp      adapter-backed
        ├── codex-cli-acp        adapter-backed
        ├── gemini-cli-acp       native
        ├── opencode-acp         native
        └── hermes-agent-acp     native
```

工程上建议给每个 backend 记录这几个字段：

```yaml
runtime: gemini-cli
protocol: acp
support_level: native
command: gemini
args: ["--acp"]
transport: stdio
message_format: json-rpc
```

```yaml
runtime: claude-code
protocol: acp
support_level: adapter
command: npx
args: ["@zed-industries/claude-code-acp"]
transport: stdio
message_format: json-rpc
```

核心判断：**ACP 可以作为 iota 的“统一接入层协议”，但不要假设所有工具都是原生 ACP；Claude Code / Codex CLI 要按 adapter runtime 处理。**

[1]: https://zed.dev/acp "Zed — Agent Client Protocol"
[2]: https://agentclientprotocol.com/get-started/agents "Agents - Agent Client Protocol"
[3]: https://opencode.ai/docs/acp/ "ACP Support | OpenCode"
[4]: https://geminicli.com/docs/cli/acp-mode/ "ACP Mode | Gemini CLI"
[5]: https://hermes-agent.nousresearch.com/docs/user-guide/features/acp "ACP Editor Integration | Hermes Agent"
