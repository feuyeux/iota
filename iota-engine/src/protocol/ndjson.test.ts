import { describe, expect, it } from "vitest";
import { encodeNdjson, parseNdjsonLine } from "./ndjson.js";

describe("ndjson protocol helpers", () => {
  it("encodes and parses one JSON line", () => {
    const frame = encodeNdjson({ type: "message", content: "hello" });
    expect(frame.endsWith("\n")).toBe(true);
    expect(parseNdjsonLine(frame.trim())).toEqual({
      type: "message",
      content: "hello",
    });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseNdjsonLine("{")).toThrow("Invalid NDJSON frame");
  });
});
