import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryInjector,
  injectMemory,
  injectMemoryWithVisibility,
} from "./injector.js";
import { MemoryStorage, type MemoryStorageBackend } from "./storage.js";
import type { MemoryQuery, StoredMemory, MemoryContext } from "./types.js";
import type { RuntimeContext } from "../event/types.js";

class MockMemoryStorageBackend implements MemoryStorageBackend {
  private memories: StoredMemory[] = [];

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async saveUnifiedMemory(memory: StoredMemory): Promise<void> {
    this.memories.push(memory);
  }

  async loadUnifiedMemories(query: MemoryQuery): Promise<StoredMemory[]> {
    return this.memories
      .filter(
        (m) =>
          m.type === query.type &&
          m.scope === query.scope &&
          m.scopeId === query.scopeId &&
          (query.facet === undefined || m.facet === query.facet),
      )
      .filter(
        (m) => !query.minConfidence || m.confidence >= query.minConfidence,
      )
      .slice(0, query.limit ?? 100);
  }

  async deleteUnifiedMemory(): Promise<boolean> {
    return true;
  }

  async touchUnifiedMemories(): Promise<void> {}

  async searchUnifiedMemories(): Promise<
    Array<StoredMemory & { score?: number }>
  > {
    return [];
  }

  setMemories(memories: StoredMemory[]): void {
    this.memories = memories;
  }
}

describe("MemoryInjector", () => {
  let backend: MockMemoryStorageBackend;
  let storage: MemoryStorage;
  let injector: MemoryInjector;

  beforeEach(() => {
    backend = new MockMemoryStorageBackend();
    storage = new MemoryStorage(backend);
    injector = new MemoryInjector(storage);
  });

  describe("buildContext", () => {
    it("retrieves all memory buckets", async () => {
      const now = Date.now();
      const memories: StoredMemory[] = [
        {
          id: "m1",
          type: "episodic",
          scope: "session",
          scopeId: "session_1",
          content: "User asked about Redis",
          source: {
            backend: "claude-code",
            nativeType: "conversation_context",
            executionId: "exec_1",
          },
          metadata: {},
          confidence: 0.9,
          timestamp: now,
          ttlDays: 7,
          createdAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          expiresAt: now + 7 * 86400000,
        },
        {
          id: "m2",
          type: "procedural",
          scope: "project",
          scopeId: "/project",
          content: "Use docker-compose up",
          source: {
            backend: "claude-code",
            nativeType: "code_context",
            executionId: "exec_2",
          },
          metadata: {},
          confidence: 0.85,
          timestamp: now,
          ttlDays: 30,
          createdAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          expiresAt: now + 30 * 86400000,
        },
        {
          id: "m3",
          type: "semantic",
          facet: "preference",
          scope: "user",
          scopeId: "user_1",
          content: "User prefers backend-focused answers",
          source: {
            backend: "claude-code",
            nativeType: "user_preferences",
            executionId: "exec_3",
          },
          metadata: {},
          confidence: 0.95,
          timestamp: now,
          ttlDays: 180,
          createdAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          expiresAt: now + 180 * 86400000,
        },
        {
          id: "m4",
          type: "semantic",
          facet: "strategic",
          scope: "project",
          scopeId: "/project",
          content: "Plan to add OpenTelemetry",
          source: {
            backend: "claude-code",
            nativeType: "project_context",
            executionId: "exec_4",
          },
          metadata: {},
          confidence: 0.88,
          timestamp: now,
          ttlDays: 180,
          createdAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          expiresAt: now + 180 * 86400000,
        },
      ];

      backend.setMemories(memories);

      const context = await injector.buildContext({
        sessionId: "session_1",
        projectId: "/project",
        userId: "user_1",
        workingDirectory: "/project",
      });

      expect(context.episodic).toHaveLength(1);
      expect(context.procedural).toHaveLength(1);
      expect(context.preference).toHaveLength(1);
      expect(context.strategic).toHaveLength(1);
    });

    it("uses workingDirectory as fallback for projectId", async () => {
      const now = Date.now();
      const memory: StoredMemory = {
        id: "m1",
        type: "procedural",
        scope: "project",
        scopeId: "/working/dir",
        content: "Test memory",
        source: {
          backend: "claude-code",
          nativeType: "code_context",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.85,
        timestamp: now,
        ttlDays: 30,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        expiresAt: now + 30 * 86400000,
      };

      backend.setMemories([memory]);

      const context = await injector.buildContext({
        sessionId: "session_1",
        workingDirectory: "/working/dir",
      });

      expect(context.procedural).toHaveLength(1);
    });

    it("uses default userId when not provided", async () => {
      const now = Date.now();
      const memory: StoredMemory = {
        id: "m1",
        type: "semantic",
        facet: "preference",
        scope: "user",
        scopeId: "default",
        content: "Default user preference",
        source: {
          backend: "claude-code",
          nativeType: "user_preferences",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.9,
        timestamp: now,
        ttlDays: 180,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        expiresAt: now + 180 * 86400000,
      };

      backend.setMemories([memory]);

      const context = await injector.buildContext({
        sessionId: "session_1",
        workingDirectory: "/project",
      });

      expect(context.preference).toHaveLength(1);
    });
  });

  describe("formatAsPrompt", () => {
    it("formats memory context as prompt", () => {
      const now = Date.now();
      const memoryContext: MemoryContext = {
        episodic: [
          {
            id: "m1",
            type: "episodic",
            scope: "session",
            scopeId: "session_1",
            content: "User asked about Redis",
            source: {
              backend: "claude-code",
              nativeType: "conversation_context",
              executionId: "exec_1",
            },
            metadata: {},
            confidence: 0.9,
            timestamp: now,
            ttlDays: 7,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 7 * 86400000,
          },
        ],
        procedural: [
          {
            id: "m2",
            type: "procedural",
            scope: "project",
            scopeId: "/project",
            content: "Use docker-compose up",
            source: {
              backend: "claude-code",
              nativeType: "code_context",
              executionId: "exec_2",
            },
            metadata: {},
            confidence: 0.85,
            timestamp: now,
            ttlDays: 30,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 30 * 86400000,
          },
        ],
        domain: [
          {
            id: "m3",
            type: "semantic",
          facet: "domain",
            scope: "user",
            scopeId: "user_1",
            content: "User is backend engineer",
            source: {
              backend: "claude-code",
              nativeType: "user_preferences",
              executionId: "exec_3",
            },
            metadata: {},
            confidence: 0.95,
            timestamp: now,
            ttlDays: 180,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 180 * 86400000,
          },
        ],
        strategic: [
          {
            id: "m4",
            type: "semantic",
          facet: "strategic",
            scope: "project",
            scopeId: "/project",
            content: "Plan to add OpenTelemetry",
            source: {
              backend: "claude-code",
              nativeType: "project_context",
              executionId: "exec_4",
            },
            metadata: {},
            confidence: 0.88,
            timestamp: now,
            ttlDays: 180,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 180 * 86400000,
          },
        ],
      };

      const prompt = injector.formatAsPrompt(memoryContext);

      expect(prompt).toContain("# Domain Memory");
      expect(prompt).toContain("User is backend engineer");
      expect(prompt).toContain("# Strategic Memory");
      expect(prompt).toContain("Plan to add OpenTelemetry");
      expect(prompt).toContain("# Procedural Memory");
      expect(prompt).toContain("Use docker-compose up");
      expect(prompt).toContain("# Episodic Memory");
      expect(prompt).toContain("User asked about Redis");
    });

    it("omits empty sections", () => {
      const memoryContext: MemoryContext = {
        episodic: [],
        procedural: [],
        domain: [],
        strategic: [],
      };

      const prompt = injector.formatAsPrompt(memoryContext);
      expect(prompt).toBe("");
    });

    it("includes timestamps for episodic memories", () => {
      const now = Date.now();
      const memoryContext: MemoryContext = {
        episodic: [
          {
            id: "m1",
            type: "episodic",
            scope: "session",
            scopeId: "session_1",
            content: "Test memory",
            source: {
              backend: "claude-code",
              nativeType: "conversation_context",
              executionId: "exec_1",
            },
            metadata: {},
            confidence: 0.9,
            timestamp: now,
            ttlDays: 7,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 7 * 86400000,
          },
        ],
        procedural: [],
        domain: [],
        strategic: [],
      };

      const prompt = injector.formatAsPrompt(memoryContext);
      expect(prompt).toContain(new Date(now).toISOString());
    });
  });

  describe("injectMemory", () => {
    it("injects memory into runtime context", () => {
      const now = Date.now();
      const context: RuntimeContext = {
        executionId: "exec_1",
        sessionId: "session_1",
        backend: "claude-code",
        workingDirectory: "/project",
        prompt: "Test prompt",
        injectedMemory: [],
      };

      const memoryContext: MemoryContext = {
        episodic: [],
        procedural: [],
        domain: [
          {
            id: "m1",
            type: "semantic",
          facet: "domain",
            scope: "user",
            scopeId: "user_1",
            content: "User is backend engineer",
            source: {
              backend: "claude-code",
              nativeType: "user_preferences",
              executionId: "exec_1",
            },
            metadata: {},
            confidence: 0.95,
            timestamp: now,
            ttlDays: 180,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 180 * 86400000,
          },
        ],
        strategic: [],
      };

      const result = injectMemory(context, memoryContext);
      expect(result.injectedMemory).toHaveLength(1);
      expect(result.injectedMemory[0].content).toBe("User is backend engineer");
    });
  });

  describe("injectMemoryWithVisibility", () => {
    it("respects token budget", () => {
      const now = Date.now();
      const context: RuntimeContext = {
        executionId: "exec_1",
        sessionId: "session_1",
        backend: "claude-code",
        workingDirectory: "/project",
        prompt: "Test prompt",
        injectedMemory: [],
      };

      const longContent = "a".repeat(1000);
      const memoryContext: MemoryContext = {
        episodic: [],
        procedural: [],
        domain: [
          {
            id: "m1",
            type: "semantic",
          facet: "domain",
            scope: "user",
            scopeId: "user_1",
            content: longContent,
            source: {
              backend: "claude-code",
              nativeType: "user_preferences",
              executionId: "exec_1",
            },
            metadata: {},
            confidence: 0.95,
            timestamp: now,
            ttlDays: 180,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 180 * 86400000,
          },
          {
            id: "m2",
            type: "semantic",
          facet: "domain",
            scope: "user",
            scopeId: "user_1",
            content: longContent,
            source: {
              backend: "claude-code",
              nativeType: "user_preferences",
              executionId: "exec_2",
            },
            metadata: {},
            confidence: 0.9,
            timestamp: now,
            ttlDays: 180,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 180 * 86400000,
          },
        ],
        strategic: [],
      };

      const result = injectMemoryWithVisibility(context, memoryContext, {
        tokenBudget: 100,
      });

      expect(result.selected.length).toBeLessThan(2);
      expect(result.excluded.length).toBeGreaterThan(0);
    });

    it("tracks candidates, selected, and excluded", () => {
      const now = Date.now();
      const context: RuntimeContext = {
        executionId: "exec_1",
        sessionId: "session_1",
        backend: "claude-code",
        workingDirectory: "/project",
        prompt: "Test prompt",
        injectedMemory: [],
      };

      const memoryContext: MemoryContext = {
        episodic: [],
        procedural: [],
        domain: [
          {
            id: "m1",
            type: "semantic",
          facet: "domain",
            scope: "user",
            scopeId: "user_1",
            content: "Short memory",
            source: {
              backend: "claude-code",
              nativeType: "user_preferences",
              executionId: "exec_1",
            },
            metadata: {},
            confidence: 0.95,
            timestamp: now,
            ttlDays: 180,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            expiresAt: now + 180 * 86400000,
          },
        ],
        strategic: [],
      };

      const result = injectMemoryWithVisibility(context, memoryContext);

      expect(result.candidates).toHaveLength(1);
      expect(result.selected).toHaveLength(1);
      expect(result.excluded).toHaveLength(0);
      expect(result.selected[0].visibleToBackend).toBe(true);
    });
  });
});
