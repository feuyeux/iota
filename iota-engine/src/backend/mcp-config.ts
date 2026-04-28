import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpServerDescriptor } from "../event/types.js";

export function hasMcpServers(servers: McpServerDescriptor[]): boolean {
  return servers.length > 0;
}

export function buildClaudeMcpConfig(
  servers: McpServerDescriptor[],
): string | undefined {
  if (!hasMcpServers(servers)) return undefined;
  return JSON.stringify({
    mcpServers: Object.fromEntries(
      servers.map((server) => [
        server.name,
        {
          command: server.command,
          args: server.args ?? [],
          env: normalizeEnv(server.env),
          ...(isIotaFunServer(server)
            ? {
                cwd: path.dirname(server.args?.[0] ?? process.cwd()),
                trust: true,
              }
            : {}),
        },
      ]),
    ),
  });
}

export function buildClaudeAllowedMcpTools(
  servers: McpServerDescriptor[],
): string[] {
  return servers.flatMap((server) => {
    if (!isIotaFunServer(server)) return [];
    return ["cpp", "typescript", "rust", "zig", "java", "python", "go"].map(
      (language) => `mcp__${server.name}__fun_${language}`,
    );
  });
}

export function buildCodexMcpConfigArgs(
  servers: McpServerDescriptor[],
): string[] {
  const args: string[] = [];
  for (const server of servers) {
    const key = tomlKey(server.name);
    args.push("-c", `mcp_servers.${key}.command=${tomlString(server.command)}`);
    if (server.args && server.args.length > 0) {
      args.push("-c", `mcp_servers.${key}.args=${tomlArray(server.args)}`);
    }
    if (isIotaFunServer(server)) {
      args.push("-c", `mcp_servers.${key}.startup_timeout_sec=60`);
      args.push("-c", `mcp_servers.${key}.tool_timeout_sec=60`);
    }
    for (const [envKey, envValue] of Object.entries(normalizeEnv(server.env))) {
      args.push(
        "-c",
        `mcp_servers.${key}.env.${tomlKey(envKey)}=${tomlString(envValue)}`,
      );
    }
  }
  return args;
}

export function writeGeminiSystemSettings(
  servers: McpServerDescriptor[],
): string | undefined {
  if (!hasMcpServers(servers)) return undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iota-gemini-"));
  fs.chmodSync(dir, 0o700);
  const settingsPath = path.join(dir, "settings.json");
  fs.writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        mcpServers: Object.fromEntries(
          servers.map((server) => [
            server.name,
            {
              command: server.command,
              args: server.args ?? [],
              env: normalizeEnv(server.env),
              ...(isIotaFunServer(server)
                ? {
                    cwd: path.dirname(server.args?.[0] ?? process.cwd()),
                    trust: true,
                    timeout: 60_000,
                  }
                : {}),
            },
          ]),
        ),
        mcp: {
          allowed: servers.map((server) => server.name),
        },
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  return settingsPath;
}

export function cleanupGeneratedSettings(settingsPath?: string): void {
  if (!settingsPath) return;
  fs.rmSync(path.dirname(settingsPath), { recursive: true, force: true });
}

function normalizeEnv(
  env?: Record<string, string> | string[],
): Record<string, string> {
  if (!env) return {};
  if (!Array.isArray(env)) return env;
  const result: Record<string, string> = {};
  for (const entry of env) {
    const eq = entry.indexOf("=");
    if (eq > 0) result[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return result;
}

function isIotaFunServer(server: McpServerDescriptor): boolean {
  return server.name === "iota-fun" || server.name === "iota-fun-mcp";
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)
    ? value
    : JSON.stringify(value);
}
