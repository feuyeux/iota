# GEMINI.md

This file provides root-level guidance for working in the Iota workspace with Gemini-oriented workflows.

## Workspace Overview

The root directory is the single Git repository for Iota. There is no root package manifest.

- `iota-engine/`: `@iota/engine`, core runtime, backend adapters, approval, memory, visibility, MCP, workspace, and skill execution
- `iota-cli/`: `@iota/cli`, command-line and interactive interface
- `iota-agent/`: `@iota/agent`, Fastify HTTP / WebSocket service around Engine
- `iota-app/`: Vite + React frontend that consumes Agent snapshots and deltas
- `iota-skill/`: structured skills, currently including `pet-generator` and iota-fun examples
- `docs/`: guides, diagrams, and requirement documents

`mem0/` may appear as an untracked local reference checkout. Treat it as external reference material unless a task explicitly targets it.

## Architecture Rules

- Backend protocol adaptation belongs inside `iota-engine/src/backend/`.
- Do not add protocol-conversion executables.
- Do not depend on vendor internal APIs or SDK internals.
- All native backend events must normalize to `RuntimeEvent`.
- App-facing UI should consume Agent App Read Model snapshots / deltas, not raw backend protocols.
- Redact sensitive values in visibility, audit, snapshot, replay, docs, logs, and event examples.
- Shared docs belong in root `docs/`.

## Current Implementation Constraints

- Backend credentials, model settings, and endpoints are resolved through layered config plus Redis distributed config overlays.
- Config loading supports defaults, user `~/.iota/config.yaml`, project `iota.config.yaml`, selected environment overrides, and Redis scopes (`global`, `backend`, `session`, `user`).
- Backend verification for Claude Code, Codex, Gemini CLI, Hermes, and OpenCode requires a real traced execution, not just executable detection.
- Agent WebSocket `/api/v1/stream` currently accepts `execute`, `interrupt`, `subscribe_app_session`, `subscribe_visibility`, and `approval_decision` inbound messages.
- App approval UI sends `approval_decision`; Agent routes it into `engine.resolveApproval()`. Engine deferred approval requests are pushed to subscribed App sessions as `app_delta` approval cards.
- Approval is enforced in Engine through policy and approval hooks. CLI uses `CliApprovalHook`; Agent constructs Engine with `DeferredApprovalHook`.
- Engine loads structured skills from configured `skill.roots`, falling back to repository-adjacent `iota-skill` when empty.
- Executable skills run through `SkillRunner -> McpRouter -> configured MCP server`; do not bypass MCP to call iota-fun internals directly.
- The `iota-fun` MCP server is implemented in Engine; function sources live under `iota-skill/pet-generator/iota-fun/`; compiled artifacts are cached under `$HOME/.iota/iota-fun`.
- Architecture and sequence diagrams must state exact arrow source and target boxes for every line.
- Docker storage defaults to Redis only. Use `deployment/scripts/start-storage.sh --full` for Redis + MinIO + Milvus and `--ha` for Redis Sentinel.

## Development Commands

Run commands inside the changed package:

- `cd iota-engine && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-cli && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-agent && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-app && bun install && bun run build`

Also run `bun run lint` and `bun run format` in each touched package where available.

Notes:

- `iota-app` has no standalone `typecheck` script; `bun run build` runs `tsc -b && vite build`.
- `iota-agent` tests currently use `vitest run --passWithNoTests`.
- `iota-skill` has no package-level build; validate through Engine skill/iota-fun tests and the relevant runtime guide.

## Backend Verification Requirement

- Verification cannot stop at executable discovery or `iota status`.
- After switching backend, run one real traced request:

```bash
cd iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

- Use `deployment/scripts/ensure-backends.sh --check-only` for shared backend discovery.
- For Hermes, inspect `hermes config show`; reject dead local `model.provider: custom` / `model.base_url` configurations unless that gateway is running.

## Gemini Adapter Reference

For Gemini CLI adapter internals, see:

- `iota-engine/GEMINI.md`
- `iota-engine/src/backend/gemini.ts`
- `iota-engine/src/backend/subprocess.ts`
- `iota-engine/src/backend/prompt-composer.ts`

## Documentation Index

Primary docs are consolidated under `docs/iota-guides/`:

- `docs/iota-guides/README.md`
- `docs/iota-guides/01-architecture.md`
- `docs/iota-guides/02-engine.md`
- `docs/iota-guides/03-backend-adapters.md`
- `docs/iota-guides/04-cli-tui.md`
- `docs/iota-guides/05-agent.md`
- `docs/iota-guides/06-app.md`
- `docs/iota-guides/07-visibility-trace.md`
- `docs/iota-guides/08-memory.md`
- `docs/iota-guides/09-skill-fun.md`
- `docs/iota-guides/10-deployment.md`

Legacy `docs/guides/`, `docs/diagrams/`, and `docs/plan/` content has been consolidated; do not recreate parallel guide trees.

## Safety

Do not commit secrets, populated env files, `node_modules/`, `dist/`, `*.tsbuildinfo`, generated caches, or compiled iota-fun artifacts.

## Commit Identity

When committing as Gemini, use matching author and trailer identity:

- Author: `Gemini <noreply@google.com>`
- Trailer: `Co-authored-By: Gemini <noreply@google.com>`
