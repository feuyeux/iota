import { describe, expect, it, vi } from "vitest";
import { AcpFallbackBackend, BackendPool } from "./pool.js";
import { DEFAULT_CONFIG, type IotaConfig } from "../config/schema.js";
import type {
  BackendConfig,
  BackendSnapshot,
  HealthStatus,
  RuntimeBackend,
} from "./interface.js";
import type {
  BackendName,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
} from "../event/types.js";

function configWithBackendProtocol(
  backend: "claudeCode" | "codex" | "gemini",
  protocol: "native" | "acp" | undefined,
): IotaConfig {
  return {
    ...DEFAULT_CONFIG,
    backend: {
      ...DEFAULT_CONFIG.backend,
      claudeCode: { ...DEFAULT_CONFIG.backend.claudeCode },
      codex: { ...DEFAULT_CONFIG.backend.codex },
      gemini: { ...DEFAULT_CONFIG.backend.gemini },
      hermes: { ...DEFAULT_CONFIG.backend.hermes },
      opencode: { ...DEFAULT_CONFIG.backend.opencode },
      [backend]: {
        ...DEFAULT_CONFIG.backend[backend],
        protocol,
      },
    },
  };
}

describe("ACP backend selection fallback", () => {
  it("keeps legacy native adapter quiet by default when protocol is native", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pool = new BackendPool(
      configWithBackendProtocol("gemini", "native"),
      process.cwd(),
    );

    expect(pool.getCapabilities().gemini.acp).toBe(false);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Using legacy native adapter for gemini"),
    );
    warn.mockRestore();
  });

  it("logs legacy native adapter use when ACP debug logging is enabled", () => {
    const previous = process.env.IOTA_DEBUG_ACP;
    process.env.IOTA_DEBUG_ACP = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    new BackendPool(configWithBackendProtocol("gemini", "native"), process.cwd());

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Using legacy native adapter for gemini"),
    );
    warn.mockRestore();
    if (previous === undefined) {
      delete process.env.IOTA_DEBUG_ACP;
    } else {
      process.env.IOTA_DEBUG_ACP = previous;
    }
  });

  it("selects ACP adapter when protocol is acp", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pool = new BackendPool(
      configWithBackendProtocol("gemini", "acp"),
      process.cwd(),
    );

    expect(pool.getCapabilities().gemini.acp).toBe(true);
    expect(pool.getCapabilities().gemini.acpMode).toBe("native");
    warn.mockRestore();
  });

  it("falls back to native stream when ACP fails before emitting events", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const request: RuntimeRequest = {
      sessionId: "s1",
      executionId: "e1",
      prompt: "ping",
      workingDirectory: process.cwd(),
    };
    const fallbackEvent: RuntimeEvent = {
      type: "output",
      sessionId: "s1",
      executionId: "e1",
      backend: "gemini",
      sequence: 0,
      timestamp: Date.now(),
      data: { role: "assistant", content: "pong", format: "markdown", final: true },
    };
    const acp = new MockBackend("gemini", () => ({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            throw new Error("handshake failed");
          },
        };
      },
    }));
    const native = new MockBackend("gemini", async function* () {
      yield fallbackEvent;
    });
    const backend = new AcpFallbackBackend("gemini", acp, native);

    const events: RuntimeEvent[] = [];
    for await (const event of backend.stream(request)) {
      events.push(event);
    }

    expect(events).toEqual([fallbackEvent]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("falling back to legacy native adapter"),
    );
    warn.mockRestore();
  });

  it("propagates usage from final output in execute", async () => {
    const request: RuntimeRequest = {
      sessionId: "s1",
      executionId: "e1",
      prompt: "ping",
      workingDirectory: process.cwd(),
    };
    const usage = { inputTokens: 1, outputTokens: 2, reasoningTokens: 3 };
    const finalEvent: RuntimeEvent = {
      type: "output",
      sessionId: "s1",
      executionId: "e1",
      backend: "gemini",
      sequence: 0,
      timestamp: Date.now(),
      data: {
        role: "assistant",
        content: "pong",
        format: "markdown",
        final: true,
        usage,
      },
    };
    const acp = new MockBackend("gemini", async function* () {
      yield finalEvent;
    });
    const native = new MockBackend("gemini", () => ({
      [Symbol.asyncIterator]() {
        return { async next() { return { done: true, value: undefined }; } };
      },
    }));
    const backend = new AcpFallbackBackend("gemini", acp, native);

    const response = await backend.execute(request);

    expect(response.usage).toEqual(usage);
    expect(response.output).toBe("pong");
  });


  it("passes model information through from ACP or fallback adapters", () => {
    const acp = new MockBackend("gemini", async function* () {});
    const native = new MockBackend("gemini", async function* () {});
    acp.model = "gemini-acp-model";
    native.model = "gemini-native-model";
    const backend = new AcpFallbackBackend("gemini", acp, native);

    expect(backend.getModel?.()).toBe("gemini-acp-model");

    acp.model = undefined;
    expect(backend.getModel?.()).toBe("gemini-native-model");
  });

  it("rejects native protocol for ACP-only Hermes and OpenCode backends", () => {
    expect(
      () =>
        new BackendPool(
          {
            ...DEFAULT_CONFIG,
            backend: {
              ...DEFAULT_CONFIG.backend,
              hermes: { ...DEFAULT_CONFIG.backend.hermes, protocol: "native" },
            },
          },
          process.cwd(),
        ),
    ).toThrow(/does not provide a native protocol adapter/);
  });

});

class MockBackend implements RuntimeBackend {
  model?: string;
  readonly capabilities = {
    sandbox: false,
    mcp: false,
    mcpResponseChannel: false,
    acp: false,
    streaming: true,
    thinking: false,
    multimodal: false,
    maxContextTokens: 1000,
  };

  constructor(
    readonly name: BackendName,
    private readonly streamImpl: (request: RuntimeRequest) => AsyncIterable<RuntimeEvent>,
  ) {}

  async init(_config: BackendConfig): Promise<void> {}

  stream(request: RuntimeRequest): AsyncIterable<RuntimeEvent> {
    return this.streamImpl(request);
  }

  async execute(request: RuntimeRequest): Promise<RuntimeResponse> {
    const events: RuntimeEvent[] = [];
    for await (const event of this.stream(request)) events.push(event);
    return {
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend: this.name,
      status: "completed",
      output: "",
      events,
    };
  }

  async interrupt(_executionId: string): Promise<void> {}

  async snapshot(sessionId: string): Promise<BackendSnapshot> {
    return { sessionId, backend: this.name, createdAt: Date.now(), payload: {} };
  }

  async probe(): Promise<HealthStatus> {
    return { healthy: true, status: "ready", uptimeMs: 0, activeExecutions: 0 };
  }

  async destroy(): Promise<void> {}

  getModel(): string | undefined {
    return this.model;
  }
}
