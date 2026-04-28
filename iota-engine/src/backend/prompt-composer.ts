import type { RuntimeRequest } from "../event/types.js";
import type { RuntimeBackend } from "./interface.js";

/**
 * Compose an effective prompt that includes injected memory for per-execution
 * backends that only receive stdin text (not structured context).
 *
 * Per-execution CLIs manage their own system prompt and conversation history.
 * Iota injects memory by prepending it as structured context before the user prompt.
 * Skill definitions are prepended as a system prompt section so the backend LLM
 * can decide whether to trigger them.
 */
export function composeEffectivePrompt(
  request: RuntimeRequest,
  backend?: RuntimeBackend,
): string {
  const parts: string[] = [];

  // Inject skill definitions so the backend LLM can match and execute them
  if (request.systemPrompt) {
    const skillMatch = request.systemPrompt.match(
      /<iota_skills>([\s\S]*?)<\/iota_skills>/,
    );
    const skillNames = skillMatch
      ? [...skillMatch[1].matchAll(/^## (.+)$/gm)].map((m) => m[1]).join(", ")
      : null;
    console.debug(
      `[iota-skill] injecting system prompt into prompt (execution=${request.executionId})${skillNames ? ` skills=[${skillNames}]` : ""}`,
    );
    parts.push(request.systemPrompt);
    parts.push("");
  }

  // Always inject model information if available - let the LLM decide when to use it
  if (backend?.getModel) {
    const model = backend.getModel();
    if (model) {
      parts.push("# Model Information");
      parts.push(`You are currently using the model: ${model}`);
      parts.push("");
    }
  }

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

  if (request.context?.workspaceSummary) {
    parts.push("<workspace_summary>");
    parts.push(request.context.workspaceSummary);
    parts.push("</workspace_summary>");
    parts.push("");
  }

  parts.push(request.prompt);
  return parts.join("\n");
}
