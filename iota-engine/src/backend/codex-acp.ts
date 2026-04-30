import { AcpBackendAdapter } from "./acp-backend-adapter.js";
import type { BackendConfig } from "./interface.js";
import type { McpServerDescriptor } from "../event/types.js";

export class CodexAcpAdapter extends AcpBackendAdapter {
  private configuredModel?: string;

  constructor(mcpServers: McpServerDescriptor[] = [], commandArgs = ["@zed-industries/codex-acp"]) {
    super({
      name: "codex",
      defaultExecutable: "npx",
      commandArgs,
      mcpServers,
      capabilities: {
        sandbox: true,
        mcp: true,
        mcpResponseChannel: true,
        acp: true,
        acpMode: "adapter",
        streaming: true,
        thinking: true,
        multimodal: false,
        maxContextTokens: 200_000,
        promptOnlyInput: true,
      },
    });
  }

  async init(config: BackendConfig): Promise<void> {
    this.configuredModel = config.env?.OPENAI_MODEL;
    return super.init({
      ...config,
      // In ACP mode the configured default native executable (`codex`)
      // should not override the adapter-backed defaultExecutable (`npx`).
      // Custom executable paths are preserved for users who provide their own shim.
      executable: config.executable === "codex" ? undefined : config.executable,
    });
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }
}
