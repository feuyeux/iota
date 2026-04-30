import os from "node:os";
import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "./claude-code.js";
import type { RuntimeRequest } from "../event/types.js";

const request: RuntimeRequest = {
  sessionId: "session-claude",
  executionId: "execution-claude",
  prompt: "hello",
  workingDirectory: os.tmpdir(),
};

describe("ClaudeCodeAdapter native event mapper", () => {
  it("maps named tool_use events to tool_call", () => {
    const adapter = new ClaudeCodeAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const event = mapper("claude-code", request, {
      type: "tool_use",
      id: "call-1",
      name: "Read",
      input: { file_path: "README.md" },
    });

    expect(event?.type).toBe("tool_call");
    expect(event?.data.toolName).toBe("Read");
    expect(event?.data.arguments).toEqual({ file_path: "README.md" });
  });

  it("does not emit empty unknown tool calls", () => {
    const adapter = new ClaudeCodeAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const event = mapper("claude-code", request, { type: "tool_use" });

    expect(event?.type).toBe("extension");
    expect(event?.data.name).toBe("native_event");
  });
});
