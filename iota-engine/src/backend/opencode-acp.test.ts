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

  it("falls back to process.env when no config env provided", async () => {
    const previous = process.env.OPENCODE_MODEL;
    process.env.OPENCODE_MODEL = "env-model";
    const adapter = new OpenCodeAcpAdapter();

    await adapter.init({
      workingDirectory: process.cwd(),
      timeoutMs: 1000,
    });

    expect(adapter.getModel()).toBe("env-model");

    if (previous === undefined) {
      delete process.env.OPENCODE_MODEL;
    } else {
      process.env.OPENCODE_MODEL = previous;
    }
  });

  it("returns undefined model when no env is set", async () => {
    const previous = process.env.OPENCODE_MODEL;
    delete process.env.OPENCODE_MODEL;
    const adapter = new OpenCodeAcpAdapter();

    await adapter.init({
      workingDirectory: process.cwd(),
      timeoutMs: 1000,
    });

    expect(adapter.getModel()).toBeUndefined();

    if (previous !== undefined) {
      process.env.OPENCODE_MODEL = previous;
    }
  });

  it("reports correct capabilities", () => {
    const adapter = new OpenCodeAcpAdapter();
    expect(adapter.capabilities.streaming).toBe(true);
    expect(adapter.capabilities.thinking).toBe(true);
    expect(adapter.capabilities.mcp).toBe(true);
    expect(adapter.capabilities.sandbox).toBe(false);
    expect(adapter.capabilities.multimodal).toBe(false);
    expect(adapter.capabilities.maxContextTokens).toBe(200_000);
    expect(adapter.capabilities.promptOnlyInput).toBe(true);
  });

  it("accepts MCP server descriptors", () => {
    const mcpServers = [
      { name: "test-server", command: "test-cmd", args: [] },
    ];
    const adapter = new OpenCodeAcpAdapter(mcpServers);
    expect(adapter.name).toBe("opencode");
    expect(adapter.capabilities.mcp).toBe(true);
  });

  it("defaults executable to opencode", () => {
    const adapter = new OpenCodeAcpAdapter();
    // @ts-expect-error - accessing protected adapter options in tests
    expect(adapter.options.defaultExecutable).toBe("opencode");
  });
});
