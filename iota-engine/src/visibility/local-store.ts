import fs from "node:fs/promises";
import path from "node:path";
import type { VisibilityStore } from "./store.js";
import type {
  ContextManifest,
  EventMappingVisibility,
  ExecutionVisibility,
  ExecutionVisibilitySummary,
  LinkVisibilityRecord,
  MemoryVisibilityRecord,
  TokenLedger,
  TraceSpan,
  VisibilityListOptions,
} from "./types.js";

/**
 * Local file-based VisibilityStore for development/debug.
 *
 * Layout:
 *   <baseDir>/<sessionId>/<executionId>/
 *     context.json
 *     memory.json
 *     tokens.json
 *     link.json
 *     spans.jsonl
 *     mappings.jsonl
 */
export class LocalVisibilityStore implements VisibilityStore {
  constructor(private readonly baseDir: string) {}

  private execDir(sessionId: string, executionId: string): string {
    return path.join(this.baseDir, sessionId, executionId);
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  async saveContextManifest(manifest: ContextManifest): Promise<void> {
    const dir = this.execDir(manifest.sessionId, manifest.executionId);
    await this.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, "context.json"),
      JSON.stringify(manifest, null, 2),
    );
  }

  async saveMemoryVisibility(record: MemoryVisibilityRecord): Promise<void> {
    const dir = this.execDir(record.sessionId, record.executionId);
    await this.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, "memory.json"),
      JSON.stringify(record, null, 2),
    );
  }

  async saveTokenLedger(ledger: TokenLedger): Promise<void> {
    const dir = this.execDir(ledger.sessionId, ledger.executionId);
    await this.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, "tokens.json"),
      JSON.stringify(ledger, null, 2),
    );
  }

  async saveLinkVisibility(record: LinkVisibilityRecord): Promise<void> {
    const dir = this.execDir(record.sessionId, record.executionId);
    await this.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, "link.json"),
      JSON.stringify(record, null, 2),
    );
  }

  async appendTraceSpan(span: TraceSpan): Promise<void> {
    const dir = this.execDir(span.sessionId, span.executionId);
    await this.ensureDir(dir);
    await fs.appendFile(
      path.join(dir, "spans.jsonl"),
      JSON.stringify(span) + "\n",
    );
  }

  async appendEventMapping(mapping: EventMappingVisibility): Promise<void> {
    const dir = this.execDir(mapping.sessionId, mapping.executionId);
    await this.ensureDir(dir);
    await fs.appendFile(
      path.join(dir, "mappings.jsonl"),
      JSON.stringify(mapping) + "\n",
    );
  }

  async getExecutionVisibility(
    executionId: string,
  ): Promise<ExecutionVisibility | null> {
    // Must scan all session dirs to find executionId
    let sessionDirs: string[];
    try {
      sessionDirs = await fs.readdir(this.baseDir);
    } catch {
      return null;
    }

    for (const sessionId of sessionDirs) {
      const dir = this.execDir(sessionId, executionId);
      try {
        await fs.access(dir);
      } catch {
        continue;
      }
      return this.readExecutionVisibility(dir);
    }
    return null;
  }

  async listSessionVisibility(
    sessionId: string,
    options?: VisibilityListOptions,
  ): Promise<ExecutionVisibilitySummary[]> {
    const sessionDir = path.join(this.baseDir, sessionId);
    let execDirs: string[];
    try {
      execDirs = await fs.readdir(sessionDir);
    } catch {
      return [];
    }

    const summaries: ExecutionVisibilitySummary[] = [];
    for (const executionId of execDirs) {
      const dir = this.execDir(sessionId, executionId);
      const [hasContext, hasMemory, hasTokens, hasLink, mappingCount, context] =
        await Promise.all([
          fileExists(path.join(dir, "context.json")),
          fileExists(path.join(dir, "memory.json")),
          fileExists(path.join(dir, "tokens.json")),
          fileExists(path.join(dir, "link.json")),
          countLines(path.join(dir, "mappings.jsonl")),
          readJsonSafe<ContextManifest>(path.join(dir, "context.json")),
        ]);

      const createdAt = context?.createdAt ?? 0;
      if (options?.afterTimestamp && createdAt <= options.afterTimestamp)
        continue;

      summaries.push({
        executionId,
        sessionId,
        backend: context?.backend ?? "claude-code",
        createdAt,
        hasContext,
        hasMemory,
        hasTokens,
        hasLink,
        mappingCount,
      });
    }

    summaries.sort((a, b) => a.createdAt - b.createdAt);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    return summaries.slice(offset, offset + limit);
  }

  /**
   * Remove execution visibility directories older than retentionHours.
   * Uses context.json mtime as the age indicator.
   */
  async gc(retentionHours: number): Promise<{ removed: number }> {
    const cutoff = Date.now() - retentionHours * 3600_000;
    let removed = 0;

    let sessionDirs: string[];
    try {
      sessionDirs = await fs.readdir(this.baseDir);
    } catch {
      return { removed };
    }

    for (const sessionId of sessionDirs) {
      const sessionDir = path.join(this.baseDir, sessionId);
      let stat;
      try {
        stat = await fs.stat(sessionDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let execDirs: string[];
      try {
        execDirs = await fs.readdir(sessionDir);
      } catch {
        continue;
      }

      for (const executionId of execDirs) {
        const dir = path.join(sessionDir, executionId);
        const contextFile = path.join(dir, "context.json");
        try {
          const fileStat = await fs.stat(contextFile);
          if (fileStat.mtimeMs < cutoff) {
            await fs.rm(dir, { recursive: true, force: true });
            removed++;
          }
        } catch {
          // No context.json — check dir mtime as fallback
          try {
            const dirStat = await fs.stat(dir);
            if (dirStat.mtimeMs < cutoff) {
              await fs.rm(dir, { recursive: true, force: true });
              removed++;
            }
          } catch {
            // Already gone
          }
        }
      }

      // Remove empty session dirs
      try {
        const remaining = await fs.readdir(sessionDir);
        if (remaining.length === 0) {
          await fs.rmdir(sessionDir);
        }
      } catch {
        // ignore
      }
    }

    return { removed };
  }

  private async readExecutionVisibility(
    dir: string,
  ): Promise<ExecutionVisibility> {
    const result: ExecutionVisibility = {};
    result.context =
      (await readJsonSafe<ContextManifest>(path.join(dir, "context.json"))) ??
      undefined;
    result.memory =
      (await readJsonSafe<MemoryVisibilityRecord>(
        path.join(dir, "memory.json"),
      )) ?? undefined;
    result.tokens =
      (await readJsonSafe<TokenLedger>(path.join(dir, "tokens.json"))) ??
      undefined;
    result.link =
      (await readJsonSafe<LinkVisibilityRecord>(path.join(dir, "link.json"))) ??
      undefined;

    // Read spans
    const spansFile = path.join(dir, "spans.jsonl");
    if (await fileExists(spansFile)) {
      const content = await fs.readFile(spansFile, "utf-8");
      const spans = content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceSpan);
      result.spans = spans;
      if (result.link) {
        result.link.spans = spans;
      }
    }

    // Read mappings
    const mappingsFile = path.join(dir, "mappings.jsonl");
    if (await fileExists(mappingsFile)) {
      const content = await fs.readFile(mappingsFile, "utf-8");
      result.mappings = content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EventMappingVisibility);
    }

    return result;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function countLines(filePath: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}
