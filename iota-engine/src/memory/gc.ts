import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type LoadConfigOptions } from "../config/loader.js";
import { RedisStorage } from "../storage/redis.js";

export interface GcResult {
  removedMemories: number;
  removedEvents: number;
  removedAuditEntries: number;
  removedSnapshots: number;
}

export async function runMemoryGc(
  options: LoadConfigOptions = {},
): Promise<GcResult> {
  const config = await loadConfig(options);
  const redisCfg =
    config.engine.mode === "production"
      ? config.storage.production.redis
      : config.storage.development.redis;
  const storage = new RedisStorage({
    sentinels: redisCfg.sentinels.length > 0 ? redisCfg.sentinels : undefined,
    masterName: redisCfg.masterName,
    password: redisCfg.password,
    host: redisCfg.host ?? "localhost",
    port: redisCfg.port ?? 6379,
    streamPrefix: redisCfg.streamPrefix,
  });
  await storage.init();
  try {
    const retentionMs = config.engine.eventRetentionHours * 60 * 60 * 1000;
    const removed = await storage.gc(retentionMs);

    // Also GC old workspace snapshots
    const iotaHome = path.resolve(
      expandHome(options.env?.IOTA_HOME ?? process.env.IOTA_HOME ?? "~/.iota"),
    );
    const removedSnapshots = await gcWorkspaceSnapshots(iotaHome, 5);

    return {
      removedMemories: removed.removedMemories,
      removedEvents: removed.removedEvents,
      removedAuditEntries: removed.removedAuditEntries,
      removedSnapshots,
    };
  } finally {
    await storage.close();
  }
}

async function gcWorkspaceSnapshots(
  iotaHome: string,
  keepPerSession: number,
): Promise<number> {
  const workspacesDir = path.join(iotaHome, "workspaces");
  let removed = 0;
  try {
    const sessions = await fs.promises.readdir(workspacesDir);
    for (const sessionId of sessions) {
      const snapshotDir = path.join(workspacesDir, sessionId, "snapshots");
      try {
        const files = await fs.promises.readdir(snapshotDir);
        const manifests = files
          .filter((f) => f.endsWith(".manifest.json"))
          .sort();
        if (manifests.length > keepPerSession) {
          const toRemove = manifests.slice(
            0,
            manifests.length - keepPerSession,
          );
          for (const file of toRemove) {
            await fs.promises
              .unlink(path.join(snapshotDir, file))
              .catch(() => {});
            removed += 1;
          }
        }
      } catch {
        // No snapshots dir
      }
    }
  } catch {
    // No workspaces dir
  }
  return removed;
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\"))
    return path.join(os.homedir(), input.slice(2));
  return input;
}
