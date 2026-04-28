import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { GeminiAdapter } from "./gemini.js";
import type { RuntimeRequest } from "../event/types.js";

describe("GeminiAdapter", () => {
  const mockRequest: RuntimeRequest = {
    sessionId: "session-123",
    executionId: "exec-456",
    prompt: "hello",
    workingDirectory: os.tmpdir(),
  };

  it("should have correct capabilities", () => {
    const adapter = new GeminiAdapter();
    expect(adapter.name).toBe("gemini");
    expect(adapter.capabilities.streaming).toBe(true);
    expect(adapter.capabilities.promptOnlyInput).toBe(true);
  });

  it("should build headless prompt args", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const args = adapter.options.buildArgs(mockRequest);
    expect(args).toEqual([
      "--output-format",
      "stream-json",
      "--skip-trust",
      "--prompt",
      "hello",
    ]);
  });

  it("should map init event correctly", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "init",
      model: "gemini-1.5-pro",
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("extension");
    expect(event?.data.name).toBe("gemini_init");
    expect(event?.data.payload.model).toBe("gemini-1.5-pro");
  });

  it("should map message event correctly", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "message",
      content: "hello world",
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("output");
    expect(event?.data.content).toBe("hello world");
  });

  it("should map result event with usageMetadata (legacy/API style)", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "result",
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("output");
    expect(event?.data.final).toBe(true);
    expect(event?.data.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
  });

  it("should map result event with stats (current CLI style)", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "result",
      status: "success",
      stats: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      },
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("output");
    expect(event?.data.final).toBe(true);
    expect(event?.data.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("should map tool_use event correctly", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "tool_use",
      name: "read_file",
      input: { path: "test.txt" },
      id: "call-1",
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("tool_call");
    expect(event?.data.toolName).toBe("read_file");
    expect(event?.data.arguments).toEqual({ path: "test.txt" });
    expect(event?.data.toolCallId).toBe("call-1");
  });

  it("should support visibility collector for tracing", async () => {
    const adapter = new GeminiAdapter();
    const mockVc = {
      startSpan: vi.fn().mockReturnValue("span-1"),
      endSpan: vi.fn(),
      appendNativeEventRef: vi.fn(),
      appendEventMapping: vi.fn(),
      getPolicy: vi.fn().mockReturnValue({
        rawProtocol: "on",
        previewChars: 100,
        redactSecrets: false,
      }),
      getExecutionInfo: vi.fn().mockReturnValue({
        sessionId: "s1",
        executionId: "e1",
        backend: "gemini",
      }),
      setNativeUsage: vi.fn(),
    };

    // @ts-expect-error - inject test visibility collector
    adapter.setVisibilityCollector(mockVc, mockRequest.executionId);

    // Simulate mapping a line with a result event that has stats
    const line = JSON.stringify({
      type: "result",
      status: "success",
      stats: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    // @ts-expect-error - call protected mapLine
    const event = adapter.mapLine(line, mockRequest);

    expect(event?.type).toBe("output");
    expect(event?.data.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });

    // Verify VC was called
    expect(mockVc.appendNativeEventRef).toHaveBeenCalled();
    expect(mockVc.appendEventMapping).toHaveBeenCalled();
    expect(mockVc.setNativeUsage).toHaveBeenCalledWith({
      backend: "gemini",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it("should map thinking/thought event correctly", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "thinking",
      text: "I am thinking about the workspace...",
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("extension");
    expect(event?.data.name).toBe("thinking");
    expect(event?.data.payload.text).toBe(
      "I am thinking about the workspace...",
    );
  });

  it("should map tool_result event correctly", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "tool_result",
      id: "call-1",
      output: "file content here",
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("tool_result");
    expect(event?.data.toolCallId).toBe("call-1");
    expect(event?.data.output).toBe("file content here");
    expect(event?.data.status).toBe("success");
  });

  it("should map error event correctly", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "error",
      error: "something went wrong",
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("error");
    expect(event?.data.message).toBe("something went wrong");
  });

  it("should map unknown events to native_event extension", () => {
    const adapter = new GeminiAdapter();
    // @ts-expect-error - accessing protected options for testing
    const mapper = adapter.options.mapNativeEvent;
    const nativeEvent = {
      type: "unknown_future_event",
      foo: "bar",
    };
    const event = mapper("gemini", mockRequest, nativeEvent);
    expect(event?.type).toBe("extension");
    expect(event?.data.name).toBe("native_event");
    expect(event?.data.payload.foo).toBe("bar");
  });
});
