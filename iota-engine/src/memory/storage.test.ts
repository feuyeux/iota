import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorage, type MemoryStorageBackend } from "./storage.js";
import type { MemoryQuery, StoredMemory, UnifiedMemory } from "./types.js";

class MockMemoryStorageBackend implements MemoryStorageBackend {
  private memories = new Map<string, StoredMemory>();
  private accessCounts = new Map<string, number>();
  readonly history: Array<{ memoryId: string; event: string; oldContent: string | null; newContent: string }> = [];

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async saveUnifiedMemory(memory: StoredMemory): Promise<void> {
    this.memories.set(memory.id, memory);
  }

  async loadUnifiedMemories(query: MemoryQuery): Promise<StoredMemory[]> {
    const results: StoredMemory[] = [];
    for (const memory of this.memories.values()) {
      if (memory.type !== query.type) continue;
      if (memory.scope !== query.scope) continue;
      if (memory.scopeId !== query.scopeId) continue;
      if (query.minConfidence && memory.confidence < query.minConfidence) {
        continue;
      }
      if (query.tags?.length) {
        const memoryTags = Array.isArray(memory.metadata.tags)
          ? memory.metadata.tags
          : [];
        if (!query.tags.some((tag) => memoryTags.includes(tag))) {
          continue;
        }
      }
      results.push(memory);
    }
    return results
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, query.limit ?? 100);
  }

  async deleteUnifiedMemory(type: string, memoryId: string): Promise<boolean> {
    return this.memories.delete(memoryId);
  }

  async touchUnifiedMemories(
    memoryIds: string[],
    accessedAt: number,
  ): Promise<void> {
    for (const id of memoryIds) {
      const memory = this.memories.get(id);
      if (memory) {
        memory.lastAccessedAt = accessedAt;
        memory.accessCount += 1;
        this.accessCounts.set(id, memory.accessCount);
      }
    }
  }


  async findUnifiedMemoryByHash(
    type: StoredMemory["type"],
    scopeId: string,
    contentHash: string,
    facet?: StoredMemory["facet"],
  ): Promise<StoredMemory | null> {
    for (const memory of this.memories.values()) {
      if (
        memory.type === type &&
        memory.scopeId === scopeId &&
        memory.contentHash === contentHash &&
        (facet === undefined || memory.facet === facet)
      ) {
        return memory;
      }
    }
    return null;
  }

  async addHistory(
    memoryId: string,
    event: string,
    oldContent: string | null,
    newContent: string,
  ): Promise<void> {
    this.history.push({ memoryId, event, oldContent, newContent });
  }

  async searchUnifiedMemories(
    query: string,
    limit = 10,
  ): Promise<Array<StoredMemory & { score?: number }>> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: Array<StoredMemory & { score?: number }> = [];
    for (const memory of this.memories.values()) {
      const score = terms.filter((term) =>
        memory.content.toLowerCase().includes(term),
      ).length;
      if (terms.length === 0 || score > 0) {
        results.push({ ...memory, score });
      }
    }
    return results
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }

  getAccessCount(memoryId: string): number {
    return this.accessCounts.get(memoryId) ?? 0;
  }

  clear(): void {
    this.memories.clear();
    this.accessCounts.clear();
    this.history.length = 0;
  }
}

describe("MemoryStorage", () => {
  let backend: MockMemoryStorageBackend;
  let storage: MemoryStorage;

  beforeEach(() => {
    backend = new MockMemoryStorageBackend();
    storage = new MemoryStorage(backend);
  });

  describe("store", () => {
    it("stores a unified memory", async () => {
      const memory: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "User asked about Redis",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.95,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      const stored = await storage.store(memory, "session_1");
      expect(stored.id).toBeDefined();
      expect(stored.scopeId).toBe("session_1");
      expect(stored.content).toBe("User asked about Redis");
      expect(stored.createdAt).toBeDefined();
      expect(stored.lastAccessedAt).toBeDefined();
      expect(stored.accessCount).toBe(0);
      expect(stored.expiresAt).toBeGreaterThan(Date.now());
    });

    it("calculates correct TTL", async () => {
      const now = Date.now();
      const memory: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "Test",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.9,
        timestamp: now,
        ttlDays: 7,
      };

      const stored = await storage.store(memory, "session_1");
      const expectedExpiry = now + 7 * 24 * 60 * 60 * 1000;
      expect(stored.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 1000);
      expect(stored.expiresAt).toBeLessThanOrEqual(expectedExpiry + 1000);
    });

    it("records ADD history on new memory", async () => {
      const stored = await storage.store(
        {
          type: "episodic",
          scope: "session",
          content: "Remember this",
          source: {
            backend: "claude-code",
            nativeType: "conversation_context",
            executionId: "exec_history",
          },
          metadata: {},
          confidence: 0.9,
          timestamp: Date.now(),
          ttlDays: 7,
        },
        "session_1",
      );

      expect(backend.history).toEqual([
        {
          memoryId: stored.id,
          event: "ADD",
          oldContent: null,
          newContent: "Remember this",
        },
      ]);
    });

    it("deduplicates by content hash and records UPDATE history", async () => {
      const memory: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "Same content",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_dupe",
        },
        metadata: {},
        confidence: 0.9,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      const first = await storage.store(memory, "session_1");
      const second = await storage.store(memory, "session_1");

      expect(second.id).toBe(first.id);
      expect(backend.getAccessCount(first.id)).toBe(1);
      expect(backend.history.map((entry) => entry.event)).toEqual(["ADD", "UPDATE"]);
    });
  });

  describe("retrieve", () => {
    it("retrieves memories by type and scope", async () => {
      const memory1: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "Memory 1",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.9,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      const memory2: UnifiedMemory = {
        type: "procedural",
        scope: "project",
        content: "Memory 2",
        source: {
          backend: "claude-code",
          nativeType: "code_context",
          executionId: "exec_2",
        },
        metadata: {},
        confidence: 0.85,
        timestamp: Date.now(),
        ttlDays: 30,
      };

      await storage.store(memory1, "session_1");
      await storage.store(memory2, "project_1");

      const results = await storage.retrieve({
        type: "episodic",
        scope: "session",
        scopeId: "session_1",
      });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("Memory 1");
    });

    it("filters by minimum confidence", async () => {
      const memory1: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "High confidence",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.95,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      const memory2: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "Low confidence",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_2",
        },
        metadata: {},
        confidence: 0.6,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      await storage.store(memory1, "session_1");
      await storage.store(memory2, "session_1");

      const results = await storage.retrieve({
        type: "episodic",
        scope: "session",
        scopeId: "session_1",
        minConfidence: 0.8,
      });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("High confidence");
    });

    it("filters by tags", async () => {
      const memory1: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "Tagged memory",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_1",
        },
        metadata: { tags: ["important", "user-request"] },
        confidence: 0.9,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      const memory2: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "Untagged memory",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_2",
        },
        metadata: {},
        confidence: 0.9,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      await storage.store(memory1, "session_1");
      await storage.store(memory2, "session_1");

      const results = await storage.retrieve({
        type: "episodic",
        scope: "session",
        scopeId: "session_1",
        tags: ["important"],
      });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("Tagged memory");
    });

    it("updates access count on retrieve", async () => {
      const memory: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "Test memory",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.9,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      const stored = await storage.store(memory, "session_1");
      expect(stored.accessCount).toBe(0);

      await storage.retrieve({
        type: "episodic",
        scope: "session",
        scopeId: "session_1",
      });

      expect(backend.getAccessCount(stored.id)).toBe(1);
    });

    it("continues scanning past filtered-out top records", async () => {
      const now = Date.now();
      for (let index = 0; index < 5; index += 1) {
        await storage.store(
          {
            type: "episodic",
            scope: "session",
            content: `Low confidence ${index}`,
            source: {
              backend: "claude-code",
              nativeType: "conversation_context",
              executionId: `exec_low_${index}`,
            },
            metadata: {},
            confidence: 0.5,
            timestamp: now + index,
            ttlDays: 7,
          },
          "session_1",
        );
      }

      await storage.store(
        {
          type: "episodic",
          scope: "session",
          content: "High confidence survivor",
          source: {
            backend: "claude-code",
            nativeType: "conversation_context",
            executionId: "exec_high",
          },
          metadata: {},
          confidence: 0.95,
          timestamp: now - 1000,
          ttlDays: 7,
        },
        "session_1",
      );

      const results = await storage.retrieve({
        type: "episodic",
        scope: "session",
        scopeId: "session_1",
        minConfidence: 0.9,
        limit: 1,
      });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("High confidence survivor");
    });
  });

  describe("delete", () => {
    it("deletes a memory", async () => {
      const memory: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "To be deleted",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.9,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      const stored = await storage.store(memory, "session_1");
      const deleted = await storage.delete("episodic", stored.id);
      expect(deleted).toBe(true);

      const results = await storage.retrieve({
        type: "episodic",
        scope: "session",
        scopeId: "session_1",
      });
      expect(results).toHaveLength(0);
    });

    it("returns false when deleting non-existent memory", async () => {
      const deleted = await storage.delete("episodic", "non_existent_id");
      expect(deleted).toBe(false);
    });
  });

  describe("searchAcrossScopes", () => {
    it("searches memories by content", async () => {
      const memory1: UnifiedMemory = {
        type: "episodic",
        scope: "session",
        content: "Redis configuration issue",
        source: {
          backend: "claude-code",
          nativeType: "conversation_context",
          executionId: "exec_1",
        },
        metadata: {},
        confidence: 0.9,
        timestamp: Date.now(),
        ttlDays: 7,
      };

      const memory2: UnifiedMemory = {
        type: "procedural",
        scope: "project",
        content: "Use docker-compose for Redis",
        source: {
          backend: "claude-code",
          nativeType: "code_context",
          executionId: "exec_2",
        },
        metadata: {},
        confidence: 0.85,
        timestamp: Date.now(),
        ttlDays: 30,
      };

      await storage.store(memory1, "session_1");
      await storage.store(memory2, "project_1");

      const results = await storage.searchAcrossScopes("Redis", 10);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((r) => r.content.includes("Redis"))).toBe(true);
    });
  });
});
