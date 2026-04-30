import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { ApprovalDecision, ApprovalRequest } from "@iota/engine";
import { websocketHandler } from "./websocket.js";

type ApprovalListener = (requestId: string, request: ApprovalRequest) => void;

class FakeEngine {
  resolved: Array<{ requestId: string; decision: ApprovalDecision }> = [];
  private listener?: ApprovalListener;

  resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
    this.resolved.push({ requestId, decision });
    return true;
  }

  onDeferredApprovalRequest(listener: ApprovalListener): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emitApproval(requestId: string, request: ApprovalRequest): void {
    this.listener?.(requestId, request);
  }

  getPubSub(): undefined {
    return undefined;
  }
}

async function buildServer(engine: FakeEngine): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  await fastify.register(websocket);
  fastify.decorate("engine", engine);
  await fastify.register(websocketHandler, { prefix: "/api/v1" });
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  return fastify;
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), 2_000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

function connect(fastify: FastifyInstance): Promise<WebSocket> {
  const address = fastify.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/stream`);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

describe("websocket approval flow", () => {
  let fastify: FastifyInstance | undefined;
  let ws: WebSocket | undefined;

  afterEach(async () => {
    ws?.close();
    ws = undefined;
    await fastify?.close();
    fastify = undefined;
  });

  it("normalizes App approved boolean messages before resolving approval", async () => {
    const engine = new FakeEngine();
    fastify = await buildServer(engine);
    ws = await connect(fastify);

    ws.send(
      JSON.stringify({
        type: "approval_decision",
        executionId: "exec-1",
        requestId: "approval-1",
        approved: true,
      }),
    );

    const response = await nextMessage(ws);
    expect(response).toMatchObject({
      type: "approval_result",
      requestId: "approval-1",
      resolved: true,
    });
    expect(engine.resolved).toEqual([
      { requestId: "approval-1", decision: { decision: "approve" } },
    ]);
  });

  it("pushes deferred approval requests to subscribed app sessions", async () => {
    const engine = new FakeEngine();
    fastify = await buildServer(engine);
    ws = await connect(fastify);

    ws.send(
      JSON.stringify({
        type: "subscribe_app_session",
        sessionId: "session-1",
      }),
    );
    await nextMessage(ws);

    engine.emitApproval("approval-2", {
      sessionId: "session-1",
      executionId: "exec-2",
      backend: "codex",
      operationType: "shell",
      description: "Run shell command",
      details: { command: "pwd" },
      timeoutMs: 120_000,
    });

    const response = await nextMessage(ws);
    expect(response).toMatchObject({
      type: "app_delta",
      sessionId: "session-1",
      delta: {
        type: "conversation_delta",
        executionId: "exec-2",
        item: {
          role: "tool",
          content: "Approval required",
          metadata: {
            approval: {
              id: "approval-2",
              type: "shell",
              command: "pwd",
              reason: "Run shell command",
            },
          },
        },
      },
    });
  });
});

declare module "fastify" {
  interface FastifyInstance {
    engine: FakeEngine;
  }
}
