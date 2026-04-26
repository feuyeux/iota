import type { BackendName, FileDeltaEvent } from "../event/types.js";
import type { WorkspaceManifest } from "./hash-scan.js";

export function diffManifests(
  before: WorkspaceManifest,
  after: WorkspaceManifest,
  base: {
    sessionId: string;
    executionId: string;
    backend: BackendName;
  },
): Omit<FileDeltaEvent, "sequence" | "timestamp">[] {
  const events: Omit<FileDeltaEvent, "sequence" | "timestamp">[] = [];

  for (const [filePath, beforeEntry] of before) {
    const afterEntry = after.get(filePath);
    if (!afterEntry) {
      events.push({
        type: "file_delta",
        ...base,
        data: {
          path: filePath,
          operation: "deleted",
          hashBefore: beforeEntry.hash,
          sizeBytes: beforeEntry.sizeBytes,
        },
      });
      continue;
    }
    if (beforeEntry.hash !== afterEntry.hash) {
      events.push({
        type: "file_delta",
        ...base,
        data: {
          path: filePath,
          operation: "modified",
          hashBefore: beforeEntry.hash,
          hashAfter: afterEntry.hash,
          sizeBytes: afterEntry.sizeBytes,
        },
      });
    }
  }

  for (const [filePath, afterEntry] of after) {
    if (!before.has(filePath)) {
      events.push({
        type: "file_delta",
        ...base,
        data: {
          path: filePath,
          operation: "created",
          hashAfter: afterEntry.hash,
          sizeBytes: afterEntry.sizeBytes,
        },
      });
    }
  }

  return events;
}
