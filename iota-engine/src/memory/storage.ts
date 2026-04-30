import crypto from "node:crypto";
import type { StorageBackend } from "../storage/interface.js";
import { cosineSimilarity, createDefaultEmbeddingChain, type EmbeddingProvider } from "./embedding.js";
import type {
  MemoryQuery,
  StoredMemory,
  UnifiedMemory,
} from "./types.js";

export class MemoryStorage {
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(
    private readonly storage: MemoryStorageBackend,
    embeddingProvider: EmbeddingProvider = createDefaultEmbeddingChain(1024),
  ) {
    this.embeddingProvider = embeddingProvider;
  }

  async store(memory: UnifiedMemory, scopeId: string): Promise<StoredMemory> {
    const now = Date.now();
    const ttlMs = memory.ttlDays * 24 * 60 * 60 * 1000;
    const hash = hashMemoryContent(memory.content);
    const existing = await this.storage.findUnifiedMemoryByHash?.(
      memory.type,
      scopeId,
      hash,
      memory.facet,
    );
    if (existing) {
      await this.storage.touchUnifiedMemories([existing.id], now);
      await this.storage.addHistory?.(existing.id, "UPDATE", existing.content, memory.content);
      return { ...existing, lastAccessedAt: now, accessCount: existing.accessCount + 1 };
    }

    const embedding = await this.embeddingProvider.embed(memory.content);
    const stored: StoredMemory = {
      ...memory,
      id: crypto.randomUUID(),
      scopeId,
      contentHash: hash,
      embeddingJson: JSON.stringify(embedding),
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      expiresAt: now + ttlMs,
    };
    await this.storage.saveUnifiedMemory(stored);
    await this.storage.addHistory?.(stored.id, "ADD", null, stored.content);
    return stored;
  }

  async retrieve(query: MemoryQuery): Promise<StoredMemory[]> {
    const memories = query.vector && this.storage.searchByVector
      ? await this.storage.searchByVector(query.vector, query, query.limit ?? 100)
      : await this.storage.loadUnifiedMemories(query);
    if (memories.length > 0) {
      await this.storage.touchUnifiedMemories(
        memories.map((memory) => memory.id),
        Date.now(),
      );
    }
    return memories;
  }

  async delete(type: StoredMemory["type"], memoryId: string): Promise<boolean> {
    return this.storage.deleteUnifiedMemory(type, memoryId);
  }

  async searchAcrossScopes(
    query: string,
    limit = 10,
  ): Promise<Array<StoredMemory & { score?: number }>> {
    return this.storage.searchUnifiedMemories(query, limit);
  }

  async getUserProfile(userId: string): Promise<{
    identity: StoredMemory[];
    preference: StoredMemory[];
  }> {
    const [identity, preference] = await Promise.all([
      this.retrieve({
        type: "semantic",
        facet: "identity",
        scope: "user",
        scopeId: userId,
        limit: 20,
        minConfidence: 0.85,
      }),
      this.retrieve({
        type: "semantic",
        facet: "preference",
        scope: "user",
        scopeId: userId,
        limit: 30,
        minConfidence: 0.8,
      }),
    ]);
    return { identity, preference };
  }
}

export async function getUserProfile(
  storage: MemoryStorage,
  userId: string,
): Promise<{ identity: StoredMemory[]; preference: StoredMemory[] }> {
  return storage.getUserProfile(userId);
}

export interface MemoryStorageBackend extends StorageBackend {
  saveUnifiedMemory(memory: StoredMemory): Promise<void>;
  loadUnifiedMemories(query: MemoryQuery): Promise<StoredMemory[]>;
  deleteUnifiedMemory(type: StoredMemory["type"], memoryId: string): Promise<boolean>;
  touchUnifiedMemories(memoryIds: string[], accessedAt: number): Promise<void>;
  searchUnifiedMemories(
    query: string,
    limit?: number,
  ): Promise<Array<StoredMemory & { score?: number }>>;
  checkHashExists?(
    type: StoredMemory["type"],
    scopeId: string,
    contentHash: string,
    facet?: StoredMemory["facet"],
  ): Promise<boolean>;
  findUnifiedMemoryByHash?(
    type: StoredMemory["type"],
    scopeId: string,
    contentHash: string,
    facet?: StoredMemory["facet"],
  ): Promise<StoredMemory | null>;
  searchByVector?(
    vector: number[],
    query: MemoryQuery,
    topK: number,
  ): Promise<Array<StoredMemory & { score?: number }>>;
  addHistory?(
    memoryId: string,
    event: string,
    oldContent: string | null,
    newContent: string,
  ): Promise<void>;
}

export function hashMemoryContent(content: string): string {
  return crypto.createHash("md5").update(content.trim()).digest("hex");
}

export function parseMemoryEmbedding(memory: StoredMemory): number[] | null {
  if (!memory.embeddingJson) return null;
  try {
    const parsed = JSON.parse(memory.embeddingJson) as unknown;
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "number")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function scoreMemoryByVector(memory: StoredMemory, vector: number[]): number {
  const embedding = parseMemoryEmbedding(memory);
  return embedding ? cosineSimilarity(vector, embedding) : 0;
}
