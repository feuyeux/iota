import type { FastifyPluginAsync } from "fastify";
import type { BackendName, TraceAggregationOptions } from "@iota/engine";
import {
  buildAppExecutionSnapshot,
  buildAppSessionSnapshot,
} from "@iota/engine";
import { BACKEND_ENUM_SCHEMA, parseTime } from "./shared.js";
import { getMappedBackendStatus } from "./status-helper.js";

const visibilityParamsSchema = {
  params: {
    type: "object",
    required: ["executionId"],
    properties: {
      executionId: { type: "string", minLength: 1, maxLength: 100 },
    },
  },
} as const;

const sessionVisibilityParamsSchema = {
  params: {
    type: "object",
    required: ["sessionId"],
    properties: {
      sessionId: { type: "string", minLength: 1, maxLength: 100 },
    },
  },
  querystring: {
    type: "object",
    properties: {
      limit: { type: "string", pattern: "^\\d+$" },
      offset: { type: "string", pattern: "^\\d+$" },
      afterTimestamp: { type: "string", pattern: "^\\d+$" },
      backend: BACKEND_ENUM_SCHEMA,
    },
  },
} as const;

const traceAggregateQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      sessionId: { type: "string", minLength: 1, maxLength: 100 },
      executionId: { type: "string", minLength: 1, maxLength: 100 },
      backend: BACKEND_ENUM_SCHEMA,
      since: { type: "string", minLength: 1 },
      until: { type: "string", minLength: 1 },
      limit: { type: "string", pattern: "^\\d+$" },
      offset: { type: "string", pattern: "^\\d+$" },
    },
  },
} as const;

export const visibilityRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /executions/:executionId/visibility — full visibility bundle
  fastify.get<{ Params: { executionId: string } }>(
    "/executions/:executionId/visibility",
    { schema: visibilityParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;
      const visibility =
        await fastify.engine.getExecutionVisibility(executionId);
      if (!visibility) {
        reply.code(404);
        return { error: "Visibility data not found", executionId };
      }
      return visibility;
    },
  );

  // GET /executions/:executionId/visibility/memory
  fastify.get<{ Params: { executionId: string } }>(
    "/executions/:executionId/visibility/memory",
    { schema: visibilityParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;
      const visibility =
        await fastify.engine.getExecutionVisibility(executionId);
      if (!visibility?.memory) {
        reply.code(404);
        return { error: "Memory visibility data not found", executionId };
      }
      return visibility.memory;
    },
  );

  // GET /executions/:executionId/visibility/tokens
  fastify.get<{ Params: { executionId: string } }>(
    "/executions/:executionId/visibility/tokens",
    { schema: visibilityParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;
      const visibility =
        await fastify.engine.getExecutionVisibility(executionId);
      if (!visibility?.tokens) {
        reply.code(404);
        return { error: "Token visibility data not found", executionId };
      }
      return visibility.tokens;
    },
  );

  // GET /executions/:executionId/visibility/chain
  fastify.get<{ Params: { executionId: string } }>(
    "/executions/:executionId/visibility/chain",
    { schema: visibilityParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;
      const visibility =
        await fastify.engine.getExecutionVisibility(executionId);
      const spans = visibility?.spans ?? visibility?.link?.spans ?? [];
      if (!visibility?.link && spans.length === 0) {
        reply.code(404);
        return { error: "Chain visibility data not found", executionId };
      }
      return { link: visibility?.link, spans, mappings: visibility?.mappings };
    },
  );

  // GET /executions/:executionId/trace — hierarchical trace tree
  fastify.get<{ Params: { executionId: string } }>(
    "/executions/:executionId/trace",
    { schema: visibilityParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;
      const trace = await fastify.engine.getExecutionTrace(executionId);
      if (!trace) {
        reply.code(404);
        return { error: "Trace data not found", executionId };
      }
      return trace;
    },
  );

  // GET /traces/aggregate — aggregate traces across executions
  fastify.get<{
    Querystring: {
      sessionId?: string;
      executionId?: string;
      backend?: BackendName;
      since?: string;
      until?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    "/traces/aggregate",
    { schema: traceAggregateQuerySchema },
    async (request, reply) => {
      const options = parseTraceAggregateQuery(request.query);
      if (typeof options === "string") {
        reply.code(400);
        return { error: "Invalid trace query", message: options };
      }
      return fastify.engine.aggregateTraces(options);
    },
  );

  // GET /sessions/:sessionId/visibility — list visibility summaries
  fastify.get<{
    Params: { sessionId: string };
    Querystring: {
      limit?: string;
      offset?: string;
      afterTimestamp?: string;
      backend?: import("@iota/engine").BackendName;
    };
  }>(
    "/sessions/:sessionId/visibility",
    { schema: sessionVisibilityParamsSchema },
    async (request) => {
      const { sessionId } = request.params;
      const limit = Math.min(parseInt(request.query.limit ?? "50", 10), 200);
      const offset = parseInt(request.query.offset ?? "0", 10);
      const afterTimestamp = request.query.afterTimestamp
        ? parseInt(request.query.afterTimestamp, 10)
        : undefined;
      const summaries = (
        await fastify.engine.listSessionVisibility(sessionId, {
          limit,
          offset,
          afterTimestamp,
        })
      ).filter(
        (summary) =>
          !request.query.backend || summary.backend === request.query.backend,
      );
      return { sessionId, summaries };
    },
  );

  // GET /sessions/:sessionId/visibility/summary — aggregate visibility summary
  fastify.get<{
    Params: { sessionId: string };
    Querystring: {
      limit?: string;
      offset?: string;
      afterTimestamp?: string;
      backend?: import("@iota/engine").BackendName;
    };
  }>(
    "/sessions/:sessionId/visibility/summary",
    { schema: sessionVisibilityParamsSchema },
    async (request) => {
      const { sessionId } = request.params;
      const limit = Math.min(parseInt(request.query.limit ?? "200", 10), 500);
      const offset = parseInt(request.query.offset ?? "0", 10);
      const afterTimestamp = request.query.afterTimestamp
        ? parseInt(request.query.afterTimestamp, 10)
        : undefined;
      const summaries = (
        await fastify.engine.listSessionVisibility(sessionId, {
          limit,
          offset,
          afterTimestamp,
        })
      ).filter(
        (summary) =>
          !request.query.backend || summary.backend === request.query.backend,
      );

      const byBackend: Record<string, number> = {};
      let inputTokens = 0;
      let outputTokens = 0;
      let selectedMemory = 0;
      let trimmedMemory = 0;

      for (const summary of summaries) {
        byBackend[summary.backend] = (byBackend[summary.backend] ?? 0) + 1;
        const visibility = await fastify.engine.getExecutionVisibility(
          summary.executionId,
        );
        inputTokens +=
          visibility?.tokens?.input.nativeTokens ??
          visibility?.tokens?.input.estimatedTokens ??
          0;
        outputTokens +=
          visibility?.tokens?.output.nativeTokens ??
          visibility?.tokens?.output.estimatedTokens ??
          0;
        selectedMemory += visibility?.memory?.selected.length ?? 0;
        trimmedMemory +=
          visibility?.memory?.selected.filter((item) => item.trimmed).length ??
          0;
      }

      return {
        sessionId,
        executionCount: summaries.length,
        tokens: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          averageTokens:
            summaries.length > 0
              ? Math.round((inputTokens + outputTokens) / summaries.length)
              : 0,
        },
        memory: {
          selectedBlocks: selectedMemory,
          trimmedBlocks: trimmedMemory,
        },
        byBackend,
      };
    },
  );

  // GET /executions/:executionId/app-snapshot
  fastify.get<{ Params: { executionId: string } }>(
    "/executions/:executionId/app-snapshot",
    { schema: visibilityParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;

      const record = await fastify.engine.getExecution(executionId);
      if (!record) {
        reply.code(404);
        return { error: "Execution not found", executionId };
      }

      const visibility =
        await fastify.engine.getExecutionVisibility(executionId);
      const events = await fastify.engine.getExecutionEvents(executionId);

      const snapshot = buildAppExecutionSnapshot(
        record.sessionId,
        executionId,
        record.backend,
        visibility ?? {},
        events,
        record.prompt,
      );
      return snapshot;
    },
  );

  fastify.get<{ Params: { executionId: string } }>(
    "/executions/:executionId/replay",
    { schema: visibilityParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;

      const record = await fastify.engine.getExecution(executionId);
      if (!record) {
        reply.code(404);
        return { error: "Execution not found", executionId };
      }

      const snapshot = buildAppExecutionSnapshot(
        record.sessionId,
        executionId,
        record.backend,
        (await fastify.engine.getExecutionVisibility(executionId)) ?? {},
        await fastify.engine.getExecutionEvents(executionId),
        record.prompt,
      );

      return {
        executionId,
        sessionId: record.sessionId,
        backend: record.backend,
        prompt: record.prompt,
        status: record.status,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        events: snapshot.conversation.items,
      };
    },
  );

  // GET /sessions/:sessionId/app-snapshot — session-level snapshot (Section 9.4)
  fastify.get<{
    Params: { sessionId: string };
  }>(
    "/sessions/:sessionId/app-snapshot",
    { schema: sessionVisibilityParamsSchema },
    async (request, reply) => {
      const { sessionId } = request.params;

      const session = await fastify.engine.getSession(sessionId);
      if (!session) {
        reply.code(404);
        return { error: "Session not found", sessionId };
      }

      const sessionView = session as typeof session & {
        activeBackend?: BackendName;
        updatedAt?: number;
      };

      // Use execution records as primary source (survives visibility TTL/write failure)
      const execRecords = await fastify.engine.listSessionExecutions(sessionId);

      // Build execution snapshots — include all executions, not just those with visibility
      const executionSnapshots = [];
      for (const execRecord of execRecords) {
        const visibility = await fastify.engine.getExecutionVisibility(
          execRecord.executionId,
        );
        const events = await fastify.engine.getExecutionEvents(
          execRecord.executionId,
        );
        executionSnapshots.push(
          buildAppExecutionSnapshot(
            sessionId,
            execRecord.executionId,
            execRecord.backend,
            visibility ?? {},
            events,
            execRecord.prompt,
          ),
        );
      }

      // Build backend status views
      const backends = await getMappedBackendStatus(
        fastify,
        sessionView.activeBackend,
      );

      const snapshot = buildAppSessionSnapshot({
        sessionId,
        activeBackend: (session as any).activeBackend ?? "claude-code",
        workingDirectory: session.workingDirectory,
        createdAt: session.createdAt,
        updatedAt: (session as any).updatedAt ?? session.createdAt,
        backends,
        executionSnapshots,
        activeFiles: fastify.engine.getActiveFiles(sessionId),
        mcpServers: fastify.engine.getMcpServers(),
      });
      return snapshot;
    },
  );
};

function parseTraceAggregateQuery(query: {
  sessionId?: string;
  executionId?: string;
  backend?: BackendName;
  since?: string;
  until?: string;
  limit?: string;
  offset?: string;
}): TraceAggregationOptions | string {
  const since = parseTime(query.since, "since");
  if (typeof since === "string") return since;
  const until = parseTime(query.until, "until");
  if (typeof until === "string") return until;

  return {
    sessionId: query.sessionId,
    executionId: query.executionId,
    backend: query.backend,
    since,
    until,
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
  };
}
