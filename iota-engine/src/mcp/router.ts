import type { McpServerDescriptor } from "../event/types.js";
import { McpServerManager, type McpServerStatus } from "./manager.js";

export interface McpToolCall {
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export class McpRouter {
  private readonly manager = new McpServerManager();

  constructor(private readonly servers: McpServerDescriptor[] = []) {
    for (const server of servers) {
      this.manager.register(server);
    }
  }

  listServers(): McpServerDescriptor[] {
    return [...this.servers];
  }

  /** Get connection status of all MCP servers */
  status(): McpServerStatus[] {
    return this.manager.status();
  }

  /** List all available tools across connected servers */
  async listTools(): Promise<Array<{ server: string; tool: string }>> {
    return this.manager.listTools();
  }

  /** Register a new MCP server at runtime */
  addServer(server: McpServerDescriptor): void {
    this.servers.push(server);
    this.manager.register(server);
  }

  /** Remove an MCP server at runtime */
  removeServer(serverName: string): void {
    const idx = this.servers.findIndex((s) => s.name === serverName);
    if (idx >= 0) this.servers.splice(idx, 1);
    this.manager.unregister(serverName);
  }

  async callTool(call: McpToolCall): Promise<Record<string, unknown>> {
    const client = await this.manager.getClient(call.serverName);
    const result = await client.request("tools/call", {
      name: call.toolName,
      arguments: call.arguments,
    });
    return result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { result };
  }

  /** Start periodic health checks */
  startHealthChecks(intervalMs?: number): void {
    this.manager.startHealthChecks(intervalMs);
  }

  async close(): Promise<void> {
    await this.manager.close();
  }
}
