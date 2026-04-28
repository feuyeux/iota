import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildClaudeAllowedMcpTools,
  buildClaudeMcpConfig,
  buildCodexMcpConfigArgs,
  cleanupGeneratedSettings,
  writeGeminiSystemSettings,
} from "./mcp-config.js";
import type { McpServerDescriptor } from "../event/types.js";

describe("backend MCP config rendering", () => {
  const servers: McpServerDescriptor[] = [
    {
      name: "iota-fun",
      command: "node",
      args: ["/repo/iota-engine/dist/mcp/fun-server.js"],
      env: ["IOTA_TEST=true"],
    },
  ];
  let generatedPath: string | undefined;

  afterEach(() => {
    cleanupGeneratedSettings(generatedPath);
    generatedPath = undefined;
  });

  it("renders Claude Code --mcp-config JSON", () => {
    const config = JSON.parse(buildClaudeMcpConfig(servers) ?? "{}") as {
      mcpServers: Record<string, unknown>;
    };

    expect(config.mcpServers["iota-fun"]).toEqual({
      command: "node",
      args: ["/repo/iota-engine/dist/mcp/fun-server.js"],
      env: { IOTA_TEST: "true" },
      cwd: "/repo/iota-engine/dist/mcp",
      trust: true,
    });
  });

  it("renders Claude Code allowlist names for iota-fun tools", () => {
    expect(buildClaudeAllowedMcpTools(servers)).toEqual([
      "mcp__iota-fun__fun_cpp",
      "mcp__iota-fun__fun_typescript",
      "mcp__iota-fun__fun_rust",
      "mcp__iota-fun__fun_zig",
      "mcp__iota-fun__fun_java",
      "mcp__iota-fun__fun_python",
      "mcp__iota-fun__fun_go",
    ]);
  });

  it("renders Codex -c MCP overrides with quoted server keys", () => {
    expect(buildCodexMcpConfigArgs(servers)).toEqual([
      "-c",
      'mcp_servers.iota-fun.command="node"',
      "-c",
      'mcp_servers.iota-fun.args=["/repo/iota-engine/dist/mcp/fun-server.js"]',
      "-c",
      "mcp_servers.iota-fun.startup_timeout_sec=60",
      "-c",
      "mcp_servers.iota-fun.tool_timeout_sec=60",
      "-c",
      'mcp_servers.iota-fun.env.IOTA_TEST="true"',
    ]);
  });

  it("writes Gemini system settings with allowed MCP server names", () => {
    generatedPath = writeGeminiSystemSettings(servers);
    expect(generatedPath).toBeTruthy();

    const settings = JSON.parse(fs.readFileSync(generatedPath!, "utf8")) as {
      mcpServers: Record<string, unknown>;
      mcp: { allowed: string[] };
    };

    expect(settings.mcpServers["iota-fun"]).toEqual({
      command: "node",
      args: ["/repo/iota-engine/dist/mcp/fun-server.js"],
      env: { IOTA_TEST: "true" },
      cwd: "/repo/iota-engine/dist/mcp",
      trust: true,
      timeout: 60_000,
    });
    expect(settings.mcp.allowed).toEqual(["iota-fun"]);
  });
});
