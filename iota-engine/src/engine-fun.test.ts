import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IotaEngine } from "./engine.js";
import type {
  ExecutionRecord,
  LockLease,
  SessionRecord,
  StorageBackend,
} from "./storage/interface.js";
import type { RuntimeEvent, RuntimeResponse } from "./event/types.js";

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

  it("routes fun prompt execute() through IotaFunEngine", async () => {
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

    const executeSpy = vi
      .spyOn(
        (engine as unknown as { funEngine: { execute: (input: unknown) => Promise<unknown> } }).funEngine,
        "execute",
      )
      .mockResolvedValue({
        language: "python",
        command: "python",
        args: ["-c", "print(42)"],
        stdout: "42\n",
        stderr: "",
        exitCode: 0,
        value: "42",
      });

    const response = await engine.execute({
      sessionId,
      prompt: "请用 python 随机生成 1-100 的数字",
    });

    expect(executeSpy).toHaveBeenCalledWith({ language: "python" });
    expect(response.status).toBe("completed");
    expect(response.output).toBe("42");
    expect(response.events.some((event) => event.type === "tool_call")).toBe(true);
    expect(response.events.some((event) => event.type === "tool_result")).toBe(true);
  });
});
