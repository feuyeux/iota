import { describe, expect, it } from "vitest";
import { BackendPool } from "./pool.js";
import { DEFAULT_CONFIG, type IotaConfig } from "../config/schema.js";

function configWithProtocol(
  backend: keyof IotaConfig["backend"],
  protocol: string | undefined,
): IotaConfig {
  return {
    ...DEFAULT_CONFIG,
    backend: {
      ...DEFAULT_CONFIG.backend,
      claudeCode: { ...DEFAULT_CONFIG.backend.claudeCode },
      codex: { ...DEFAULT_CONFIG.backend.codex },
      gemini: { ...DEFAULT_CONFIG.backend.gemini },
      hermes: { ...DEFAULT_CONFIG.backend.hermes },
      opencode: { ...DEFAULT_CONFIG.backend.opencode },
      [backend]: {
        ...DEFAULT_CONFIG.backend[backend],
        protocol,
      },
    },
  } as IotaConfig;
}

describe("ACP-only backend selection", () => {
  it.each([
    ["claude-code", "claudeCode"],
    ["codex", "codex"],
    ["gemini", "gemini"],
    ["hermes", "hermes"],
    ["opencode", "opencode"],
  ] as const)("uses an ACP adapter for %s", (_name, section) => {
    const pool = new BackendPool(
      configWithProtocol(section, "acp"),
      process.cwd(),
    );

    expect(pool.getCapabilities()[_name].acp).toBe(true);
    expect(pool.getCapabilities()[_name].mcpResponseChannel).toBe(true);
  });

  it.each([
    ["claude-code", "claudeCode"],
    ["codex", "codex"],
    ["gemini", "gemini"],
    ["hermes", "hermes"],
    ["opencode", "opencode"],
  ] as const)("rejects native protocol config for %s", (_name, section) => {
    expect(() => {
      new BackendPool(configWithProtocol(section, "native"), process.cwd());
    }).toThrow(/only supports ACP protocol/);
  });
});
