import { describe, expect, it } from "vitest";
import { formatTuiEvent } from "./interactive.js";
import type { BackendName, RuntimeEvent } from "@iota/engine";

const backends: BackendName[] = [
  "claude-code",
  "codex",
  "gemini",
  "hermes",
  "opencode",
];

function baseEvent(backend: BackendName): Omit<RuntimeEvent, "type" | "data"> {
  return {
    sessionId: `session-${backend}`,
    executionId: `execution-${backend}`,
    backend,
    sequence: 1,
    timestamp: 1,
  };
}

describe("formatTuiEvent", () => {
  it.each(backends)("renders assistant output for %s", (backend) => {
    const event: RuntimeEvent = {
      ...baseEvent(backend),
      type: "output",
      data: {
        role: "assistant",
        content: `${backend} says hello`,
        format: "markdown",
      },
    };

    expect(formatTuiEvent(event)?.text).toBe(`${backend} says hello`);
  });

  it.each(backends)("renders named tool calls for %s", (backend) => {
    const event: RuntimeEvent = {
      ...baseEvent(backend),
      type: "tool_call",
      data: {
        toolCallId: `tool-${backend}`,
        toolName: "web.fetch",
        rawToolName: "web.fetch",
        arguments: { url: "https://example.com" },
        approvalRequired: false,
      },
    };

    const rendered = formatTuiEvent(event)?.text ?? "";
    expect(rendered).toContain("web.fetch");
    expect(rendered).toContain("example.com");
  });

  it.each(backends)(
    "renders unknown tool calls when arguments identify the work for %s",
    (backend) => {
      const event: RuntimeEvent = {
        ...baseEvent(backend),
        type: "tool_call",
        data: {
          toolCallId: `tool-${backend}`,
          toolName: "unknown",
          rawToolName: "unknown",
          arguments: { command: "pwd" },
          approvalRequired: false,
        },
      };

      const rendered = formatTuiEvent(event)?.text ?? "";
      expect(rendered).toContain("unknown");
      expect(rendered).toContain("pwd");
    },
  );
  it.each(backends)("hides empty unknown tool calls for %s", (backend) => {
    const event: RuntimeEvent = {
      ...baseEvent(backend),
      type: "tool_call",
      data: {
        toolCallId: `tool-${backend}`,
        toolName: "unknown",
        rawToolName: "unknown",
        arguments: {},
        approvalRequired: false,
      },
    };

    expect(formatTuiEvent(event)).toBeUndefined();
  });
});
