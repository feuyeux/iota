import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWorkspacePath } from "./path-guard.js";

describe("workspace path guard", () => {
  it("accepts paths inside the workspace", () => {
    const root = path.resolve("repo");
    expect(checkWorkspacePath(root, "src/index.ts").insideRoot).toBe(true);
  });

  it("rejects paths outside the workspace", () => {
    const root = path.resolve("repo");
    expect(checkWorkspacePath(root, "../outside.txt").insideRoot).toBe(false);
  });
});
