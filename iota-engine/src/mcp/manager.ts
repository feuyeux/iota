import type { McpServerDescriptor } from "../event/types.js";
import { StdioMcpClient, type McpClient } from "./client.js";

/** Normalize env to Record<string,string> regardless of input form. */
function normalizeEnv(
  env?: Record<string, string> | string[],
): Record<string, string> {
  if (!env) return {};
  if (Array.isArray(env)) {
    const result: Record<string, string> = {};
    for (const entry of env) {
      const eq = entry.indexOf("=");
      if (eq > 0) result[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return result;
  }
  return env;
}

export interface McpServerStatus {
  name: string;
  connected: boolean;
  tools: string[];
  lastHealthCheck?: number;
  error?: string;
}

export class McpServerManager {
  private readonly servers = new Map<string, McpServerDescriptor>();
  private readonly clients = new Map<string, McpClient>();
  private readonly pendingClients = new Map<string, Promise<McpClient>>();
  private readonly toolCache = new Map<string, string[]>();
  private readonly serverErrors = new Map<string, string>();
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  register(server: McpServerDescriptor): void {
    this.servers.set(server.name, server);
  }

  unregister(serverName: string): void {
    this.servers.delete(serverName);
    const client = this.clients.get(serverName);
    if (client) {
      client.close?.();
      this.clients.delete(serverName);
    }
    this.toolCache.delete(serverName);
    this.serverErrors.delete(serverName);
  }

  list(): McpServerDescriptor[] {
    return [...this.servers.values()];
  }

  /** Get status of all registered servers */
  status(): McpServerStatus[] {
    return [...this.servers.keys()].map((name) => ({
      name,
      connected: this.clients.has(name),
      tools: this.toolCache.get(name) ?? [],
      error: this.serverErrors.get(name),
    }));
  }

  async getClient(serverName: string): Promise<McpClient> {
    const existing = this.clients.get(serverName);
    if (existing) {
      return existing;
    }
    const inflight = this.pendingClients.get(serverName);
    if (inflight) {
      return inflight;
    }
    const descriptor = this.servers.get(serverName);
    if (!descriptor) {
      throw new Error(`MCP server ${serverName} is not registered`);
    }
    const promise = (async (): Promise<McpClient> => {
      try {
        const client = new StdioMcpClient(
          descriptor.command,
          descriptor.args,
          normalizeEnv(descriptor.env),
        );
        // List tools on connect and cache them
        const toolsResult = (await client.request("tools/list")) as
          | { tools?: Array<{ name: string }> }
          | undefined;
        const toolNames = toolsResult?.tools?.map((t) => t.name) ?? [];
        this.toolCache.set(serverName, toolNames);
        this.serverErrors.delete(serverName);
        this.clients.set(serverName, client);
        return client;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Connection failed";
        this.serverErrors.set(serverName, message);
        throw error;
      } finally {
        this.pendingClients.delete(serverName);
      }
    })();
    this.pendingClients.set(serverName, promise);
    return promise;
  }

  /** List available tools across all connected servers */
  async listTools(): Promise<Array<{ server: string; tool: string }>> {
    const results: Array<{ server: string; tool: string }> = [];
    for (const [serverName, tools] of this.toolCache) {
      for (const tool of tools) {
        results.push({ server: serverName, tool });
      }
    }
    return results;
  }

  /** Refresh tool list for a specific server */
  async refreshTools(serverName: string): Promise<string[]> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server ${serverName} is not connected`);
    }
    const toolsResult = (await client.request("tools/list")) as
      | { tools?: Array<{ name: string }> }
      | undefined;
    const toolNames = toolsResult?.tools?.map((t) => t.name) ?? [];
    this.toolCache.set(serverName, toolNames);
    return toolNames;
  }

  /** Health check a specific server by sending a ping */
  async healthCheck(serverName: string): Promise<boolean> {
    const client = this.clients.get(serverName);
    if (!client) return false;
    try {
      await client.request("ping");
      this.serverErrors.delete(serverName);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Health check failed";
      this.serverErrors.set(serverName, message);
      return false;
    }
  }

  /** Start periodic health checks for all connected servers */
  startHealthChecks(intervalMs = 30_000): void {
    this.stopHealthChecks();
    this.healthCheckTimer = setInterval(async () => {
      for (const serverName of this.clients.keys()) {
        const healthy = await this.healthCheck(serverName);
        if (!healthy) {
          // Remove dead client so it gets reconnected on next getClient()
          this.clients.get(serverName)?.close?.();
          this.clients.delete(serverName);
        }
      }
    }, intervalMs);
    this.healthCheckTimer.unref();
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  async close(): Promise<void> {
    this.stopHealthChecks();
    // Wait for any in-flight client connections to settle so we don't leak
    // their child processes.
    await Promise.allSettled([...this.pendingClients.values()]);
    this.pendingClients.clear();
    await Promise.all(
      [...this.clients.values()].map((client) => client.close?.()),
    );
    this.clients.clear();
    this.toolCache.clear();
    this.serverErrors.clear();
  }
}
