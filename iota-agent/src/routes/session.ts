import type { FastifyPluginAsync } from "fastify";
import { resolve, normalize, sep } from "node:path";
import { access, stat } from "node:fs/promises";
import { IotaError } from "@iota/engine";
import { BACKEND_ENUM_SCHEMA } from "./shared.js";

interface CreateSessionBody {
  workingDirectory?: string;
  backend?: string;
}

const createSessionSchema = {
  body: {
    type: "object",
    properties: {
      workingDirectory: { type: "string", maxLength: 1000 },
      backend: BACKEND_ENUM_SCHEMA,
    },
  },
} as const;

const sessionParamsSchema = {
  params: {
    type: "object",
    required: ["sessionId"],
    properties: {
      sessionId: { type: "string", minLength: 1, maxLength: 100 },
    },
  },
} as const;

/**
 * Allowed root directories for working directory validation.
 * If empty, any accessible directory is permitted (development default).
 * Set via IOTA_ALLOWED_ROOTS env var (comma-separated absolute paths).
 */
const ALLOWED_ROOTS: string[] = (process.env.IOTA_ALLOWED_ROOTS ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => normalize(resolve(r)));

/**
 * Validate and normalize a working directory path.
 * Rejects path traversal attacks, non-existent directories, and paths
 * outside configured allowed roots.
 */
export async function validateWorkingDirectory(
  dir: string,
): Promise<
  { valid: true; normalized: string } | { valid: false; error: string }
> {
  // Block null bytes before any path operations
  if (dir.includes("\0")) {
    return { valid: false, error: "Working directory contains null bytes" };
  }

  const normalized = normalize(resolve(dir));

  // Enforce allowed roots when configured
  if (ALLOWED_ROOTS.length > 0) {
    const withinRoot = ALLOWED_ROOTS.some(
      (root) => normalized === root || normalized.startsWith(root + (root.endsWith("/") || root.endsWith("\\") ? "" : sep)),
    );
    if (!withinRoot) {
      return {
        valid: false,
        error: "Working directory is outside the allowed roots",
      };
    }
  }

  try {
    await access(normalized);
    const info = await stat(normalized);
    if (!info.isDirectory()) {
      return { valid: false, error: "Path is not a directory" };
    }
  } catch {
    return {
      valid: false,
      error: "Working directory does not exist or is not accessible",
    };
  }

  return { valid: true, normalized };
}

export const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  // Create a new session
  fastify.post<{ Body: CreateSessionBody }>(
    "/sessions",
    { schema: createSessionSchema },
    async (request, reply) => {
      const { workingDirectory } = request.body;

      let resolvedDir: string | undefined;
      if (workingDirectory) {
        const result = await validateWorkingDirectory(workingDirectory);
        if (!result.valid) {
          reply.code(400);
          return { error: result.error };
        }
        resolvedDir = result.normalized;
      }

      const session = await fastify.engine.createSession({
        workingDirectory: resolvedDir,
      });

      reply.code(201);
      return {
        sessionId: session.id,
        createdAt: session.createdAt,
      };
    },
  );

  // Get session info
  fastify.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId",
    { schema: sessionParamsSchema },
    async (request, reply) => {
      const { sessionId } = request.params;

      const session = await fastify.engine.getSession(sessionId);
      if (!session) {
        reply.code(404);
        return {
          error: "Session not found",
          message: `The session "${sessionId}" does not exist or has been deleted.`,
        };
      }

      return {
        sessionId: session.id,
        workingDirectory: session.workingDirectory,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    },
  );

  // Delete session
  fastify.delete<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId",
    { schema: sessionParamsSchema },
    async (request, reply) => {
      const { sessionId } = request.params;

      const session = await fastify.engine.getSession(sessionId);
      if (!session) {
        reply.code(404);
        return {
          error: "Session not found",
          message: `The session "${sessionId}" does not exist or has been deleted.`,
        };
      }

      await fastify.engine.deleteSession(sessionId);
      reply.code(204);
      return;
    },
  );

  // Update session context (active files)
  fastify.put<{
    Params: { sessionId: string };
    Body: { activeFiles: Array<{ path: string; pinned?: boolean }> };
  }>(
    "/sessions/:sessionId/context",
    {
      schema: {
        ...sessionParamsSchema,
        body: {
          type: "object",
          required: ["activeFiles"],
          properties: {
            activeFiles: {
              type: "array",
              items: {
                type: "object",
                required: ["path"],
                properties: {
                  path: { type: "string" },
                  pinned: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { activeFiles } = request.body;

      const session = await fastify.engine.getSession(sessionId);
      if (!session) {
        reply.code(404);
        return { error: "Session not found" };
      }

      // Update working memory
      fastify.engine.setActiveFiles(sessionId, activeFiles);

      return { success: true };
    },
  );

  fastify.get<{
    Params: { sessionId: string };
    Querystring: { path: string };
  }>(
    "/sessions/:sessionId/workspace/file",
    {
      schema: {
        ...sessionParamsSchema,
        querystring: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string", minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await fastify.engine.readWorkspaceFile(
          request.params.sessionId,
          request.query.path,
        );
      } catch (error) {
        if (error instanceof IotaError) {
          reply.code(error.code === "WORKSPACE_OUTSIDE_ROOT" ? 403 : 404);
          return { error: error.message };
        }
        reply.code(500);
        return { error: "Failed to read workspace file" };
      }
    },
  );

  fastify.put<{
    Params: { sessionId: string };
    Body: { path: string; content: string };
  }>(
    "/sessions/:sessionId/workspace/file",
    {
      schema: {
        ...sessionParamsSchema,
        body: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string", minLength: 1, maxLength: 4000 },
            content: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await fastify.engine.writeWorkspaceFile(
          request.params.sessionId,
          request.body.path,
          request.body.content,
        );
      } catch (error) {
        if (error instanceof IotaError) {
          reply.code(error.code === "WORKSPACE_OUTSIDE_ROOT" ? 403 : 404);
          return { error: error.message };
        }
        reply.code(500);
        return { error: "Failed to write workspace file" };
      }
    },
  );

  fastify.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string };
  }>(
    "/sessions/:sessionId/memories",
    {
      schema: {
        ...sessionParamsSchema,
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
        const limit = Math.min(Number(request.query.limit ?? "50"), 200);
        const memories = await fastify.engine.listSessionMemories(request.params.sessionId, limit);
        return { count: memories.length, memories };
      } catch (error) {
        if (error instanceof IotaError) {
          reply.code(404);
          return { error: error.message };
        }
        reply.code(500);
        return { error: "Failed to load memories" };
      }
    },
  );

  fastify.post<{
    Params: { sessionId: string };
    Body: {
      content: string;
    };
  }>(
    "/sessions/:sessionId/memories",
    {
      schema: {
        ...sessionParamsSchema,
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 20000 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const memory = await fastify.engine.createSessionMemory(request.params.sessionId, request.body.content);
        reply.code(201);
        return memory;
      } catch (error) {
        if (error instanceof IotaError) {
          reply.code(404);
          return { error: error.message };
        }
        reply.code(500);
        return { error: "Failed to create memory" };
      }
    },
  );

  fastify.delete<{
    Params: { sessionId: string; memoryId: string };
  }>(
    "/sessions/:sessionId/memories/:memoryId",
    {
      schema: {
        params: {
          type: "object",
          required: ["sessionId", "memoryId"],
          properties: {
            sessionId: { type: "string", minLength: 1, maxLength: 100 },
            memoryId: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const deleted = await fastify.engine.deleteSessionMemory(
          request.params.sessionId,
          request.params.memoryId,
        );
        if (!deleted) {
          reply.code(404);
          return { error: "Memory not found" };
        }
        reply.code(204);
        return;
      } catch (error) {
        if (error instanceof IotaError) {
          reply.code(404);
          return { error: error.message };
        }
        reply.code(500);
        return { error: "Failed to delete memory" };
      }
    },
  );
};
