import type { RuntimeRequest } from "../event/types.js";

/**
 * Compose an effective prompt that includes injected memory for per-execution
 * backends that only receive stdin text (not structured context).
 *
 * Per-execution CLIs manage their own system prompt and conversation history.
 * Iota injects memory by prepending it as structured context before the user prompt.
 */
export function composeEffectivePrompt(request: RuntimeRequest): string {
  const parts: string[] = [];

  // Inject memory blocks as context
  const memories = request.context?.injectedMemory;
  if (memories && memories.length > 0) {
    parts.push("<context>");
    for (const mem of memories) {
      const label = mem.type ? `[${mem.type}]` : "[memory]";
      parts.push(`${label} ${mem.content}`);
    }
    parts.push("</context>");
    parts.push("");
  }

  parts.push(request.prompt);
  return parts.join("\n");
}
