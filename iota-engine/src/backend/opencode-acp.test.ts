import { describe, expect, it } from "vitest";
import { OpenCodeAcpAdapter } from "./opencode-acp.js";

function envFor(adapter: OpenCodeAcpAdapter): Record<string, string> | undefined {
  // @ts-expect-error - accessing protected test surface through adapter config
  return adapter.config?.env;
}

describe("OpenCodeAcpAdapter", () => {
  it("uses native opencode acp mode", () => {
    const adapter = new OpenCodeAcpAdapter();
    expect(adapter.name).toBe("opencode");
    expect(adapter.capabilities.acp).toBe(true);
    expect(adapter.capabilities.acpMode).toBe("native");
    expect(adapter.capabilities.mcpResponseChannel).toBe(true);
    // @ts-expect-error - accessing protected adapter options in tests
    expect(adapter.options.buildArgs()).toEqual(["acp"]);
  });

  it("reads the configured model from backend env", async () => {
    const previous = process.env.OPENCODE_MODEL;
    process.env.OPENCODE_MODEL = "ambient-model";
    const adapter = new OpenCodeAcpAdapter();

    await adapter.init({
      workingDirectory: process.cwd(),
      timeoutMs: 1000,
      env: { OPENCODE_MODEL: "configured-model" },
    });

    expect(adapter.getModel()).toBe("configured-model");
    expect(envFor(adapter)?.OPENCODE_MODEL).toBe("configured-model");

    if (previous === undefined) {
      delete process.env.OPENCODE_MODEL;
    } else {
      process.env.OPENCODE_MODEL = previous;
    }
  });
});
