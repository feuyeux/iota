import crypto from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type {
  RuntimeRequest,
  BackendName,
  RuntimeEvent,
  AppVisibilityDelta,
  TraceStepView,
  ApprovalDecision,
} from "@iota/engine";
import { buildAppExecutionSnapshot } from "@iota/engine";

interface JsonWebSocket {
  send(data: string): void;
  readyState: number;
}

/** Safely send data over WebSocket, ignoring sends if socket is not open. */
function safeSend(ws: JsonWebSocket, data: string): void {
  // readyState 1 = OPEN
  if (ws.readyState === 1) {
    ws.send(data);
  }
}

interface StreamRequestMessage {
  type: "execute";
  sessionId: string;
  executionId?: string;
  prompt: string;
  workingDirectory?: string;
  backend?: BackendName;
  approvals?: Record<string, "auto" | "deny" | "ask">;
}

interface SubscribeAppSessionMessage {
  type: "subscribe_app_session";
  sessionId: string;
  include?: AppDeltaKind[];
}

interface SubscribeVisibilityMessage {
  type: "subscribe_visibility";
  executionId: string;
  kinds?: VisibilitySubscriptionKind[];
}

interface InterruptExecutionMessage {
  type: "interrupt";
  executionId: string;
}

interface ApprovalDecisionMessage {
  type: "approval_decision";
  requestId: string;
  decision: "approve" | "deny";
  reason?: string;
}

type IncomingMessage =
  | StreamRequestMessage
  | SubscribeAppSessionMessage
  | SubscribeVisibilityMessage
  | InterruptExecutionMessage
  | ApprovalDecisionMessage;

interface StreamResponseMessage {
  type: "event" | "error" | "complete";
  executionId?: string;
  event?: RuntimeEvent;
  error?: string;
}

interface AppDeltaResponseMessage {
  type: "app_delta";
  sessionId: string;
  delta: AppVisibilityDelta;
  revision?: number;
}

type AppDeltaKind =
  | "conversation"
  | "tracing"
  | "memory"
  | "tokens"
  | "summary";

type VisibilitySubscriptionKind = "memory" | "tokens" | "chain" | "summary";

export const websocketHandler: FastifyPluginAsync = async (fastify) => {
  fastify.get("/stream", { websocket: true }, (connection) => {
    const ws = connection;
    const appSessionSubscriptions = new Map<string, Set<AppDeltaKind>>();
    const visibilitySubscriptions = new Map<
      string,
      Set<VisibilitySubscriptionKind>
    >();
    const activeSubscriptionAborts = new Map<string, AbortController>();
    const activeVisibilityPollers = new Map<string, AbortController>();
    const visibilityHashes = new Map<string, string>();
    let deltaRevision = 0;

    // Bridge Redis pub/sub to WebSocket for multi-instance event distribution (Section 4.3)
    const pubsubUnsubscribers: Array<() => Promise<void>> = [];
    const pubsub = fastify.engine.getPubSub?.();
    if (pubsub) {
      // Forward execution events from all instances to this WebSocket client
      const setupPubSubBridge = async () => {
        const unsubExec = await pubsub.subscribe(
          "iota:execution:events",
          (message) => {
            if (message.type !== "execution_event") return;
            // Only forward if client is subscribed to this session
            for (const [_sessionId, include] of appSessionSubscriptions) {
              if (include.size > 0) {
                safeSend(ws, 
                  JSON.stringify({
                    type: "pubsub_event",
                    channel: "iota:execution:events",
                    message,
                  }),
                );
                break;
              }
            }
          },
        );
        pubsubUnsubscribers.push(unsubExec);

        const unsubSession = await pubsub.subscribe(
          "iota:session:updates",
          (message) => {
            if (message.type !== "session_update") return;
            // Forward session updates if client subscribes to this session
            if (appSessionSubscriptions.has(message.sessionId)) {
              safeSend(ws, 
                JSON.stringify({
                  type: "pubsub_event",
                  channel: "iota:session:updates",
                  message,
                }),
              );
            }
          },
        );
        pubsubUnsubscribers.push(unsubSession);

        const unsubConfig = await pubsub.subscribe(
          "iota:config:changes",
          (message) => {
            safeSend(ws, 
              JSON.stringify({
                type: "pubsub_event",
                channel: "iota:config:changes",
                message,
              }),
            );
          },
        );
        pubsubUnsubscribers.push(unsubConfig);
      };
      setupPubSubBridge().catch((err) => {
        fastify.log.warn(
          { err },
          "Failed to set up pub/sub bridge for WebSocket",
        );
      });
    }

    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as IncomingMessage;

        if (message.type === "subscribe_app_session") {
          const include = new Set<AppDeltaKind>(
            message.include ?? [
              "conversation",
              "tracing",
              "memory",
              "tokens",
              "summary",
            ],
          );
          appSessionSubscriptions.set(message.sessionId, include);
          safeSend(ws, 
            JSON.stringify({
              type: "subscribed",
              sessionId: message.sessionId,
              include: [...include],
            }),
          );
          await pushSessionSnapshot(fastify, ws, message.sessionId);
          return;
        }

        if (message.type === "subscribe_visibility") {
          const execId = message.executionId;
          const kinds = new Set<VisibilitySubscriptionKind>(
            message.kinds ?? ["memory", "tokens", "chain", "summary"],
          );
          visibilitySubscriptions.set(execId, kinds);
          safeSend(ws, 
            JSON.stringify({
              type: "subscribed_visibility",
              executionId: execId,
              kinds: [...kinds],
            }),
          );

          await pushExecutionVisibilitySnapshot(fastify, ws, execId);
          if (!activeVisibilityPollers.has(execId)) {
            const ac = new AbortController();
            activeVisibilityPollers.set(execId, ac);
            void pollVisibilityStoreDeltas(
              fastify,
              ws,
              execId,
              () =>
                visibilitySubscriptions.get(execId) ??
                new Set<VisibilitySubscriptionKind>(),
              () => ++deltaRevision,
              ac.signal,
              visibilityHashes,
            ).finally(() => {
              activeVisibilityPollers.delete(execId);
              visibilityHashes.delete(execId);
            });
          }

          // Start live event subscription for cross-connection visibility
          if (!activeSubscriptionAborts.has(execId)) {
            const ac = new AbortController();
            activeSubscriptionAborts.set(execId, ac);

            // Determine sessionId from execution record
            (async () => {
              try {
                const execRecord = await fastify.engine.getExecution(execId);
                const sid = execRecord?.sessionId;
                if (!sid) return;

                for await (const event of fastify.engine.subscribeExecution(
                  execId,
                )) {
                  if (ac.signal.aborted) break;
                  // Push event-derived deltas
                  const deltas = eventToAppDeltas(execId, event);
                  for (const delta of deltas) {
                    if (!shouldSendVisibilityDelta(delta, kinds)) continue;
                    deltaRevision++;
                    safeSend(ws, 
                      JSON.stringify({
                        type: "app_delta",
                        sessionId: sid,
                        delta,
                        revision: deltaRevision,
                      }),
                    );
                  }
                }

                // Execution completed — push store-driven visibility deltas
                if (sid && !ac.signal.aborted) {
                  await pushVisibilityDeltas(
                    fastify,
                    ws,
                    sid,
                    execId,
                    () => ++deltaRevision,
                    kinds,
                  );
                }
              } catch {
                // Non-fatal: subscription error shouldn't crash the connection
              } finally {
                activeSubscriptionAborts.delete(execId);
              }
            })();
          }
          return;
        }

        if (message.type === "interrupt") {
          await fastify.engine.interrupt(message.executionId);
          safeSend(ws,
            JSON.stringify({
              type: "complete",
              executionId: message.executionId,
            } satisfies StreamResponseMessage),
          );
          return;
        }

        if (message.type === "approval_decision") {
          const decision: ApprovalDecision = {
            decision: message.decision,
            reason: message.reason,
          };
          const resolved = fastify.engine.resolveApproval(
            message.requestId,
            decision,
          );
          safeSend(ws,
            JSON.stringify({
              type: "approval_result",
              requestId: message.requestId,
              resolved,
            }),
          );
          return;
        }

        if (message.type === "execute") {
          const executionId =
            message.executionId ?? `exec_${crypto.randomUUID()}`;

          // Validate working directory through the same path as REST routes
          let workingDir = message.workingDirectory ?? process.cwd();
          if (message.workingDirectory) {
            const { validateWorkingDirectory } = await import("./session.js");
            const result = await validateWorkingDirectory(message.workingDirectory);
            if (!result.valid) {
              const errorMsg: StreamResponseMessage = {
                type: "error",
                executionId,
                error: result.error,
              };
              safeSend(ws, JSON.stringify(errorMsg));
              return;
            }
            workingDir = result.normalized;
          }

          const runtimeRequest: RuntimeRequest = {
            sessionId: message.sessionId,
            executionId,
            prompt: message.prompt,
            workingDirectory: workingDir,
            backend: message.backend,
            approvals: message.approvals,
          };

          try {
            // Stream events to WebSocket
            for await (const event of fastify.engine.stream(runtimeRequest)) {
              const response: StreamResponseMessage = {
                type: "event",
                executionId,
                event,
              };
              safeSend(ws, JSON.stringify(response));

              // Push app deltas to subscribers of this session
              const include = appSessionSubscriptions.get(message.sessionId);
              if (include) {
                const deltas = eventToAppDeltas(executionId, event);
                for (const delta of deltas) {
                  if (!shouldSendAppDelta(delta, include)) continue;
                  deltaRevision++;
                  const deltaMsg: AppDeltaResponseMessage = {
                    type: "app_delta",
                    sessionId: message.sessionId,
                    delta,
                    revision: deltaRevision,
                  };
                  safeSend(ws, JSON.stringify(deltaMsg));
                }
              }
            }

            // Post-execution: push store-driven visibility deltas
            if (
              appSessionSubscriptions.has(message.sessionId) ||
              visibilitySubscriptions.has(executionId)
            ) {
              const include = appSessionSubscriptions.get(message.sessionId);
              const kinds = visibilitySubscriptions.get(executionId);
              await pushVisibilityDeltas(
                fastify,
                ws,
                message.sessionId,
                executionId,
                () => ++deltaRevision,
                mergeSubscriptionKinds(include, kinds),
              );
            }

            // Send completion message
            const completeMsg: StreamResponseMessage = {
              type: "complete",
              executionId,
            };
            safeSend(ws, JSON.stringify(completeMsg));
          } catch (error) {
            const errorMsg: StreamResponseMessage = {
              type: "error",
              executionId,
              error: error instanceof Error ? error.message : String(error),
            };
            safeSend(ws, JSON.stringify(errorMsg));
          }
        }
      } catch (error) {
        const errorMsg: StreamResponseMessage = {
          type: "error",
          error:
            error instanceof Error ? error.message : "Invalid message format",
        };
        safeSend(ws, JSON.stringify(errorMsg));
      }
    });

    ws.on("error", (error) => {
      fastify.log.error({ error }, "WebSocket error");
    });

    ws.on("close", () => {
      appSessionSubscriptions.clear();
      visibilitySubscriptions.clear();
      for (const ac of activeSubscriptionAborts.values()) {
        ac.abort();
      }
      activeSubscriptionAborts.clear();
      for (const ac of activeVisibilityPollers.values()) {
        ac.abort();
      }
      activeVisibilityPollers.clear();
      visibilityHashes.clear();
      // Clean up pub/sub bridge subscriptions
      for (const unsub of pubsubUnsubscribers) {
        unsub().catch(() => {});
      }
      pubsubUnsubscribers.length = 0;
      fastify.log.info("WebSocket connection closed");
    });
  });
};

async function pushSessionSnapshot(
  fastify: FastifyInstance,
  ws: JsonWebSocket,
  sessionId: string,
): Promise<void> {
  try {
    const res = await fastify.inject({
      method: "GET",
      url: `/api/v1/sessions/${encodeURIComponent(sessionId)}/app-snapshot`,
    });
    if (res.statusCode >= 400) return;
    safeSend(ws, 
      JSON.stringify({
        type: "app_snapshot",
        sessionId,
        snapshot: JSON.parse(res.body),
      }),
    );
  } catch {
    // Snapshot push is best-effort.
  }
}

async function pushExecutionVisibilitySnapshot(
  fastify: FastifyInstance,
  ws: JsonWebSocket,
  executionId: string,
): Promise<void> {
  try {
    const visibility = await fastify.engine.getExecutionVisibility(executionId);
    if (!visibility) return;
    const record = await fastify.engine.getExecution(executionId);
    safeSend(ws, 
      JSON.stringify({
        type: "visibility_snapshot",
        executionId,
        sessionId: record?.sessionId,
        visibility,
      }),
    );
  } catch {
    // Snapshot push is best-effort.
  }
}

/**
 * After execution completes, read visibility data from the store and push
 * memory, token, and summary deltas to connected subscribers.
 */
async function pushVisibilityDeltas(
  fastify: FastifyInstance,
  ws: JsonWebSocket,
  sessionId: string,
  executionId: string,
  nextRevision: () => number,
  kinds: Set<VisibilitySubscriptionKind>,
): Promise<void> {
  try {
    const visibility = await fastify.engine.getExecutionVisibility(executionId);
    if (!visibility) return;

    const events = await fastify.engine.getExecutionEvents(executionId);
    const execRecord = await fastify.engine.getExecution(executionId);
    const snapshot = buildAppExecutionSnapshot(
      sessionId,
      executionId,
      execRecord?.backend ?? "claude-code",
      visibility,
      events,
      execRecord?.prompt,
    );

    // Push token delta from store
    if (snapshot.tokens.totalTokens > 0) {
      const tokenDelta: AppVisibilityDelta = {
        type: "token_delta",
        executionId,
        tokens: snapshot.tokens,
      };
      sendDelta(ws, sessionId, tokenDelta, nextRevision, kinds);
    }

    // Push memory delta from store
    const memSelected = visibility.memory?.selected ?? [];
    if (memSelected.length > 0) {
      const memoryDelta: AppVisibilityDelta = {
        type: "memory_delta",
        executionId,
        memory: {
          added: snapshot.memory.tabs.longTerm
            .concat(snapshot.memory.tabs.session)
            .concat(snapshot.memory.tabs.knowledge),
          selectedCount: snapshot.memory.selectedCount,
          trimmedCount: snapshot.memory.trimmedCount,
        },
      };
      sendDelta(ws, sessionId, memoryDelta, nextRevision, kinds);
    }

    // Push summary delta
    const summaryDelta: AppVisibilityDelta = {
      type: "summary_delta",
      executionId,
      summary: snapshot.summary,
    };
    sendDelta(ws, sessionId, summaryDelta, nextRevision, kinds);

    // Push trace step deltas from visibility spans
    if (snapshot.tracing?.steps) {
      for (const step of snapshot.tracing.steps) {
        const traceDelta: AppVisibilityDelta = {
          type: "trace_step_delta",
          executionId,
          step,
        };
        sendDelta(ws, sessionId, traceDelta, nextRevision, kinds);
      }
    }
  } catch {
    // Non-fatal: visibility push failure shouldn't break the connection
  }
}

async function pollVisibilityStoreDeltas(
  fastify: FastifyInstance,
  ws: JsonWebSocket,
  executionId: string,
  getKinds: () => Set<VisibilitySubscriptionKind>,
  nextRevision: () => number,
  signal: AbortSignal,
  visibilityHashes: Map<string, string>,
): Promise<void> {
  let sessionId: string | undefined;
  while (!signal.aborted) {
    const kinds = getKinds();
    if (kinds.size === 0) return;
    const visibility = await fastify.engine.getExecutionVisibility(executionId);
    if (visibility) {
      const hash = JSON.stringify({
        memory: kinds.has("memory") ? visibility.memory : undefined,
        tokens: kinds.has("tokens") ? visibility.tokens : undefined,
        chain: kinds.has("chain")
          ? {
              link: visibility.link,
              mappings: visibility.mappings,
              spans: visibility.spans,
            }
          : undefined,
        summary: kinds.has("summary")
          ? visibility.context?.createdAt
          : undefined,
      });
      if (visibilityHashes.get(executionId) !== hash) {
        visibilityHashes.set(executionId, hash);
        const record = await fastify.engine.getExecution(executionId);
        sessionId = record?.sessionId ?? sessionId;
        if (sessionId) {
          await pushVisibilityDeltas(
            fastify,
            ws,
            sessionId,
            executionId,
            nextRevision,
            kinds,
          );
        }
      }
    }
    await sleep(1000, signal);
  }
}

function sendDelta(
  ws: JsonWebSocket,
  sessionId: string,
  delta: AppVisibilityDelta,
  nextRevision: () => number,
  kinds: Set<VisibilitySubscriptionKind>,
): void {
  if (!shouldSendVisibilityDelta(delta, kinds)) return;
  safeSend(ws, 
    JSON.stringify({
      type: "app_delta",
      sessionId,
      delta,
      revision: nextRevision(),
    }),
  );
}

function shouldSendAppDelta(
  delta: AppVisibilityDelta,
  include: Set<AppDeltaKind>,
): boolean {
  switch (delta.type) {
    case "conversation_delta":
      return include.has("conversation");
    case "trace_step_delta":
      return include.has("tracing");
    case "memory_delta":
      return include.has("memory");
    case "token_delta":
      return include.has("tokens");
    case "summary_delta":
      return include.has("summary");
    default:
      return false;
  }
}

function shouldSendVisibilityDelta(
  delta: AppVisibilityDelta,
  kinds: Set<VisibilitySubscriptionKind>,
): boolean {
  switch (delta.type) {
    case "memory_delta":
      return kinds.has("memory");
    case "token_delta":
      return kinds.has("tokens");
    case "trace_step_delta":
      return kinds.has("chain");
    case "summary_delta":
      return kinds.has("summary");
    case "conversation_delta":
      return false;
    default:
      return false;
  }
}

function mergeSubscriptionKinds(
  include: Set<AppDeltaKind> | undefined,
  kinds: Set<VisibilitySubscriptionKind> | undefined,
): Set<VisibilitySubscriptionKind> {
  if (kinds) return kinds;
  const result = new Set<VisibilitySubscriptionKind>();
  if (!include) return new Set(["memory", "tokens", "chain", "summary"]);
  if (include.has("memory")) result.add("memory");
  if (include.has("tokens")) result.add("tokens");
  if (include.has("tracing")) result.add("chain");
  if (include.has("summary")) result.add("summary");
  return result;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

/** Convert a RuntimeEvent to zero or more AppVisibilityDelta messages. */
function eventToAppDeltas(
  executionId: string,
  event: RuntimeEvent,
): AppVisibilityDelta[] {
  const deltas: AppVisibilityDelta[] = [];

  if (event.type === "output") {
    deltas.push({
      type: "conversation_delta",
      executionId,
      item: {
        id: `${executionId}-${event.sequence}`,
        role: event.data.role === "assistant" ? "assistant" : "system",
        content: event.data.content,
        timestamp: event.timestamp,
        executionId,
        eventSequence: event.sequence,
        metadata: event.data.final ? { final: true } : undefined,
      },
    });
  }

  if (event.type === "extension") {
    const name = event.data.name;
    if (name === "thinking") {
      const payload = event.data.payload as { text?: string } | undefined;
      const text = payload?.text ?? "";
      if (text) {
        deltas.push({
          type: "conversation_delta",
          executionId,
          item: {
            id: `${executionId}-think-${event.sequence}`,
            role: "assistant",
            content: text,
            timestamp: event.timestamp,
            executionId,
            eventSequence: event.sequence,
            metadata: { thinking: true },
          },
        });
      }
    }
    if (name === "approval_request") {
      const payload = event.data.payload as Record<string, unknown>;
      deltas.push({
        type: "conversation_delta",
        executionId,
        item: {
          id: `${executionId}-${event.sequence}`,
          role: "tool",
          content: "Approval required",
          timestamp: event.timestamp,
          executionId,
          eventSequence: event.sequence,
          metadata: {
            approval: {
              id: String(
                payload.requestId ?? `${executionId}-${event.sequence}`,
              ),
              type: String(payload.operationType ?? "shell"),
              command:
                typeof payload.command === "string"
                  ? payload.command
                  : undefined,
              path: typeof payload.path === "string" ? payload.path : undefined,
              reason:
                typeof payload.description === "string"
                  ? payload.description
                  : undefined,
            },
          },
        },
      });
    }
    if (name === "approval_decision") {
      const payload = event.data.payload as
        | { approved?: boolean; decision?: string; requestId?: string }
        | undefined;
      const approved =
        typeof payload?.approved === "boolean"
          ? payload.approved
          : payload?.decision === "approve";
      deltas.push({
        type: "conversation_delta",
        executionId,
        item: {
          id: `${executionId}-${event.sequence}`,
          role: "system",
          content: approved ? "Approval granted" : "Approval denied",
          timestamp: event.timestamp,
          executionId,
          eventSequence: event.sequence,
          metadata: {
            approval: {
              id: String(
                payload?.requestId ?? `${executionId}-${event.sequence}`,
              ),
              type: "shell",
              status: approved ? "approved" : "denied",
            },
          },
        },
      });
    }
  }

  if (event.type === "state") {
    const s = event.data.state;
    const statusMap: Record<string, string> = {
      running: "running",
      completed: "completed",
      failed: "failed",
      waiting_approval: "pending",
      queued: "pending",
    };
    if (statusMap[s]) {
      const status: TraceStepView["status"] =
        statusMap[s] === "running"
          ? "running"
          : statusMap[s] === "completed"
            ? "completed"
            : statusMap[s] === "failed"
              ? "failed"
              : "pending";
      deltas.push({
        type: "trace_step_delta",
        executionId,
        step: {
          key: "request",
          label: s,
          status,
        },
      });
    }
  }

  // Trace step deltas for approval events
  if (event.type === "extension") {
    const name = event.data.name;
    if (name === "approval_request") {
      deltas.push({
        type: "trace_step_delta",
        executionId,
        step: {
          key: "approval",
          label: "Approval requested",
          status: "pending",
        },
      });
    }
    if (name === "approval_decision") {
      const payload = event.data.payload as
        | { approved?: boolean; decision?: string }
        | undefined;
      const approved = payload?.approved;
      const decision =
        typeof approved === "boolean"
          ? approved
            ? "approved"
            : "denied"
          : (payload?.decision ?? "unknown");
      deltas.push({
        type: "trace_step_delta",
        executionId,
        step: {
          key: "approval",
          label: `Approval: ${decision}`,
          status:
            decision === "approved" || decision === "allow"
              ? "completed"
              : "failed",
        },
      });
    }
  }

  // Trace step deltas for MCP tool calls
  if (event.type === "tool_call") {
    deltas.push({
      type: "conversation_delta",
      executionId,
      item: {
        id: `${executionId}-tc-${event.sequence}`,
        role: "tool",
        content: `Tool: ${event.data.toolName}`,
        timestamp: event.timestamp,
        executionId,
        eventSequence: event.sequence,
        metadata: {
          toolCall: {
            name: event.data.toolName,
            arguments: event.data.arguments,
          },
        },
      },
    });
    deltas.push({
      type: "trace_step_delta",
      executionId,
      step: {
        key: "mcp",
        label: `Tool: ${event.data.toolName}`,
        status: "running",
      },
    });
  }

  if (event.type === "tool_result") {
    deltas.push({
      type: "trace_step_delta",
      executionId,
      step: {
        key: "mcp",
        label: `Tool result: ${event.data.status}`,
        status: event.data.status === "success" ? "completed" : "failed",
      },
    });
  }

  return deltas;
}
