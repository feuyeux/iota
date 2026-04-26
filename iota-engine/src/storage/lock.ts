import type { LockLease, StorageBackend } from "./interface.js";

export async function withLock<T>(
  storage: StorageBackend,
  key: string,
  ttlMs: number,
  callback: (lease: LockLease) => Promise<T>,
): Promise<T | null> {
  const lease = await storage.acquireLock(key, ttlMs);
  if (!lease) {
    return null;
  }

  try {
    return await callback(lease);
  } finally {
    await storage.releaseLock(lease);
  }
}
