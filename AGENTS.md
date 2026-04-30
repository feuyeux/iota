# AGENTS.md

## Project Overview

Iota is a pluggable AI coding assistant runtime. The root repository currently contains five first-party areas:

- `iota-engine`: core runtime, backend adapters, approval, memory, visibility, workspace, MCP, and skill execution
- `iota-cli`: command-line and interactive interface for direct Engine execution
- `iota-agent`: Fastify HTTP / WebSocket service around Engine
- `iota-app`: React / Vite frontend that consumes Agent snapshots and deltas
- `iota-skill`: structured skills, currently including the `pet-generator` iota-fun sample

`mem0/` may appear as an untracked local reference checkout. Treat it as external reference material unless a task explicitly targets it.

## Workspace Structure

```text
iota/
├── docs/                      # Shared design docs, guides, diagrams, verification notes
├── deployment/                # Redis / Docker / storage deployment files and helper scripts
├── iota-engine/               # @iota/engine runtime
├── iota-cli/                  # @iota/cli command interface
├── iota-agent/                # @iota/agent HTTP/WebSocket service
├── iota-app/                  # Vite + React frontend
└── iota-skill/                # Structured skills and iota-fun examples
```

## Source Of Truth

Use current code first, then the current docs. The primary docs are:

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

If code and docs diverge, prefer the current code path and update docs to match actual behavior.

## Backend Adapters

Each backend adapter lives in `iota-engine/src/backend/`:

| Adapter | File | Process Model | Protocol |
|---|---|---|---|
| Claude Code | `claude-code.ts` | per-execution subprocess | stream-json NDJSON |
| Codex | `codex.ts` | per-execution subprocess | NDJSON |
| Gemini CLI | `gemini.ts` | per-execution subprocess | stream-json NDJSON |
| Hermes Agent | `hermes.ts` | long-running subprocess | ACP JSON-RPC 2.0 |
| OpenCode | `opencode-acp.ts` | long-running subprocess | ACP JSON-RPC 2.0 |

Backend protocol logic stays in `iota-engine/src/backend/`; do not add vendor internal SDK dependencies or protocol-conversion executables. All native backend events must normalize to `RuntimeEvent`.

## Current Architecture Constraints

- App-facing UI must consume Agent snapshot / delta models, not raw backend protocol payloads.
- Visibility, audit, snapshot, replay, logs, and docs must redact secrets.
- Backend credentials, models, and endpoints are resolved through layered config plus Redis distributed config overlays. Do not rely on deleted backend-local env files such as `iota-engine/claude.env` or `codex.env`.
- Config loading supports defaults, user config, project `iota.config.yaml`, selected environment overrides, and Redis scopes (`global`, `backend`, `session`, `user`).
- WebSocket `/api/v1/stream` currently accepts `execute`, `interrupt`, `subscribe_app_session`, and `subscribe_visibility` inbound messages. It also emits app snapshots/deltas, runtime events, completion/errors, subscription acknowledgements, and Redis pub/sub bridge messages.
- App approval UI can send `approval_decision`, but Agent WebSocket inbound schema does not currently route that message into `engine.resolveApproval()`. Do not document approval decision as a completed App-to-Agent-to-Engine WebSocket loop unless the code is wired and tested.
- Approval is enforced in Engine through approval policy and approval hooks. CLI uses `CliApprovalHook`; Agent constructs Engine with `DeferredApprovalHook`.
- Engine loads structured skills from configured `skill.roots`, falling back to the repository-adjacent `iota-skill` directory. Executable skills run through `SkillRunner -> McpRouter -> configured MCP server`.
- The `iota-fun` MCP server is implemented in Engine and uses source files under `iota-skill/pet-generator/iota-fun/`; compiled artifacts are cached under `$HOME/.iota/iota-fun`.
- Project toolchain convention: use `bun` for install, build, typecheck, test, lint, format, and dev execution; use `node` to run built JavaScript artifacts under `dist/`.

## Codex Tooling Notes

- `apply_patch` is a FREEFORM tool. Do not call it with JSON such as `{ "input": "..." }`.
- When using `apply_patch`, the tool message body must be the raw unified diff text, beginning with `*** Begin Patch` and ending with `*** End Patch`.
- If the environment or tool bridge keeps wrapping `apply_patch` as JSON and patching fails repeatedly, stop retrying immediately. Use a scoped fallback edit method, then verify with `git diff`.
## Development Workflow

1. Engine changes: `cd iota-engine && bun install && bun run build && bun run typecheck && bun run test`
2. CLI changes: `cd iota-cli && bun install && bun run build && bun run typecheck && bun run test`
3. Agent changes: `cd iota-agent && bun install && bun run build && bun run typecheck && bun run test`
4. App changes: `cd iota-app && bun install && bun run build`
5. In each touched package, also run `bun run lint` and `bun run format` when available.

Notes:

- `iota-app` has no standalone `typecheck` script; its build runs `tsc -b && vite build`.
- `iota-agent` tests currently use `vitest run --passWithNoTests`.
- `iota-skill` has no package-level build; validate through Engine skill/iota-fun tests and the runtime guide relevant to the changed language.

## Backend Verification Rule

Verification cannot stop at executable discovery or `iota status`.

After switching Claude Code, Codex, Gemini CLI, Hermes, or OpenCode, run one real traced request:

```bash
cd iota-cli
node dist/index.js run --backend <name> --trace "ping"
```

Use `deployment/scripts/ensure-backends.sh --check-only` for shared backend discovery. For Hermes specifically:

- inspect `hermes config show`
- reject dead `model.provider: custom`
- reject local `model.base_url` configs unless the local gateway is actually running

## Review Focus

When reviewing code or docs, pay extra attention to:

- approval flow consistency between Engine, Agent, App, and diagrams
- WebSocket inbound/outbound message schema consistency
- whether App approval decisions are actually wired beyond UI events
- visibility / trace / replay coverage versus documentation claims
- session / execution ownership and arrow direction in architecture diagrams
- Redis key naming and persistence path descriptions
- skill execution path consistency (`SKILL.md` frontmatter, `skill.roots`, MCP server config, iota-fun cache)
- backend credential handling and redaction in examples, logs, visibility, and snapshots

## Testing

- Use Vitest with colocated `*.test.ts` files.
- Test backend adapters, protocol parsers, memory system, visibility records, approval flow, App read model shaping, skill matching/running, MCP config generation, workspace guards, and Redis config overlays.
- Run `bun run typecheck && bun run test` before submitting code changes where the package provides those scripts.

## Security

- Never commit API keys, tokens, passwords, or secrets.
- Use Redis distributed config or local user/project config for backend credentials; keep examples redacted.
- Do not commit generated caches or compiled iota-fun artifacts.
- Keep examples redacted in docs, tests, logs, visibility, replay, snapshots, and App fixtures.
