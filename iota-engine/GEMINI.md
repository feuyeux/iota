# GEMINI.md

## Gemini CLI Backend Adapter

This document describes the Gemini CLI backend adapter in `src/backend/gemini.ts`.

## Configuration

| Property | Value |
|---|---|
| Backend name | `gemini` |
| Default executable | `gemini` |
| Process mode | per-execution subprocess |
| Protocol | NDJSON stream-json |
| stdin mode | none |

## Command Line

```typescript
buildArgs: (request) => [
  "--output-format",
  "stream-json",
  "--skip-trust",
  "--prompt",
  composeEffectivePrompt(request),
]
```

## Capabilities

```typescript
{
  sandbox: false,
  mcp: false,
  mcpResponseChannel: false,
  acp: false,
  streaming: true,
  thinking: true,
  multimodal: true,
  maxContextTokens: 1_000_000,
  promptOnlyInput: true,
}
```

## Event Mapping

| Native Type | RuntimeEvent | Notes |
|---|---|---|
| `init` | `extension` | `gemini_init` |
| `thought` / `thinking` | `extension` | thinking payload |
| `message` / `text` / `content` | `output` | assistant text |
| `tool_use` / `function_call` | `tool_call` | tool invocation |
| `tool_result` / `function_response` | `tool_result` | tool result |
| `result` / `done` | `output` | final output with usage metadata when available |
| `error` | `error` | execution error |
| unknown native event | `extension` | preserved as native event payload, not dropped |

## Native Usage

Gemini reports usage via `usageMetadata` in result events:

```typescript
{
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}
```

When native usage is absent, Engine visibility may fall back to estimated token accounting.

## Prompt Composition

Uses `composeEffectivePrompt(request)` as the `--prompt` value so Gemini CLI runs in non-interactive headless mode. Without `--prompt`, current Gemini CLI versions may enter interactive mode and block.

## Current Workspace Constraints

- Gemini backend credentials and model selection come from Redis distributed config, not package-local env files
- Backend verification must use a real traced execution, not only executable discovery
- Any architecture or sequence document that mentions Gemini flow must label exact arrow source and target boxes

## Implementation Notes

- Each `stream()` call spawns a new `gemini` subprocess
- Thinking events are preserved as `extension` events
- Adapters emit placeholder sequence values; final event sequencing is assigned by EventStore
- Native protocol fragments should remain visible enough for traceability without leaking secrets

## Related

- `src/backend/subprocess.ts`
- `src/backend/prompt-composer.ts`
- `src/protocol/ndjson.ts`
