import { describe, expect, it } from "vitest";
import { HermesAdapter } from "./hermes.js";

describe("Hermes ACP adapter", () => {
  it("uses native hermes acp command", () => {
    const adapter = new HermesAdapter();
    expect(adapter.name).toBe("hermes");
    expect(adapter.capabilities.acp).toBe(true);
    expect(adapter.capabilities.acpMode).toBe("native");
    // @ts-expect-error - accessing protected adapter options in tests
    expect(adapter.options.buildArgs()).toEqual(["acp"]);
  });
});
