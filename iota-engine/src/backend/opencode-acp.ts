import { AcpBackendAdapter } from "./acp-backend-adapter.js";
import type { McpServerDescriptor } from "../event/types.js";

export class OpenCodeAcpAdapter extends AcpBackendAdapter {
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
}
