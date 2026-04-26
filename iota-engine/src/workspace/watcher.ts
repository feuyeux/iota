import fs from "node:fs";
import path from "node:path";
import { isBuiltinIgnored } from "./ignore.js";

export interface WorkspaceWatcher {
  /** Get paths changed since last check */
  getChangedPaths(): string[];
  close(): void;
}

/**
 * Section 10.2: fs watcher as acceleration source (hash scan remains authoritative).
 * Tracks changed paths between hash scans for faster delta detection.
 */
export function createFsWatcher(workspaceRoot: string): WorkspaceWatcher {
  const changedPaths = new Set<string>();
  let watcher: fs.FSWatcher | undefined;

  try {
    watcher = fs.watch(
      workspaceRoot,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;
        const normalized = filename.replaceAll(path.sep, "/");
        // Skip built-in ignored directories
        const firstSegment = normalized.split("/")[0];
        if (firstSegment && isBuiltinIgnored(firstSegment)) return;
        changedPaths.add(normalized);
      },
    );

    watcher.on("error", () => {
      // Non-fatal: watcher is acceleration only
      watcher?.close();
      watcher = undefined;
    });
  } catch {
    // fs.watch may not support recursive on all platforms
  }

  return {
    getChangedPaths(): string[] {
      const paths = [...changedPaths];
      changedPaths.clear();
      return paths;
    },
    close(): void {
      watcher?.close();
      watcher = undefined;
    },
  };
}

/** Noop watcher for environments where fs.watch is unavailable */
export function createNoopWatcher(): WorkspaceWatcher {
  return {
    getChangedPaths(): string[] {
      return [];
    },
    close() {
      return undefined;
    },
  };
}
