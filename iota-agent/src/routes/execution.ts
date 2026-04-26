import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { RuntimeRequest, BackendName } from "@iota/engine";
import { validateWorkingDirectory } from "./session.js";
import { BACKEND_ENUM_SCHEMA, notFound } from "./shared.js";

/** Maximum execution time before automatic interrupt (30 minutes) */
const EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;

interface ExecuteRequestBody {
  sessionId: string;
  prompt: string;
  workingDirectory?: string;
  backend?: BackendName;
  approvals?: Record<string, "auto" | "deny" | "ask">;
}

interface ExecuteResponse {
  executionId: string;
  sessionId: string;
  status: "queued" | "running" | "completed" | "failed";
}

const executeSchema = {
  body: {
    type: "object",
    required: ["sessionId", "prompt"],
    properties: {
      sessionId: { type: "string", minLength: 1, maxLength: 100 },
      prompt: { type: "string", minLength: 1, maxLength: 100_000 },
      workingDirectory: { type: "string", maxLength: 1000 },
      backend: BACKEND_ENUM_SCHEMA,
      approvals: {
        type: "object",
        additionalProperties: {
          type: "string",
          enum: ["auto", "deny", "ask"],
        },
      },
    },
  },
} as const;

const executionParamsSchema = {
  params: {
    type: "object",
    required: ["executionId"],
    properties: {
      executionId: { type: "string", minLength: 1, maxLength: 100 },
    },
  },
} as const;

const executionEventsSchema = {
  params: {
    type: "object",
    required: ["executionId"],
    properties: {
      executionId: { type: "string", minLength: 1, maxLength: 100 },
    },
  },
  querystring: {
    type: "object",
    properties: {
      offset: { type: "string", pattern: "^\\d+$" },
      limit: { type: "string", pattern: "^\\d+$" },
    },
  },
} as const;

export const executionRoutes: FastifyPluginAsync = async (fastify) => {
  // Execute a prompt (non-streaming)
  fastify.post<{ Body: ExecuteRequestBody }>(
    "/execute",
    { schema: executeSchema },
    async (request, reply) => {
      const { sessionId, prompt, workingDirectory, backend, approvals } =
        request.body;

      // Validate session exists before queuing execution
      const session = await fastify.engine.getSession(sessionId);
      if (!session) {
        reply.code(404);
        return { error: "Session not found", sessionId };
      }

      // Validate and normalize working directory if provided
      let resolvedWorkingDir =
        workingDirectory ?? session.workingDirectory ?? process.cwd();
      if (workingDirectory) {
        const result = await validateWorkingDirectory(workingDirectory);
        if (!result.valid) {
          reply.code(400);
          return { error: result.error };
        }
        resolvedWorkingDir = result.normalized;
      }

      const executionId = `exec_${crypto.randomUUID()}`;

      const runtimeRequest: RuntimeRequest = {
        sessionId,
        executionId,
        prompt,
        workingDirectory: resolvedWorkingDir,
        backend,
        approvals,
      };

      // Execute in background with timeout guard
      (async () => {
        const timeoutId = setTimeout(() => {
          fastify.engine.interrupt(executionId).catch((err: unknown) =>
            fastify.log.error(
              {
                executionId,
                err: err instanceof Error ? err.message : String(err),
              },
              "Failed to interrupt timed-out execution",
            ),
          );
        }, EXECUTION_TIMEOUT_MS);

        try {
          for await (const event of fastify.engine.stream(runtimeRequest)) {
            void event;
            // Events are persisted and published by the engine internally
          }
        } catch (error: unknown) {
          fastify.log.error(
            {
              executionId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Execution failed with unhandled error",
          );
        } finally {
          clearTimeout(timeoutId);
        }
      })();

      reply.code(202);
      return {
        executionId,
        sessionId,
        status: "queued",
      } as ExecuteResponse;
    },
  );

  // Get execution status
  fastify.get<{ Params: { executionId: string } }>(
    "/executions/:executionId",
    { schema: executionParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;
      const record = await fastify.engine.getExecution(executionId);
      if (!record) {
        return notFound(reply, "Execution", executionId);
      }
      return record;
    },
  );

  // Get execution events (paginated)
  fastify.get<{
    Params: { executionId: string };
    Querystring: { offset?: string; limit?: string };
  }>(
    "/executions/:executionId/events",
    { schema: executionEventsSchema },
    async (request, reply) => {
      const { executionId } = request.params;
      const offset = parseInt(request.query.offset ?? "0", 10);
      const limit = Math.min(parseInt(request.query.limit ?? "100", 10), 1000);

      const record = await fastify.engine.getExecution(executionId);
      if (!record) {
        return notFound(reply, "Execution", executionId);
      }

      const events = await fastify.engine.getExecutionEvents(
        executionId,
        offset,
        limit,
      );
      return { executionId, offset, limit, count: events.length, events };
    },
  );

  // Interrupt execution
  fastify.post<{ Params: { executionId: string } }>(
    "/executions/:executionId/interrupt",
    { schema: executionParamsSchema },
    async (request, reply) => {
      const { executionId } = request.params;

      const record = await fastify.engine.getExecution(executionId);
      if (!record) {
        return notFound(reply, "Execution", executionId);
      }

      try {
        await fastify.engine.interrupt(executionId);
        return { executionId, status: "interrupted" };
      } catch (error) {
        reply.code(500);
        return {
          error: "Interrupt failed",
          message: error instanceof Error ? error.message : "Unknown error",
          executionId,
        };
      }
    },
  );
};
