import fs from "node:fs";
import path from "node:path";
import ig from "ignore";

/**
 * Section 10.5: File filtering
 * Priority: built-in > .iotaignore > .gitignore
 */

/** Built-in ignore patterns (Section 10.5) */
const BUILTIN_IGNORES = [
  ".git",
  "node_modules",
  "__pycache__",
  "venv",
  ".venv",
  "target",
  "dist",
  ".next",
  ".iota",
];

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = root.replace(/[/\\]+$/, "").toLowerCase();
  const normalizedCandidate = candidate.toLowerCase();
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}\\`) ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

export interface IgnoreFilter {
  ignores(relativePath: string): boolean;
}

/** Create a combined ignore filter for a workspace root */
export function createIgnoreFilter(workspaceRoot: string): IgnoreFilter {
  const filter = ig.default();

  // 1. Built-in ignores (highest priority)
  filter.add(BUILTIN_IGNORES);

  // 2. .iotaignore
  const iotaIgnorePath = path.join(workspaceRoot, ".iotaignore");
  if (fs.existsSync(iotaIgnorePath)) {
    try {
      const content = fs.readFileSync(iotaIgnorePath, "utf8");
      filter.add(content);
    } catch {
      // Non-fatal
    }
  }

  // 3. .gitignore
  const gitIgnorePath = path.join(workspaceRoot, ".gitignore");
  if (fs.existsSync(gitIgnorePath)) {
    try {
      const content = fs.readFileSync(gitIgnorePath, "utf8");
      filter.add(content);
    } catch {
      // Non-fatal
    }
  }

  return {
    ignores(relativePath: string): boolean {
      return filter.ignores(relativePath);
    },
  };
}

/** Check if a filename matches built-in ignore set */
export function isBuiltinIgnored(name: string): boolean {
  return BUILTIN_IGNORES.includes(name);
}

/**
 * Section 10.5: Binary detection
 * A file is considered binary if the first 8192 bytes contain a NUL byte.
 */
export function isBinaryFile(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0x00) {
      return true;
    }
  }
  return false;
}
