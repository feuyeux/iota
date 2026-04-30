import { describe, expect, it } from "vitest";
import { ClaudeCodeAcpAdapter } from "./claude-acp.js";

describe("ClaudeCodeAcpAdapter", () => {
  it("uses adapter-backed ACP command args", () => {
    const adapter = new ClaudeCodeAcpAdapter([], ["@example/claude-acp", "--verbose"]);
    expect(adapter.name).toBe("claude-code");
    expect(adapter.capabilities.acp).toBe(true);
    expect(adapter.capabilities.acpMode).toBe("adapter");
    // @ts-expect-error - accessing protected adapter options in tests
    expect(adapter.options.buildArgs()).toEqual(["@example/claude-acp", "--verbose"]);
  });
});
