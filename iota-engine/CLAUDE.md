# CLAUDE.md

This file provides package-level guidance for working in `iota-engine/`.

## Workspace Overview

`iota-engine` is the `@iota/engine` runtime library. It orchestrates multiple AI coding CLIs through native subprocess protocols and provides shared memory, workspace, visibility, storage, routing, approval, metrics, and event-streaming primitives for `../iota-cli/` and `../iota-agent/`.

Shared design documents live at the workspace root in `../docs/`.

## Design Authority

- `../docs/guides/05-engine-guide.md`
- `../docs/guides/03-agent-guide.md`
- `../docs/requirement/4.iota_engine_design_0425.md`
- `../docs/requirement/5.iota_app_design.md`

If code and docs conflict, prefer the current implementation and then update docs.

## Architecture Rules

- TypeScript / Bun runtime
- Engine-internal adapters in `src/backend/`
- Native CLI subprocess protocols over stdio
- No vendor internal SDK imports
- No extra protocol-conversion executables
- Redact secret-like values in visibility, audit, snapshots, replay, logs, and examples

## Backend Integration Baseline

| Backend | Process | Protocol |
|---|---|---|
| Claude Code | `claude --print --output-format stream-json --verbose --bare --permission-mode auto` | NDJSON stream-json output |
| Codex | `codex exec [-c model=...]` | NDJSON output |
| Gemini CLI | `gemini --output-format stream-json --skip-trust --prompt <prompt>` | NDJSON stream-json output |
| Hermes Agent | `hermes acp` | ACP JSON-RPC 2.0 |

## Current Implementation Notes

- Approval enforcement is currently implemented in `src/engine.ts`; avoid treating `src/approval/guard.ts` as the active execution path unless wiring changes
- Backend credentials, models, and endpoints come from Redis distributed config
- Do not reintroduce backend-local env files as the main configuration path
- Keep Engine output aligned with Agent App Read Model expectations: snapshots and deltas are shaped above Engine, but Engine remains the source for visibility, trace, replay, and runtime events

## Commands

Run from `iota-engine/`:

- `bun install`
- `bun run build`
- `bun run typecheck`
- `bun run test`
- `bun run test:watch`
- `bun run lint`
- `bun run format`

## Verification Rule

Do not stop verification at executable discovery or `status()`.

After changing backend-related code, run at least one real traced execution:

```bash
cd ../iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

For Hermes, inspect `hermes config show`; reject dead `model.provider: custom` / local `model.base_url` configurations unless the local gateway is actually running.

## Commit Identity & Co-Authorship Rules

The tool identity that makes the commit must match the `Co-authored-by` trailer.

| Committing Tool | Author | Co-authored-by |
|---|---|---|
| Claude | `Claude <noreply@anthropic.com>` | `Co-authored-By: Claude <noreply@anthropic.com>` |
| Codex | `Codex <noreply@openai.com>` | `Co-authored-By: Codex <noreply@openai.com>` |
| Gemini | `Gemini <noreply@google.com>` | `Co-authored-By: Gemini <noreply@google.com>` |
