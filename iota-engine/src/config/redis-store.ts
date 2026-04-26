import IoRedis from "ioredis";
import type { RedisPubSub } from "../storage/pubsub.js";

type RedisClient = InstanceType<typeof IoRedis.default>;

export type ConfigScope = "global" | "backend" | "session" | "user";

export interface RedisConfigStoreConfig {
  sentinels?: Array<{ host: string; port: number }>;
  masterName?: string;
  password?: string;
  host?: string;
  port?: number;
  /** Optional pub/sub instance for publishing change events. */
  pubsub?: RedisPubSub;
}

/**
 * Redis-backed distributed configuration store.
 *
 * Key layout:
 *   iota:config:global              — Hash (system-wide settings)
 *   iota:config:backend:<name>      — Hash (backend-specific settings)
 *   iota:config:session:<id>        — Hash (session-specific overrides)
 *   iota:config:user:<id>           — Hash (user-specific preferences)
 *
 * Resolution priority (lowest → highest):
 *   global < backend < session < user
 */
export class RedisConfigStore {
  private client!: RedisClient;
  private readonly pubsub?: RedisPubSub;

  constructor(private readonly config: RedisConfigStoreConfig) {
    this.pubsub = config.pubsub;
  }

  async init(): Promise<void> {
    const clientConfig = this.config.sentinels?.length
      ? {
          sentinels: this.config.sentinels,
          name: this.config.masterName ?? "mymaster",
          password: this.config.password,
          lazyConnect: true,
        }
      : {
          host: this.config.host ?? "localhost",
          port: this.config.port ?? 6379,
          password: this.config.password,
          lazyConnect: true,
        };

    this.client = new IoRedis.default(clientConfig);
    await this.client.connect();
  }

  /** Build the Redis key for a given scope. */
  private redisKey(scope: ConfigScope, scopeId?: string): string {
    switch (scope) {
      case "global":
        return "iota:config:global";
      case "backend":
        if (!scopeId) throw new Error("backend scope requires scopeId");
        return `iota:config:backend:${scopeId}`;
      case "session":
        if (!scopeId) throw new Error("session scope requires scopeId");
        return `iota:config:session:${scopeId}`;
      case "user":
        if (!scopeId) throw new Error("user scope requires scopeId");
        return `iota:config:user:${scopeId}`;
    }
  }

  /** Get all key-value pairs for a scope. */
  async get(
    scope: ConfigScope,
    scopeId?: string,
  ): Promise<Record<string, string>> {
    return this.client.hgetall(this.redisKey(scope, scopeId));
  }

  /** Get a single key from a scope. */
  async getKey(
    scope: ConfigScope,
    key: string,
    scopeId?: string,
  ): Promise<string | null> {
    return this.client.hget(this.redisKey(scope, scopeId), key);
  }

  /** Set a key in a scope. Publishes a config change event if pub/sub is configured. */
  async set(
    scope: ConfigScope,
    key: string,
    value: string,
    scopeId?: string,
  ): Promise<void> {
    await this.client.hset(this.redisKey(scope, scopeId), key, value);
    await this.publishChange(scope, key, value, scopeId);
  }

  /** Set multiple keys in a scope at once. */
  async setMany(
    scope: ConfigScope,
    entries: Record<string, string>,
    scopeId?: string,
  ): Promise<void> {
    const redisKey = this.redisKey(scope, scopeId);
    if (Object.keys(entries).length === 0) return;
    await this.client.hset(redisKey, entries);
    // Publish one event per key for granular notifications
    for (const [key, value] of Object.entries(entries)) {
      await this.publishChange(scope, key, value, scopeId);
    }
  }

  /** Delete a key from a scope. */
  async del(scope: ConfigScope, key: string, scopeId?: string): Promise<void> {
    await this.client.hdel(this.redisKey(scope, scopeId), key);
    await this.publishChange(scope, key, null, scopeId);
  }

  /** Delete all keys in a scope. */
  async clear(scope: ConfigScope, scopeId?: string): Promise<void> {
    await this.client.del(this.redisKey(scope, scopeId));
  }

  /**
   * Resolve configuration by merging all applicable scopes.
   * Priority: global < backend < session < user (later overrides earlier).
   */
  async getResolved(
    backendName?: string,
    sessionId?: string,
    userId?: string,
  ): Promise<Record<string, string>> {
    const layers: Record<string, string>[] = [];

    // 1. Global (lowest priority)
    layers.push(await this.get("global"));

    // 2. Backend-specific
    if (backendName) {
      layers.push(await this.get("backend", backendName));
    }

    // 3. Session-specific
    if (sessionId) {
      layers.push(await this.get("session", sessionId));
    }

    // 4. User-specific (highest priority)
    if (userId) {
      layers.push(await this.get("user", userId));
    }

    // Merge layers
    const result: Record<string, string> = {};
    for (const layer of layers) {
      for (const [key, value] of Object.entries(layer)) {
        if (value !== undefined && value !== "") {
          result[key] = value;
        }
      }
    }
    return result;
  }

  /** List all keys matching a scope pattern (useful for admin/debug). */
  async listScopes(scope: ConfigScope): Promise<string[]> {
    if (scope === "global") return ["global"];
    const pattern = `iota:config:${scope}:*`;
    const prefix = `iota:config:${scope}:`;
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, found] = await this.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      for (const key of found) {
        keys.push(key.slice(prefix.length));
      }
    } while (cursor !== "0");
    return keys;
  }

  async close(): Promise<void> {
    await this.client?.quit();
  }

  private async publishChange(
    scope: ConfigScope,
    key: string,
    value: unknown,
    scopeId?: string,
  ): Promise<void> {
    if (!this.pubsub) return;
    try {
      await this.pubsub.publishConfigChange({
        key,
        value,
        scope,
        scopeId,
        timestamp: Date.now(),
      });
    } catch {
      // Non-fatal: pub/sub failure should not block config writes
    }
  }
}
