# Claude Code Native vs Iota ACP Claude 延迟对比报告

**生成时间:** 2026-04-30T15:26:43.893Z  
**实验文档:** ../claude-code-vs-iota-acp-latency.md  
**样本文件:** ./2026-04-30T15-19-17-639Z-claude-iota-latency-samples.jsonl

## 实验环境

| 字段 | 值 |
|---|---|
| 日期 | 2026-04-30T15:26:43.893Z |
| 机器 | alienware |
| OS | Windows_NT 10.0.26200 x64 |
| Node | v24.13.1 |
| Bun | 1.3.11 |
| Claude Code version | 2.1.123 |
| Iota commit | 07069ba |
| Backend protocol | claude-code: acp |
| Iota ACP command | npx @anthropic-ai/claude-code-acp |
| Model | MiniMax-M2.7 |
| Prompt | ping。只回复 pong。 |
| Working directory | D:/coding/creative/iota |
| Native env source | C:/Users/feuye/.claude/settings-minimax.json |
| Native env keys | ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_HAIKU_MODEL, ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_MODEL, ANTHROPIC_SMALL_FAST_MODEL, API_TIMEOUT_MS, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; ANTHROPIC_AUTH_TOKEN 映射为 ANTHROPIC_API_KEY，仅记录变量名 |

## Wall Clock 统计

| 组别 | 样本数 | error_count | min_ms | p50_ms | p90_ms | p95_ms | max_ms | mean_ms | stddev_ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A native cold | 5 | 0 | 5241 | 6856 | 7732 | 7732 | 7732 | 6746 | 934 |
| B iota acp cold | 5 | 0 | 4592 | 5165 | 5750 | 5750 | 5750 | 5241 | 401 |
| C native warm | 30 | 0 | 4818 | 6054 | 9308 | 10005 | 10636 | 6474 | 1591 |
| D iota acp warm | 30 | 0 | 3980 | 5035 | 6599 | 7123 | 7507 | 5268 | 949 |

## First Output 统计

该指标按实验文档定义为 stdout 首次出现非空输出的时间。Iota CLI 会先打印 skill/MCP 初始化日志，所以此指标反映客户端首字节，不等价于模型首 token。

| 组别 | 样本数 | error_count | min_ms | p50_ms | p90_ms | p95_ms | max_ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| A native cold | 5 | 0 | 3409 | 3433 | 4375 | 4375 | 4375 |
| B iota acp cold | 5 | 0 | 1347 | 1351 | 1364 | 1364 | 1364 |
| C native warm | 30 | 0 | 3381 | 3426 | 3471 | 3489 | 3511 |
| D iota acp warm | 30 | 0 | 1335 | 1379 | 1425 | 1627 | 1633 |

## Iota Trace 补充

| 组别 | 样本数 | error_count | min_ms | p50_ms | p90_ms | p95_ms | max_ms | mean_ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| D iota acp warm trace_duration_ms | 30 | 0 | 2521 | 3519 | 5176 | 5673 | 6084 | 3795 |

## 差异结论

| 对比 | overhead_p50_ms | overhead_p95_ms | overhead_ratio_p50 | overhead_ratio_p95 | 结论 |
|---|---:|---:|---:|---:|---|
| B - A cold | -1691 | -1982 | 0.75 | 0.74 | Iota ACP CLI 冷启动路径相对 native 的端到端开销 |
| D - C warm | -1019 | -2882 | 0.83 | 0.71 | Iota ACP CLI 热启动路径相对 native 的端到端开销 |

## 备注

- 本次实验按 CLI 路径采样，不代表 iota-agent 常驻服务路径。
- Iota CLI 每个样本都是新的 Node 进程；ACP adapter 的 long-lived subprocess 在单次 CLI 执行内启动，样本之间不复用。
- Iota trace 中本次 ACP 映射的 engine outputChars 可能为 0；报告的主指标使用外层 wall_ms。
- JSONL 样本只保存聚合字段和长度，不保存 stdout/stderr 原文。
