import type { FastifyPluginAsync } from "fastify";
import { getMappedBackendStatus } from "./status-helper.js";

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

  // Get engine metrics
  fastify.get("/metrics", async () => {
    return fastify.engine.getMetrics();
  });
};
