# AGENTS.md

## Package Overview

`iota-engine/` contains `@iota/engine`, the core runtime library. It is the only layer allowed to speak vendor CLI subprocess protocols directly.

Key responsibilities:

- backend adapters for Claude Code, Codex, Gemini CLI, Hermes Agent, and OpenCode
- normalized `RuntimeEvent` generation and event persistence
- approval policy enforcement and approval hooks
- memory injection / extraction and visibility reporting
- workspace path guards, snapshots, and delta journal
- visibility store, trace spans, App read model helpers, and replay data
- Redis config, Redis storage, Redis pub/sub, optional Milvus, optional MinIO
- MCP routing plus structured skill loading and execution
- iota-fun MCP server and local multi-language function runtime support

## Source Structure

```text
src/
├── approval/         # approval hooks, helpers, policy enforcement
├── audit/            # audit logger
├── backend/          # vendor adapters and subprocess protocol handling
├── config/           # config schema, layered loader, Redis-backed config overlay
├── error/            # runtime error codes and typed errors
├── event/            # RuntimeEvent types, event store, multiplexer
├── mcp/              # MCP client, router, manager, iota-fun server
├── memory/           # dialogue, working, retrieval, injection, storage mapping
├── metrics/          # metrics collector
├── protocol/         # NDJSON / ACP / JSON-RPC helpers
├── routing/          # backend resolver and selection
├── skill/            # SKILL.md loader and executable skill runner
├── storage/          # Redis / MinIO abstractions and pub/sub
├── visibility/       # redaction, tokens, spans, snapshots, App read model
└── workspace/        # path guards, snapshots, watchers, deltas
```

Tests are colocated as `*.test.ts`.

## Backend Adapters

Each adapter lives in `src/backend/`:

| Adapter | Process Mode | Protocol |
|---|---|---|
| ClaudeCodeAdapter | per-execution subprocess | stream-json NDJSON |
| CodexAdapter | per-execution subprocess | NDJSON |
| GeminiAdapter | per-execution subprocess | stream-json NDJSON |
| HermesAdapter | long-running subprocess | ACP JSON-RPC 2.0 |
| OpenCodeAcpAdapter | long-running subprocess | ACP JSON-RPC 2.0 |

## Hard Constraints

- Backend protocol logic stays in `src/backend/`.
- Do not add vendor internal SDK dependencies.
- Do not add protocol-conversion executables.
- All sensitive values must be redacted in visibility, audit, snapshots, replay, docs, and logs.
- All native backend events must map into normalized `RuntimeEvent`.
- Backend adapters must keep secrets out of argv; pass secrets through environment or backend-native config files.
- App read models are built from Engine visibility/event models, never from raw backend payloads.

## Current Implementation Notes

- Approval is enforced by Engine through approval policy and approval hooks. `CliApprovalHook` is used by CLI; Agent constructs Engine with `DeferredApprovalHook`.
- `IotaEngine.resolveApproval()` exists for deferred approval hooks, but Agent WebSocket inbound messages currently do not include `approval_decision` in the accepted `IncomingMessage` union or route it into `resolveApproval()`.
- `src/approval/guard.ts` exists and shares helpers, but confirm real wiring in `src/engine.ts` before treating it as authoritative.
- Config loading merges defaults, user `~/.iota/config.yaml`, project `iota.config.yaml`, selected env overrides, and optional Redis distributed config overlays.
- Redis distributed config is the operational source for backend credentials and model settings in shared deployments. Do not reintroduce deleted backend-local credential files.
- `skill.roots` is part of `IotaConfig`; when empty, Engine falls back to the repository-adjacent `iota-skill` directory.
- Structured executable skills are matched by trigger text and run via `SkillRunner -> McpRouter -> configured MCP server`; they should not bypass MCP to call iota-fun internals directly.
- The `iota-fun` MCP server lives under `src/mcp/fun-server.ts`; function sources live in `../iota-skill/pet-generator/iota-fun/`; compiled outputs are cached under `$HOME/.iota/iota-fun`.
- Hermes remains sensitive to local `hermes config show`; reject dead `model.provider: custom` and unreachable local `model.base_url` configs during verification.

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

Use `bun` for development workflows and `node` when running built `dist/` artifacts for verification or production-style execution.

## Verification Rule

Backend readiness must be proven with a real traced execution, not just `probe()` or executable discovery:

```bash
cd ../iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

For Hermes, inspect `hermes config show` and reject dead local-gateway configs.

For skill or iota-fun changes, run the relevant Engine tests and, when runtime languages are touched, follow `docs/guides/09-fun-runtime-install-guide.md` for the language-specific toolchain check.

## Testing Focus

- protocol parsing and backend adapter event mapping
- approval flow and waiting state ordering
- deferred approval boundaries between Engine and Agent
- visibility generation, App snapshots, App read model shaping, and redaction
- memory mapping, retrieval, injection, storage, and visibility
- MCP config generation and MCP router calls
- skill manifest parsing, trigger matching, output rendering, and MCP execution
- iota-fun runtime planning and cache paths
- workspace path guards and snapshot persistence
- Redis config overlays, storage, pub/sub, and visibility records
- long-running Hermes and OpenCode per-execution trace isolation
