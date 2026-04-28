import type { BackendName, MemoryBlock, RuntimeContext } from "../event/types.js";
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
import type {
  MemoryContext,
  MemoryQuery,
  MemoryScopeContext,
  StoredMemory,
} from "./types.js";
import type { MemoryStorage } from "./storage.js";

export interface InjectOptions {
  tokenBudget?: number;
}

export interface InjectWithVisibilityOptions extends InjectOptions {
  backend?: BackendName;
  visibilityPolicy?: VisibilityPolicy;
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

export class MemoryInjector {
  constructor(private readonly storage: MemoryStorage) {}

  async buildContext(scope: MemoryScopeContext): Promise<MemoryContext> {
    const projectScopeId = scope.projectId ?? scope.workingDirectory;
    const userScopeId = scope.userId ?? "default";

    const queries: MemoryQuery[] = [
      {
        type: "episodic",
        scope: "session",
        scopeId: scope.sessionId,
        limit: 20,
        minConfidence: 0.7,
      },
      {
        type: "procedural",
        scope: "project",
        scopeId: projectScopeId,
        limit: 10,
        minConfidence: 0.75,
      },
      {
        type: "factual",
        scope: "user",
        scopeId: userScopeId,
        limit: 50,
        minConfidence: 0.8,
      },
      {
        type: "strategic",
        scope: "project",
        scopeId: projectScopeId,
        limit: 30,
        minConfidence: 0.8,
      },
    ];

    const [episodic, procedural, factual, strategic] = await Promise.all(
      queries.map((query) => this.storage.retrieve(query)),
    );

    return { episodic, procedural, factual, strategic };
  }

  formatAsPrompt(memoryContext: MemoryContext): string {
    const sections: string[] = [];

    appendSection(sections, "Factual Memory", memoryContext.factual);
    appendSection(sections, "Strategic Memory", memoryContext.strategic);
    appendSection(sections, "Procedural Memory", memoryContext.procedural);

    if (memoryContext.episodic.length > 0) {
      sections.push("# Episodic Memory");
      for (const memory of memoryContext.episodic) {
        sections.push(
          `- [${new Date(memory.timestamp).toISOString()}] ${memory.content}`,
        );
      }
      sections.push("");
    }

    return sections.join("\n").trim();
  }
}

export function injectMemory(
  context: RuntimeContext,
  memoryContext: MemoryContext | MemoryBlock[],
  options: InjectOptions = {},
): RuntimeContext {
  return injectMemoryWithVisibility(context, memoryContext, options).context;
}

export function injectMemoryWithVisibility(
  context: RuntimeContext,
  memoryContext: MemoryContext | MemoryBlock[],
  options: InjectWithVisibilityOptions = {},
): InjectWithVisibilityResult {
  const budget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const backend = options.backend ?? "claude-code";
  const policy = options.visibilityPolicy ?? DEFAULT_VISIBILITY_POLICY;
  const showPreview = policy.memory !== "off" && policy.memory !== "summary";
  const previewChars = policy.previewChars;
  const normalizedMemoryContext = normalizeMemoryContext(memoryContext);
  const ordered = flattenMemoryContext(normalizedMemoryContext);
  const minScore = options.minScore ?? 0;
  const existingIds = new Set(context.injectedMemory.map((memory) => memory.id));

  const candidates: MemoryCandidateVisibility[] = ordered.map((memory) =>
    toCandidate(memory, backend, policy, showPreview, previewChars),
  );
  const selected: MemorySelectedVisibility[] = [];
  const excluded: MemoryExcludedVisibility[] = [];

  let usedTokens = 0;
  const selectedBlocks: RuntimeContext["injectedMemory"] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const memory = ordered[index];
    const candidate = candidates[index];
    const tokens = estimateTokens(memory.content);

    if (existingIds.has(memory.id)) {
      excluded.push({ ...candidate, reason: "duplicate" });
      continue;
    }

    if (minScore > 0 && (memory.confidence ?? 0) < minScore) {
      excluded.push({ ...candidate, reason: "low_score" });
      continue;
    }

    if (usedTokens + tokens > budget) {
      const remaining = budget - usedTokens;
      if (remaining > 50) {
        selectedBlocks.push({
          id: memory.id,
          type: memory.type,
          content: memory.content.slice(0, remaining * CHARS_PER_TOKEN),
          metadata: {
            ...memory.metadata,
            source: memory.scope,
            memoryScopeId: memory.scopeId,
            confidence: memory.confidence,
          },
        });
        selected.push({
          ...candidate,
          injectedSegmentId: memory.id,
          trimmed: true,
          trimmedFromTokens: tokens,
          trimmedToTokens: remaining,
          visibleToBackend: true,
        });
        usedTokens += remaining;
      } else {
        excluded.push({ ...candidate, reason: "token_budget_exceeded" });
      }

      for (let tail = index + 1; tail < ordered.length; tail += 1) {
        excluded.push({
          ...candidates[tail],
          reason: "token_budget_exceeded",
        });
      }
      break;
    }

    selectedBlocks.push({
      id: memory.id,
      type: memory.type,
      content: memory.content,
      metadata: {
        ...memory.metadata,
        source: memory.scope,
        memoryScopeId: memory.scopeId,
        confidence: memory.confidence,
      },
    });
    selected.push({
      ...candidate,
      injectedSegmentId: memory.id,
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

function appendSection(
  sections: string[],
  title: string,
  memories: StoredMemory[],
): void {
  if (memories.length === 0) {
    return;
  }

  sections.push(`# ${title}`);
  for (const memory of memories) {
    sections.push(`- ${memory.content}`);
  }
  sections.push("");
}

function flattenMemoryContext(memoryContext: MemoryContext): StoredMemory[] {
  return [
    ...memoryContext.factual,
    ...memoryContext.strategic,
    ...memoryContext.procedural,
    ...memoryContext.episodic,
  ];
}

function normalizeMemoryContext(
  memoryContext: MemoryContext | MemoryBlock[],
): MemoryContext {
  if (Array.isArray(memoryContext)) {
    const now = Date.now();
    return {
      episodic: memoryContext.map((memory, index) => ({
        id: memory.id,
        type: memory.type ?? "episodic",
        scope: "session",
        scopeId: "legacy-session",
        content: memory.content,
        source: {
          backend: "claude-code",
          nativeType: "legacy_memory_block",
          executionId: `legacy:${index}`,
        },
        metadata: memory.metadata ?? {},
        confidence:
          memory.score ??
          (typeof memory.metadata?.relevanceScore === "number"
            ? memory.metadata.relevanceScore
            : 1),
        timestamp: now - index,
        ttlDays: 7,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      })),
      procedural: [],
      factual: [],
      strategic: [],
    };
  }

  return memoryContext;
}

function toCandidate(
  memory: StoredMemory,
  backend: BackendName,
  policy: VisibilityPolicy,
  showPreview: boolean,
  previewChars: number,
): MemoryCandidateVisibility {
  const preview = showPreview
    ? policy.redactSecrets
      ? redactText(makePreview(memory.content, previewChars)).text
      : makePreview(memory.content, previewChars)
    : undefined;

  return {
    memoryId: memory.id,
    type: memory.type,
    source: normalizeCandidateSource(memory.scope),
    score: memory.confidence,
    contentHash: contentHash(memory.content),
    preview,
    charCount: memory.content.length,
    estimatedTokens: visEstimateTokens(memory.content, backend),
  };
}

function normalizeCandidateSource(
  scope: StoredMemory["scope"],
): MemoryCandidateVisibility["source"] {
  switch (scope) {
    case "project":
      return "redis";
    case "user":
      return "redis";
    case "session":
      return "dialogue";
    default:
      return "store";
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
