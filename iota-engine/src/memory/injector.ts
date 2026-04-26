import crypto from "node:crypto";
import type {
  BackendName,
  MemoryBlock,
  RuntimeContext,
} from "../event/types.js";
import { estimateTokens as visEstimateTokens } from "../visibility/token-estimator.js";
import {
  contentHash,
  makePreview,
  redactText,
} from "../visibility/redaction.js";
import type {
  MemoryCandidateVisibility,
  MemoryExcludedVisibility,
  MemorySelectedVisibility,
  VisibilityPolicy,
} from "../visibility/types.js";
import { DEFAULT_VISIBILITY_POLICY } from "../visibility/types.js";

export interface InjectOptions {
  /** Maximum token budget for injected memory (default 4096) */
  tokenBudget?: number;
}

export interface InjectWithVisibilityOptions extends InjectOptions {
  backend?: BackendName;
  visibilityPolicy?: VisibilityPolicy;
  /** Minimum relevance score threshold. Candidates below this are excluded with reason 'low_score'. Default 0 (no filtering). */
  minScore?: number;
}

export interface InjectWithVisibilityResult {
  context: RuntimeContext;
  candidates: MemoryCandidateVisibility[];
  selected: MemorySelectedVisibility[];
  excluded: MemoryExcludedVisibility[];
}

const DEFAULT_TOKEN_BUDGET = 4096;
const CHARS_PER_TOKEN = 4;

/**
 * Inject memory blocks into the runtime context, respecting a token budget.
 * Memories are deduplicated, sorted by relevance then recency, and trimmed to fit.
 */
export function injectMemory(
  context: RuntimeContext,
  memory: MemoryBlock[],
  options: InjectOptions = {},
): RuntimeContext {
  const budget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  // Deduplicate by id
  const seen = new Set<string>();
  // Include already-injected memories in dedup set
  for (const m of context.injectedMemory) {
    seen.add(m.id);
  }
  const unique: MemoryBlock[] = [];
  for (const m of memory) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      unique.push(m);
    }
  }

  // Sort: by relevance score desc (if available), then by array order (proxy for recency)
  const sorted = unique
    .map((m, index) => ({ block: m, index }))
    .sort((a, b) => {
      const scoreA =
        a.block.score ??
        (typeof a.block.metadata?.relevanceScore === "number"
          ? a.block.metadata.relevanceScore
          : 0);
      const scoreB =
        b.block.score ??
        (typeof b.block.metadata?.relevanceScore === "number"
          ? b.block.metadata.relevanceScore
          : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      // More recent (higher index) first
      return b.index - a.index;
    });

  // Compute existing token usage
  let usedTokens = 0;
  for (const m of context.injectedMemory) {
    usedTokens += estimateTokens(m.content);
  }

  // Fill within budget
  const selected: MemoryBlock[] = [];
  for (const { block } of sorted) {
    const tokens = estimateTokens(block.content);
    if (usedTokens + tokens > budget) {
      // Try to fit a trimmed version
      const remaining = budget - usedTokens;
      if (remaining > 50) {
        const trimmedContent = block.content.slice(
          0,
          remaining * CHARS_PER_TOKEN,
        );
        selected.push({ ...block, content: trimmedContent });
        usedTokens += remaining;
      }
      break;
    }
    selected.push(block);
    usedTokens += tokens;
  }

  return {
    ...context,
    injectedMemory: [...context.injectedMemory, ...selected],
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Inject memory blocks with full visibility reporting.
 * Returns the updated context plus visibility records for candidates, selected, and excluded.
 */
export function injectMemoryWithVisibility(
  context: RuntimeContext,
  memory: MemoryBlock[],
  options: InjectWithVisibilityOptions = {},
): InjectWithVisibilityResult {
  const budget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const backend = options.backend ?? "claude-code";
  const policy = options.visibilityPolicy ?? DEFAULT_VISIBILITY_POLICY;
  const previewChars = policy.previewChars;
  const showPreview = policy.memory !== "off" && policy.memory !== "summary";
  const minScore = options.minScore ?? 0;

  // Deduplicate by id
  const seen = new Set<string>();
  const duplicates: MemoryBlock[] = [];
  for (const m of context.injectedMemory) {
    seen.add(m.id);
  }
  const unique: MemoryBlock[] = [];
  for (const m of memory) {
    if (seen.has(m.id)) {
      duplicates.push(m);
    } else {
      seen.add(m.id);
      unique.push(m);
    }
  }

  // Sort by relevance then recency
  const sorted = unique
    .map((m, index) => ({ block: m, index }))
    .sort((a, b) => {
      const scoreA =
        a.block.score ??
        (typeof a.block.metadata?.relevanceScore === "number"
          ? a.block.metadata.relevanceScore
          : 0);
      const scoreB =
        b.block.score ??
        (typeof b.block.metadata?.relevanceScore === "number"
          ? b.block.metadata.relevanceScore
          : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.index - a.index;
    });

  // Build candidates
  const candidates: MemoryCandidateVisibility[] = sorted.map(({ block }) => ({
    memoryId: block.id,
    type: block.type,
    source:
      (block.metadata?.source as MemoryCandidateVisibility["source"]) ??
      "store",
    score:
      block.score ?? (block.metadata?.relevanceScore as number | undefined),
    contentHash: contentHash(block.content),
    preview: showPreview
      ? policy.redactSecrets
        ? redactText(makePreview(block.content, previewChars)).text
        : makePreview(block.content, previewChars)
      : undefined,
    charCount: block.content.length,
    estimatedTokens: visEstimateTokens(block.content, backend),
  }));

  // Compute existing token usage
  let usedTokens = 0;
  for (const m of context.injectedMemory) {
    usedTokens += estimateTokens(m.content);
  }

  // Fill within budget
  const selectedBlocks: MemoryBlock[] = [];
  const selected: MemorySelectedVisibility[] = [];
  const excluded: MemoryExcludedVisibility[] = [];

  // Add duplicates as excluded
  for (const dup of duplicates) {
    excluded.push({
      memoryId: dup.id,
      type: dup.type,
      source:
        (dup.metadata?.source as MemoryCandidateVisibility["source"]) ??
        "store",
      score: dup.score,
      contentHash: contentHash(dup.content),
      preview: showPreview
        ? policy.redactSecrets
          ? redactText(makePreview(dup.content, previewChars)).text
          : makePreview(dup.content, previewChars)
        : undefined,
      charCount: dup.content.length,
      estimatedTokens: visEstimateTokens(dup.content, backend),
      reason: "duplicate",
    });
  }

  let budgetExceeded = false;
  for (let i = 0; i < sorted.length; i++) {
    const { block } = sorted[i];
    const candidate = candidates[i];
    const tokens = estimateTokens(block.content);

    // Filter by minimum score threshold
    const score =
      block.score ??
      (typeof block.metadata?.relevanceScore === "number"
        ? block.metadata.relevanceScore
        : 0);
    if (minScore > 0 && score < minScore) {
      excluded.push({ ...candidate, reason: "low_score" });
      continue;
    }

    if (budgetExceeded) {
      excluded.push({ ...candidate, reason: "token_budget_exceeded" });
      continue;
    }

    if (usedTokens + tokens > budget) {
      // Try trimmed version
      const remaining = budget - usedTokens;
      if (remaining > 50) {
        const trimmedContent = block.content.slice(
          0,
          remaining * CHARS_PER_TOKEN,
        );
        const segId = crypto.randomUUID();
        selectedBlocks.push({ ...block, content: trimmedContent });
        selected.push({
          ...candidate,
          injectedSegmentId: segId,
          trimmed: true,
          trimmedFromTokens: tokens,
          trimmedToTokens: remaining,
          visibleToBackend: true,
        });
        usedTokens += remaining;
      } else {
        excluded.push({ ...candidate, reason: "token_budget_exceeded" });
      }
      budgetExceeded = true;
      continue;
    }

    const segId = crypto.randomUUID();
    selectedBlocks.push(block);
    selected.push({
      ...candidate,
      injectedSegmentId: segId,
      trimmed: false,
      visibleToBackend: true,
    });
    usedTokens += tokens;
  }

  return {
    context: {
      ...context,
      injectedMemory: [...context.injectedMemory, ...selectedBlocks],
    },
    candidates,
    selected,
    excluded,
  };
}
