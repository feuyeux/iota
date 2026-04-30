import os from "node:os";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "./codex.js";
import type { RuntimeRequest } from "../event/types.js";

const request: RuntimeRequest = {
  sessionId: "session-codex",
  executionId: "execution-codex",
  prompt: "hello",
  workingDirectory: os.tmpdir(),
};

describe("CodexAdapter native event mapper", () => {
  it("maps started MCP tool calls to tool_call", () => {
    const adapter = new CodexAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const event = mapper("codex", request, {
      type: "item.started",
      item: {
        type: "mcp_tool_call",
        id: "call-1",
        server: "iota-fun",
        tool: "fun.python",
        arguments: { prompt: "pet" },
      },
    });

    expect(event?.type).toBe("tool_call");
    expect(event?.data.toolName).toBe("fun.python");
    expect(event?.data.rawToolName).toBe("iota-fun/fun.python");
    expect(event?.data.arguments).toEqual({ prompt: "pet" });
  });

  it("does not emit empty unknown MCP tool calls", () => {
    const adapter = new CodexAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const event = mapper("codex", request, {
      type: "item.started",
      item: { type: "mcp_tool_call" },
    });

    expect(event?.type).toBe("extension");
    expect(event?.data.name).toBe("codex_item");
  });
});
