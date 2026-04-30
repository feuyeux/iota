# iota Engine

`@iota/engine` 是 iota 的核心 TypeScript 运行时库。它负责统一执行、事件流、工作区状态、记忆系统、审批、可见性、追踪、配置与存储，并把多个 AI coding backend 的原生协议归一化为统一运行时模型。

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

Backend credentials, model settings, and endpoints are stored in Redis distributed config, not backend-local env files.

全部 5 后端（Claude Code、Codex、Gemini CLI、Hermes、OpenCode）的安装、Redis 配置和验证步骤见 [`docs/iota-guides/00-setup.md`](../docs/iota-guides/00-setup.md)。

## Verification

Backend changes must be verified with a real traced execution:

```bash
cd ../iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

For Hermes, inspect `hermes config show` and reject dead local-gateway configs.

## Documentation

- [`../docs/iota-guides/02-engine.md`](../docs/iota-guides/02-engine.md)
- [`../docs/iota-guides/03-backend-adapters.md`](../docs/iota-guides/03-backend-adapters.md)
- [`../docs/iota-guides/05-agent.md`](../docs/iota-guides/05-agent.md)
