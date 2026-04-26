import type { MemoryBlock } from "../event/types.js";
import type { EmbeddingProvider } from "./embedding.js";
import { cosineSimilarity } from "./embedding.js";

export interface StoredMemory {
  block: MemoryBlock;
  embedding: number[];
}

export interface RetrievalResult {
  block: MemoryBlock;
  score: number;
}

/**
 * Retrieves relevant memories via embedding similarity search.
 */
export class MemoryRetriever {
  private readonly provider: EmbeddingProvider;
  private readonly store: StoredMemory[];

  constructor(provider: EmbeddingProvider, store: StoredMemory[] = []) {
    this.provider = provider;
    this.store = store;
  }

  /** Add a memory block, computing its embedding. */
  async add(block: MemoryBlock): Promise<void> {
    const embedding = await this.provider.embed(block.content);
    this.store.push({ block, embedding });
  }

  /** Retrieve top-k memories similar to the query. */
  async retrieve(
    query: string,
    limit: number = 5,
    threshold: number = 0.3,
  ): Promise<RetrievalResult[]> {
    if (this.store.length === 0) return [];

    const queryEmbedding = await this.provider.embed(query);

    const scored: RetrievalResult[] = [];
    for (const { block, embedding } of this.store) {
      const score = cosineSimilarity(queryEmbedding, embedding);
      if (score >= threshold) {
        scored.push({
          block: {
            ...block,
            metadata: { ...block.metadata, relevanceScore: score },
          },
          score,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** Current number of stored memories. */
  get size(): number {
    return this.store.length;
  }
}
