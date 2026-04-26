import { Client as MinioClient } from "minio";

export interface MinioSnapshotConfig {
  endPoint: string;
  port?: number;
  useSSL?: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

/**
 * MinIO-backed snapshot object store.
 * Section 13.3: Snapshot large objects stored in MinIO in production.
 */
export class MinioSnapshotStore {
  private client!: MinioClient;
  private readonly bucket: string;

  constructor(private readonly config: MinioSnapshotConfig) {
    this.bucket = config.bucket;
  }

  async init(): Promise<void> {
    this.client = new MinioClient({
      endPoint: this.config.endPoint,
      port: this.config.port ?? 9000,
      useSSL: this.config.useSSL ?? false,
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
    });
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  /** Upload a snapshot manifest + data as a JSON object. */
  async putSnapshot(
    sessionId: string,
    executionId: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const key = `snapshots/${sessionId}/${executionId}/${Date.now()}.json`;
    const body = JSON.stringify(data);
    await this.client.putObject(
      this.bucket,
      key,
      Buffer.from(body, "utf8"),
      body.length,
      {
        "Content-Type": "application/json",
      },
    );
    return key;
  }

  /** Get a snapshot by key. */
  async getSnapshot(key: string): Promise<Record<string, unknown> | null> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch (error) {
      const e = error as { code?: string };
      if (e.code === "NoSuchKey") return null;
      throw error;
    }
  }

  /** List snapshot keys for a session. */
  async listSnapshots(sessionId: string): Promise<string[]> {
    const prefix = `snapshots/${sessionId}/`;
    const keys: string[] = [];
    const stream = this.client.listObjectsV2(this.bucket, prefix, true);
    for await (const obj of stream) {
      if (obj.name) keys.push(obj.name);
    }
    return keys;
  }

  /** Delete old snapshots, keeping the most recent `keep` per session. */
  async pruneSnapshots(sessionId: string, keep: number): Promise<number> {
    const keys = await this.listSnapshots(sessionId);
    if (keys.length <= keep) return 0;
    // Keys are date-prefixed so sort descending
    keys.sort().reverse();
    const toDelete = keys.slice(keep);
    for (const key of toDelete) {
      await this.client.removeObject(this.bucket, key);
    }
    return toDelete.length;
  }

  async close(): Promise<void> {
    // MinIO client has no explicit close
  }
}
