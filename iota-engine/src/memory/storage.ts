import crypto from "node:crypto";
import type { MemoryKind } from "../event/types.js";
import type { StorageBackend } from "../storage/interface.js";
import type {
  MemoryQuery,
  MemoryScope,
  StoredMemory,
  UnifiedMemory,
} from "./types.js";

export class MemoryStorage {
  constructor(private readonly storage: MemoryStorageBackend) {}

  async store(memory: UnifiedMemory, scopeId: string): Promise<StoredMemory> {
    const now = Date.now();
    const ttlMs = memory.ttlDays * 24 * 60 * 60 * 1000;
    const stored: StoredMemory = {
      ...memory,
      id: crypto.randomUUID(),
      scopeId,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      expiresAt: now + ttlMs,
    };
    await this.storage.saveUnifiedMemory(stored);
    return stored;
  }

  async retrieve(query: MemoryQuery): Promise<StoredMemory[]> {
    const memories = await this.storage.loadUnifiedMemories(query);
    if (memories.length > 0) {
      await this.storage.touchUnifiedMemories(
        memories.map((memory) => memory.id),
        Date.now(),
      );
    }
    return memories;
  }

  async delete(type: MemoryKind, memoryId: string): Promise<boolean> {
    return this.storage.deleteUnifiedMemory(type, memoryId);
  }

  async searchAcrossScopes(
    query: string,
    limit = 10,
  ): Promise<Array<StoredMemory & { score?: number }>> {
    return this.storage.searchUnifiedMemories(query, limit);
  }
}

export interface MemoryStorageBackend extends StorageBackend {
  saveUnifiedMemory(memory: StoredMemory): Promise<void>;
  loadUnifiedMemories(query: MemoryQuery): Promise<StoredMemory[]>;
  deleteUnifiedMemory(type: MemoryKind, memoryId: string): Promise<boolean>;
  touchUnifiedMemories(memoryIds: string[], accessedAt: number): Promise<void>;
  searchUnifiedMemories(
    query: string,
    limit?: number,
    scope?: { scope: MemoryScope; scopeId: string },
  ): Promise<Array<StoredMemory & { score?: number }>>;
}
