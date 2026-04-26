import { describe, expect, it } from "vitest";
import { SubprocessBackendAdapter } from "./subprocess.js";
import type {
  BackendName,
  RuntimeEvent,
  RuntimeRequest,
} from "../event/types.js";

class FastExitAdapter extends SubprocessBackendAdapter {
  constructor() {
    super({
      name: "gemini",
      defaultExecutable: process.execPath,
      processMode: "per-execution",
      capabilities: {
        sandbox: false,
        mcp: false,
        mcpResponseChannel: false,
        acp: false,
        streaming: true,
        thinking: false,
        multimodal: false,
        maxContextTokens: 1000,
      },
      buildArgs: () => [
        "-e",
        'process.stdout.write(JSON.stringify({type:"message",content:"pong"}) + "\\n");',
      ],
      mapNativeEvent: mapFastExitEvent,
    });
  }
}

describe("SubprocessBackendAdapter", () => {
  it("completes per-execution streams when the child exits immediately", async () => {
    const adapter = new FastExitAdapter();
    await adapter.init({ workingDirectory: process.cwd(), timeoutMs: 1000 });

    const request: RuntimeRequest = {
      sessionId: "s1",
      executionId: "e1",
      backend: "gemini",
      prompt: "ping",
      workingDirectory: process.cwd(),
    };

    const events = await collectWithTimeout(adapter.stream(request), 1000);
    await adapter.destroy();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("output");
    expect(events[0]?.data.content).toBe("pong");
  });
});

function mapFastExitEvent(
  backend: BackendName,
  request: RuntimeRequest,
  value: Record<string, unknown>,
): RuntimeEvent | null {
  if (value.type !== "message") return null;
  return {
    type: "output",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: {
      role: "assistant",
      content: String(value.content ?? ""),
      format: "text",
    },
  };
}

async function collectWithTimeout<T>(
  iterable: AsyncIterable<T>,
  timeoutMs: number,
): Promise<T[]> {
  return await Promise.race([
    (async () => {
      const items: T[] = [];
      for await (const item of iterable) {
        items.push(item);
      }
      return items;
    })(),
    new Promise<T[]>((_, reject) => {
      setTimeout(() => reject(new Error("stream timed out")), timeoutMs);
    }),
  ]);
}
