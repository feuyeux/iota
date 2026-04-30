import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import os from "node:os";

const repo = "D:/coding/creative/iota";
const cli = "D:/coding/creative/iota/iota-cli";
const reportsDir = "D:/coding/creative/iota/docs/performance/reports";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const jsonlPath = join(reportsDir, `${runId}-claude-iota-latency-samples.jsonl`);
const reportPath = join(reportsDir, `${runId}-claude-iota-latency-report.md`);
const prompt = "ping。只回复 pong。";
const settingsPath = "C:/Users/feuye/.claude/settings-minimax.json";

mkdirSync(reportsDir, { recursive: true });

const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const nativeEnv = { ...process.env, ...(settings.env ?? {}) };
if (nativeEnv.ANTHROPIC_AUTH_TOKEN && !nativeEnv.ANTHROPIC_API_KEY) {
  nativeEnv.ANTHROPIC_API_KEY = nativeEnv.ANTHROPIC_AUTH_TOKEN;
}

const envNames = Object.keys(settings.env ?? {}).sort();
const model = nativeEnv.ANTHROPIC_MODEL || nativeEnv.CLAUDE_MODEL || "unknown";

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function stats(samples, field) {
  const ok = samples.filter((sample) => sample.exitCode === 0 && sample.isError !== true && Number.isFinite(sample[field]));
  const values = ok.map((sample) => sample[field]);
  return {
    n: samples.length,
    valid: values.length,
    errorCount: samples.length - values.length,
    min: values.length ? Math.min(...values) : null,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
    max: values.length ? Math.max(...values) : null,
    mean: mean(values),
    stddev: stddev(values),
  };
}

function round(value) {
  return value === null || value === undefined || Number.isNaN(value) ? "" : String(Math.round(value));
}

function ratio(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return "";
  return (a / b).toFixed(2);
}

function parseNative(stdout) {
  const result = { isError: false, model: undefined, nativeDurationMs: undefined, assistantTextChars: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event.type === "system") result.model = event.model;
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block?.type === "text" && typeof block.text === "string") result.assistantTextChars += block.text.length;
        }
      }
      if (event.type === "result") {
        result.isError = event.is_error === true;
        result.nativeDurationMs = event.duration_ms;
        if (typeof event.result === "string" && result.assistantTextChars === 0) result.assistantTextChars = event.result.length;
      }
    } catch { }
  }
  return result;
}

function parseIota(stdout) {
  const result = { isError: false, traceDurationMs: undefined, engineOutputChars: undefined, protocol: undefined, command: undefined, processMode: undefined, reusedWarmProcess: undefined, assistantTextChars: 0 };
  const start = stdout.indexOf("{\n  \"context\"");
  if (start < 0) return result;
  try {
    const visibility = JSON.parse(stdout.slice(start));
    const spans = visibility.spans ?? visibility.link?.spans ?? [];
    const engine = spans.find((span) => span.kind === "engine.request");
    if (engine?.startedAt && engine?.endedAt) result.traceDurationMs = engine.endedAt - engine.startedAt;
    if (engine?.attributes) result.engineOutputChars = engine.attributes.outputChars;
    const backendResolve = spans.find((span) => span.kind === "backend.resolve" && span.attributes?.scope === "process");
    if (backendResolve?.attributes) {
      result.processMode = backendResolve.attributes.processMode;
      result.reusedWarmProcess = backendResolve.attributes.reusedWarmProcess;
    }
    result.protocol = visibility.link?.protocol?.name;
    if (visibility.link?.command) {
      result.command = `${visibility.link.command.executable} ${(visibility.link.command.args ?? []).join(" ")}`.trim();
    }
  } catch {
    result.isError = true;
  }
  return result;
}

async function runProcess(command, args, cwd, env) {
  return await new Promise((resolve) => {
    const start = performance.now();
    let firstOutputMs = null;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true });
    child.stdout.on("data", (chunk) => {
      if (firstOutputMs === null && chunk.toString().trim().length > 0) firstOutputMs = performance.now() - start;
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, wallMs: performance.now() - start, firstOutputMs, stdout, stderr });
    });
  });
}

async function runSample(group, sampleIndex, commandKind, phase) {
  const timestamp = new Date().toISOString();
  let proc;
  let parsed;
  if (commandKind === "native") {
    proc = await runProcess("claude", ["--print", "--output-format", "stream-json", "--verbose", "--bare", "--permission-mode", "auto", prompt], repo, nativeEnv);
    parsed = parseNative(proc.stdout);
  } else {
    proc = await runProcess("node", ["dist/index.js", "run", "--backend", "claude-code", "--cwd", repo, "--trace-json", prompt], cli, process.env);
    parsed = parseIota(proc.stdout);
  }

  const sample = {
    runId,
    timestamp,
    group,
    sampleIndex,
    phase,
    commandKind,
    wallMs: Math.round(proc.wallMs),
    firstOutputMs: proc.firstOutputMs === null ? null : Math.round(proc.firstOutputMs),
    exitCode: proc.exitCode,
    responseChars: proc.stdout.length,
    stderrChars: proc.stderr.length,
    ...parsed,
  };
  appendFileSync(jsonlPath, `${JSON.stringify(sample)}\n`, "utf8");
  console.log(`${group} #${sampleIndex} ${phase} wall=${sample.wallMs}ms first=${sample.firstOutputMs}ms exit=${sample.exitCode}`);
  return sample;
}

async function prewarm(commandKind, count) {
  for (let i = 1; i <= count; i += 1) {
    await runSample(`${commandKind}-prewarm`, i, commandKind, "prewarm");
  }
}

const samples = [];
for (let i = 1; i <= 5; i += 1) samples.push(await runSample("A-native-cold", i, "native", "cold"));
for (let i = 1; i <= 5; i += 1) samples.push(await runSample("B-iota-acp-cold", i, "iota-acp", "cold"));
await prewarm("native", 3);
for (let i = 1; i <= 30; i += 1) samples.push(await runSample("C-native-warm", i, "native", "warm"));
await prewarm("iota-acp", 3);
for (let i = 1; i <= 30; i += 1) samples.push(await runSample("D-iota-acp-warm", i, "iota-acp", "warm"));

const groups = Object.fromEntries(["A-native-cold", "B-iota-acp-cold", "C-native-warm", "D-iota-acp-warm"].map((name) => [name, samples.filter((sample) => sample.group === name)]));
const groupStats = Object.fromEntries(Object.entries(groups).map(([name, groupSamples]) => [name, stats(groupSamples, "wallMs")]));
const firstStats = Object.fromEntries(Object.entries(groups).map(([name, groupSamples]) => [name, stats(groupSamples, "firstOutputMs")]));
const traceStats = stats(groups["D-iota-acp-warm"], "traceDurationMs");
const iotaProtocol = samples.find((sample) => sample.commandKind === "iota-acp")?.protocol ?? "unknown";
const iotaCommand = samples.find((sample) => sample.commandKind === "iota-acp")?.command ?? "unknown";
const nativeObservedModel = samples.find((sample) => sample.commandKind === "native" && sample.model)?.model ?? model;

const coldNative = groupStats["A-native-cold"];
const coldIota = groupStats["B-iota-acp-cold"];
const warmNative = groupStats["C-native-warm"];
const warmIota = groupStats["D-iota-acp-warm"];

function statRow(label, stat) {
  return `| ${label} | ${stat.n} | ${stat.errorCount} | ${round(stat.min)} | ${round(stat.p50)} | ${round(stat.p90)} | ${round(stat.p95)} | ${round(stat.max)} | ${round(stat.mean)} | ${round(stat.stddev)} |`;
}

function firstRow(label, stat) {
  return `| ${label} | ${stat.n} | ${stat.errorCount} | ${round(stat.min)} | ${round(stat.p50)} | ${round(stat.p90)} | ${round(stat.p95)} | ${round(stat.max)} |`;
}

const report = `# Claude Code Native vs iota ACP Claude 延迟对比报告

**生成时间:** ${new Date().toISOString()}  
**实验文档:** ../claude-code-vs-iota-acp-latency.md  
**样本文件:** ./${runId}-claude-iota-latency-samples.jsonl

## 实验环境

| 字段 | 值 |
|---|---|
| 日期 | ${new Date().toISOString()} |
| 机器 | ${os.hostname()} |
| OS | ${os.type()} ${os.release()} ${os.arch()} |
| Node | ${process.version} |
| Bun | 1.3.11 |
| Claude Code version | 2.1.123 |
| iota commit | 07069ba |
| Backend protocol | claude-code: ${iotaProtocol} |
| iota ACP command | ${iotaCommand} |
| Model | ${nativeObservedModel} |
| Prompt | ${prompt} |
| Working directory | ${repo} |
| Native env source | ${settingsPath} |
| Native env keys | ${envNames.join(", ")}; ANTHROPIC_AUTH_TOKEN 映射为 ANTHROPIC_API_KEY，仅记录变量名 |

## Wall Clock 统计

| 组别 | 样本数 | error_count | min_ms | p50_ms | p90_ms | p95_ms | max_ms | mean_ms | stddev_ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${statRow("A native cold", coldNative)}
${statRow("B iota acp cold", coldIota)}
${statRow("C native warm", warmNative)}
${statRow("D iota acp warm", warmIota)}

## First Output 统计

该指标按实验文档定义为 stdout 首次出现非空输出的时间。iota CLI 会先打印 skill/MCP 初始化日志，所以此指标反映客户端首字节，不等价于模型首 token。

| 组别 | 样本数 | error_count | min_ms | p50_ms | p90_ms | p95_ms | max_ms |
|---|---:|---:|---:|---:|---:|---:|---:|
${firstRow("A native cold", firstStats["A-native-cold"])}
${firstRow("B iota acp cold", firstStats["B-iota-acp-cold"])}
${firstRow("C native warm", firstStats["C-native-warm"])}
${firstRow("D iota acp warm", firstStats["D-iota-acp-warm"])}

## iota Trace 补充

| 组别 | 样本数 | error_count | min_ms | p50_ms | p90_ms | p95_ms | max_ms | mean_ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| D iota acp warm trace_duration_ms | ${traceStats.n} | ${traceStats.errorCount} | ${round(traceStats.min)} | ${round(traceStats.p50)} | ${round(traceStats.p90)} | ${round(traceStats.p95)} | ${round(traceStats.max)} | ${round(traceStats.mean)} |

## 差异结论

| 对比 | overhead_p50_ms | overhead_p95_ms | overhead_ratio_p50 | overhead_ratio_p95 | 结论 |
|---|---:|---:|---:|---:|---|
| B - A cold | ${round(coldIota.p50 - coldNative.p50)} | ${round(coldIota.p95 - coldNative.p95)} | ${ratio(coldIota.p50, coldNative.p50)} | ${ratio(coldIota.p95, coldNative.p95)} | iota ACP CLI 冷启动路径相对 native 的端到端开销 |
| D - C warm | ${round(warmIota.p50 - warmNative.p50)} | ${round(warmIota.p95 - warmNative.p95)} | ${ratio(warmIota.p50, warmNative.p50)} | ${ratio(warmIota.p95, warmNative.p95)} | iota ACP CLI 热启动路径相对 native 的端到端开销 |

## 备注

- 本次实验按 CLI 路径采样，不代表 iota-agent 常驻服务路径。
- iota CLI 每个样本都是新的 Node 进程；ACP adapter 的 long-lived subprocess 在单次 CLI 执行内启动，样本之间不复用。
- iota trace 中本次 ACP 映射的 engine outputChars 可能为 0；报告的主指标使用外层 wall_ms。
- JSONL 样本只保存聚合字段和长度，不保存 stdout/stderr 原文。
`;

writeFileSync(reportPath, report, "utf8");
console.log(`REPORT_PATH=${reportPath}`);
console.log(`JSONL_PATH=${jsonlPath}`);
