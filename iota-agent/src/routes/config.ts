import type { FastifyPluginAsync } from "fastify";
import type { ConfigScope } from "@iota/engine";

const VALID_SCOPES: ConfigScope[] = ["global", "backend", "session", "user"];

function isValidScope(scope: string): scope is ConfigScope {
  return VALID_SCOPES.includes(scope as ConfigScope);
}

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /config — resolved config (all scopes merged) */
  fastify.get(
    "/config",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            backend: { type: "string" },
            sessionId: { type: "string" },
            userId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const store = fastify.engine.getConfigStore();
      if (!store) {
        reply.code(503);
        return { error: "Config store not available" };
      }
      const query = request.query as {
        backend?: string;
        sessionId?: string;
        userId?: string;
      };
      const resolved = await store.getResolved(
        query.backend,
        query.sessionId,
        query.userId,
      );
      return resolved;
    },
  );

  /** GET /config/:scope — all keys in a scope */
  fastify.get<{ Params: { scope: string } }>(
    "/config/:scope",
    async (request, reply) => {
      const store = fastify.engine.getConfigStore();
      if (!store) {
        reply.code(503);
        return { error: "Config store not available" };
      }
      const { scope } = request.params;
      if (!isValidScope(scope)) {
        reply.code(400);
        return {
          error: `Invalid scope: ${scope}. Valid: ${VALID_SCOPES.join(", ")}`,
        };
      }
      if (scope === "global") {
        return store.get("global");
      }
      // List all scope IDs
      const ids = await store.listScopes(scope);
      return { scope, ids };
    },
  );

  /** GET /config/:scope/:scopeId — keys for a specific scoped entity */
  fastify.get<{ Params: { scope: string; scopeId: string } }>(
    "/config/:scope/:scopeId",
    async (request, reply) => {
      const store = fastify.engine.getConfigStore();
      if (!store) {
        reply.code(503);
        return { error: "Config store not available" };
      }
      const { scope, scopeId } = request.params;
      if (!isValidScope(scope)) {
        reply.code(400);
        return { error: `Invalid scope: ${scope}` };
      }
      return store.get(scope, scopeId);
    },
  );

  /** POST /config — set a global config key */
  fastify.post(
    "/config",
    {
      schema: {
        body: {
          type: "object",
          required: ["key", "value"],
          properties: {
            key: { type: "string", minLength: 1, maxLength: 200 },
            value: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const store = fastify.engine.getConfigStore();
      if (!store) {
        reply.code(503);
        return { error: "Config store not available" };
      }
      const body = request.body as { key: string; value: string };
      await store.set("global", body.key, String(body.value));
      return { ok: true, scope: "global", key: body.key, value: body.value };
    },
  );

  /** POST /config/:scope/:scopeId — set a scoped config key */
  fastify.post<{ Params: { scope: string; scopeId: string } }>(
    "/config/:scope/:scopeId",
    {
      schema: {
        params: {
          type: "object",
          required: ["scope", "scopeId"],
          properties: {
            scope: { type: "string" },
            scopeId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["key", "value"],
          properties: {
            key: { type: "string", minLength: 1, maxLength: 200 },
            value: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const store = fastify.engine.getConfigStore();
      if (!store) {
        reply.code(503);
        return { error: "Config store not available" };
      }
      const { scope, scopeId } = request.params;
      if (!isValidScope(scope)) {
        reply.code(400);
        return { error: `Invalid scope: ${scope}` };
      }
      const body = request.body as { key: string; value: string };
      await store.set(
        scope as ConfigScope,
        body.key,
        String(body.value),
        scopeId,
      );
      return { ok: true, scope, scopeId, key: body.key, value: body.value };
    },
  );

  /** DELETE /config/global/:key — delete a global config key */
  fastify.delete<{ Params: { key: string } }>(
    "/config/global/:key",
    async (_request, reply) => {
      const store = fastify.engine.getConfigStore();
      if (!store) {
        reply.code(503);
        return { error: "Config store not available" };
      }
      const { key } = _request.params;
      await store.del("global", key);
      return { ok: true, scope: "global", key };
    },
  );

  /** DELETE /config/:scope/:scopeId/:key — delete a scoped config key */
  fastify.delete<{ Params: { scope: string; scopeId: string; key: string } }>(
    "/config/:scope/:scopeId/:key",
    async (request, reply) => {
      const store = fastify.engine.getConfigStore();
      if (!store) {
        reply.code(503);
        return { error: "Config store not available" };
      }
      const { scope, scopeId, key } = request.params;
      if (!isValidScope(scope)) {
        reply.code(400);
        return { error: `Invalid scope: ${scope}` };
      }
      const effectiveScopeId = scope === "global" ? undefined : scopeId;
      await store.del(scope as ConfigScope, key, effectiveScopeId);
      return { ok: true, scope, scopeId: effectiveScopeId, key };
    },
  );
};
