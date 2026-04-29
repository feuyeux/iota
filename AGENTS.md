# AGENTS.md

## Project Overview

Iota is a pluggable AI coding assistant runtime. The workspace contains one root repository with four main packages:

- `iota-engine`: core runtime and backend adapters
- `iota-cli`: command-line interface
- `iota-agent`: Fastify HTTP / WebSocket service
- `iota-app`: React / Vite frontend

## Workspace Structure

```text
iota/
├── docs/                      # Shared design docs and verification guides
├── deployment/                # Redis / Docker / storage deployment files
├── iota-engine/               # @iota/engine runtime
├── iota-cli/                  # @iota/cli command interface
├── iota-agent/                # @iota/agent HTTP/WebSocket service
└── iota-app/                  # Vite + React frontend
```

## Source Of Truth

Use these documents as the primary design authority:

- `docs/guides/00-architecture-overview.md`
- `docs/guides/03-agent-guide.md`
- `docs/guides/04-app-guide.md`
- `docs/guides/05-engine-guide.md`
- `docs/requirement/4.iota_engine_design_0425.md`
- `docs/requirement/5.iota_app_design.md`

If code and docs diverge, prefer the current code path, then update docs to match actual behavior.

## Backend Adapters

Each backend adapter lives in `iota-engine/src/backend/`:

| Adapter | File | Process Model | Protocol |
|---|---|---|---|
| Claude Code | `claude-code.ts` | per-execution | stream-json NDJSON |
| Codex | `codex.ts` | per-execution | NDJSON |
| Gemini CLI | `gemini.ts` | per-execution | stream-json NDJSON |
| Hermes Agent | `hermes.ts` | long-running | ACP JSON-RPC 2.0 |

## Hard Architecture Constraints

- Backend protocol logic stays in `iota-engine/src/backend/`
- Do not add vendor internal SDK dependencies
- Do not add protocol-conversion executables
- All backend events must normalize to `RuntimeEvent`
- App-facing UI must consume Agent snapshot / delta models, not raw backend protocol payloads
- Visibility, audit, snapshot, replay, logs, and docs must redact secrets

## Current Behavior Constraints

- Backend credentials, models, and endpoints are stored in Redis distributed config
- Do not rely on deleted backend-local env files such as `iota-engine/claude.env` or `codex.env`
- WebSocket currently supports `execute`, `interrupt`, `subscribe_app_session`, and `subscribe_visibility`
- Do not document or diagram a first-class App approval decision WebSocket API unless you also implement it in code
- Approval in the current implementation is enforced in Engine through approval policy and approval hook; CLI has a concrete `CliApprovalHook`
- Project toolchain convention: use `bun` for install, build, typecheck, test, lint, and dev execution; use `node` to run built JavaScript artifacts under `dist/`

## Development Workflow

1. Engine changes: `cd iota-engine && bun install && bun run build && bun run typecheck && bun run test`
2. CLI changes: `cd iota-cli && bun install && bun run build && bun run typecheck && bun run test`
3. Agent changes: `cd iota-agent && bun install && bun run build && bun run typecheck && bun run test`
4. App changes: `cd iota-app && bun install && bun run build && bun run typecheck`
5. In each touched package, also run `bun run lint` and `bun run format` when available

## Backend Verification Rule

Verification cannot stop at executable discovery or `iota status`.

After switching Claude Code, Codex, Gemini CLI, or Hermes, run one real traced request:

```bash
cd iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

For Hermes specifically:

- inspect `hermes config show`
- reject dead `model.provider: custom`
- reject local `model.base_url` configs unless the local gateway is actually running

## Review Focus

When reviewing code or docs, pay extra attention to:

- approval flow consistency between Engine, Agent, App, and diagrams
- WebSocket message schema consistency
- visibility / trace / replay coverage versus documentation claims
- session / execution ownership and arrow direction in architecture diagrams
- Redis key naming and persistence path descriptions

## Testing

- Use Vitest with colocated `*.test.ts` files
- Test backend adapters, protocol parsers, memory system, visibility records, approval flow, and App read model shaping
- Run `bun run typecheck && bun run test` before submitting changes

## Security

- Never commit API keys, tokens, passwords, or secrets
- Use Redis distributed config for backend credentials
- Keep examples redacted in docs, tests, logs, visibility, and snapshots
