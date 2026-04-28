import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IotaEngine } from "./engine.js";
import type { RuntimeBackend } from "./backend/interface.js";
import type {
  ExecutionRecord,
  LockLease,
  SessionRecord,
  StorageBackend,
} from "./storage/interface.js";
import type { RuntimeEvent } from "./event/types.js";

class MemoryStorage implements StorageBackend {
  private sessions = new Map<string, SessionRecord>();
  private executions = new Map<string, ExecutionRecord>();
  private events = new Map<string, RuntimeEvent[]>();

  async init(): Promise<void> {}

  async createSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.id, record);
  }

  async updateSession(
    record: Partial<SessionRecord> & { id: string },
  ): Promise<void> {
    const existing = this.sessions.get(record.id);
    if (!existing) return;
    this.sessions.set(record.id, { ...existing, ...record });
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async appendEvent(event: RuntimeEvent): Promise<void> {
    const items = this.events.get(event.executionId) ?? [];
    items.push(event);
    this.events.set(event.executionId, items);
  }

  async readEvents(
    executionId: string,
    afterSequence = 0,
  ): Promise<RuntimeEvent[]> {
    return (this.events.get(executionId) ?? []).filter(
      (event) => event.sequence > afterSequence,
    );
  }

  async createExecution(record: ExecutionRecord): Promise<void> {
    this.executions.set(record.executionId, record);
  }

  async updateExecution(record: ExecutionRecord): Promise<void> {
    this.executions.set(record.executionId, record);
  }

  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    return this.executions.get(executionId) ?? null;
  }

  async listSessionExecutions(sessionId: string): Promise<ExecutionRecord[]> {
    return [...this.executions.values()].filter(
      (item) => item.sessionId === sessionId,
    );
  }

  async acquireLock(key: string, ttlMs: number): Promise<LockLease | null> {
    return { key, token: 1, expiresAt: Date.now() + ttlMs };
  }

  async renewLock(_lease: LockLease, _ttlMs: number): Promise<boolean> {
    return true;
  }

  async releaseLock(_lease: LockLease): Promise<boolean> {
    return true;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async close(): Promise<void> {}
}

describe("IotaEngine fun integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not short-circuit fun prompts in the engine", async () => {
    const storage = new MemoryStorage();
    const engine = new IotaEngine({
      storage,
      cwd: path.resolve(__dirname, ".."),
      workingDirectory: path.resolve(__dirname, ".."),
    });
    await engine.init();

    const sessionId = "session-fun";
    await storage.createSession({
      id: sessionId,
      workingDirectory: path.resolve(__dirname, ".."),
      activeBackend: "claude-code",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const backend: RuntimeBackend = {
      name: "claude-code",
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: false,
        acp: false,
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 200_000,
        promptOnlyInput: true,
      },
      async init() {},
      async *stream(request) {
        yield {
          type: "output",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: "claude-code",
          sequence: 0,
          timestamp: Date.now(),
          data: {
            role: "assistant",
            content: "backend handled fun prompt",
            format: "text",
            final: true,
          },
        };
      },
      async execute() {
        throw new Error("not used");
      },
      async interrupt() {},
      async snapshot(sessionId) {
        return {
          sessionId,
          backend: "claude-code",
          createdAt: Date.now(),
          payload: {},
        };
      },
      async probe() {
        return {
          healthy: true,
          status: "ready",
          uptimeMs: 0,
          activeExecutions: 0,
        };
      },
      async destroy() {},
    };
    (engine as unknown as { pool: { get: () => RuntimeBackend } }).pool = {
      get: () => backend,
    };
    (
      engine as unknown as {
        memoryStorage: { store: () => Promise<null> };
      }
    ).memoryStorage = {
      store: async () => null,
    };

    const response = await engine.execute({
      sessionId,
      prompt: "请用 python 随机生成 1-100 的数字",
    });

    expect(response.status).toBe("completed");
    expect(response.output).toBe("backend handled fun prompt");
    expect(response.events.some((event) => event.type === "tool_call")).toBe(
      false,
    );
    expect(response.events.some((event) => event.type === "tool_result")).toBe(
      false,
    );
  });

  it("runs pet-generator through the configured iota-fun MCP server", async () => {
    const storage = new MemoryStorage();
    const engine = new IotaEngine({
      storage,
      cwd: path.resolve(__dirname, ".."),
      workingDirectory: path.resolve(__dirname, ".."),
    });
    await engine.init();

    const sessionId = "session-pet";
    await storage.createSession({
      id: sessionId,
      workingDirectory: path.resolve(__dirname, ".."),
      activeBackend: "claude-code",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const backend: RuntimeBackend = {
      name: "claude-code",
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: false,
        acp: false,
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 200_000,
        promptOnlyInput: true,
      },
      async init() {},
      stream() {
        throw new Error("backend stream should not be used for pet skill");
      },
      async execute() {
        throw new Error("not used");
      },
      async interrupt() {},
      async snapshot(sessionId) {
        return {
          sessionId,
          backend: "claude-code",
          createdAt: Date.now(),
          payload: {},
        };
      },
      async probe() {
        return {
          healthy: true,
          status: "ready",
          uptimeMs: 0,
          activeExecutions: 0,
        };
      },
      async destroy() {},
    };
    (engine as unknown as { pool: { get: () => RuntimeBackend } }).pool = {
      get: () => backend,
    };
    (
      engine as unknown as {
        memoryStorage: { store: () => Promise<null> };
      }
    ).memoryStorage = {
      store: async () => null,
    };
    (
      engine as unknown as {
        mcpRouter: {
          listServers: () => Array<{ name: string; command: string }>;
          callTool: (call: {
            toolName: string;
          }) => Promise<Record<string, unknown>>;
        };
      }
    ).mcpRouter = {
      listServers: () => [{ name: "iota-fun", command: "node" }],
      callTool: async ({ toolName }) => ({
        content: [
          {
            type: "text",
            text:
              {
                "fun.cpp": "睡觉",
                "fun.typescript": "red",
                "fun.rust": "wood",
                "fun.zig": "小",
                "fun.java": "猫",
                "fun.python": "42",
                "fun.go": "circle",
              }[toolName] ?? "unknown",
          },
        ],
      }),
    };

    const response = await engine.execute({
      sessionId,
      prompt: "生成宠物",
    });

    expect(response.status).toBe("completed");
    expect(response.output).toContain(
      "一只正在睡觉的、red的、wood感的、小号的猫",
    );
    expect(
      response.events.filter((event) => event.type === "tool_call"),
    ).toHaveLength(7);
    expect(
      response.events.filter((event) => event.type === "tool_result"),
    ).toHaveLength(7);
  });

  it("fails pet-generator when the iota-fun MCP server returns an error result", async () => {
    const storage = new MemoryStorage();
    const engine = new IotaEngine({
      storage,
      cwd: path.resolve(__dirname, ".."),
      workingDirectory: path.resolve(__dirname, ".."),
    });
    await engine.init();

    const sessionId = "session-pet-failure";
    await storage.createSession({
      id: sessionId,
      workingDirectory: path.resolve(__dirname, ".."),
      activeBackend: "claude-code",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const backend: RuntimeBackend = {
      name: "claude-code",
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: false,
        acp: false,
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 200_000,
        promptOnlyInput: true,
      },
      async init() {},
      stream() {
        throw new Error("backend stream should not be used for pet skill");
      },
      async execute() {
        throw new Error("not used");
      },
      async interrupt() {},
      async snapshot(sessionId) {
        return {
          sessionId,
          backend: "claude-code",
          createdAt: Date.now(),
          payload: {},
        };
      },
      async probe() {
        return {
          healthy: true,
          status: "ready",
          uptimeMs: 0,
          activeExecutions: 0,
        };
      },
      async destroy() {},
    };
    (engine as unknown as { pool: { get: () => RuntimeBackend } }).pool = {
      get: () => backend,
    };
    (
      engine as unknown as {
        memoryStorage: { store: () => Promise<null> };
      }
    ).memoryStorage = {
      store: async () => null,
    };
    (
      engine as unknown as {
        mcpRouter: {
          listServers: () => Array<{ name: string; command: string }>;
          callTool: (call: {
            toolName: string;
          }) => Promise<Record<string, unknown>>;
        };
      }
    ).mcpRouter = {
      listServers: () => [{ name: "iota-fun", command: "node" }],
      callTool: async ({ toolName }) => {
        if (toolName === "fun.zig") {
          return {
            content: [{ type: "text", text: "ERROR: zig not installed" }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: "ok" }],
          isError: false,
        };
      },
    };

    const response = await engine.execute({
      sessionId,
      prompt: "生成宠物",
    });

    expect(response.status).toBe("failed");
    expect(response.output).toContain("pet-generator 执行失败");
    expect(response.output).toContain("fun.zig: ERROR: zig not installed");
    expect(
      response.events.filter(
        (event) =>
          event.type === "tool_result" && event.data.status === "error",
      ),
    ).toHaveLength(1);
  });
});
