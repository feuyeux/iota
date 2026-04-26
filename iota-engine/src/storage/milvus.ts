import { MilvusClient, DataType } from "@zilliz/milvus2-sdk-node";
import type { MemoryBlock, MemoryKind } from "../event/types.js";
import type { EmbeddingProvider } from "../memory/embedding.js";

export interface MilvusMemoryConfig {
  address: string;
  collectionName?: string;
  dimension?: number;
}

/**
 * Milvus-backed experiential memory vector store.
 * Section 13.3: episodic, procedural, factual, and strategic memories use Milvus in production.
 */
export class MilvusMemoryStore {
  private client!: MilvusClient;
  private readonly collectionName: string;
  private readonly dimension: number;

  constructor(
    private readonly config: MilvusMemoryConfig,
    private readonly embedder: EmbeddingProvider,
  ) {
    this.collectionName = config.collectionName ?? "iota_memories";
    this.dimension = config.dimension ?? embedder.dimensions;
  }

  async init(): Promise<void> {
    this.client = new MilvusClient({ address: this.config.address });
    await this.ensureCollection();
  }

  private async ensureCollection(): Promise<void> {
    const has = await this.client.hasCollection({
      collection_name: this.collectionName,
    });
    if (has.value) return;

    await this.client.createCollection({
      collection_name: this.collectionName,
      fields: [
        {
          name: "id",
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 64,
        },
        { name: "session_id", data_type: DataType.VarChar, max_length: 64 },
        { name: "content", data_type: DataType.VarChar, max_length: 65535 },
        { name: "type", data_type: DataType.VarChar, max_length: 32 },
        {
          name: "metadata_json",
          data_type: DataType.VarChar,
          max_length: 4096,
        },
        {
          name: "embedding",
          data_type: DataType.FloatVector,
          dim: this.dimension,
        },
        { name: "created_at", data_type: DataType.Int64 },
      ],
    });

    await this.client.createIndex({
      collection_name: this.collectionName,
      field_name: "embedding",
      index_type: "IVF_FLAT",
      metric_type: "COSINE",
      params: { nlist: 128 },
    });

    await this.client.loadCollection({ collection_name: this.collectionName });
  }

  async add(sessionId: string, block: MemoryBlock): Promise<void> {
    const embedding = await this.embedder.embed(block.content);
    await this.client.insert({
      collection_name: this.collectionName,
      data: [
        {
          id: block.id,
          session_id: sessionId,
          content: block.content.slice(0, 65535),
          type: block.type ?? "episodic",
          metadata_json: block.metadata ? JSON.stringify(block.metadata) : "{}",
          embedding,
          created_at: Date.now(),
        },
      ],
    });
  }

  async search(
    sessionId: string,
    query: string,
    limit = 5,
  ): Promise<MemoryBlock[]> {
    const embedding = await this.embedder.embed(query);

    const results = await this.client.search({
      collection_name: this.collectionName,
      vector: embedding,
      filter: `session_id == "${sessionId}"`,
      limit,
      output_fields: ["id", "content", "type", "metadata_json"],
    });

    return results.results.map((r) => ({
      id: String(r.id),
      type: toMemoryKind(String(r.type)),
      content: String(r.content),
      score: r.score,
      metadata: r.metadata_json
        ? (JSON.parse(String(r.metadata_json)) as Record<string, unknown>)
        : undefined,
    }));
  }

  async close(): Promise<void> {
    await this.client?.closeConnection();
  }
}

function toMemoryKind(value: string): MemoryKind | undefined {
  if (
    value === "episodic" ||
    value === "procedural" ||
    value === "factual" ||
    value === "strategic"
  ) {
    return value;
  }
  return undefined;
}
