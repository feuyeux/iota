# CLAUDE.md

This file provides root-level guidance for working in the Iota workspace with Claude-oriented workflows.

## Workspace Overview

The root directory is the single Git repository for Iota.

Primary first-party areas:

- `iota-engine/`: `@iota/engine`, the core runtime, backend protocol layer, approval, memory, visibility, MCP, workspace, and skill execution
- `iota-cli/`: `@iota/cli`, the CLI and interactive interface for direct Engine execution
- `iota-agent/`: `@iota/agent`, the Fastify HTTP / WebSocket service around Engine
- `iota-app/`: the Vite + React frontend that consumes Agent snapshots and deltas
- `iota-skill/`: structured skills, currently including `pet-generator` and its iota-fun examples
- `docs/`: architecture, verification, diagrams, and design documents

`mem0/` may appear as an untracked local reference checkout. Treat it as external reference material unless a task explicitly targets it.

## Design Authority

Use current code first, then current docs. Primary docs:

- `docs/guides/README.md`
- `docs/guides/00-architecture-overview.md`
- `docs/guides/02-cli-guide.md`
- `docs/guides/03-tui-guide.md`
- `docs/guides/04-agent-guide.md`
- `docs/guides/05-app-guide.md`
- `docs/guides/06-engine-guide.md`
- `docs/guides/07-visibility-trace-guide.md`
- `docs/guides/08-fun-call-guide.md`
- `docs/guides/09-fun-runtime-install-guide.md`
- `docs/guides/11-iota-skill.md`
- `docs/guides/12-iota-memory.md`
- `docs/requirement/iota_engine_design_0425.md`
- `docs/requirement/iota_app_design.md`
- `docs/requirement/iota_memory_design.md`
- `docs/requirement/IMPLEMENTATION_STATUS.md`

If code and docs differ, prefer the current implementation and then update docs.

## Architecture Rules

- Backend protocol adaptation belongs inside `iota-engine/src/backend/`.
- Do not add protocol-conversion executables.
- Do not depend on vendor internal APIs or SDK internals.
- All native backend events must normalize to `RuntimeEvent`.
- App-facing UI should consume Agent App Read Model snapshots and deltas, not raw backend protocols.
- Shared docs belong in root `docs/`.
- Redact sensitive values in visibility, audit, snapshot, replay, docs, logs, and event examples.

## Backend Integration

All five backends are handled by engine-internal adapters:

| Backend | Executable | Process Model | Protocol |
|---|---|---|---|
| Claude Code | `claude --print --output-format stream-json ...` | per-execution subprocess | stream-json NDJSON |
| Codex | `codex exec [-c model=...]` | per-execution subprocess | NDJSON |
| Gemini CLI | `gemini --output-format stream-json --skip-trust --prompt <prompt>` | per-execution subprocess | stream-json NDJSON |
| Hermes Agent | `hermes acp` | long-running subprocess | ACP JSON-RPC 2.0 |
| OpenCode | `opencode acp` | long-running subprocess | ACP JSON-RPC 2.0 |

Keep secrets out of argv. Pass credentials through environment or backend-native config files resolved by Engine config.

## Current Implementation Notes

- Backend credentials, models, and endpoints are resolved through layered config plus Redis distributed config overlays.
- Config loading supports defaults, user `~/.iota/config.yaml`, project `iota.config.yaml`, selected environment overrides, and Redis scopes (`global`, `backend`, `session`, `user`).
- Do not rely on deleted backend-local env files such as `iota-engine/claude.env` or `codex.env`.
- Agent WebSocket `/api/v1/stream` accepts `execute`, `interrupt`, `subscribe_app_session`, and `subscribe_visibility` inbound messages.
- App approval UI can send `approval_decision`, but Agent WebSocket inbound schema does not currently route that message into `engine.resolveApproval()`. Do not document a completed App-to-Agent-to-Engine approval loop unless code and tests are added.
- Approval is enforced in Engine through policy and approval hooks. CLI uses `CliApprovalHook`; Agent constructs Engine with `DeferredApprovalHook`.
- Engine loads structured skills from configured `skill.roots`, falling back to repository-adjacent `iota-skill` when empty.
- Executable skills run through `SkillRunner -> McpRouter -> configured MCP server`. Do not bypass MCP to call iota-fun internals directly.
- The `iota-fun` MCP server is implemented in Engine; function sources live under `iota-skill/pet-generator/iota-fun/`; compiled artifacts are cached under `$HOME/.iota/iota-fun`.
- App architecture diagrams must label every arrow with exact start box and end box; avoid ambiguous floating WS arrows.

## Commands

Run commands inside the relevant package:

- `cd iota-engine && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-cli && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-agent && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-app && bun install && bun run build`

Also run `bun run lint` and `bun run format` in every touched package where available.

Notes:

- `iota-app` has no standalone `typecheck` script; `bun run build` runs `tsc -b && vite build`.
- `iota-agent` tests currently use `vitest run --passWithNoTests`.
- `iota-skill` has no package-level build; validate through Engine skill/iota-fun tests and the relevant runtime guide.

## Backend Verification Rule

- Do not stop verification at executable discovery or `iota status`.
- After switching Claude Code, Codex, Gemini CLI, Hermes, or OpenCode, run one real request with trace:

```bash
cd iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

- Use `deployment/scripts/ensure-backends.sh --check-only` for shared backend discovery.
- For Hermes, inspect `hermes config show`.
- Reject dead `model.provider: custom` or local `model.base_url` configurations unless that local gateway is actually running.

## Safety

Do not commit secrets, populated env files, `node_modules/`, `dist/`, `*.tsbuildinfo`, generated caches, or compiled iota-fun artifacts.

Redact API keys, auth tokens, cookies, passwords, and secret-like values in visibility, audit, snapshot, replay, log, docs, and event examples.

## Commit Identity & Co-Authorship Rules

The tool identity that makes the commit must match the `Co-authored-by` trailer.

| Committing Tool | Author | Co-authored-by |
|---|---|---|
| Claude | `Claude <noreply@anthropic.com>` | `Co-authored-By: Claude <noreply@anthropic.com>` |
| Codex | `Codex <noreply@openai.com>` | `Co-authored-By: Codex <noreply@openai.com>` |
| Gemini | `Gemini <noreply@google.com>` | `Co-authored-By: Gemini <noreply@google.com>` |
