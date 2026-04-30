import fs from "node:fs";
import { AcpBackendAdapter } from "./acp-backend-adapter.js";
import { prepareHermesBackendConfig } from "./hermes-config.js";
import type { BackendConfig } from "./interface.js";
import type { McpServerDescriptor } from "../event/types.js";

/**
 * Convert an engine McpServerDescriptor to the hermes ACP McpServerStdio wire format.
 * Hermes requires: { name, type: "stdio", command, args, env: string[] }
 */
function toHermesMcpServer(s: McpServerDescriptor): Record<string, unknown> {
  let env: string[];
  if (Array.isArray(s.env)) {
    env = s.env as string[];
  } else if (s.env && typeof s.env === "object") {
    env = Object.entries(s.env).map(([k, v]) => `${k}=${v}`);
  } else {
    env = [];
  }
  return {
    name: s.name,
    type: "stdio",
    command: s.command,
    args: s.args ?? [],
    env,
  };
}

/**
 * HermesAdapter - ACP JSON-RPC 2.0 over stdio, long-lived process.
 * The shared ACP lifecycle and event mapping live in AcpBackendAdapter.
 */
export class HermesAdapter extends AcpBackendAdapter {
  private generatedHermesHome?: string;
  private configuredModel?: string;

  constructor(mcpServers: McpServerDescriptor[] = []) {
    super({
      name: "hermes",
      defaultExecutable: "hermes",
      commandArgs: ["acp"],
      mcpServers,
      mapMcpServer: toHermesMcpServer,
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: true,
        acp: true,
        acpMode: "native",
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 128_000,
        promptOnlyInput: true,
      },
    });
  }

  async init(config: BackendConfig): Promise<void> {
    this.cleanupGeneratedHermesHome();
    const prepared = prepareHermesBackendConfig(config);
    this.generatedHermesHome = prepared.generatedHermesHome;
    this.configuredModel = prepared.model;
    return super.init(prepared.config);
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }

  async destroy(): Promise<void> {
    await super.destroy();
    this.cleanupGeneratedHermesHome();
  }

  private cleanupGeneratedHermesHome(): void {
    if (!this.generatedHermesHome) return;
    fs.rmSync(this.generatedHermesHome, { recursive: true, force: true });
    this.generatedHermesHome = undefined;
  }
}

