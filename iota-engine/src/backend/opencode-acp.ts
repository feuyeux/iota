import { AcpBackendAdapter } from "./acp-backend-adapter.js";
import type { BackendConfig } from "./interface.js";
import type { McpServerDescriptor, RuntimeRequest } from "../event/types.js";

export class OpenCodeAcpAdapter extends AcpBackendAdapter {
  private configuredModel?: string;
  private readonly opencodeMcpServers: McpServerDescriptor[];

  constructor(mcpServers: McpServerDescriptor[] = []) {
    super({
      name: "opencode",
      defaultExecutable: "opencode",
      commandArgs: ["acp"],
      mcpServers,
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: true,
        acp: true,
        acpMode: "native",
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 200_000,
        promptOnlyInput: true,
      },
    });
    this.opencodeMcpServers = mcpServers;
  }

  async init(config: BackendConfig): Promise<void> {
    this.configuredModel =
      config.env?.OPENCODE_MODEL ?? process.env.OPENCODE_MODEL;
    return super.init(config);
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }

  /**
   * OpenCode's ACP `session/new` schema requires `mcpServers` to always be
   * present as an array (empty arrays are accepted, but an omitted field
   * triggers `Invalid input: expected array, received undefined`). The base
   * adapter omits the field when no servers are configured, so we override
   * here to always emit it.
   */
  protected buildSessionNewParams(
    request: RuntimeRequest,
  ): Record<string, unknown> {
    return {
      cwd: request.workingDirectory || process.cwd(),
      mcpServers: this.opencodeMcpServers,
    };
  }
}

