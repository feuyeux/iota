import { describe, it, expect } from "vitest";
import { buildAppExecutionSnapshot } from "../visibility/snapshot-builder.js";
import {
  contentHash,
  redactText,
  redactArgs,
  emptyRedaction,
} from "../visibility/redaction.js";
import { LocalVisibilityStore } from "../visibility/local-store.js";
import { VisibilityCollector } from "../visibility/collector.js";
import type { VisibilityStore } from "../visibility/store.js";
import type { RuntimeRequest, RuntimeResponse } from "../event/types.js";
import type {
  EventMappingVisibility,
  LinkVisibilityRecord,
  MemoryVisibilityRecord,
} from "../visibility/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("snapshot-builder: parseErrorCount", () => {
  it("counts parse errors by mappingRule, not runtimeEventType", () => {
    const snapshot = buildAppExecutionSnapshot(
      "session-1",
      "exec-1",
      "claude-code",
      {
        mappings: [
          {
            sessionId: "session-1",
            executionId: "exec-1",
            nativeRefId: "ref-1",
            runtimeEventType: "output",
            mappingRule: "parse_error_to_text",
            lossy: true,
          },
          {
            sessionId: "session-1",
            executionId: "exec-1",
            nativeRefId: "ref-2",
            runtimeEventType: "output",
            mappingRule: "json_primitive_to_text",
            lossy: false,
          },
        ] satisfies EventMappingVisibility[],
        link: {
          traceId: "trace-1",
          sessionId: "session-1",
          executionId: "exec-1",
          backend: "claude-code",
          command: {
            executable: "claude",
            args: [],
            envSummary: {},
            workingDirectory: ".",
          },
          process: { pid: 1, startedAt: 0, exitCode: 0 },
          protocol: {
            name: "stream-json",
            stdinMode: "prompt",
            stdoutMode: "ndjson",
            stderrCaptured: true,
          },
          spans: [],
          nativeEventRefs: [
            {
              refId: "ref-1",
              direction: "stdout",
              timestamp: 0,
              rawHash: "abc",
              redaction: emptyRedaction(),
            },
            {
              refId: "ref-2",
              direction: "stdout",
              timestamp: 0,
              rawHash: "def",
              redaction: emptyRedaction(),
            },
          ],
        } satisfies LinkVisibilityRecord,
      },
      [],
    );

    // detail lives under tracing.tabs.detail
    expect(snapshot.tracing.tabs.detail.parseErrorCount).toBe(1);
  });
});

describe("redaction", () => {
  it("contentHash produces a hex string, not a content prefix", () => {
    const hash = contentHash("hello world");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    // Should NOT be a prefix of the input
    expect(hash).not.toBe("hello world".slice(0, 16));
  });

  it("redactText removes long secret-like tokens", () => {
    // Pattern requires 20+ chars after prefix
    const secret = "sk_abcdefghijklmnopqrstuvwxyz0123456789";
    const result = redactText(`my key is ${secret}`);
    expect(result.text).toContain("[REDACTED]");
    expect(result.text).not.toContain(secret);
    expect(result.redaction.applied).toBe(true);
  });

  it("redactText returns original text when no secrets found", () => {
    const result = redactText("just normal text");
    expect(result.text).toBe("just normal text");
    expect(result.redaction.applied).toBe(false);
  });

  it("redactArgs catches key=value patterns like openai_api_key=...", () => {
    const args = [
      "exec",
      "-c",
      "model=gpt-4",
      "-c",
      "openai_api_key=sk-abc123",
    ];
    const result = redactArgs(args);
    expect(result.args).toEqual([
      "exec",
      "-c",
      "model=gpt-4",
      "-c",
      "openai_api_key=[REDACTED]",
    ]);
    expect(result.redaction.applied).toBe(true);
    expect(result.redaction.fields).toContain("openai_api_key");
  });

  it("redactArgs catches various secret key=value patterns", () => {
    const args = ["--flag", "db_password=hunter2", "client_secret=xyz"];
    const result = redactArgs(args);
    expect(result.args).toEqual([
      "--flag",
      "db_password=[REDACTED]",
      "client_secret=[REDACTED]",
    ]);
  });
});

describe("LocalVisibilityStore gc", () => {
  it("removes execution directories older than retention", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vis-gc-"));
    const store = new LocalVisibilityStore(tmpDir);

    // Create an old execution
    const sessionDir = path.join(tmpDir, "session-1");
    const execDir = path.join(sessionDir, "exec-old");
    await fs.mkdir(execDir, { recursive: true });
    const contextFile = path.join(execDir, "context.json");
    await fs.writeFile(contextFile, JSON.stringify({ createdAt: 0 }));
    // Set mtime to 48 hours ago
    const oldTime = new Date(Date.now() - 48 * 3600_000);
    await fs.utimes(contextFile, oldTime, oldTime);

    // Create a recent execution
    const recentDir = path.join(sessionDir, "exec-recent");
    await fs.mkdir(recentDir, { recursive: true });
    await fs.writeFile(
      path.join(recentDir, "context.json"),
      JSON.stringify({ createdAt: Date.now() }),
    );

    const result = await store.gc(24); // 24 hour retention

    expect(result.removed).toBe(1);

    // Old should be gone, recent should remain
    const remaining = await fs.readdir(sessionDir);
    expect(remaining).toEqual(["exec-recent"]);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe("VisibilityCollector prompt redaction", () => {
  it("redacts secrets from prompt preview in memory visibility", async () => {
    const secret = "sk_abcdefghijklmnopqrstuvwxyz0123456789";
    const prompt = `Please use this key: ${secret} to authenticate`;

    let savedMemory: MemoryVisibilityRecord | undefined;
    const mockStore: VisibilityStore = {
      saveContextManifest: async () => {},
      saveMemoryVisibility: async (record) => {
        savedMemory = record;
      },
      saveTokenLedger: async () => {},
      saveLinkVisibility: async () => {},
      appendTraceSpan: async () => {},
      appendEventMapping: async () => {},
      getExecutionVisibility: async () => null,
      listSessionVisibility: async () => [],
    };

    const collector = new VisibilityCollector({
      store: mockStore,
      policy: {
        memory: "preview",
        tokens: "summary",
        chain: "off",
        rawProtocol: "off",
        previewChars: 200,
        persistFullContent: false,
        redactSecrets: true,
      },
    });

    collector.begin({
      sessionId: "s1",
      executionId: "e1",
      prompt,
      workingDirectory: ".",
      backend: "claude-code",
    } satisfies RuntimeRequest);

    // Finalize to persist
    await collector.finalize({
      sessionId: "s1",
      executionId: "e1",
      backend: "claude-code",
      status: "completed",
      output: "done",
      events: [],
    } satisfies RuntimeResponse);

    expect(savedMemory).toBeDefined();
    expect(savedMemory!.query.preview).toBeDefined();
    expect(savedMemory!.query.preview).not.toContain(secret);
    expect(savedMemory!.query.preview).toContain("[REDACTED]");
  });
});
