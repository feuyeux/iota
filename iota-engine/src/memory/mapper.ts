import type { BackendName, MemoryKind } from "../event/types.js";
import type { BackendMemoryEvent, MemoryScope, UnifiedMemory } from "./types.js";

interface MappingRule {
  unifiedType: MemoryKind;
  defaultConfidence: number;
  scope: MemoryScope;
  ttlDays: number;
}

const ALL_MEMORY_TYPES: MemoryKind[] = [
  "episodic",
  "procedural",
  "factual",
  "strategic",
];

export class MemoryMapper {
  private readonly mappingRules: Map<BackendName, Map<string, MappingRule>>;

  constructor() {
    this.mappingRules = new Map([
      [
        "claude-code",
        new Map([
          [
            "conversation_context",
            {
              unifiedType: "episodic",
              defaultConfidence: 0.95,
              scope: "session",
              ttlDays: 7,
            },
          ],
          [
            "code_context",
            {
              unifiedType: "procedural",
              defaultConfidence: 0.9,
              scope: "project",
              ttlDays: 30,
            },
          ],
          [
            "user_preferences",
            {
              unifiedType: "factual",
              defaultConfidence: 0.95,
              scope: "user",
              ttlDays: 180,
            },
          ],
          [
            "project_context",
            {
              unifiedType: "strategic",
              defaultConfidence: 0.9,
              scope: "project",
              ttlDays: 180,
            },
          ],
        ]),
      ],
      [
        "codex",
        new Map([
          [
            "session_history",
            {
              unifiedType: "episodic",
              defaultConfidence: 0.9,
              scope: "session",
              ttlDays: 7,
            },
          ],
          [
            "tool_usage",
            {
              unifiedType: "procedural",
              defaultConfidence: 0.88,
              scope: "project",
              ttlDays: 30,
            },
          ],
          [
            "codebase_facts",
            {
              unifiedType: "factual",
              defaultConfidence: 0.92,
              scope: "user",
              ttlDays: 180,
            },
          ],
          [
            "task_planning",
            {
              unifiedType: "strategic",
              defaultConfidence: 0.85,
              scope: "project",
              ttlDays: 180,
            },
          ],
        ]),
      ],
      [
        "gemini",
        new Map([
          [
            "interaction_log",
            {
              unifiedType: "episodic",
              defaultConfidence: 0.88,
              scope: "session",
              ttlDays: 7,
            },
          ],
          [
            "execution_patterns",
            {
              unifiedType: "procedural",
              defaultConfidence: 0.85,
              scope: "project",
              ttlDays: 30,
            },
          ],
          [
            "entity_knowledge",
            {
              unifiedType: "factual",
              defaultConfidence: 0.9,
              scope: "user",
              ttlDays: 180,
            },
          ],
          [
            "goal_tracking",
            {
              unifiedType: "strategic",
              defaultConfidence: 0.85,
              scope: "project",
              ttlDays: 180,
            },
          ],
        ]),
      ],
      [
        "hermes",
        new Map([
          [
            "dialogue_memory",
            {
              unifiedType: "episodic",
              defaultConfidence: 0.92,
              scope: "session",
              ttlDays: 7,
            },
          ],
          [
            "skill_memory",
            {
              unifiedType: "procedural",
              defaultConfidence: 0.88,
              scope: "project",
              ttlDays: 30,
            },
          ],
          [
            "profile_memory",
            {
              unifiedType: "factual",
              defaultConfidence: 0.93,
              scope: "user",
              ttlDays: 180,
            },
          ],
          [
            "intention_memory",
            {
              unifiedType: "strategic",
              defaultConfidence: 0.87,
              scope: "project",
              ttlDays: 180,
            },
          ],
        ]),
      ],
    ]);
  }

  map(event: BackendMemoryEvent, executionId: string): UnifiedMemory {
    const backendRules = this.mappingRules.get(event.backend);
    if (!backendRules) {
      throw new Error(`No mapping rules for backend: ${event.backend}`);
    }

    const rule = backendRules.get(event.nativeType);
    if (!rule) {
      return {
        type: "episodic",
        scope: "session",
        content: event.content,
        source: {
          backend: event.backend,
          nativeType: event.nativeType,
          executionId,
        },
        metadata: {
          ...(event.metadata ?? {}),
          mappingFallback: true,
        },
        confidence: event.confidence ?? 0.5,
        timestamp: event.timestamp ?? Date.now(),
        ttlDays: 7,
      };
    }

    return {
      type: rule.unifiedType,
      scope: rule.scope,
      content: event.content,
      source: {
        backend: event.backend,
        nativeType: event.nativeType,
        executionId,
      },
      metadata: {
        ...(event.metadata ?? {}),
      },
      confidence: event.confidence ?? rule.defaultConfidence,
      timestamp: event.timestamp ?? Date.now(),
      ttlDays: rule.ttlDays,
    };
  }

  validateCoverage(backend: BackendName): {
    complete: boolean;
    missing: MemoryKind[];
  } {
    const rules = this.mappingRules.get(backend);
    if (!rules) {
      return { complete: false, missing: [...ALL_MEMORY_TYPES] };
    }

    const covered = new Set<MemoryKind>();
    for (const rule of rules.values()) {
      covered.add(rule.unifiedType);
    }

    const missing = ALL_MEMORY_TYPES.filter((type) => !covered.has(type));
    return {
      complete: missing.length === 0,
      missing,
    };
  }
}

export const memoryMapper = new MemoryMapper();

