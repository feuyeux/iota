import type { FastifyPluginAsync } from "fastify";
import type { BackendName } from "@iota/engine";

/**
 * Cross-session data access routes
 * Provides APIs for querying logs, memories, and backend isolation across sessions.
 * Uses Engine API methods instead of accessing storage directly (encapsulation).
 */
export const crossSessionRoutes: FastifyPluginAsync = async (fastify) => {
  const { engine } = fastify;

  /**
   * GET /cross-session/logs
   * Query logs across sessions with filtering
   */
  fastify.get<{
    Querystring: {
      sessionId?: string;
      executionId?: string;
      backend?: BackendName;
      eventType?: string;
      since?: string;
      until?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    "/cross-session/logs",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            executionId: { type: "string" },
            backend: { type: "string" },
            eventType: { type: "string" },
            since: { type: "string" },
            until: { type: "string" },
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const options = {
          sessionId: request.query.sessionId,
          executionId: request.query.executionId,
          backend: request.query.backend as BackendName | undefined,
          eventType: request.query.eventType as any,
          since: request.query.since ? Number(request.query.since) : undefined,
          until: request.query.until ? Number(request.query.until) : undefined,
          limit: request.query.limit ? Number(request.query.limit) : undefined,
          offset: request.query.offset
            ? Number(request.query.offset)
            : undefined,
        };

        const logs = await engine.queryLogs(options);
        return reply.send({
          logs,
          count: logs.length,
          options,
        });
      } catch (err: any) {
        return reply
          .code(501)
          .send({ error: err.message ?? "queryLogs not supported" });
      }
    },
  );

  /**
   * GET /cross-session/logs/aggregate
   * Aggregate log statistics across sessions
   */
  fastify.get<{
    Querystring: {
      sessionId?: string;
      backend?: BackendName;
      since?: string;
      until?: string;
    };
  }>(
    "/cross-session/logs/aggregate",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            backend: { type: "string" },
            since: { type: "string" },
            until: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const options = {
          sessionId: request.query.sessionId,
          backend: request.query.backend as BackendName | undefined,
          since: request.query.since ? Number(request.query.since) : undefined,
          until: request.query.until ? Number(request.query.until) : undefined,
        };

        const aggregation = await engine.aggregateLogs(options);
        return reply.send(aggregation);
      } catch (err: any) {
        return reply
          .code(501)
          .send({ error: err.message ?? "aggregateLogs not supported" });
      }
    },
  );

  /**
   * GET /cross-session/sessions
   * List all sessions
   */
  fastify.get<{
    Querystring: {
      limit?: string;
    };
  }>(
    "/cross-session/sessions",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? Number(request.query.limit) : 100;
        const sessions = await engine.listAllSessions(limit);
        return reply.send({
          sessions,
          count: sessions.length,
        });
      } catch (err: any) {
        return reply
          .code(501)
          .send({ error: err.message ?? "listAllSessions not supported" });
      }
    },
  );

  /**
   * GET /cross-session/memories/search
   * Search memories across all sessions
   */
  fastify.get<{
    Querystring: {
      query: string;
      limit?: string;
    };
  }>(
    "/cross-session/memories/search",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string" },
            limit: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { query } = request.query;
        const limit = request.query.limit ? Number(request.query.limit) : 10;

        const memories = await engine.searchMemoriesAcrossSessions(
          query,
          limit,
        );
        return reply.send({
          memories,
          count: memories.length,
          query,
        });
      } catch (err: any) {
        return reply.code(501).send({
          error: err.message ?? "searchMemoriesAcrossSessions not supported",
        });
      }
    },
  );

  /**
   * GET /cross-session/backend-isolation
   * Get backend isolation report
   */
  fastify.get("/cross-session/backend-isolation", async (_request, reply) => {
    try {
      const report = await engine.getBackendIsolationReport();
      return reply.send(report);
    } catch (err: any) {
      return reply.code(501).send({
        error: err.message ?? "getBackendIsolationReport not supported",
      });
    }
  });
};
