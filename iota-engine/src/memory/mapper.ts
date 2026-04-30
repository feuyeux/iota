import type { BackendName } from "../event/types.js";
import type {
  BackendMemoryEvent,
  MemoryFacet,
  MemoryScope,
  MemoryType,
  UnifiedMemory,
} from "./types.js";

interface MappingRule {
  unifiedType: MemoryType;
  facet?: MemoryFacet;
  defaultConfidence: number;
  scope: MemoryScope;
  ttlDays: number;
}

const ALL_MEMORY_TYPES: MemoryType[] = ["episodic", "procedural", "semantic"];
export class MemoryMapper {
  private readonly mappingRules: Map<BackendName, Map<string, MappingRule>>;

  constructor() {
    this.mappingRules = new Map([
      [
        "claude-code",
        new Map([
          ["conversation_context", episodic(0.95)],
          ["code_context", procedural(0.9)],
          ["user_preferences", semantic("preference", 0.95, "user", 365)],
          ["project_context", semantic("strategic", 0.9, "project", 180)],
        ]),
      ],
      [
        "codex",
        new Map([
          ["session_history", episodic(0.9)],
          ["tool_usage", procedural(0.88)],
          ["codebase_facts", semantic("domain", 0.92, "project", 90)],
          ["task_planning", semantic("strategic", 0.85, "project", 180)],
        ]),
      ],
      [
        "gemini",
        new Map([
          ["interaction_log", episodic(0.88)],
          ["execution_patterns", procedural(0.85)],
          ["entity_knowledge", semantic("domain", 0.9, "project", 90)],
          ["goal_tracking", semantic("strategic", 0.85, "project", 180)],
        ]),
      ],
      [
        "hermes",
        new Map([
          ["dialogue_memory", episodic(0.92)],
          ["skill_memory", procedural(0.88)],
          ["profile_memory", semantic("identity", 0.93, "user", 365)],
          ["intention_memory", semantic("strategic", 0.87, "project", 180)],
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
      facet: rule.facet,
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
    missing: MemoryType[];
  } {
    const rules = this.mappingRules.get(backend);
    if (!rules) {
      return { complete: false, missing: [...ALL_MEMORY_TYPES] };
    }

    const covered = new Set<MemoryType>();
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

function episodic(defaultConfidence: number): MappingRule {
  return {
    unifiedType: "episodic",
    defaultConfidence,
    scope: "session",
    ttlDays: 7,
  };
}

function procedural(defaultConfidence: number): MappingRule {
  return {
    unifiedType: "procedural",
    defaultConfidence,
    scope: "project",
    ttlDays: 30,
  };
}

function semantic(
  facet: MemoryFacet,
  defaultConfidence: number,
  scope: MemoryScope,
  ttlDays: number,
): MappingRule {
  return {
    unifiedType: "semantic",
    facet,
    defaultConfidence,
    scope,
    ttlDays,
  };
}

export const memoryMapper = new MemoryMapper();
