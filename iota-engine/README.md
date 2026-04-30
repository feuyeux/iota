# Iota Engine

`@iota/engine` 是 Iota 的核心 TypeScript 运行时库。它负责统一执行、事件流、工作区状态、记忆系统、审批、可见性、追踪、配置与存储，并把多个 AI coding backend 的原生协议归一化为统一运行时模型。

## 包结构

```text
iota-engine/
├── src/
│   ├── approval/     # approval hooks and policy enforcement
│   ├── audit/        # audit logging
│   ├── backend/      # Claude / Codex / Gemini / Hermes / OpenCode adapters
│   ├── config/       # config schema and Redis-backed config loader
│   ├── event/        # normalized RuntimeEvent flow
│   ├── mcp/          # MCP routing and manager
│   ├── memory/       # dialogue, working memory, retrieval, injection
│   ├── metrics/      # metrics collection
│   ├── protocol/     # NDJSON / ACP helpers
│   ├── routing/      # backend selection
│   ├── storage/      # Redis / MinIO abstractions
│   ├── visibility/   # read models, redaction, token estimation
│   └── workspace/    # path guards, snapshots, deltas, watchers
├── iota.config.yaml
└── package.json
```

## Backend Baseline

| Backend | Process Model | Protocol |
|---|---|---|
| Claude Code | per-execution `claude` subprocess | stream-json NDJSON |
| Codex | per-execution `codex exec` subprocess | NDJSON |
| Gemini CLI | per-execution `gemini` subprocess | stream-json NDJSON |
| Hermes Agent | long-running `hermes acp` subprocess | ACP JSON-RPC 2.0 |
| OpenCode | long-running `opencode acp` subprocess | ACP JSON-RPC 2.0 |

Backend protocol adaptation belongs only inside `src/backend/`.

## Current Behavior

- Engine emits normalized `RuntimeEvent`
- Engine persists execution events, visibility, and traces
- Engine exposes execution visibility, execution trace, replay-oriented data, and App read model helpers
- Approval is enforced inside Engine through approval policy and approval hook
- Redis distributed config is the source of truth for backend credentials, models, and endpoints

## Known Implementation Caveats

- `src/approval/guard.ts` exists, but current execution-path approval behavior is primarily implemented in `src/engine.ts`
- Do not assume App approval decisions are already a complete Engine-to-Agent-to-App roundtrip API; that protocol is not fully implemented end-to-end yet
- Hermes long-running process tracing exists, but multi-execution anti-cross-talk coverage still needs strong integration verification

## Commands

Run from `iota-engine/`:

```bash
bun install
bun run build
bun run typecheck
bun run test
bun run lint
bun run format
```

Convention: use `bun` for install, build, typecheck, test, lint, format, and dev workflows; use `node` to run built JavaScript artifacts under `dist/`.

## Configuration

Backend credentials, model settings, and endpoints are stored in Redis distributed config, not backend-local env files:

```bash
iota config set env.ANTHROPIC_AUTH_TOKEN "<redacted>" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id claude-code
iota config set env.ANTHROPIC_MODEL "MiniMax-M2.7" --scope backend --scope-id claude-code

iota config set env.OPENAI_MODEL "gpt-5.5" --scope backend --scope-id codex

iota config set env.GEMINI_MODEL "auto-gemini-3" --scope backend --scope-id gemini

iota config set env.HERMES_API_KEY "<redacted>" --scope backend --scope-id hermes
iota config set env.HERMES_BASE_URL "https://api.minimaxi.com/anthropic" --scope backend --scope-id hermes
iota config set env.HERMES_MODEL "MiniMax-M2.7" --scope backend --scope-id hermes
iota config set env.HERMES_PROVIDER "minimax-cn" --scope backend --scope-id hermes

iota config set env.OPENCODE_MODEL "anthropic/claude-sonnet-4-6" --scope backend --scope-id opencode
```

## Verification

Backend changes must be verified with a real traced execution:

```bash
cd ../iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

For Hermes, inspect `hermes config show` and reject dead local-gateway configs.

## Documentation

- [`../docs/guides/05-engine-guide.md`](../docs/guides/05-engine-guide.md)
- [`../docs/guides/03-agent-guide.md`](../docs/guides/03-agent-guide.md)
- [`../docs/requirement/4.iota_engine_design_0425.md`](../docs/requirement/4.iota_engine_design_0425.md)
- [`../docs/requirement/5.iota_app_design.md`](../docs/requirement/5.iota_app_design.md)
