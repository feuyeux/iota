# CLAUDE.md

This file provides root-level guidance for working in the Iota workspace.

## Workspace Overview

The root directory is the single Git repository for Iota.

Primary packages:

- `iota-engine/`: `@iota/engine`, the core runtime and backend protocol layer
- `iota-cli/`: `@iota/cli`, the CLI interface
- `iota-agent/`: `@iota/agent`, the Fastify HTTP / WebSocket service
- `iota-app/`: the Vite + React frontend
- `docs/`: architecture, verification, and design documents

## Design Authority

- `docs/guides/README.md`
- `docs/guides/00-architecture-overview.md`
- `docs/guides/03-agent-guide.md`
- `docs/guides/04-app-guide.md`
- `docs/guides/05-engine-guide.md`
- `docs/requirement/4.iota_engine_design_0425.md`
- `docs/requirement/5.iota_app_design.md`

If code and docs differ, prefer the current implementation and then update docs.

## Architecture Rules

- Backend protocol adaptation belongs inside `iota-engine/src/backend/`
- Do not add protocol-conversion executables
- Do not depend on vendor internal APIs or SDK internals
- App-facing UI should consume Agent App Read Model snapshots and deltas, not raw backend protocols
- Shared docs belong in root `docs/`

## Backend Integration

All four backends use subprocess stdio protocols handled by engine-internal adapters:

| Backend | Executable | Process Model | Protocol |
|---|---|---|---|
| Claude Code | `claude --print --output-format stream-json --verbose --permission-mode auto` | per-execution | NDJSON stream-json |
| Codex | `codex exec [-c model=...]` | per-execution | NDJSON |
| Gemini CLI | `gemini --output-format stream-json --skip-trust --prompt <prompt>` | per-execution | NDJSON stream-json |
| Hermes Agent | `hermes acp` | long-running | ACP JSON-RPC 2.0 |

## Current Implementation Notes

- Backend credentials are stored in Redis distributed config, not backend-local `.env` files
- Agent WebSocket supports `execute`, `interrupt`, `subscribe_app_session`, and `subscribe_visibility`
- Approval is enforced in Engine through policy + approval hook; do not assume a separate App-to-Agent approval decision API exists unless code implements it
- App architecture diagrams must label every arrow with exact start box and end box; avoid ambiguous floating WS arrows

## Commands

Run commands inside the relevant package:

- `cd iota-engine && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-cli && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-agent && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-app && bun install && bun run build && bun run typecheck`

Also run `bun run lint` and `bun run format` in every touched package where available.

## Backend Verification Rule

- Do not stop verification at executable discovery or `iota status`
- After switching Claude Code, Codex, Gemini CLI, or Hermes, run one real request with trace:

```bash
cd iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

- For Hermes, inspect `hermes config show`
- Reject dead `model.provider: custom` or local `model.base_url` configurations unless that local gateway is actually running

## Safety

Do not commit secrets, populated env files, `node_modules/`, `dist/`, or `*.tsbuildinfo`.

Redact API keys, auth tokens, cookies, passwords, and secret-like values in visibility, audit, snapshot, replay, log, and event examples.

## Commit Identity & Co-Authorship Rules

The tool identity that makes the commit must match the `Co-authored-by` trailer.

| Committing Tool | Author | Co-authored-by |
|---|---|---|
| Claude | `Claude <noreply@anthropic.com>` | `Co-authored-By: Claude <noreply@anthropic.com>` |
| Codex | `Codex <noreply@openai.com>` | `Co-authored-By: Codex <noreply@openai.com>` |
| Gemini | `Gemini <noreply@google.com>` | `Co-authored-By: Gemini <noreply@google.com>` |
