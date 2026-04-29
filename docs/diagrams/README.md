# Iota Diagrams

These diagrams are maintained as Markdown files with Mermaid source. They reflect the current code path as of 2026-04-29 and should be updated when Engine, Agent, App, or backend adapter behavior changes.

## Format Rules

- Use one Markdown file per diagram.
- Put the Mermaid source in a fenced `mermaid` block.
- Prefer actual package, route, class, and Redis key names from the code.
- Do not describe raw backend payloads as App-facing data. App diagrams must stop at snapshot/delta models.
- Do not describe a first-class App approval decision WebSocket API until `iota-agent/src/routes/websocket.ts` implements it.
- Keep secrets redacted in labels and examples.

## Index

| Diagram | Purpose |
|---|---|
| [01-layered-architecture.md](./01-layered-architecture.md) | Detailed layered architecture across App, Agent, Engine, adapters, and storage |
| [02-system-topology.md](./02-system-topology.md) | Runtime topology and process boundaries |
| [03-execution-read-model.md](./03-execution-read-model.md) | Execution lifecycle and App snapshot/delta read model |
| [04-engine-internals.md](./04-engine-internals.md) | Engine internal components and responsibilities |
| [05-backend-adapters.md](./05-backend-adapters.md) | Backend adapter process/protocol normalization |
| [06-agent-app-websocket.md](./06-agent-app-websocket.md) | Agent REST/WebSocket and App store integration |
| [07-storage-visibility-memory.md](./07-storage-visibility-memory.md) | Redis, visibility, memory, snapshots, and audit storage |
