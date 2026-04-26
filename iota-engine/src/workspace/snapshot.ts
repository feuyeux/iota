import fs from "node:fs";
import path from "node:path";
import type {
  BackendName,
  McpServerDescriptor,
  Message,
} from "../event/types.js";
import type { FileManifestEntry, WorkspaceManifest } from "./hash-scan.js";

export interface WorkspaceSnapshot {
  snapshotId: string;
  sessionId: string;
  createdAt: number;
  workingDirectory: string;
  activeBackend: BackendName;
  conversationHistory: Message[];
  activeTools: string[];
  mcpServers: McpServerDescriptor[];
  fileManifest: FileManifestEntry[];
  metadata: Record<string, unknown>;
  manifestPath?: string;
}

export function createWorkspaceSnapshot(
  input: Omit<WorkspaceSnapshot, "snapshotId" | "createdAt" | "manifestPath">,
): WorkspaceSnapshot {
  return {
    ...input,
    snapshotId: cryptoRandomId(),
    createdAt: Date.now(),
  };
}

export async function writeWorkspaceSnapshot(
  iotaHome: string,
  snapshot: WorkspaceSnapshot,
  manifest: WorkspaceManifest,
): Promise<WorkspaceSnapshot> {
  const workspaceRoot = path.join(iotaHome, "workspaces", snapshot.sessionId);
  const snapshotDir = path.join(workspaceRoot, "snapshots");
  await fs.promises.mkdir(snapshotDir, { recursive: true });

  const manifestPath = path.join(
    snapshotDir,
    `${snapshot.snapshotId}.manifest.json`,
  );
  await fs.promises.writeFile(
    manifestPath,
    JSON.stringify([...manifest.values()], null, 2),
    "utf8",
  );

  const complete = { ...snapshot, manifestPath };
  await fs.promises.writeFile(
    path.join(workspaceRoot, "manifest.json"),
    JSON.stringify(complete, null, 2),
    "utf8",
  );

  // Keep only last 5 snapshots (Section 10.4)
  await pruneSnapshots(snapshotDir, 5);

  return complete;
}

export async function appendDeltaJournal(
  iotaHome: string,
  sessionId: string,
  executionId: string,
  deltas: unknown[],
): Promise<string> {
  const deltaDir = path.join(iotaHome, "workspaces", sessionId, "deltas");
  await fs.promises.mkdir(deltaDir, { recursive: true });
  const deltaPath = path.join(deltaDir, `${executionId}.jsonl`);
  if (deltas.length > 0) {
    await fs.promises.appendFile(
      deltaPath,
      deltas.map((delta) => JSON.stringify(delta)).join("\n") + "\n",
      "utf8",
    );
  } else {
    await fs.promises.writeFile(deltaPath, "", { flag: "a" });
  }
  return deltaPath;
}

async function pruneSnapshots(
  snapshotDir: string,
  keep: number,
): Promise<void> {
  try {
    const entries = await fs.promises.readdir(snapshotDir);
    const manifestFiles = entries
      .filter((f) => f.endsWith(".manifest.json"))
      .sort();
    if (manifestFiles.length > keep) {
      const toRemove = manifestFiles.slice(0, manifestFiles.length - keep);
      await Promise.all(
        toRemove.map((f) =>
          fs.promises.unlink(path.join(snapshotDir, f)).catch(() => {}),
        ),
      );
    }
  } catch {
    // Non-fatal: directory may not exist yet
  }
}

function cryptoRandomId(): string {
  return `snap_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
