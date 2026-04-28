import { describe, it, expect } from "vitest";
import { memoryMapper, MemoryMapper } from "./mapper.js";
import type { BackendMemoryEvent } from "./types.js";

describe("MemoryMapper", () => {
  describe("map", () => {
    it("maps Claude Code conversation_context to episodic", () => {
      const event: BackendMemoryEvent = {
        backend: "claude-code",
        nativeType: "conversation_context",
        content: "User asked about Redis config",
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_1");
      expect(result.type).toBe("episodic");
      expect(result.scope).toBe("session");
      expect(result.confidence).toBe(0.95);
      expect(result.ttlDays).toBe(7);
      expect(result.source.backend).toBe("claude-code");
      expect(result.source.executionId).toBe("exec_1");
    });

    it("maps Claude Code code_context to procedural", () => {
      const event: BackendMemoryEvent = {
        backend: "claude-code",
        nativeType: "code_context",
        content: "Use redis-cli HGETALL for debugging",
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_2");
      expect(result.type).toBe("procedural");
      expect(result.scope).toBe("project");
      expect(result.confidence).toBe(0.9);
      expect(result.ttlDays).toBe(30);
    });

    it("maps Claude Code user_preferences to factual", () => {
      const event: BackendMemoryEvent = {
        backend: "claude-code",
        nativeType: "user_preferences",
        content: "User is a senior backend engineer",
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_3");
      expect(result.type).toBe("factual");
      expect(result.scope).toBe("user");
      expect(result.confidence).toBe(0.95);
      expect(result.ttlDays).toBe(180);
    });

    it("maps Claude Code project_context to strategic", () => {
      const event: BackendMemoryEvent = {
        backend: "claude-code",
        nativeType: "project_context",
        content: "Decided to use Redis for distributed config",
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_4");
      expect(result.type).toBe("strategic");
      expect(result.scope).toBe("project");
      expect(result.confidence).toBe(0.9);
      expect(result.ttlDays).toBe(180);
    });

    it("maps Codex session_history to episodic", () => {
      const event: BackendMemoryEvent = {
        backend: "codex",
        nativeType: "session_history",
        content: "Fixed bug in adapter.ts",
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_5");
      expect(result.type).toBe("episodic");
      expect(result.scope).toBe("session");
      expect(result.confidence).toBe(0.9);
      expect(result.ttlDays).toBe(7);
    });

    it("maps Gemini interaction_log to episodic", () => {
      const event: BackendMemoryEvent = {
        backend: "gemini",
        nativeType: "interaction_log",
        content: "User requested status check",
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_6");
      expect(result.type).toBe("episodic");
      expect(result.scope).toBe("session");
      expect(result.confidence).toBe(0.88);
      expect(result.ttlDays).toBe(7);
    });

    it("maps Hermes dialogue_memory to episodic", () => {
      const event: BackendMemoryEvent = {
        backend: "hermes",
        nativeType: "dialogue_memory",
        content: "User confirmed deployment approach",
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_7");
      expect(result.type).toBe("episodic");
      expect(result.scope).toBe("session");
      expect(result.confidence).toBe(0.92);
      expect(result.ttlDays).toBe(7);
    });

    it("handles unknown native types with fallback", () => {
      const event: BackendMemoryEvent = {
        backend: "claude-code",
        nativeType: "unknown_type",
        content: "Some content",
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_8");
      expect(result.type).toBe("episodic");
      expect(result.scope).toBe("session");
      expect(result.confidence).toBe(0.5);
      expect(result.ttlDays).toBe(7);
      expect(result.metadata.mappingFallback).toBe(true);
    });

    it("uses custom confidence when provided", () => {
      const event: BackendMemoryEvent = {
        backend: "claude-code",
        nativeType: "conversation_context",
        content: "Test content",
        confidence: 0.75,
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_9");
      expect(result.confidence).toBe(0.75);
    });

    it("preserves metadata from event", () => {
      const event: BackendMemoryEvent = {
        backend: "claude-code",
        nativeType: "conversation_context",
        content: "Test content",
        metadata: { tags: ["important", "user-request"] },
        timestamp: Date.now(),
      };
      const result = memoryMapper.map(event, "exec_10");
      expect(result.metadata.tags).toEqual(["important", "user-request"]);
    });

    it("throws error for unknown backend", () => {
      const event: BackendMemoryEvent = {
        backend: "unknown-backend" as any,
        nativeType: "some_type",
        content: "Test",
        timestamp: Date.now(),
      };
      expect(() => memoryMapper.map(event, "exec_11")).toThrow(
        "No mapping rules for backend: unknown-backend",
      );
    });
  });

  describe("validateCoverage", () => {
    it("validates complete coverage for Claude Code", () => {
      const result = memoryMapper.validateCoverage("claude-code");
      expect(result.complete).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("validates complete coverage for Codex", () => {
      const result = memoryMapper.validateCoverage("codex");
      expect(result.complete).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("validates complete coverage for Gemini", () => {
      const result = memoryMapper.validateCoverage("gemini");
      expect(result.complete).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("validates complete coverage for Hermes", () => {
      const result = memoryMapper.validateCoverage("hermes");
      expect(result.complete).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("reports incomplete coverage for unknown backend", () => {
      const result = memoryMapper.validateCoverage("unknown" as any);
      expect(result.complete).toBe(false);
      expect(result.missing).toEqual([
        "episodic",
        "procedural",
        "factual",
        "strategic",
      ]);
    });
  });

  describe("all backends mapping", () => {
    const backends: Array<{
      backend: BackendMemoryEvent["backend"];
      types: Array<{ native: string; unified: string; scope: string }>;
    }> = [
      {
        backend: "claude-code",
        types: [
          { native: "conversation_context", unified: "episodic", scope: "session" },
          { native: "code_context", unified: "procedural", scope: "project" },
          { native: "user_preferences", unified: "factual", scope: "user" },
          { native: "project_context", unified: "strategic", scope: "project" },
        ],
      },
      {
        backend: "codex",
        types: [
          { native: "session_history", unified: "episodic", scope: "session" },
          { native: "tool_usage", unified: "procedural", scope: "project" },
          { native: "codebase_facts", unified: "factual", scope: "user" },
          { native: "task_planning", unified: "strategic", scope: "project" },
        ],
      },
      {
        backend: "gemini",
        types: [
          { native: "interaction_log", unified: "episodic", scope: "session" },
          { native: "execution_patterns", unified: "procedural", scope: "project" },
          { native: "entity_knowledge", unified: "factual", scope: "user" },
          { native: "goal_tracking", unified: "strategic", scope: "project" },
        ],
      },
      {
        backend: "hermes",
        types: [
          { native: "dialogue_memory", unified: "episodic", scope: "session" },
          { native: "skill_memory", unified: "procedural", scope: "project" },
          { native: "profile_memory", unified: "factual", scope: "user" },
          { native: "intention_memory", unified: "strategic", scope: "project" },
        ],
      },
    ];

    for (const { backend, types } of backends) {
      for (const { native, unified, scope } of types) {
        it(`maps ${backend} ${native} to ${unified} with ${scope} scope`, () => {
          const event: BackendMemoryEvent = {
            backend,
            nativeType: native,
            content: "Test content",
            timestamp: Date.now(),
          };
          const result = memoryMapper.map(event, "exec_test");
          expect(result.type).toBe(unified);
          expect(result.scope).toBe(scope);
        });
      }
    }
  });
});
