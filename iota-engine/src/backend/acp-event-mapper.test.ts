import os from "node:os";
import { describe, expect, it } from "vitest";
import { mapAcpNotificationToEvent } from "./acp-event-mapper.js";
import type { AcpMessage } from "../protocol/acp.js";
import type { RuntimeRequest } from "../event/types.js";

const request: RuntimeRequest = {
  sessionId: "s1",
  executionId: "e1",
  prompt: "ping",
  workingDirectory: os.tmpdir(),
};

function msg(message: Omit<AcpMessage, "jsonrpc">): AcpMessage {
  return { jsonrpc: "2.0", ...message };
}

describe("mapAcpNotificationToEvent", () => {
  it("maps session/update agent messages to output", () => {
    const event = mapAcpNotificationToEvent(
      "gemini",
      request,
      msg({
        method: "session/update",
        params: {
          sessionId: "agent-s1",
          type: "agent_message",
          content: [{ type: "text", text: "hello" }],
        },
      }),
    );

    expect(event?.type).toBe("output");
    expect(event?.data.content).toBe("hello");
  });

  it("maps permission requests to approval_request extensions", () => {
    const event = mapAcpNotificationToEvent(
      "hermes",
      request,
      msg({
        id: "perm-1",
        method: "session/request_permission",
        params: {
          toolName: "shell",
          arguments: { command: "pwd" },
          description: "run pwd",
        },
      }),
    );

    expect(event?.type).toBe("extension");
    expect(event?.data.name).toBe("approval_request");
    expect(event?.data.payload.requestId).toBe("perm-1");
  });

  it("maps session/complete usage to a final output event", () => {
    const event = mapAcpNotificationToEvent(
      "opencode",
      request,
      msg({
        method: "session/complete",
        params: {
          sessionId: "agent-s1",
          stopReason: "end_turn",
          finalMessage: "done",
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        },
      }),
    );

    expect(event?.type).toBe("output");
    expect(event?.data.final).toBe(true);
    expect(event?.data.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
  });
});
