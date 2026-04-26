import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  createIgnoreFilter,
  isBinaryFile,
  type IgnoreFilter,
} from "./ignore.js";

export interface FileManifestEntry {
  path: string;
  hash: string;
  sizeBytes: number;
  modifiedAt: number;
  binary?: boolean;
  oversized?: boolean;
}

export type WorkspaceManifest = Map<string, FileManifestEntry>;

/** Text files larger than 1MB: record path/hash/size only (Section 10.5) */
const TEXT_SIZE_LIMIT = 1 * 1024 * 1024;
/** Skip files over 10MB entirely */
const ABSOLUTE_SIZE_LIMIT = 10 * 1024 * 1024;

export async function scanWorkspace(root: string): Promise<WorkspaceManifest> {
  const manifest: WorkspaceManifest = new Map();
  const resolvedRoot = path.resolve(root);
  const ignoreFilter = createIgnoreFilter(resolvedRoot);
  await scanDirectory(resolvedRoot, resolvedRoot, manifest, ignoreFilter);
  return manifest;
}

async function scanDirectory(
  root: string,
  directory: string,
  manifest: WorkspaceManifest,
  filter: IgnoreFilter,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return; // Permission denied or other error
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path
      .relative(root, fullPath)
      .replaceAll(path.sep, "/");

    // Check ignore filter
    if (
      filter.ignores(entry.isDirectory() ? `${relativePath}/` : relativePath)
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      await scanDirectory(root, fullPath, manifest, filter);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(fullPath);
    } catch {
      continue;
    }

    // Skip files over absolute limit
    if (stat.size > ABSOLUTE_SIZE_LIMIT) {
      continue;
    }

    // Read file for hashing and binary detection
    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.promises.readFile(fullPath);
    } catch {
      continue;
    }

    const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const binary = isBinaryFile(fileBuffer);

    // Binary or oversized text files: record path/hash/size only (Section 10.5)
    if (binary || stat.size > TEXT_SIZE_LIMIT) {
      manifest.set(relativePath, {
        path: relativePath,
        hash,
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
        binary: binary || undefined,
        oversized: stat.size > TEXT_SIZE_LIMIT || undefined,
      });
      continue;
    }

    manifest.set(relativePath, {
      path: relativePath,
      hash,
      sizeBytes: stat.size,
      modifiedAt: stat.mtimeMs,
    });
  }
}
