import { describe, expect, it } from "vitest";
import { eventToAppDeltas } from "./websocket.js";

const backends = [
  "claude-code",
  "codex",
  "gemini",
  "hermes",
  "opencode",
] as const;

describe("eventToAppDeltas", () => {
  it.each(backends)(
    "does not create App tool cards for empty unknown tool calls from %s",
    (backend) => {
      const deltas = eventToAppDeltas("exec-unknown", {
        type: "tool_call",
        sessionId: "session-1",
        executionId: "exec-unknown",
        backend,
        sequence: 1,
        timestamp: 1,
        data: {
          toolCallId: "call-1",
          toolName: "unknown",
          rawToolName: "unknown",
          arguments: {},
          approvalRequired: false,
        },
      });

      expect(deltas).toEqual([]);
    },
  );

  it.each(backends)(
    "keeps App tool cards for named tool calls from %s",
    (backend) => {
      const deltas = eventToAppDeltas("exec-tool", {
        type: "tool_call",
        sessionId: "session-1",
        executionId: "exec-tool",
        backend,
        sequence: 2,
        timestamp: 2,
        data: {
          toolCallId: "call-2",
          toolName: "web.fetch",
          rawToolName: "web.fetch",
          arguments: { url: "https://example.com" },
          approvalRequired: false,
        },
      });

      const conversation = deltas.find(
        (delta) => delta.type === "conversation_delta",
      );
      expect(conversation?.item.metadata?.toolCall).toEqual({
        name: "web.fetch",
        arguments: { url: "https://example.com" },
      });
    },
  );
});
