# GEMINI.md

## Gemini CLI ACP Backend Adapter

This document describes the Gemini CLI ACP adapter in `src/backend/gemini-acp.ts`.

## Configuration

| Property | Value |
|---|---|
| Backend name | `gemini` |
| Default executable | `gemini` |
| Process mode | long-running subprocess |
| Protocol | ACP JSON-RPC 2.0 |
| stdin mode | message |
| command args | `--acp` |

## Capabilities

```typescript
{
  sandbox: false,
  mcp: true,
  mcpResponseChannel: true,
  acp: true,
  acpMode: "native",
  streaming: true,
  thinking: true,
  multimodal: true,
  maxContextTokens: 1_000_000,
  promptOnlyInput: true,
}
```

## Event Mapping

Gemini ACP messages are normalized by `acp-event-mapper.ts`.

| ACP Message | RuntimeEvent | Notes |
|---|---|---|
| `session/update` content | `output` / `thinking` / `tool_call` / `tool_result` / `file_delta` | Depends on content part |
| `session/request_permission` | `extension` | `approval_request` |
| `session/complete` | `state` | terminal status |
| JSON-RPC error | `error` | execution error |

## Prompt Composition

Uses `composeEffectivePrompt(request)` through `AcpBackendAdapter` so Gemini receives the same effective prompt as other prompt-only backends.

## Current Workspace Constraints

- Gemini backend credentials and model selection come from Redis distributed config, not package-local env files.
- Backend verification must use a real traced execution, not only executable discovery.
- Any architecture or sequence document that mentions Gemini flow must label exact arrow source and target boxes.
