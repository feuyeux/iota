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
    const target = this.generatedHermesHome;
    this.generatedHermesHome = undefined;
    // On Windows the hermes subprocess may briefly retain handles to its
    // HERMES_HOME (config.yaml, log files) after we send SIGINT, producing
    // EPERM/EBUSY when we try to remove the directory. Use the Node built-in
    // retry options and swallow any residual error so destroy() never throws.
    try {
      fs.rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch (error) {
      // Schedule a best-effort async retry; do not propagate. The directory
      // lives under the OS temp folder and will eventually be cleaned by the
      // OS even if this attempt fails.
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY") {
        setTimeout(() => {
          try {
            fs.rmSync(target, {
              recursive: true,
              force: true,
              maxRetries: 5,
              retryDelay: 200,
            });
          } catch {
            // Ignore; OS temp cleanup will reclaim it.
          }
        }, 500).unref?.();
        return;
      }
      // Unknown error: log via stderr but do not throw.
      process.stderr.write(
        `[hermes] failed to clean up ${target}: ${(error as Error).message}\n`,
      );
    }
  }
}

