# CLAUDE.md

This file provides package-level guidance for working in `iota-engine/`.

## Workspace Overview

`iota-engine` is the `@iota/engine` runtime library. It orchestrates multiple AI coding CLIs through ACP subprocess protocols and provides shared memory, workspace, visibility, storage, routing, approval, metrics, and event-streaming primitives for `../iota-cli/` and `../iota-agent/`.

Shared design documents live at the workspace root in `../docs/`.

## Design Authority

- `../docs/iota-guides/02-engine.md`
- `../docs/iota-guides/05-agent.md`

If code and docs conflict, prefer the current implementation and then update docs.

## Architecture Rules

- TypeScript / Bun runtime
- Engine-internal adapters in `src/backend/`
- ACP JSON-RPC 2.0 is the only backend protocol path for first-party backends
- No vendor internal SDK imports; adapter-backed ACP shims must remain external executables configured through backend protocol settings
- Redact secret-like values in visibility, audit, snapshots, replay, logs, and examples

## Backend Integration Baseline

| Backend | ACP Process | Protocol |
|---|---|---|
| Claude Code | `npx @zed-industries/claude-code-acp` | ACP JSON-RPC 2.0 |
| Codex | `npx @zed-industries/codex-acp` | ACP JSON-RPC 2.0 |
| Gemini CLI | `gemini --acp` | ACP JSON-RPC 2.0 |
| Hermes Agent | `hermes acp` | ACP JSON-RPC 2.0 |
| OpenCode | `opencode acp` | ACP JSON-RPC 2.0 |

## Current Implementation Notes

- Approval enforcement is implemented in `src/engine.ts` through approval policy and hooks. CLI uses `CliApprovalHook`; Agent uses `DeferredApprovalHook` and routes `approval_decision` into `IotaEngine.resolveApproval()`.
- Backend credentials, models, and endpoints are resolved through layered config plus Redis distributed config overlays. Do not reintroduce backend-local env files as the main configuration path.
- ACP adapters expose `mcpResponseChannel: true`. Keep Agent/App backend capability views aligned when this changes.
- Keep Engine output aligned with Agent App Read Model expectations: snapshots and deltas are shaped above Engine, but Engine remains the source for visibility, trace, replay, and runtime events.

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

For Hermes, inspect `hermes config show`; reject dead `model.provider: custom` / local `model.base_url` configurations unless the local gateway is actually running. For OpenCode, verify provider login/config and run a real traced request.

## Commit Identity & Co-Authorship Rules

The tool identity that makes the commit must match the `Co-authored-by` trailer.

| Committing Tool | Author | Co-authored-by |
|---|---|---|
| Claude | `Claude <noreply@anthropic.com>` | `Co-authored-By: Claude <noreply@anthropic.com>` |
| Codex | `Codex <noreply@openai.com>` | `Co-authored-By: Codex <noreply@openai.com>` |
| Gemini | `Gemini <noreply@google.com>` | `Co-authored-By: Gemini <noreply@google.com>` |
