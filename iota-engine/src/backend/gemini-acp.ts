import { AcpBackendAdapter } from "./acp-backend-adapter.js";
import type { BackendConfig } from "./interface.js";
import type { McpServerDescriptor } from "../event/types.js";

export class GeminiAcpAdapter extends AcpBackendAdapter {
  private configuredModel?: string;

  constructor(mcpServers: McpServerDescriptor[] = [], commandArgs = ["--acp"]) {
    super({
      name: "gemini",
      defaultExecutable: "gemini",
      commandArgs,
      mcpServers,
      capabilities: {
        sandbox: false,
        mcp: true,
        mcpResponseChannel: true,
        acp: true,
        acpMode: "native",
        streaming: true,
        thinking: true,
        multimodal: true,
        maxContextTokens: 1_000_000,
        promptOnlyInput: true,
      },
    });
  }

  async init(config: BackendConfig): Promise<void> {
    this.configuredModel = config.env?.GEMINI_MODEL || config.env?.GOOGLE_MODEL;
    return super.init(config);
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }
}
