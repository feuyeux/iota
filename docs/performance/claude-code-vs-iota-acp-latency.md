# Claude Code Native vs Iota ACP Claude 延迟对比实验

**版本:** 0.1  
**最后更新:** 2026-04-30

## 1. 实验目标

验证同一台机器、同一账号、同一模型、同一工作目录、同一提示词下，直接使用 Claude Code 与通过 Iota + ACP + Claude Code adapter 使用 Claude Code 的端到端延迟差异。

对比路径：

| 路径 | 说明 | 入口命令 |
|---|---|---|
| Claude Code native | 直接启动 Claude Code CLI，绕过 Iota Engine / ACP adapter | `claude --print ...` |
| Iota + ACP + Claude | `iota-cli -> IotaEngine -> ClaudeCodeAcpAdapter -> @anthropic-ai/claude-code-acp -> Claude Code` | `node dist/index.js run --backend claude-code --trace ...` |

本实验只回答延迟问题，不评价回答质量。回答质量只作为剔除异常样本的依据，例如空响应、认证失败、限流、工具调用失败。

---

## 2. 延迟指标口径

| 指标 | 定义 | 获取方式 |
|---|---|---|
| `wall_ms` | 客户端命令从启动到退出的墙钟时间 | 外层计时脚本，使用 `performance.now()` 或 PowerShell `Stopwatch` |
| `first_output_ms` | 客户端启动到 stdout 首次出现非空输出的时间 | Node 脚本监听子进程 stdout 第一块数据 |
| `trace_duration_ms` | Iota visibility / trace 记录的执行耗时 | Iota `--trace-json` 输出或 trace API |
| `exit_code` | 进程退出码 | 外层计时脚本 |
| `response_chars` | stdout 响应字符数 | 外层计时脚本统计，辅助识别异常 |

主结论使用 `wall_ms`。`first_output_ms` 用于观察流式首包延迟。`trace_duration_ms` 只用于 Iota 路径内部拆解，不直接与 Claude Code native 的 `wall_ms` 混用。

---

## 3. 变量控制

固定以下变量：

- 同一机器、同一网络、同一终端环境。
- 同一 Claude Code 登录账号或同一 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` 配置。
- 同一模型。通过 Claude Code 配置或环境变量固定，不在两条路径之间切换。
- 同一工作目录，建议使用仓库根目录 `D:\coding\creative\iota`。
- 同一提示词集合，提示词尽量短、确定、无需工具调用。
- 同一并发度。本实验默认串行执行，避免服务端限流和本机资源竞争。
- 同一冷启动策略。冷启动和热启动分开记录，不混入同一组统计。

建议提示词：

```text
ping。只回复 pong。
```

如果需要更接近真实编码场景，可以增加第二组提示词：

```text
用一句话说明这个仓库的主要用途。不要读取文件，只基于当前提示回答。
```

---

## 4. 前置检查

### 4.1 Claude Code native

```bash
claude /status
claude --version
```

确认账号、组织、配额和模型符合预期。不要把 token、账号邮箱或组织 ID 写入实验结果。

### 4.2 Iota CLI 与 ACP Claude

```bash
cd iota-cli
bun install
bun run build
node dist/index.js config get --scope backend --scope-id claude-code
```

确认 `claude-code` backend 走 ACP：

```bash
node dist/index.js config set backend.claudeCode.protocol acp
node dist/index.js run --backend claude-code --trace "ping。只回复 pong。"
```

验收不能停在 backend discovery 或配置读取。切到 ACP 后必须跑一次真实 traced request。

---

## 5. 实验分组

| 组别 | 路径 | 启动状态 | 样本数 | 说明 |
|---|---|---|---:|---|
| A | Claude Code native | 冷启动 | 5 | 每次都启动新进程 |
| B | Iota + ACP + Claude | 冷启动 | 5 | 首次触发 Iota CLI、Engine、ACP adapter |
| C | Claude Code native | 热启动 | 30 | 预热 3 次后采样 |
| D | Iota + ACP + Claude | 热启动 | 30 | 预热 3 次后采样；如 adapter 复用长连接，需记录复用策略 |

如果 Iota CLI 每次命令都会重新创建 Engine 进程，则 D 组仍然是 CLI 进程级热启动，而不是单 Agent 服务内的长连接热启动。若要验证 Agent 常驻路径，应另建 `iota-agent` WebSocket/REST 实验，不与本页 CLI 实验混合。

---

## 6. 采样命令

### 6.1 Claude Code native 命令

使用非交互、流式 JSON 或文本输出均可，但两次实验之间要保持一致。推荐使用 Claude Code stream-json，便于捕获首包：

```bash
claude --print --output-format stream-json --verbose --bare --permission-mode auto "ping。只回复 pong。"
```

如果本机 Claude Code 版本不支持某个参数，记录实际命令并保持所有 native 样本一致。

### 6.2 Iota ACP Claude 命令

```bash
cd iota-cli
node dist/index.js run --backend claude-code --trace-json "ping。只回复 pong。"
```

`--trace-json` 便于从输出中提取 Iota trace 耗时。若输出中混有普通响应与 JSON，可先只统计外层 `wall_ms` 和 `first_output_ms`，再通过 `iota trace` 或 Agent visibility API 补取 trace。

---

## 7. 推荐采样脚本

建议把脚本放到临时目录或 `docs/performance/results/` 下，不提交包含机器名、账号、token、完整模型凭证的原始日志。

示例 Node 脚本逻辑：

```javascript
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

async function runSample(label, command, args, cwd) {
  return await new Promise((resolve) => {
    const start = performance.now();
    let firstOutputMs;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { cwd, shell: false, env: process.env });

    child.stdout.on("data", (chunk) => {
      if (firstOutputMs === undefined && chunk.toString().trim().length > 0) {
        firstOutputMs = performance.now() - start;
      }
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      resolve({
        label,
        exitCode,
        wallMs: Math.round(performance.now() - start),
        firstOutputMs: firstOutputMs === undefined ? null : Math.round(firstOutputMs),
        responseChars: stdout.length,
        stderrChars: stderr.length,
      });
    });
  });
}
```

脚本输出建议使用 JSON Lines：每个样本一行，字段包括 `run_id`、`group`、`sample_index`、`timestamp`、`command_kind`、`wall_ms`、`first_output_ms`、`exit_code`、`response_chars`、`notes`。

---

## 8. 统计方法

每组样本独立统计：

- `min`
- `p50`
- `p90`
- `p95`
- `max`
- `mean`
- `stddev`
- `error_count`

延迟差异计算：

```text
overhead_ms = iota_acp_wall_ms - claude_native_wall_ms
overhead_ratio = iota_acp_wall_ms / claude_native_wall_ms
```

建议优先比较热启动 `p50` 和 `p95`：

| 对比 | 主要指标 | 说明 |
|---|---|---|
| D vs C `p50` | 常态中位延迟开销 | 适合描述普通交互体感 |
| D vs C `p95` | 尾延迟开销 | 适合描述偶发慢响应风险 |
| B vs A `p50` | 冷启动开销 | 适合描述首次调用成本 |

剔除样本必须记录原因。可剔除的样本包括认证失败、限流、网络断开、进程非零退出、响应为空、明显触发工具调用或审批等待。

---

## 9. 结果记录模板

实验环境：

| 字段 | 值 |
|---|---|
| 日期 |  |
| 机器 |  |
| OS |  |
| Node |  |
| Bun |  |
| Claude Code version |  |
| Iota commit |  |
| Backend protocol | `claude-code: acp` |
| Model | 仅写模型名，不写凭证 |
| Network |  |

统计结果：

| 组别 | 样本数 | error_count | min_ms | p50_ms | p90_ms | p95_ms | max_ms | mean_ms | stddev_ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A native cold |  |  |  |  |  |  |  |  |  |
| B iota acp cold |  |  |  |  |  |  |  |  |  |
| C native warm |  |  |  |  |  |  |  |  |  |
| D iota acp warm |  |  |  |  |  |  |  |  |  |

差异结论：

| 对比 | overhead_p50_ms | overhead_p95_ms | overhead_ratio_p50 | overhead_ratio_p95 | 结论 |
|---|---:|---:|---:|---:|---|
| B - A |  |  |  |  |  |
| D - C |  |  |  |  |  |

---

## 10. 注意事项

- 不要在实验结果里提交 token、完整环境变量、账号邮箱、组织 ID、原始 stderr 中的敏感内容。
- Claude 服务端负载会影响结果。建议同一组实验连续运行，必要时在不同时段重复一次。
- 如果提示词触发了工具调用、审批、MCP 或文件读取，延迟会包含额外链路，应单独建“工具调用场景”实验。
- Iota 路径可能包含 Engine 初始化、配置解析、visibility 记录、事件规范化、ACP JSON-RPC 转发等开销。分析时不要把这些开销误判为 Claude 模型推理时间。
- 如果使用 `iota-agent` 常驻服务测试，需要单独记录 Agent 进程启动时间、WebSocket 建连时间、session 创建时间和 execution 时间。

---

## 11. 可接受结论格式

```text
在 <日期>、<机器>、<模型>、<提示词>、串行采样条件下：

- Claude Code native warm p50 = <x> ms，p95 = <y> ms。
- Iota + ACP + Claude warm p50 = <x> ms，p95 = <y> ms。
- Iota ACP 路径 warm p50 额外开销 = <x> ms，p95 额外开销 = <y> ms。
- 冷启动额外开销 = <x> ms。

本结论只适用于当前 CLI 实验路径，不代表 iota-agent 常驻服务路径，也不代表工具调用场景。
```
