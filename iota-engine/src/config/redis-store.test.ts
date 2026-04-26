import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { RedisConfigStore } from "./redis-store.js";

/**
 * Unit tests for RedisConfigStore.
 * These tests mock ioredis to avoid requiring a running Redis instance.
 */

// Mock ioredis
const mockHgetall = vi.fn().mockResolvedValue({});
const mockHget = vi.fn().mockResolvedValue(null);
const mockHset = vi.fn().mockResolvedValue(1);
const mockHdel = vi.fn().mockResolvedValue(1);
const mockDel = vi.fn().mockResolvedValue(1);
const mockScan = vi.fn().mockResolvedValue(["0", []]);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockQuit = vi.fn().mockResolvedValue("OK");

vi.mock("ioredis", () => ({
  default: {
    default: class MockRedis {
      hgetall = mockHgetall;
      hget = mockHget;
      hset = mockHset;
      hdel = mockHdel;
      del = mockDel;
      scan = mockScan;
      connect = mockConnect;
      quit = mockQuit;
    },
  },
}));

describe("RedisConfigStore", () => {
  let store: RedisConfigStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new RedisConfigStore({ host: "localhost", port: 6379 });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  it("should build correct Redis key for global scope", async () => {
    await store.get("global");
    expect(mockHgetall).toHaveBeenCalledWith("iota:config:global");
  });

  it("should build correct Redis key for backend scope", async () => {
    await store.get("backend", "claude-code");
    expect(mockHgetall).toHaveBeenCalledWith("iota:config:backend:claude-code");
  });

  it("should build correct Redis key for session scope", async () => {
    await store.get("session", "sess-123");
    expect(mockHgetall).toHaveBeenCalledWith("iota:config:session:sess-123");
  });

  it("should build correct Redis key for user scope", async () => {
    await store.get("user", "user-abc");
    expect(mockHgetall).toHaveBeenCalledWith("iota:config:user:user-abc");
  });

  it("should throw if backend scope has no scopeId", async () => {
    await expect(store.get("backend")).rejects.toThrow(
      "backend scope requires scopeId",
    );
  });

  it("should set a key in global scope", async () => {
    await store.set("global", "approval.shell", "ask");
    expect(mockHset).toHaveBeenCalledWith(
      "iota:config:global",
      "approval.shell",
      "ask",
    );
  });

  it("should set a key in backend scope", async () => {
    await store.set("backend", "timeout", "60000", "claude-code");
    expect(mockHset).toHaveBeenCalledWith(
      "iota:config:backend:claude-code",
      "timeout",
      "60000",
    );
  });

  it("should delete a key", async () => {
    await store.del("global", "approval.shell");
    expect(mockHdel).toHaveBeenCalledWith(
      "iota:config:global",
      "approval.shell",
    );
  });

  it("should clear a scope", async () => {
    await store.clear("session", "sess-123");
    expect(mockDel).toHaveBeenCalledWith("iota:config:session:sess-123");
  });

  it("should get a single key", async () => {
    mockHget.mockResolvedValueOnce("ask");
    const value = await store.getKey("global", "approval.shell");
    expect(value).toBe("ask");
    expect(mockHget).toHaveBeenCalledWith(
      "iota:config:global",
      "approval.shell",
    );
  });

  it("should resolve config merging global and backend", async () => {
    mockHgetall
      .mockResolvedValueOnce({
        "approval.shell": "auto",
        "engine.mode": "development",
      }) // global
      .mockResolvedValueOnce({ "approval.shell": "ask" }); // backend overrides

    const resolved = await store.getResolved("claude-code");
    expect(resolved["approval.shell"]).toBe("ask");
    expect(resolved["engine.mode"]).toBe("development");
  });

  it("should resolve with all 4 scopes, highest priority wins", async () => {
    mockHgetall
      .mockResolvedValueOnce({ key: "global" }) // global
      .mockResolvedValueOnce({ key: "backend" }) // backend
      .mockResolvedValueOnce({ key: "session" }) // session
      .mockResolvedValueOnce({ key: "user" }); // user

    const resolved = await store.getResolved("claude-code", "sess-1", "user-1");
    expect(resolved.key).toBe("user");
  });

  it("should set many keys at once", async () => {
    await store.setMany("global", { a: "1", b: "2" });
    expect(mockHset).toHaveBeenCalledWith("iota:config:global", {
      a: "1",
      b: "2",
    });
  });

  it("should skip setMany with empty entries", async () => {
    await store.setMany("global", {});
    expect(mockHset).not.toHaveBeenCalled();
  });

  it("should publish config change event when pubsub is provided", async () => {
    const mockPublish = vi.fn().mockResolvedValue(undefined);
    const storeWithPubsub = new RedisConfigStore({
      host: "localhost",
      port: 6379,
      pubsub: { publishConfigChange: mockPublish } as any,
    });
    await storeWithPubsub.init();

    await storeWithPubsub.set("global", "key", "value");
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "key",
        value: "value",
        scope: "global",
        scopeId: undefined,
      }),
    );

    await storeWithPubsub.close();
  });

  it("should list scope IDs", async () => {
    mockScan.mockResolvedValueOnce([
      "0",
      ["iota:config:backend:claude-code", "iota:config:backend:codex"],
    ]);
    const ids = await store.listScopes("backend");
    expect(ids).toEqual(["claude-code", "codex"]);
  });

  it("should publish deletion change with null value", async () => {
    const mockPublish = vi.fn().mockResolvedValue(undefined);
    const storeWithPubsub = new RedisConfigStore({
      host: "localhost",
      port: 6379,
      pubsub: { publishConfigChange: mockPublish } as any,
    });
    await storeWithPubsub.init();

    await storeWithPubsub.del("session", "approval.shell", "sess-1");

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "approval.shell",
        value: null,
        scope: "session",
        scopeId: "sess-1",
      }),
    );

    await storeWithPubsub.close();
  });

  it("should ignore pubsub failures during setMany", async () => {
    const storeWithPubsub = new RedisConfigStore({
      host: "localhost",
      port: 6379,
      pubsub: {
        publishConfigChange: vi.fn().mockRejectedValue(new Error("boom")),
      } as any,
    });
    await storeWithPubsub.init();

    await expect(
      storeWithPubsub.setMany("global", { a: "1", b: "2" }),
    ).resolves.toBeUndefined();
    expect(mockHset).toHaveBeenCalledWith("iota:config:global", {
      a: "1",
      b: "2",
    });

    await storeWithPubsub.close();
  });
});
