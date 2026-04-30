import { describe, expect, it } from "vitest";
import { CodexAcpAdapter } from "./codex-acp.js";

describe("CodexAcpAdapter", () => {
  it("uses adapter-backed ACP command args", () => {
    const adapter = new CodexAcpAdapter([], ["@example/codex-acp"]);
    expect(adapter.name).toBe("codex");
    expect(adapter.capabilities.acp).toBe(true);
    expect(adapter.capabilities.acpMode).toBe("adapter");
    // @ts-expect-error - accessing protected adapter options in tests
    expect(adapter.options.buildArgs()).toEqual(["@example/codex-acp"]);
  });
});
