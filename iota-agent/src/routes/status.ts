import type { FastifyPluginAsync } from "fastify";
import { getMappedBackendStatus } from "./status-helper.js";
import type { BackendName } from "@iota/engine";

export const statusRoutes: FastifyPluginAsync = async (fastify) => {
  // Get backend status mapped to App Read Model
  fastify.get("/status", async (_request, reply) => {
    try {
      const backends = await getMappedBackendStatus(fastify);
      return { backends };
    } catch (error) {
      fastify.log.error(error);
      reply.code(500);
      return {
        backends: [],
        error:
          error instanceof Error ? error.message : "Failed to retrieve status",
      };
    }
  });

  // Reset circuit breaker for a specific backend
  fastify.post<{ Params: { backend: string } }>("/backends/:backend/reset-circuit", async (request, reply) => {
    const backend = request.params.backend as BackendName;
    const ok = fastify.engine.resetCircuitBreaker(backend);
    if (!ok) {
      reply.code(404);
      return { error: `Backend ${backend} not found` };
    }
    return { ok: true };
  });

  // Get engine metrics
  fastify.get("/metrics", async () => {
    return fastify.engine.getMetrics();
  });
};
