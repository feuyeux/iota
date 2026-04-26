export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

/**
 * Normalized hash-based embedding provider.
 * Produces a 1024-dimensional unit vector via deterministic hashing.
 * Used as fallback when no external embedding API is available.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    // Character-level hash spread across dimensions
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // Use multiple hash offsets for better distribution
      vector[(i * 7 + code) % this.dimensions] += code / 255;
      vector[(i * 13 + code * 3) % this.dimensions] += (code ^ 0x5a) / 255;
    }
    // L2 normalize to unit vector
    return normalize(vector);
  }
}

/**
 * Provider priority chain: tries providers in order, falls back to hash.
 */
export class EmbeddingProviderChain implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly providers: EmbeddingProvider[];
  private readonly fallback = new HashEmbeddingProvider();

  constructor(providers: EmbeddingProvider[] = [], targetDimensions?: number) {
    this.providers = providers;
    this.dimensions =
      targetDimensions ?? providers[0]?.dimensions ?? this.fallback.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    for (const provider of this.providers) {
      try {
        const result = await provider.embed(text);
        return normalize(alignDimensions(result, this.dimensions));
      } catch {
        // Try next provider
      }
    }
    return normalize(
      alignDimensions(await this.fallback.embed(text), this.dimensions),
    );
  }
}

/** Pad or truncate a vector to the target number of dimensions */
function alignDimensions(vector: number[], target: number): number[] {
  if (vector.length === target) return vector;
  if (vector.length > target) return vector.slice(0, target);
  // Pad with zeros
  const padded = new Array<number>(target).fill(0);
  for (let i = 0; i < vector.length; i++) padded[i] = vector[i];
  return padded;
}

/** L2 normalize a vector to unit length */
function normalize(vector: number[]): number[] {
  let magnitude = 0;
  for (const v of vector) {
    magnitude += v * v;
  }
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return vector;
  return vector.map((v) => v / magnitude);
}

/** Cosine similarity between two normalized vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Ollama embedding provider. Requires OLLAMA_HOST env var.
 * Uses the /api/embeddings endpoint with a configurable model.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly host: string;
  private readonly model: string;

  constructor(
    options: { host?: string; model?: string; dimensions?: number } = {},
  ) {
    this.host =
      options.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.model = options.model ?? "nomic-embed-text";
    this.dimensions = options.dimensions ?? 768;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.host}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!response.ok) {
      throw new Error(
        `Ollama embedding failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }
}

/**
 * OpenAI-compatible embedding provider.
 * Works with OpenAI, Azure OpenAI, and any OpenAI-API-compatible service.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    options: {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      dimensions?: number;
    } = {},
  ) {
    this.baseUrl =
      options.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1";
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? "text-embedding-3-small";
    this.dimensions = options.dimensions ?? 1536;
    if (!this.apiKey) {
      throw new Error("OpenAI API key is required for OpenAIEmbeddingProvider");
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!response.ok) {
      throw new Error(
        `OpenAI embedding failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0].embedding;
  }
}

/**
 * Create the default embedding provider chain based on available env vars.
 * Priority: OpenAI > Ollama > Hash fallback
 */
export function createDefaultEmbeddingChain(
  targetDimensions?: number,
): EmbeddingProviderChain {
  const providers: EmbeddingProvider[] = [];

  if (process.env.OPENAI_API_KEY) {
    try {
      providers.push(new OpenAIEmbeddingProvider());
    } catch {
      // Skip if construction fails
    }
  }

  if (process.env.OLLAMA_HOST || isOllamaAvailable()) {
    providers.push(new OllamaEmbeddingProvider());
  }

  return new EmbeddingProviderChain(providers, targetDimensions);
}

function isOllamaAvailable(): boolean {
  // Simple heuristic: only add Ollama by default if OLLAMA_HOST is explicitly set
  // to avoid unexpected network calls
  return false;
}
