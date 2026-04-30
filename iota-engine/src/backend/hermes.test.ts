import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { prepareHermesBackendConfig } from "./hermes-config.js";
import type { BackendConfig } from "./interface.js";

describe("HermesAdapter distributed config", () => {
  const baseConfig: BackendConfig = {
    executable: "hermes",
    workingDirectory: os.tmpdir(),
    timeoutMs: 60_000,
    env: {},
  };

  it("leaves Hermes default config untouched when no Redis env is set", () => {
    const prepared = prepareHermesBackendConfig(baseConfig);

    expect(prepared.config).toBe(baseConfig);
    expect(prepared.generatedHermesHome).toBeUndefined();
  });

  it("translates HERMES env to an isolated minimax-cn Hermes home", () => {
    const prepared = prepareHermesBackendConfig({
      ...baseConfig,
      env: {
        HERMES_API_KEY: "test-key",
        HERMES_BASE_URL: "https://api.minimaxi.com/anthropic",
        HERMES_MODEL: "MiniMax-M2.7",
      },
    });

    try {
      expect(prepared.generatedHermesHome).toBeTruthy();
      expect(prepared.config.env?.HERMES_HOME).toBe(
        prepared.generatedHermesHome,
      );
      expect(prepared.config.env?.HERMES_INFERENCE_PROVIDER).toBe("minimax-cn");
      expect(prepared.config.env?.MINIMAX_CN_API_KEY).toBe("test-key");
      expect(prepared.config.env?.MINIMAX_CN_BASE_URL).toBe(
        "https://api.minimaxi.com/anthropic",
      );

      const home = prepared.generatedHermesHome!;
      const configYaml = yaml.load(
        fs.readFileSync(path.join(home, "config.yaml"), "utf8"),
      ) as { model: { default: string; provider: string; base_url: string } };
      expect(configYaml.model).toEqual({
        default: "MiniMax-M2.7",
        provider: "minimax-cn",
        base_url: "https://api.minimaxi.com/anthropic",
      });
      expect(fs.existsSync(path.join(home, ".env"))).toBe(false);
    } finally {
      if (prepared.generatedHermesHome) {
        fs.rmSync(prepared.generatedHermesHome, {
          recursive: true,
          force: true,
        });
      }
    }
  });
});
