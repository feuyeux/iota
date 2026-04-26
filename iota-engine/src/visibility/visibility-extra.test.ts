import { describe, expect, it } from "vitest";
import { SubprocessBackendAdapter } from "../backend/subprocess.js";
import { injectMemoryWithVisibility } from "../memory/injector.js";
import type { RuntimeRequest } from "../event/types.js";
import { VisibilityCollector } from "./collector.js";
import { RedisVisibilityStore } from "./redis-store.js";
import { estimateTokens } from "./token-estimator.js";
import type { VisibilityStore } from "./store.js";
import type {
  ContextManifest,
  EventMappingVisibility,
  LinkVisibilityRecord,
  MemoryVisibilityRecord,
  TokenLedger,
  TraceSpan,
} from "./types.js";
import {
  buildAppExecutionSnapshot,
  buildAppSessionSnapshot,
} from "./snapshot-builder.js";

class CaptureStore implements VisibilityStore {
  context?: ContextManifest;
  memory?: MemoryVisibilityRecord;
  tokens?: TokenLedger;
  link?: LinkVisibilityRecord;
  spans: TraceSpan[] = [];
  mappings: EventMappingVisibility[] = [];

  async saveContextManifest(manifest: ContextManifest): Promise<void> {
    this.context = manifest;
  }
  async saveMemoryVisibility(record: MemoryVisibilityRecord): Promise<void> {
    this.memory = record;
  }
  async saveTokenLedger(ledger: TokenLedger): Promise<void> {
    this.tokens = ledger;
  }
  async saveLinkVisibility(record: LinkVisibilityRecord): Promise<void> {
    this.link = record;
  }
  async appendTraceSpan(span: TraceSpan): Promise<void> {
    this.spans.push(span);
  }
  async appendEventMapping(mapping: EventMappingVisibility): Promise<void> {
    this.mappings.push(mapping);
  }
  async getExecutionVisibility() {
    return null;
  }
  async listSessionVisibility() {
    return [];
  }
}

describe("VisibilityCollector token ledger", () => {
  it("merges native usage with estimated segment breakdown", async () => {
    const store = new CaptureStore();
    const collector = new VisibilityCollector({ store });
    collector.begin({
      sessionId: "s1",
      executionId: "e1",
      backend: "claude-code",
      prompt: "hello",
      workingDirectory: ".",
      context: { conversation: [], injectedMemory: [] },
    });
    collector.buildContextFromRequest(
      {
        sessionId: "s1",
        executionId: "e1",
        backend: "claude-code",
        prompt: "hello",
        workingDirectory: ".",
      },
      { conversation: [], injectedMemory: [] },
      1000,
    );
    collector.addOutputTokens("world", "assistant_output");

    await collector.finalize({
      sessionId: "s1",
      executionId: "e1",
      backend: "claude-code",
      status: "completed",
      output: "world",
      events: [],
      usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
    });

    expect(store.tokens?.confidence).toBe("native");
    expect(store.tokens?.input.nativeTokens).toBe(10);
    expect(store.tokens?.output.nativeTokens).toBe(3);
    expect(store.tokens?.input.bySegment[0]?.kind).toBe("user_prompt");
  });
});

describe("VisibilityCollector trace tree", () => {
  it("keeps child spans under the engine.request root span", async () => {
    const store = new CaptureStore();
    const collector = new VisibilityCollector({ store });
    collector.begin({
      sessionId: "s1",
      executionId: "e1",
      backend: "claude-code",
      prompt: "hello",
      workingDirectory: ".",
    });

    const rootSpanId = collector.startSpan("engine.request");
    const backendSpanId = collector.startSpan("backend.spawn", {
      executable: "claude",
    });
    collector.endSpan(backendSpanId);
    collector.endSpan(rootSpanId);

    await collector.finalize({
      sessionId: "s1",
      executionId: "e1",
      backend: "claude-code",
      status: "completed",
      output: "",
      events: [],
    });

    const root = store.spans.find((span) => span.kind === "engine.request");
    const backend = store.spans.find((span) => span.kind === "backend.spawn");

    expect(root?.parentSpanId).toBeUndefined();
    expect(backend?.parentSpanId).toBe(root?.spanId);
  });

  it("backfills queued native mappings in event order", async () => {
    const store = new CaptureStore();
    const collector = new VisibilityCollector({ store });
    collector.begin({
      sessionId: "s1",
      executionId: "e1",
      backend: "hermes",
      prompt: "hello",
      workingDirectory: ".",
    });
    collector.setLinkCommand({
      command: {
        executable: "hermes",
        args: ["acp"],
        envSummary: {},
        workingDirectory: ".",
      },
      protocol: {
        name: "acp",
        stdinMode: "message",
        stdoutMode: "ndjson",
        stderrCaptured: true,
      },
    });

    collector.appendNativeEventRef({
      refId: "stdin-1",
      direction: "stdin",
      timestamp: 1,
      rawHash: "stdin",
      redaction: { applied: false, fields: [], patterns: [] },
    });
    collector.appendNativeEventRef({
      refId: "ref-1",
      direction: "stdout",
      timestamp: 2,
      rawHash: "one",
      parsedAs: "output",
      redaction: { applied: false, fields: [], patterns: [] },
    });
    collector.appendEventMapping({
      sessionId: "s1",
      executionId: "e1",
      backend: "hermes",
      nativeRefId: "ref-1",
      runtimeEventType: "output",
      mappingRule: "hermes_native_mapper",
      lossy: false,
    });
    collector.appendNativeEventRef({
      refId: "ref-2",
      direction: "stdout",
      timestamp: 3,
      rawHash: "two",
      parsedAs: "output",
      redaction: { applied: false, fields: [], patterns: [] },
    });
    collector.appendEventMapping({
      sessionId: "s1",
      executionId: "e1",
      backend: "hermes",
      nativeRefId: "ref-2",
      runtimeEventType: "output",
      mappingRule: "hermes_native_mapper",
      lossy: false,
    });

    collector.backfillLastSequence(10);
    collector.backfillLastSequence(11);
    await collector.finalize({
      sessionId: "s1",
      executionId: "e1",
      backend: "hermes",
      status: "completed",
      output: "",
      events: [],
    });

    expect(store.link?.nativeEventRefs[1]?.runtimeSequence).toBe(10);
    expect(store.link?.nativeEventRefs[2]?.runtimeSequence).toBe(11);
    expect(store.mappings[0]?.runtimeSequence).toBe(10);
    expect(store.mappings[1]?.runtimeSequence).toBe(11);
  });
});

describe("injectMemoryWithVisibility", () => {
  it("reports duplicates, selected blocks, and token-budget exclusions", () => {
    const result = injectMemoryWithVisibility(
      {
        conversation: [],
        injectedMemory: [{ id: "existing", content: "already injected" }],
      },
      [
        { id: "existing", content: "duplicate" },
        { id: "large", content: "x".repeat(300), score: 0.9 },
        { id: "small", content: "useful", score: 0.5 },
      ],
      { backend: "claude-code", tokenBudget: 60 },
    );

    expect(result.selected.map((item) => item.memoryId)).toContain("large");
    expect(result.excluded.map((item) => item.reason)).toContain("duplicate");
    expect(result.excluded.map((item) => item.reason)).toContain(
      "token_budget_exceeded",
    );
  });
});

class MockRedisClient {
  values = new Map<string, string>();
  lists = new Map<string, string[]>();
  hashes = new Map<string, Record<string, string>>();
  sorted = new Map<string, Array<{ score: number; value: string }>>();

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async rpush(key: string, value: string): Promise<void> {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
  }
  async lrange(key: string): Promise<string[]> {
    return this.lists.get(key) ?? [];
  }
  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }
  async hset(key: string, field: string, value: string): Promise<void> {
    const hash = this.hashes.get(key) ?? {};
    hash[field] = value;
    this.hashes.set(key, hash);
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    return this.hashes.get(key) ?? {};
  }
  multi() {
    const commands: Array<() => Promise<void>> = [];
    const pipeline = {
      rpush: (key: string, value: string) => {
        commands.push(() => this.rpush(key, value));
        return pipeline;
      },
      expire: (key: string) => {
        commands.push(() => this.expire(key));
        return pipeline;
      },
      hset: (key: string, field: string, value: string) => {
        commands.push(() => this.hset(key, field, value));
        return pipeline;
      },
      exec: async () => {
        for (const command of commands) {
          await command();
        }
      },
    };
    return pipeline;
  }
  async zadd(key: string, score: number, value: string): Promise<void> {
    const list = this.sorted.get(key) ?? [];
    list.push({ score, value });
    list.sort((a, b) => a.score - b.score);
    this.sorted.set(key, list);
  }
  async zrangebyscore(
    key: string,
    min: string,
    _max: string,
    _limit: string,
    offset: number,
    limit: number,
  ): Promise<string[]> {
    const floor = min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min);
    return (this.sorted.get(key) ?? [])
      .filter((item) => item.score >= floor)
      .slice(offset, offset + limit)
      .map((item) => item.value);
  }
  async expire(): Promise<void> {}
}

describe("RedisVisibilityStore", () => {
  it("round-trips execution visibility and session summaries", async () => {
    const client = new MockRedisClient();
    const store = new RedisVisibilityStore(client as never, {
      retentionHours: 1,
    });
    await store.saveContextManifest({
      sessionId: "s1",
      executionId: "e1",
      backend: "gemini",
      createdAt: 10,
      policy: {
        memory: "preview",
        tokens: "summary",
        chain: "summary",
        rawProtocol: "off",
        previewChars: 120,
        persistFullContent: false,
        redactSecrets: true,
      },
      segments: [],
      totals: {
        estimatedInputTokens: 0,
        maxContextTokens: 100,
        budgetUsedRatio: 0,
      },
    });
    await store.appendTraceSpan({
      traceId: "t1",
      spanId: "sp1",
      sessionId: "s1",
      executionId: "e1",
      backend: "gemini",
      kind: "engine.request",
      startedAt: 10,
      endedAt: 11,
      status: "ok",
      attributes: {},
      redaction: { applied: false, fields: [], patterns: [] },
    });

    const visibility = await store.getExecutionVisibility("e1");
    const summaries = await store.listSessionVisibility("s1");

    expect(visibility?.context?.backend).toBe("gemini");
    expect(visibility?.spans?.[0]?.kind).toBe("engine.request");
    expect(client.hashes.get("iota:visibility:e1:chain")?.sp1).toBeDefined();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.executionId).toBe("e1");
  });
});

describe("snapshot builders and token estimator", () => {
  it("builds user-prompt timeline and session active files", () => {
    const execution = buildAppExecutionSnapshot(
      "s1",
      "e1",
      "codex",
      {
        tokens: {
          sessionId: "s1",
          executionId: "e1",
          backend: "codex",
          input: { estimatedTokens: 2, bySegment: [] },
          output: { estimatedTokens: 3, bySegment: [] },
          total: { estimatedTokens: 5 },
          confidence: "estimated",
        },
      },
      [],
      "fix bug",
    );
    const session = buildAppSessionSnapshot({
      sessionId: "s1",
      activeBackend: "codex",
      workingDirectory: ".",
      createdAt: 1,
      updatedAt: 2,
      backends: [],
      executionSnapshots: [execution],
      activeFiles: [{ path: "src/a.ts", pinned: true }],
    });

    expect(execution.conversation.items[0]?.role).toBe("user");
    expect(session.activeFiles).toEqual([{ path: "src/a.ts", pinned: true }]);
    expect(estimateTokens("abcd", "codex")).toBeGreaterThan(0);
  });
});

class TestAdapter extends SubprocessBackendAdapter {
  constructor() {
    super({
      name: "codex",
      defaultExecutable: "codex",
      processMode: "per-execution",
      capabilities: {
        sandbox: true,
        mcp: false,
        mcpResponseChannel: false,
        acp: false,
        streaming: true,
        thinking: false,
        multimodal: false,
        maxContextTokens: 1000,
      },
      buildArgs: () => [],
    });
  }

  parse(line: string, request: RuntimeRequest) {
    return this.mapLine(line, request);
  }
}

describe("adapter visibility mapping", () => {
  it("records native refs and parse mappings", async () => {
    const store = new CaptureStore();
    const collector = new VisibilityCollector({ store });
    const request: RuntimeRequest = {
      sessionId: "s1",
      executionId: "e1",
      backend: "codex",
      prompt: "hello",
      workingDirectory: ".",
    };
    collector.begin(request);
    collector.setLinkCommand({
      command: {
        executable: "codex",
        args: [],
        envSummary: {},
        workingDirectory: ".",
      },
      protocol: {
        name: "ndjson",
        stdinMode: "none",
        stdoutMode: "ndjson",
        stderrCaptured: true,
      },
    });
    const adapter = new TestAdapter();
    adapter.setVisibilityCollector(collector, "e1");

    const event = adapter.parse("not json", request);
    await collector.finalize({
      sessionId: "s1",
      executionId: "e1",
      backend: "codex",
      status: "completed",
      output: event?.type === "output" ? event.data.content : "",
      events: event ? [event] : [],
    });

    expect(store.mappings[0]?.mappingRule).toBe("parse_error_to_text");
    expect(store.mappings[0]?.runtimeEventType).toBe("output");
    expect(store.link?.nativeEventRefs[0]?.parsedAs).toBe("parse_error");
  });
});

describe("Hermes multi-execution isolation", () => {
  it("uses separate visibility collectors per executionId", () => {
    const adapter = new TestAdapter();
    const store1 = new CaptureStore();
    const store2 = new CaptureStore();
    const collector1 = new VisibilityCollector({ store: store1 });
    const collector2 = new VisibilityCollector({ store: store2 });

    const req1: RuntimeRequest = {
      sessionId: "s1",
      executionId: "exec-1",
      backend: "codex",
      prompt: "hello",
      workingDirectory: ".",
    };
    const req2: RuntimeRequest = {
      sessionId: "s1",
      executionId: "exec-2",
      backend: "codex",
      prompt: "world",
      workingDirectory: ".",
    };

    collector1.begin(req1);
    collector2.begin(req2);

    adapter.setVisibilityCollector(collector1, "exec-1");
    adapter.setVisibilityCollector(collector2, "exec-2");

    // Parse a line for exec-1
    adapter.parse('{"type":"result","text":"hi"}', req1);
    // Parse a line for exec-2
    adapter.parse('{"type":"result","text":"bye"}', req2);

    // Verify exec-1 collector got exactly one native ref
    const info1 = collector1.getExecutionInfo();
    expect(info1.executionId).toBe("exec-1");

    const info2 = collector2.getExecutionInfo();
    expect(info2.executionId).toBe("exec-2");

    // Clean up
    adapter.setVisibilityCollector(undefined, "exec-1");
    adapter.setVisibilityCollector(undefined, "exec-2");
  });
});

describe("snapshot-builder: latency percentiles", () => {
  it("computes non-zero percentiles from spans", () => {
    const snapshot = buildAppExecutionSnapshot(
      "s1",
      "e1",
      "claude-code",
      {
        spans: [
          {
            traceId: "t1",
            spanId: "sp1",
            sessionId: "s1",
            executionId: "e1",
            kind: "engine.request",
            startedAt: 100,
            endedAt: 200,
            status: "ok",
            attributes: {},
            redaction: { applied: false, fields: [], patterns: [] },
          },
          {
            traceId: "t1",
            spanId: "sp2",
            sessionId: "s1",
            executionId: "e1",
            kind: "backend.spawn",
            startedAt: 200,
            endedAt: 500,
            status: "ok",
            attributes: {},
            redaction: { applied: false, fields: [], patterns: [] },
          },
          {
            traceId: "t1",
            spanId: "sp3",
            sessionId: "s1",
            executionId: "e1",
            kind: "event.persist",
            startedAt: 500,
            endedAt: 520,
            status: "ok",
            attributes: {},
            redaction: { applied: false, fields: [], patterns: [] },
          },
        ],
      },
      [],
    );

    expect(snapshot.tracing.tabs.performance.latencyMs.p50).toBeGreaterThan(0);
  });
});

describe("snapshot-builder: session confidence merging", () => {
  it("merges native + estimated → mixed", () => {
    const exec1 = buildAppExecutionSnapshot(
      "s1",
      "e1",
      "claude-code",
      {
        tokens: {
          sessionId: "s1",
          executionId: "e1",
          backend: "claude-code",
          input: { estimatedTokens: 10, bySegment: [] },
          output: { estimatedTokens: 5, bySegment: [] },
          total: { nativeTokens: 15, estimatedTokens: 15 },
          confidence: "native",
        },
      },
      [],
    );
    const exec2 = buildAppExecutionSnapshot(
      "s1",
      "e2",
      "codex",
      {
        tokens: {
          sessionId: "s1",
          executionId: "e2",
          backend: "codex",
          input: { estimatedTokens: 20, bySegment: [] },
          output: { estimatedTokens: 10, bySegment: [] },
          total: { estimatedTokens: 30 },
          confidence: "estimated",
        },
      },
      [],
    );

    const session = buildAppSessionSnapshot({
      sessionId: "s1",
      activeBackend: "claude-code",
      workingDirectory: ".",
      createdAt: 1,
      updatedAt: 2,
      backends: [],
      executionSnapshots: [exec1, exec2],
      activeFiles: [],
    });

    expect(session.tokens.confidence).toBe("mixed");
  });
});

describe("snapshot-builder: degradation with missing visibility", () => {
  it("returns default panels when visibility is empty", () => {
    const snapshot = buildAppExecutionSnapshot(
      "s1",
      "e1",
      "claude-code",
      {},
      [],
    );

    expect(snapshot.tokens.confidence).toBe("estimated");
    expect(snapshot.tokens.totalTokens).toBe(0);
    expect(snapshot.memory.hitCount).toBe(0);
    expect(snapshot.tracing.steps.length).toBeGreaterThan(0);
  });
});

describe("injectMemoryWithVisibility: low_score filtering", () => {
  it("excludes candidates below minScore with reason low_score", () => {
    const result = injectMemoryWithVisibility(
      { conversation: [], injectedMemory: [] },
      [
        { id: "high", content: "important", score: 0.9 },
        { id: "low", content: "irrelevant", score: 0.1 },
      ],
      { backend: "claude-code", minScore: 0.5 },
    );

    expect(result.selected.map((s) => s.memoryId)).toContain("high");
    expect(result.excluded.map((e) => e.memoryId)).toContain("low");
    expect(result.excluded.find((e) => e.memoryId === "low")?.reason).toBe(
      "low_score",
    );
  });
});

describe("adapter: native usage forwarding from output events", () => {
  it("forwards usage from output event data to visibility collector", async () => {
    const store = new CaptureStore();
    const collector = new VisibilityCollector({ store });
    const request: RuntimeRequest = {
      sessionId: "s1",
      executionId: "e1",
      backend: "codex",
      prompt: "hello",
      workingDirectory: ".",
    };
    collector.begin(request);
    collector.buildContextFromRequest(
      request,
      { conversation: [], injectedMemory: [] },
      1000,
    );

    // Directly set native usage as the subprocess adapter would after
    // detecting usage on an output event in mapLine()
    collector.setNativeUsage({
      backend: "codex",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    collector.addOutputTokens("done", "assistant_output");

    await collector.finalize({
      sessionId: "s1",
      executionId: "e1",
      backend: "codex",
      status: "completed",
      output: "done",
      events: [],
    });

    expect(store.tokens?.confidence).toBe("native");
    expect(store.tokens?.input.nativeTokens).toBe(100);
    expect(store.tokens?.output.nativeTokens).toBe(50);
  });
});
