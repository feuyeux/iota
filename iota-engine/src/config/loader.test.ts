import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  exportConfig,
  importConfigToRedis,
  loadConfig,
  setConfigValue,
} from "./loader.js";
import type { RedisConfigStore } from "./redis-store.js";

describe("config loader", () => {
  it("writes project config values and merges defaults", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "iota-config-"));
    try {
      await setConfigValue("routing.defaultBackend", "codex", {
        cwd,
        createIfMissing: true,
      });
      const config = await loadConfig({ cwd, env: {} });
      expect(config.routing.defaultBackend).toBe("codex");
      expect(config.backend.claudeCode.executable).toBe("claude");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("loads backend env from distributed config overlays", async () => {
    const store = {
      getResolved: async () => ({
        "backend.codex.env.OPENAI_API_KEY": "sk-test",
        "backend.codex.env.OPENAI_MODEL": "gpt-test",
      }),
    } as unknown as RedisConfigStore;

    const config = await loadConfig({ env: {}, redisConfigStore: store });

    expect(config.backend.codex.env.OPENAI_API_KEY).toBe("sk-test");
    expect(config.backend.codex.env.OPENAI_MODEL).toBe("gpt-test");
  });

  it("exports config and imports flattened values into redis store", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "iota-config-export-"));
    const file = path.join(cwd, "config.yaml");
    const setMany = vi.fn().mockResolvedValue(undefined);

    try {
      const config = await loadConfig({ cwd, env: {} });
      await exportConfig(config, file);
      const count = await importConfigToRedis(file, {
        setMany,
      } as unknown as RedisConfigStore);

      expect(count).toBeGreaterThan(0);
      expect(setMany).toHaveBeenCalledWith(
        "global",
        expect.objectContaining({
          "routing.defaultBackend": expect.any(String),
        }),
      );
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects importing non-object config documents", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "iota-config-import-"));
    const file = path.join(cwd, "bad.yaml");

    try {
      fs.writeFileSync(file, "- invalid\n- config\n", "utf8");
      await expect(
        importConfigToRedis(file, {
          setMany: vi.fn(),
        } as unknown as RedisConfigStore),
      ).rejects.toThrow("Config file must contain an object");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
