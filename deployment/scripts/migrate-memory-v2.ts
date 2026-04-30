#!/usr/bin/env bun
import crypto from "node:crypto";
import IoRedis from "ioredis";

type LegacyType = "factual" | "strategic";
type Facet = "domain" | "strategic";

interface Args {
  write: boolean;
  host: string;
  port: number;
  password?: string;
  batchSize: number;
}

const args = parseArgs(process.argv.slice(2));
const redis = new IoRedis({
  host: args.host,
  port: args.port,
  password: args.password,
  lazyConnect: true,
});

try {
  await redis.connect();
  const result = await migrate(args.write, args.batchSize);
  console.log(JSON.stringify({ dryRun: !args.write, ...result }, null, 2));
} finally {
  await redis.quit();
}

async function migrate(write: boolean, batchSize: number): Promise<{
  scanned: number;
  migrated: number;
  skipped: number;
  removedLegacy: number;
}> {
  let scanned = 0;
  let migrated = 0;
  let skipped = 0;
  let removedLegacy = 0;

  for (const legacyType of ["factual", "strategic"] as const) {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `iota:memory:${legacyType}:*`,
        "COUNT",
        String(batchSize),
      );
      cursor = nextCursor;

      for (const key of keys) {
        scanned += 1;
        const data = await redis.hgetall(key);
        if (!data.id || !data.scopeId || !data.content) {
          skipped += 1;
          continue;
        }

        const normalizedType = "semantic";
        const facet = legacyTypeToFacet(legacyType);
        const contentHash = data.contentHash || hashMemoryContent(data.content);
        const semanticKey = `iota:memory:${normalizedType}:${data.id}`;
        const indexKey = memoryIndexKey(normalizedType, data.scopeId, facet);
        const hashKey = memoryHashKey(normalizedType, data.scopeId, facet, contentHash);
        const legacyIndexKey = `iota:memories:${legacyType}:${data.scopeId}`;
        const legacyHashKey = data.contentHash
          ? `iota:memory:hashes:${legacyType}:${data.scopeId}:${data.contentHash}`
          : undefined;
        const score = legacyScore(legacyType, data);
        const ttlMs = ttlFromData(data);

        if (write) {
          const fields: Record<string, string> = {
            ...data,
            type: normalizedType,
            facet,
            contentHash,
          };
          const pipeline = redis.multi();
          pipeline.hset(semanticKey, fields);
          if (ttlMs > 0) pipeline.pexpire(semanticKey, ttlMs);
          pipeline.zadd(indexKey, score, data.id);
          pipeline.sadd(hashKey, data.id);
          if (ttlMs > 0) pipeline.pexpire(hashKey, ttlMs);
          pipeline.zrem(legacyIndexKey, data.id);
          pipeline.del(key);
          if (legacyHashKey) pipeline.srem(legacyHashKey, data.id);
          await pipeline.exec();
          removedLegacy += 1;
        }
        migrated += 1;
      }
    } while (cursor !== "0");
  }

  return { scanned, migrated, skipped, removedLegacy };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    write: false,
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
    batchSize: 100,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--write":
        args.write = true;
        break;
      case "--host":
        args.host = requireValue(argv, ++index, arg);
        break;
      case "--port":
        args.port = Number(requireValue(argv, ++index, arg));
        break;
      case "--password":
        args.password = requireValue(argv, ++index, arg);
        break;
      case "--batch-size":
        args.batchSize = Number(requireValue(argv, ++index, arg));
        break;
      case "--help":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error("--port must be a positive number");
  }
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) {
    throw new Error("--batch-size must be a positive number");
  }
  return args;
}

function requireValue(argv: string[], index: number, name: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun deployment/scripts/migrate-memory-v2.ts [--write]

Options:
  --write              Apply changes. Without this flag the script is dry-run.
  --host <host>        Redis host. Defaults to REDIS_HOST or localhost.
  --port <port>        Redis port. Defaults to REDIS_PORT or 6379.
  --password <value>   Redis password. Defaults to REDIS_PASSWORD.
  --batch-size <n>     SCAN count. Defaults to 100.
`);
  process.exit(0);
}

function legacyTypeToFacet(type: LegacyType): Facet {
  return type === "strategic" ? "strategic" : "domain";
}

function hashMemoryContent(content: string): string {
  return crypto.createHash("md5").update(content.trim()).digest("hex");
}

function memoryIndexKey(type: string, scopeId: string, facet: string): string {
  return `iota:memories:${type}:${scopeId}:${facet}`;
}

function memoryHashKey(
  type: string,
  scopeId: string,
  facet: string,
  contentHash: string,
): string {
  return `iota:memory:hashes:${type}:${scopeId}:${facet}:${contentHash}`;
}

function ttlFromData(data: Record<string, string>): number {
  const expiresAt = Number(data.expiresAt);
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(expiresAt - Date.now(), 1);
}

function legacyScore(type: LegacyType, data: Record<string, string>): number {
  const confidence = Number(data.confidence || "0");
  const timestamp = Number(data.timestamp || data.createdAt || Date.now());
  const weight = type === "strategic" ? 3_000_000_000 : 2_000_000_000;
  return weight + confidence * 1000 + timestamp / 1_000_000;
}
