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
});
