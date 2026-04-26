# GEMINI.md

This file provides root-level guidance for working in the Iota workspace with Gemini-oriented workflows.

## Workspace Overview

The root directory is the single Git repository for Iota. There is no root package manifest.

- `iota-engine/`: `@iota/engine`, core runtime and backend adapters
- `iota-cli/`: `@iota/cli`, command-line interface
- `iota-agent/`: `@iota/agent`, HTTP / WebSocket service
- `iota-app/`: Vite + React frontend
- `docs/`: guides and requirement documents

## Architecture Rules

- Backend protocol adaptation belongs inside `iota-engine/src/backend/`
- Do not add protocol-conversion executables
- Do not depend on vendor internal APIs or SDK internals
- App-facing UI should consume Agent App Read Model snapshots / deltas, not raw backend protocols
- Redact sensitive values in visibility, audit, snapshot, replay, and event examples

## Current Implementation Constraints

- Backend credentials and model settings are stored in Redis distributed config
- Gemini backend verification requires a real traced execution, not just executable detection
- Agent WebSocket currently supports execution, session subscription, and visibility subscription; do not describe an implemented App approval-decision protocol unless code exists
- Architecture and sequence diagrams must state exact arrow source and target boxes for every line

## Development Commands

Run commands inside the changed package:

- `cd iota-engine && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-cli && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-agent && bun install && bun run build && bun run typecheck && bun run test`
- `cd iota-app && bun install && bun run build && bun run typecheck`

Also run `bun run lint` and `bun run format` in each touched package where available.

## Backend Verification Requirement

- Verification cannot stop at executable discovery or `iota status`
- After switching backend, run one real traced request:

```bash
cd iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

- For Hermes, inspect `hermes config show`; reject dead local `model.provider: custom` / `model.base_url` configurations unless that gateway is running

## Gemini Adapter Reference

For Gemini CLI adapter internals, see:

- `iota-engine/GEMINI.md`
- `iota-engine/src/backend/gemini.ts`
- `iota-engine/src/backend/subprocess.ts`
- `iota-engine/src/backend/prompt-composer.ts`

## Documentation Index

- `docs/guides/README.md`
- `docs/guides/00-architecture-overview.md`
- `docs/guides/03-agent-guide.md`
- `docs/guides/05-engine-guide.md`
- `docs/requirement/4.iota_engine_design_0425.md`
- `docs/requirement/5.iota_app_design.md`

## Commit Identity

When committing as Gemini, use matching author and trailer identity:

- Author: `Gemini <noreply@google.com>`
- Trailer: `Co-authored-By: Gemini <noreply@google.com>`
