import type { BackendName, Message, RuntimeContext } from "../event/types.js";

/**
 * Section 11: Backend switching and context degradation
 *
 * Three-level degradation strategy:
 * 1. Direct inject: full conversation + working memory + workspace summary fits target window
 * 2. Truncation + summary: keep recent messages, compress old ones
 * 3. Format degradation: plain text handoff prompt
 */

/** Maximum context tokens per backend (approximate) */
const BACKEND_CONTEXT_LIMITS: Record<BackendName, number> = {
  "claude-code": 200_000,
  codex: 200_000,
  gemini: 1_000_000,
  hermes: 128_000,
};

/** Rough token estimation: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface DegradationResult {
  context: RuntimeContext;
  level: "direct" | "truncated" | "plain_text";
  inputTokenEstimate: number;
  droppedMessageCount: number;
}

export function buildSwitchContext(
  previousBackend: BackendName,
  nextBackend: BackendName,
  context: RuntimeContext,
): DegradationResult {
  const targetLimit = BACKEND_CONTEXT_LIMITS[nextBackend] ?? 128_000;
  const budgetTokens = Math.floor(targetLimit * 0.8); // Reserve 20% for response

  // Estimate current context size
  const conversationText = context.conversation
    .map((m) => m.content)
    .join("\n");
  const memoryText = context.injectedMemory.map((m) => m.content).join("\n");
  const summaryText = context.workspaceSummary ?? "";
  const totalTokens = estimateTokens(
    conversationText + memoryText + summaryText,
  );

  const switchPrefix = `[Context handoff from ${previousBackend} to ${nextBackend}]`;

  // Level 1: Direct inject — everything fits
  if (totalTokens <= budgetTokens) {
    return {
      context: {
        ...context,
        workspaceSummary: `${switchPrefix}${context.workspaceSummary ? ` ${context.workspaceSummary}` : ""}`,
      },
      level: "direct",
      inputTokenEstimate: totalTokens,
      droppedMessageCount: 0,
    };
  }

  // Level 2: Truncation + summary — keep recent messages, summarize old
  const recentCount = Math.min(10, context.conversation.length);
  const recentMessages = context.conversation.slice(-recentCount);
  const oldMessages = context.conversation.slice(0, -recentCount);
  const oldSummary =
    oldMessages.length > 0
      ? `[Summary of ${oldMessages.length} earlier messages: ${oldMessages.map((m) => m.content.slice(0, 100)).join(" | ")}]`
      : "";

  const truncatedConversation: Message[] = [
    ...(oldSummary ? [{ role: "system" as const, content: oldSummary }] : []),
    ...recentMessages,
  ];

  const truncatedText =
    truncatedConversation.map((m) => m.content).join("\n") + memoryText;
  const truncatedTokens = estimateTokens(truncatedText);

  if (truncatedTokens <= budgetTokens) {
    return {
      context: {
        ...context,
        conversation: truncatedConversation,
        workspaceSummary: `${switchPrefix}${context.workspaceSummary ? ` ${context.workspaceSummary}` : ""}`,
      },
      level: "truncated",
      inputTokenEstimate: truncatedTokens,
      droppedMessageCount: oldMessages.length,
    };
  }

  // Level 3: Plain text handoff — serialize everything as a single prompt
  const lastMessages = context.conversation.slice(-3);
  const handoffPrompt = [
    switchPrefix,
    context.workspaceSummary ? `Workspace: ${context.workspaceSummary}` : "",
    context.activeFiles?.length
      ? `Active files: ${context.activeFiles.join(", ")}`
      : "",
    "Recent conversation:",
    ...lastMessages.map((m) => `[${m.role}]: ${m.content.slice(0, 500)}`),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    context: {
      conversation: [{ role: "system", content: handoffPrompt }],
      injectedMemory: [],
      workspaceSummary: switchPrefix,
      activeFiles: context.activeFiles,
    },
    level: "plain_text",
    inputTokenEstimate: estimateTokens(handoffPrompt),
    droppedMessageCount: context.conversation.length - lastMessages.length,
  };
}
