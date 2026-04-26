import crypto from "node:crypto";
import type { MemoryBlock, MemoryKind } from "../event/types.js";

/**
 * Memory store — persistent cross-execution knowledge blocks, keyed by sessionId.
 * Each block carries a MemoryKind tag (episodic / procedural / factual / strategic).
 * Backed by Redis or Milvus in production; falls back to an in-memory Map in development.
 */
export class MemoryStore {
  private readonly blocks = new Map<string, MemoryBlock[]>();
  private storage?: MemoryStoreStorage;

  /** Attach Redis-compatible storage for persistence. */
  setStorage(storage: MemoryStoreStorage): void {
    this.storage = storage;
  }

  async add(sessionId: string, block: MemoryBlock): Promise<void> {
    const normalized: MemoryBlock = {
      ...block,
      type: block.type ?? "episodic",
    };
    const existing = this.blocks.get(sessionId) ?? [];
    existing.push(normalized);
    this.blocks.set(sessionId, existing.slice(-100));

    if (this.storage) {
      try {
        await this.storage.saveMemory({
          id: normalized.id || crypto.randomUUID(),
          sessionId,
          content: normalized.content,
          type: normalized.type,
          metadata: normalized.metadata,
        });
      } catch (err) {
        // Non-fatal: in-memory still works
        console.warn("[iota-engine] Memory storage save failed:", err);
      }
    }
  }

  async search(
    sessionId: string,
    query: string,
    limit = 5,
  ): Promise<MemoryBlock[]> {
    if (this.storage && query) {
      try {
        const rows = await this.storage.searchMemories(sessionId, query, limit);
        if (rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            type: r.type,
            content: r.content,
            metadata: r.metadata,
          }));
        }
      } catch (err) {
        // Fall through to in-memory
        console.warn("[iota-engine] Memory storage search failed:", err);
      }
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      return (this.blocks.get(sessionId) ?? []).slice(-limit);
    }
    return (this.blocks.get(sessionId) ?? [])
      .map((block) => ({
        ...block,
        score: terms.filter((term) =>
          block.content.toLowerCase().includes(term),
        ).length,
      }))
      .filter((block) => (block.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }

  list(sessionId: string, limit = 100): MemoryBlock[] {
    return (this.blocks.get(sessionId) ?? []).slice(-limit).reverse();
  }

  delete(sessionId: string, memoryId: string): boolean {
    const existing = this.blocks.get(sessionId) ?? [];
    const next = existing.filter((block) => block.id !== memoryId);
    if (next.length === existing.length) {
      return false;
    }
    this.blocks.set(sessionId, next);
    return true;
  }
}

interface MemoryStoreStorage {
  saveMemory(memory: {
    id: string;
    sessionId: string;
    content: string;
    type?: MemoryKind;
    metadata?: Record<string, unknown>;
    embedding?: number[];
  }): Promise<void>;
  searchMemories(
    sessionId: string,
    query: string,
    limit?: number,
  ): Promise<
    Array<{
      id: string;
      content: string;
      type?: MemoryKind;
      metadata?: Record<string, unknown>;
    }>
  >;
}
