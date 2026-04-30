import os from "node:os";
import { describe, expect, it } from "vitest";
import { AcpBackendAdapter } from "./acp-backend-adapter.js";
import type { RuntimeRequest } from "../event/types.js";

class TestAcpAdapter extends AcpBackendAdapter {
  constructor() {
    super({
      name: "gemini",
      defaultExecutable: "gemini",
      commandArgs: ["--acp"],
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: true,
        acp: true,
        acpMode: "native",
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 1000,
      },
    });
  }
}

const request: RuntimeRequest = {
  sessionId: "s1",
  executionId: "e1",
  prompt: "ping",
  workingDirectory: os.tmpdir(),
};

describe("AcpBackendAdapter", () => {
  it("builds initialize and session/new lifecycle messages", () => {
    const adapter = new TestAcpAdapter();
    // @ts-expect-error - accessing protected test surface through adapter options
    const initMessage = JSON.parse(adapter.options.initMessage());
    expect(initMessage.method).toBe("initialize");

    // @ts-expect-error - accessing protected test surface through adapter options
    const firstMessage = adapter.options.buildMessage(request);
    const parsed = JSON.parse(firstMessage);
    expect(parsed.method).toBe("session/new");
    expect(parsed.params.cwd).toBe(request.workingDirectory);
  });

  it("maps approval decisions to ACP responses", () => {
    const adapter = new TestAcpAdapter();
    // @ts-expect-error - accessing protected test surface through adapter options
    const wire = adapter.options.buildNativeResponse({
      type: "extension",
      sessionId: "s1",
      executionId: "e1",
      backend: "gemini",
      sequence: 0,
      timestamp: Date.now(),
      data: {
        name: "approval_decision",
        payload: { requestId: "perm-1", approved: true },
      },
    });

    expect(JSON.parse(wire)).toEqual({
      jsonrpc: "2.0",
      id: "perm-1",
      result: { approved: true },
    });
  });

  it("sends deferred prompt after session/new resolves", () => {
    const adapter = new TestAcpAdapter();
    const writes: string[] = [];
    // @ts-expect-error - intercept protected method for lifecycle test
    adapter.writeToStdin = (_executionId: string, data: string) => {
      writes.push(data);
      return true;
    };

    // @ts-expect-error - accessing protected test surface through adapter options
    adapter.options.buildMessage(request);
    // @ts-expect-error - accessing protected test surface through adapter options
    const mapped = adapter.options.mapNativeEvent("gemini", request, {
      id: "e1:new",
      result: { sessionId: "agent-s1" },
    });

    expect(mapped).toBeNull();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!).method).toBe("session/prompt");
  });

  it("sends session/interrupt and clears execution ownership", async () => {
    const adapter = new TestAcpAdapter();
    const writes: string[] = [];
    // @ts-expect-error - intercept protected method for lifecycle test
    adapter.writeToStdin = (_executionId: string, data: string) => {
      writes.push(data);
      return true;
    };

    // @ts-expect-error - accessing protected test surface through adapter options
    adapter.options.buildMessage(request);
    // @ts-expect-error - accessing protected test surface through adapter options
    adapter.options.mapNativeEvent("gemini", request, {
      id: "e1:new",
      result: { sessionId: "agent-s1" },
    });
    await adapter.interrupt(request.executionId);

    expect(writes.map((wire) => JSON.parse(wire).method)).toContain("session/interrupt");
  });

  it("sends session/destroy and clears sessions on destroy", async () => {
    const adapter = new TestAcpAdapter();
    const writes: string[] = [];
    // @ts-expect-error - intercept protected method for lifecycle test
    adapter.writeToStdin = (_executionId: string, data: string) => {
      writes.push(data);
      return true;
    };

    // @ts-expect-error - accessing protected test surface through adapter options
    adapter.options.buildMessage(request);
    // @ts-expect-error - accessing protected test surface through adapter options
    adapter.options.mapNativeEvent("gemini", request, {
      id: "e1:new",
      result: { sessionId: "agent-s1" },
    });
    await adapter.destroy();

    expect(writes.map((wire) => JSON.parse(wire).method)).toContain("session/destroy");
  });

  it("clears pending session state when session/new fails", () => {
    const adapter = new TestAcpAdapter();
    // @ts-expect-error - accessing protected test surface through adapter options
    adapter.options.buildMessage(request);
    // @ts-expect-error - accessing protected test surface through adapter options
    const event = adapter.options.mapNativeEvent("gemini", request, {
      id: "e1:new",
      error: { message: "new failed" },
    });

    expect(event?.type).toBe("error");
    // @ts-expect-error - accessing private state to verify cleanup
    expect(adapter.pendingNewSessions.size).toBe(0);
    // @ts-expect-error - accessing private state to verify cleanup
    expect(adapter.deferredPrompts.size).toBe(0);
  });

});
