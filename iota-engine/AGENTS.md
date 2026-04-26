# AGENTS.md

## Package Overview

`iota-engine/` contains `@iota/engine`, the core runtime library. It is the only layer allowed to speak vendor CLI subprocess protocols directly.

Key responsibilities:

- backend adapters for Claude Code, Codex, Gemini CLI, and Hermes Agent
- normalized `RuntimeEvent` generation and event persistence
- approval policy enforcement and approval hooks
- memory injection / extraction and visibility reporting
- workspace path guards, snapshots, and delta journal
- visibility store, trace spans, App read model helpers, and replay data
- Redis config, Redis storage, optional Milvus, optional MinIO

## Source Structure

```text
src/
├── approval/         # approval hooks and policy enforcement
├── audit/            # audit logger
├── backend/          # vendor adapters and subprocess protocol handling
├── config/           # config schema and Redis-backed config loader
├── event/            # RuntimeEvent types and event store
├── mcp/              # MCP router and manager
├── memory/           # dialogue, working, retrieval, injection
├── metrics/          # metrics collector
├── protocol/         # NDJSON / ACP / JSON-RPC helpers
├── routing/          # backend resolver and selection
├── storage/          # Redis / MinIO abstractions
├── visibility/       # redaction, tokens, spans, App read model
└── workspace/        # path guards, snapshots, watchers, deltas
```

Tests are colocated as `*.test.ts`.

## Backend Adapters

Each adapter lives in `src/backend/`:

| Adapter | Process Mode | Protocol |
|---|---|---|
| ClaudeCodeAdapter | per-execution | stream-json NDJSON |
| CodexAdapter | per-execution | NDJSON |
| GeminiAdapter | per-execution | stream-json NDJSON |
| HermesAdapter | long-running | ACP JSON-RPC 2.0 |

## Hard Constraints

- Backend protocol logic stays in `src/backend/`
- No vendor internal SDK dependencies
- No protocol-conversion executables
- All sensitive values must be redacted in visibility, audit, snapshots, replay, and logs
- All native backend events must map into normalized `RuntimeEvent`

## Current Implementation Notes

- Approval is currently enforced in `engine.ts` via approval policy and approval hook; treat `src/approval/guard.ts` as non-authoritative unless wiring changes
- Redis distributed config is the source of truth for backend credentials and model settings
- Do not reintroduce deleted backend-local credential files
- WebSocket approval decision flow is not an Engine concern unless a real Agent protocol is added on top

## Development Commands

Run from `iota-engine/`:

```bash
bun install
bun run build
bun run typecheck
bun run test
bun run lint
bun run format
```

## Verification Rule

Backend readiness must be proven with a real traced execution, not just `probe()` or executable discovery:

```bash
cd ../iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

For Hermes, inspect `hermes config show` and reject dead local-gateway configs.

## Testing Focus

- protocol parsing
- backend adapter event mapping
- approval flow and waiting state ordering
- visibility generation and redaction
- memory retrieval / injection
- workspace path guards and snapshot persistence
- long-running Hermes per-execution trace isolation
