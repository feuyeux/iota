import type { FastifyPluginAsync } from "fastify";
import type { BackendName, LogQueryOptions, RuntimeEvent } from "@iota/engine";
import { BACKEND_ENUM_SCHEMA, parseTime } from "./shared.js";

interface LogsQuery {
  sessionId?: string;
  executionId?: string;
  backend?: BackendName;
  eventType?: RuntimeEvent["type"];
  since?: string;
  until?: string;
  offset?: string;
  limit?: string;
}

const EVENT_TYPE_SCHEMA = {
  type: "string",
  enum: [
    "output",
    "state",
    "tool_call",
    "tool_result",
    "file_delta",
    "error",
    "extension",
  ],
} as const;

const logsQuerySchema = {
  querystring: {
    type: "object",
    properties: {
      sessionId: { type: "string", minLength: 1, maxLength: 100 },
      executionId: { type: "string", minLength: 1, maxLength: 100 },
      backend: BACKEND_ENUM_SCHEMA,
      eventType: EVENT_TYPE_SCHEMA,
      since: { type: "string", minLength: 1 },
      until: { type: "string", minLength: 1 },
      offset: { type: "string", pattern: "^\\d+$" },
      limit: { type: "string", pattern: "^\\d+$" },
    },
  },
} as const;

export const logsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: LogsQuery }>(
    "/logs",
    { schema: logsQuerySchema },
    async (request, reply) => {
      const options = parseLogQuery(request.query);
      if (typeof options === "string") {
        reply.code(400);
        return { error: "Invalid log query", message: options };
      }

      const logs = await fastify.engine.queryLogs(options);
      return {
        offset: options.offset ?? 0,
        limit: options.limit ?? 100,
        count: logs.length,
        logs,
      };
    },
  );

  fastify.get<{ Querystring: LogsQuery }>(
    "/logs/aggregate",
    { schema: logsQuerySchema },
    async (request, reply) => {
      const options = parseLogQuery(request.query);
      if (typeof options === "string") {
        reply.code(400);
        return { error: "Invalid log query", message: options };
      }

      const aggregate = await fastify.engine.aggregateLogs(options);
      return { aggregate };
    },
  );

  // Unified memory search
  fastify.get<{
    Querystring: {
      query: string;
      limit?: string;
    };
  }>(
    "/memories/search",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1 },
            limit: { type: "string", pattern: "^\\d+$" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { query } = request.query;
        const limit = request.query.limit ? Number(request.query.limit) : 10;

        const memories = await fastify.engine.searchMemories(query, limit);
        return {
          query,
          limit,
          count: memories.length,
          memories,
        };
      } catch (err: any) {
        reply.code(501);
        return {
          error: err.message ?? "Unified memory search not supported",
        };
      }
    },
  );

  // Backend isolation report
  fastify.get("/backend-isolation", async (_request, reply) => {
    try {
      const report = await fastify.engine.getBackendIsolationReport();
      return report;
    } catch (err: any) {
      reply.code(501);
      return { error: err.message ?? "Backend isolation report not supported" };
    }
  });

  // List all sessions
  fastify.get<{
    Querystring: {
      limit?: string;
    };
  }>(
    "/sessions/all",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string", pattern: "^\\d+$" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? Number(request.query.limit) : 100;
        const sessions = await fastify.engine.listAllSessions(limit);
        return {
          limit,
          count: sessions.length,
          sessions,
        };
      } catch (err: any) {
        reply.code(501);
        return { error: err.message ?? "List all sessions not supported" };
      }
    },
  );
};

function parseLogQuery(query: LogsQuery): LogQueryOptions | string {
  const since = parseTime(query.since, "since");
  if (typeof since === "string") return since;
  const until = parseTime(query.until, "until");
  if (typeof until === "string") return until;

  return {
    sessionId: query.sessionId,
    executionId: query.executionId,
    backend: query.backend,
    eventType: query.eventType,
    since,
    until,
    offset: query.offset ? Number(query.offset) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}
