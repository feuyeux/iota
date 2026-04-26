import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { switchCommand } from "./switch.js";

describe("switch command", () => {
  it("rejects unknown backends", async () => {
    await expect(switchCommand("unknown")).rejects.toThrow(
      "Unknown backend unknown",
    );
  });

  it("accepts known backends", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "iota-cli-"));
    try {
      await expect(switchCommand("codex", cwd)).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith("Switched default backend to codex.");
      expect(
        fs.readFileSync(path.join(cwd, "iota.config.yaml"), "utf8"),
      ).toContain("defaultBackend: codex");
    } finally {
      log.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
