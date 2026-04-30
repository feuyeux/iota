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
import { createDefaultEmbeddingChain, type EmbeddingProvider } from "./embedding.js";
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
const IDENTITY_TOKEN_BUDGET = 256;
const PREFERENCE_TOKEN_BUDGET = 512;
const CHARS_PER_TOKEN = 4;

export class MemoryInjector {
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(
    private readonly storage: MemoryStorage,
    embeddingProvider: EmbeddingProvider = createDefaultEmbeddingChain(1024),
  ) {
    this.embeddingProvider = embeddingProvider;
  }

  async buildContext(scope: MemoryScopeContext): Promise<MemoryContext> {
    const projectScopeId = scope.projectId ?? scope.workingDirectory;
    const userScopeId = scope.userId ?? "default";
    const promptVector = await this.embeddingProvider.embed(
      scope.prompt ?? `${scope.sessionId}\n${projectScopeId}\n${userScopeId}`,
    );

    const queries: MemoryQuery[] = [
      {
        type: "semantic",
        facet: "identity",
        scope: "user",
        scopeId: userScopeId,
        limit: 20,
        minConfidence: 0.85,
        vector: promptVector,
      },
      {
        type: "semantic",
        facet: "preference",
        scope: "user",
        scopeId: userScopeId,
        limit: 30,
        minConfidence: 0.8,
        vector: promptVector,
      },
      {
        type: "semantic",
        facet: "strategic",
        scope: "project",
        scopeId: projectScopeId,
        limit: 30,
        minConfidence: 0.8,
        vector: promptVector,
      },
      {
        type: "semantic",
        facet: "domain",
        scope: "project",
        scopeId: projectScopeId,
        limit: 50,
        minConfidence: 0.8,
        vector: promptVector,
      },
      {
        type: "procedural",
        scope: "project",
        scopeId: projectScopeId,
        limit: 10,
        minConfidence: 0.75,
        vector: promptVector,
      },
      {
        type: "episodic",
        scope: "session",
        scopeId: scope.sessionId,
        limit: 20,
        minConfidence: 0.7,
        vector: promptVector,
      },
    ];

    const [identity, preference, strategic, domain, procedural, episodic] =
      await Promise.all(queries.map((query) => this.storage.retrieve(query)));

    return { episodic, procedural, identity, preference, domain, strategic };
  }

  formatAsPrompt(memoryContext: MemoryContext): string {
    const normalized = normalizeMemoryContext(memoryContext);
    const sections: string[] = [];

    appendSection(sections, "Identity Memory", normalized.identity);
    appendSection(sections, "Preference Memory", normalized.preference);
    appendSection(sections, "Strategic Memory", normalized.strategic);
    appendSection(sections, "Domain Memory", normalized.domain);
    appendSection(sections, "Procedural Memory", normalized.procedural);

    if (normalized.episodic.length > 0) {
      sections.push("# Episodic Memory");
      for (const memory of normalized.episodic) {
        sections.push(
          `- [${new Date(memory.timestamp).toISOString()}] ${memory.content}`,
        );
      }
      sections.push("");
    }

    return sections.join("\n").trim();
  }
}

/**
 * @deprecated Passing MemoryBlock[] is a legacy compatibility path; prefer MemoryContext.
 */
export function injectMemory(
  context: RuntimeContext,
  memoryContext: MemoryContext | MemoryBlock[],
  options: InjectOptions = {},
): RuntimeContext {
  return injectMemoryWithVisibility(context, memoryContext, options).context;
}

/**
 * @deprecated Passing MemoryBlock[] is a legacy compatibility path; prefer MemoryContext.
 */
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
  const existingIds = new Set(
    context.injectedMemory.map((memory) => memory.id),
  );

  const candidates: MemoryCandidateVisibility[] = ordered.map((memory) =>
    toCandidate(memory, backend, policy, showPreview, previewChars),
  );
  const selected: MemorySelectedVisibility[] = [];
  const excluded: MemoryExcludedVisibility[] = [];
  const selectedBlocks: RuntimeContext["injectedMemory"] = [];

  const hasIdentity = ordered.some((memory) => injectionBudgetBucket(memory) === "identity");
  const hasPreference = ordered.some((memory) => injectionBudgetBucket(memory) === "preference");
  const identityBudget = hasIdentity ? Math.min(IDENTITY_TOKEN_BUDGET, budget) : 0;
  const preferenceBudget = hasPreference
    ? Math.min(PREFERENCE_TOKEN_BUDGET, Math.max(0, budget - identityBudget))
    : 0;
  const sharedBudget = Math.max(0, budget - identityBudget - preferenceBudget);
  const usedByBucket: Record<string, number> = { identity: 0, preference: 0, shared: 0 };

  for (let index = 0; index < ordered.length; index += 1) {
    const memory = ordered[index];
    const candidate = candidates[index];
    const tokens = estimateTokens(memory.content);
    const bucket = injectionBudgetBucket(memory);
    const bucketBudget = bucket === "identity" ? identityBudget : bucket === "preference" ? preferenceBudget : sharedBudget;

    if (existingIds.has(memory.id)) {
      excluded.push({ ...candidate, reason: "duplicate" });
      continue;
    }

    if (minScore > 0 && computeMemoryScore(memory) < minScore) {
      excluded.push({ ...candidate, reason: "low_score" });
      continue;
    }

    if (usedByBucket[bucket] + tokens > bucketBudget) {
      const remaining = bucketBudget - usedByBucket[bucket];
      if (remaining > 50) {
        selectedBlocks.push(toInjectedBlock(memory, memory.content.slice(0, remaining * CHARS_PER_TOKEN)));
        selected.push({
          ...candidate,
          injectedSegmentId: memory.id,
          trimmed: true,
          trimmedFromTokens: tokens,
          trimmedToTokens: remaining,
          visibleToBackend: true,
        });
        usedByBucket[bucket] += remaining;
      } else {
        excluded.push({ ...candidate, reason: "token_budget_exceeded" });
      }
      continue;
    }

    selectedBlocks.push(toInjectedBlock(memory, memory.content));
    selected.push({
      ...candidate,
      injectedSegmentId: memory.id,
      trimmed: false,
      visibleToBackend: true,
    });
    usedByBucket[bucket] += tokens;
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
    ...sortMemories(memoryContext.identity),
    ...sortMemories(memoryContext.preference),
    ...sortMemories(memoryContext.strategic),
    ...sortMemories(memoryContext.domain),
    ...sortMemories(memoryContext.procedural),
    ...sortMemories(memoryContext.episodic),
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
        type: normalizeBlockType(memory.type),
        facet: normalizeBlockFacet(memory.type),
        scope: "session",
        scopeId: "legacy-session",
        content: memory.content,
        contentHash: contentHash(memory.content),
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
      identity: [],
      preference: [],
      domain: [],
      strategic: [],
    };
  }

  return {
    episodic: memoryContext.episodic ?? [],
    procedural: memoryContext.procedural ?? [],
    identity: memoryContext.identity ?? [],
    preference: memoryContext.preference ?? [],
    domain: memoryContext.domain ?? [],
    strategic: memoryContext.strategic ?? [],
  };
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
    score: computeMemoryScore(memory),
    contentHash: contentHash(memory.content),
    preview,
    charCount: memory.content.length,
    estimatedTokens: visEstimateTokens(memory.content, backend),
  };
}

function toInjectedBlock(memory: StoredMemory, content: string): RuntimeContext["injectedMemory"][number] {
  return {
    id: memory.id,
    type: memory.type,
    content,
    facet: memory.facet,
    scope: memory.scope,
    scopeId: memory.scopeId,
    confidence: memory.confidence,
    metadata: {
      ...memory.metadata,
      facet: memory.facet,
      source: memory.scope,
      memoryScopeId: memory.scopeId,
      confidence: memory.confidence,
    },
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

function sortMemories(memories: StoredMemory[]): StoredMemory[] {
  return [...memories].sort((a, b) => computeMemoryScore(b) - computeMemoryScore(a));
}

function computeMemoryScore(memory: StoredMemory): number {
  const now = Date.now();
  const ageDays = Math.max(0, (now - memory.lastAccessedAt) / 86_400_000);
  const recencyDecay = Math.exp(-ageDays / 30);
  const accessBoost = Math.log1p(memory.accessCount) / 10;
  const rawVectorScore = (memory as StoredMemory & { score?: unknown }).score;
  const vectorScore =
    typeof rawVectorScore === "number"
      ? rawVectorScore
      : typeof memory.metadata.vectorScore === "number"
        ? memory.metadata.vectorScore
        : undefined;
  if (vectorScore === undefined) {
    return 0.5 * memory.confidence + 0.3 * recencyDecay + 0.2 * accessBoost;
  }
  return (
    0.3 * memory.confidence +
    0.2 * recencyDecay +
    0.1 * accessBoost +
    0.4 * vectorScore
  );
}

function injectionBudgetBucket(memory: StoredMemory): "identity" | "preference" | "shared" {
  if (memory.type === "semantic" && memory.facet === "identity") return "identity";
  if (memory.type === "semantic" && memory.facet === "preference") return "preference";
  return "shared";
}

function normalizeBlockType(type: MemoryBlock["type"]): StoredMemory["type"] {
  if (type === "procedural" || type === "semantic") return type;
  return "episodic";
}

function normalizeBlockFacet(_type: MemoryBlock["type"]): StoredMemory["facet"] {
  return undefined;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
