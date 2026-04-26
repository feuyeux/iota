export interface ActiveFile {
  path: string;
  pinned?: boolean;
}

/**
 * Working memory — tracks the set of files actively referenced during a session.
 * Provides single-turn context so the engine knows which paths are currently in
 * scope. Updated after each execution via file_delta events. Not persisted.
 */
export class WorkingMemory {
  private readonly activeFiles = new Map<string, Map<string, ActiveFile>>();
  /** Insertion-order queue for LRU eviction of stale sessions. */
  private readonly sessionOrder: string[] = [];
  private readonly maxSessions: number;

  constructor(maxSessions = 1000) {
    this.maxSessions = maxSessions;
  }

  setActiveFiles(sessionId: string, files: ActiveFile[]): void {
    const map = new Map<string, ActiveFile>();
    for (const f of files) {
      map.set(f.path, f);
    }
    if (!this.activeFiles.has(sessionId)) {
      this.sessionOrder.push(sessionId);
      this.evictIfNeeded();
    }
    this.activeFiles.set(sessionId, map);
  }

  getActiveFiles(sessionId: string): ActiveFile[] {
    return [...(this.activeFiles.get(sessionId)?.values() ?? [])];
  }

  addFiles(sessionId: string, paths: string[]): void {
    let map = this.activeFiles.get(sessionId);
    if (!map) {
      map = new Map();
      this.activeFiles.set(sessionId, map);
      this.sessionOrder.push(sessionId);
      this.evictIfNeeded();
    }
    for (const p of paths) {
      if (!map.has(p)) {
        map.set(p, { path: p, pinned: false });
      }
    }
  }

  clearSession(sessionId: string): void {
    this.activeFiles.delete(sessionId);
    const idx = this.sessionOrder.indexOf(sessionId);
    if (idx !== -1) this.sessionOrder.splice(idx, 1);
  }

  private evictIfNeeded(): void {
    while (this.sessionOrder.length > this.maxSessions) {
      const oldest = this.sessionOrder.shift();
      if (oldest) this.activeFiles.delete(oldest);
    }
  }
}
