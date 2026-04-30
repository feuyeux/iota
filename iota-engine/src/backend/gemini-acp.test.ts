import { describe, expect, it } from "vitest";
import { GeminiAcpAdapter } from "./gemini-acp.js";

describe("GeminiAcpAdapter", () => {
  it("uses native --acp mode by default", () => {
    const adapter = new GeminiAcpAdapter();
    expect(adapter.name).toBe("gemini");
    expect(adapter.capabilities.acp).toBe(true);
    expect(adapter.capabilities.acpMode).toBe("native");
    // @ts-expect-error - accessing protected adapter options in tests
    expect(adapter.options.buildArgs()).toEqual(["--acp"]);
  });

  it("merges configured ACP args", () => {
    const adapter = new GeminiAcpAdapter([], ["--acp", "--experimental"]);
    // @ts-expect-error - accessing protected adapter options in tests
    expect(adapter.options.buildArgs()).toEqual(["--acp", "--experimental"]);
  });
});
