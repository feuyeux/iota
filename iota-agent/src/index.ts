import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IotaEngine, DeferredApprovalHook } from "@iota/engine";
import { executionRoutes } from "./routes/execution.js";
import { logsRoutes } from "./routes/logs.js";
import { sessionRoutes } from "./routes/session.js";
import { statusRoutes } from "./routes/status.js";
import { configRoutes } from "./routes/config.js";
import { visibilityRoutes } from "./routes/visibility.js";
import { crossSessionRoutes } from "./routes/cross-session.js";
import { websocketHandler } from "./routes/websocket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../");

const PORT = parseInt(process.env.PORT ?? "9666", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main() {
  // Initialize Iota Engine with PROJECT_ROOT and deferred approval for WebSocket
  const approvalHook = new DeferredApprovalHook();
  const engine = new IotaEngine({
    workingDirectory: PROJECT_ROOT,
    approvalHook,
  });
  await engine.init();

  // Create Fastify server
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    requestIdLogLabel: "reqId",
    disableRequestLogging: false,
  });

  // Register plugins
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "*",
    credentials: true,
  });

  await fastify.register(websocket);

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    allowList: ["127.0.0.1", "::1"],
  });

  // Decorate fastify with engine instance
  fastify.decorate("engine", engine);

  // Health check — basic liveness
  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  // Deep health check — readiness probe for K8s / load balancers
  fastify.get("/healthz", async (_request, reply) => {
    try {
      const backends = await engine.status();
      const entries = Object.values(backends);
      const allHealthy = entries.every(
        (b) =>
          b && typeof b === "object" && "healthy" in b && b.healthy === true,
      );
      const statusCode = allHealthy ? 200 : 503;
      reply.code(statusCode);
      return {
        status: allHealthy ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        backends,
      };
    } catch (error) {
      reply.code(503);
      return {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  // Request logging hooks
  fastify.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      "request completed",
    );
  });

  // Register routes
  await fastify.register(statusRoutes, { prefix: "/api/v1" });
  await fastify.register(sessionRoutes, { prefix: "/api/v1" });
  await fastify.register(executionRoutes, { prefix: "/api/v1" });
  await fastify.register(logsRoutes, { prefix: "/api/v1" });
  await fastify.register(configRoutes, { prefix: "/api/v1" });
  await fastify.register(visibilityRoutes, { prefix: "/api/v1" });
  await fastify.register(crossSessionRoutes, { prefix: "/api/v1" });
  await fastify.register(websocketHandler, { prefix: "/api/v1" });

  // Graceful shutdown
  const signals = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, shutting down gracefully...`);
      await engine.destroy();
      await fastify.close();
      process.exit(0);
    });
  }

  // Start server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Iota Agent HTTP service listening on ${HOST}:${PORT}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Type augmentation for Fastify
declare module "fastify" {
  interface FastifyInstance {
    engine: IotaEngine;
  }
}
