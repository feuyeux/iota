import { AcpBackendAdapter } from "./acp-backend-adapter.js";
import type { BackendConfig } from "./interface.js";
import type { McpServerDescriptor } from "../event/types.js";

export class ClaudeCodeAcpAdapter extends AcpBackendAdapter {
  private configuredModel?: string;

  constructor(mcpServers: McpServerDescriptor[] = [], commandArgs = ["@zed-industries/claude-code-acp"]) {
    super({
      name: "claude-code",
      defaultExecutable: "npx",
      commandArgs,
      mcpServers,
      capabilities: {
        sandbox: false,
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
    this.configuredModel = config.env?.ANTHROPIC_MODEL || config.env?.CLAUDE_MODEL;
    return super.init({
      ...config,
      // In ACP mode the configured default native executable (`claude`)
      // should not override the adapter-backed defaultExecutable (`npx`).
      // Custom executable paths are preserved for users who provide their own shim.
      executable: config.executable === "claude" ? undefined : config.executable,
    });
  }

  getModel(): string | undefined {
    return this.configuredModel;
  }
}
