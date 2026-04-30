import { AcpBackendAdapter } from "./acp-backend-adapter.js";
import type { BackendConfig } from "./interface.js";
import type { McpServerDescriptor } from "../event/types.js";

export class OpenCodeAcpAdapter extends AcpBackendAdapter {
  private configuredModel?: string;

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
  }

  async init(config: BackendConfig): Promise<void> {
    this.configuredModel =
      config.env?.OPENCODE_MODEL ?? process.env.OPENCODE_MODEL;
    return super.init(config);
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }
}
