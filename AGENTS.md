# AGENTS.md

## Project Overview

iota is a pluggable AI coding assistant runtime. The root repository currently contains five first-party areas:

- `iota-engine`: core runtime, backend adapters, approval, memory, visibility, workspace, MCP, and skill execution
- `iota-cli`: command-line and interactive interface for direct Engine execution
- `iota-agent`: Fastify HTTP / WebSocket service around Engine
- `iota-app`: React / Vite frontend that consumes Agent snapshots and deltas
- `iota-skill`: structured skills, currently including the `pet-generator` iota-fun sample

`mem0/` may appear as an untracked local reference checkout. Treat it as external reference material unless a task explicitly targets it.

## Workspace Structure

```text
iota/
├── docs/                      # Shared design docs, guides, performance reports
│   ├── iota-guides/           # Consolidated architecture & usage documentation
│   └── performance/           # Latency benchmarks, comparison reports
├── deployment/                # Redis / Docker / storage deployment files and helper scripts
├── iota-engine/               # @iota/engine runtime (v0.1.0)
├── iota-cli/                  # @iota/cli command interface (v0.1.0)
├── iota-agent/                # @iota/agent HTTP/WebSocket service (v0.1.0)
├── iota-app/                  # Vite + React 19 frontend (Zustand + TanStack Query)
└── iota-skill/                # Structured skills and iota-fun examples
```

## Source Of Truth

Use current code first, then the current docs. The primary docs are now consolidated under `docs/iota-guides/`:

- `docs/iota-guides/README.md`
- `docs/iota-guides/01-architecture.md`
- `docs/iota-guides/02-engine.md`
- `docs/iota-guides/03-backend.md`
- `docs/iota-guides/04-cli-tui.md`
- `docs/iota-guides/05-agent.md`
- `docs/iota-guides/06-app.md`
- `docs/iota-guides/07-visibility-trace.md`
- `docs/iota-guides/08-memory.md`
- `docs/iota-guides/09-skill-fun.md`
- `docs/iota-guides/10-deployment.md`

Legacy `docs/guides/`, `docs/diagrams/`, and `docs/plan/` content has been consolidated. Do not recreate parallel guide trees unless the task explicitly asks for archival material.

If code and docs diverge, prefer the current code path and update docs to match actual behavior.

## Backend Adapters

Backend protocol logic lives in `iota-engine/src/backend/`; do not add vendor internal SDK dependencies or protocol-conversion executables. All backend protocol events must normalize to `RuntimeEvent`.

| Backend | ACP Adapter | Process Model | Notes |
|---|---|---|---|
| Claude Code | `claude-acp.ts` | ACP long-running | adapter-backed ACP |
| Codex | `codex-acp.ts` | ACP long-running | adapter-backed ACP |
| Gemini CLI | `gemini-acp.ts` | ACP long-running | native `--acp` mode |
| Hermes Agent | `hermes.ts` | ACP long-running | validate `hermes config show` |
| OpenCode | `opencode-acp.ts` | ACP long-running | uses OpenCode provider config |

ACP backends expose `mcpResponseChannel: true`; all first-party backend integrations are ACP-only.

Additional backend support files in `src/backend/`:

- `acp-backend-adapter.ts` / `acp-event-mapper.ts`: shared ACP JSON-RPC 2.0 protocol adapter and event normalization
- `acp-only.test.ts`: tests for ACP-only backend selection and native protocol rejection
- `pool.ts`: backend pool with circuit breaker and health tracking
- `subprocess.ts`: shared subprocess lifecycle management
- `prompt-composer.ts`: prompt assembly for prompt-only backends
- `text-utils.ts`: output text normalization utilities
- `error-hints.ts`: user-friendly error message mapping
- `mcp-config.ts`: MCP server configuration generation per backend
- `hermes-config.ts`: Hermes-specific config validation

## Current Architecture Constraints

- App-facing UI must consume Agent snapshot / delta models, not raw backend protocol payloads.
- Visibility, audit, snapshot, replay, logs, and docs must redact secrets.
- Backend credentials, models, and endpoints are resolved through layered config plus Redis distributed config overlays. Do not rely on deleted backend-local env files such as `iota-engine/claude.env` or `codex.env`.
- Config loading supports defaults, user config, project `iota.config.yaml`, selected environment overrides, and Redis scopes (`global`, `backend`, `session`, `user`).
- WebSocket `/api/v1/stream` inbound: `execute`, `interrupt`, `subscribe_app_session`, `subscribe_visibility`, `approval_decision`. Outbound: `event`, `error`, `complete`, `app_delta`, `app_snapshot`, `subscribed`, `subscribed_visibility`, `visibility_snapshot`, `pubsub_event`, `approval_result`.
- App approval UI sends `approval_decision`; Agent routes it into `engine.resolveApproval()`. Engine deferred approval requests are pushed to subscribed App sessions as `app_delta` approval cards. Keep this loop covered by tests when changing approval behavior.
- Approval is enforced in Engine through approval policy and approval hooks. CLI uses `CliApprovalHook`; Agent constructs Engine with `DeferredApprovalHook`.
- Engine loads structured skills from configured `skill.roots`, falling back to the repository-adjacent `iota-skill` directory. Executable skills run through `SkillRunner -> McpRouter -> configured MCP server`.
- The `iota-fun` MCP server is implemented in Engine (`src/fun-engine.ts`, `src/fun-intent.ts`) and uses source files under `iota-skill/pet-generator/iota-fun/`; compiled artifacts are cached under `$HOME/.iota/iota-fun`. Supports 7 languages: python, typescript, go, rust, zig, java, cpp.
- Memory system components: `DialogueMemory` (last 50 turns), `WorkingMemory` (active files), `MemoryExtractor`, `MemoryInjector`, `MemoryStorage` (Redis + optional Milvus vectors). Embedding chain: `HashEmbeddingProvider` → `OllamaEmbeddingProvider` → `OpenAIEmbeddingProvider`.
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
- `iota-agent` tests currently use `vitest run --passWithNoTests` and a Vitest alias for `@iota/engine`.
- `iota-skill` has no package-level build; validate through Engine skill/iota-fun tests and the runtime guide relevant to the changed language.
- Docker storage defaults to a minimal Redis-only profile. Use `deployment/scripts/start-storage.sh --full` for Redis + MinIO + Milvus, and add `--ha` for Redis Sentinel.

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
- WebSocket inbound/outbound message schema consistency, including `approval_result`, `visibility_snapshot.visibility`, and `pubsub_event.message`
- approval request/decision ordering across Engine, Agent, App, including duplicate `waiting_approval` regressions
- visibility / trace / replay coverage versus documentation claims
- session / execution ownership and arrow direction in architecture diagrams
- Redis key naming and persistence path descriptions
- skill execution path consistency (`SKILL.md` frontmatter, `skill.roots`, MCP server config, iota-fun cache)
- backend credential handling and redaction in examples, logs, visibility, snapshots, and subprocess env cleanup lists

## Testing

- Use Vitest with colocated `*.test.ts` files.
- Test backend adapters, protocol parsers, memory system, visibility records, approval flow, App read model shaping, skill matching/running, MCP config generation, workspace guards, and Redis config overlays.
- Run `bun run typecheck && bun run test` before submitting code changes where the package provides those scripts.

## Security

- Never commit API keys, tokens, passwords, or secrets.
- Use Redis distributed config or local user/project config for backend credentials; keep examples redacted.
- Do not commit generated caches or compiled iota-fun artifacts.
- Keep examples redacted in docs, tests, logs, visibility, replay, snapshots, and App fixtures.
