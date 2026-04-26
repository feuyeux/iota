/**
 * Shared approval guard helper functions.
 * Extracted from engine.ts to eliminate duplication with guard.ts.
 */

/**
 * Extract file/directory path arguments from tool call arguments.
 * Looks for keys containing "path", "file", "directory", or "dir".
 */
export function extractPathArguments(args: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const k = key.toLowerCase();
    if (
      typeof value === "string" &&
      (k.includes("path") ||
        k.includes("file") ||
        k.includes("directory") ||
        k.includes("dir"))
    ) {
      result.push(value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (
          typeof item === "string" &&
          (k.includes("path") || k.includes("file"))
        ) {
          result.push(item);
        }
      }
    }
  }
  return result;
}

/**
 * Check if a tool name represents a shell/command execution tool.
 * Uses exact matching against a known set of shell tool names.
 */
export function isShellTool(toolName: string): boolean {
  const shellTools = new Set([
    "bash",
    "shell",
    "terminal",
    "exec",
    "execute",
    "run",
    "command",
    "run_command",
    "execute_command",
  ]);
  return shellTools.has(toolName.toLowerCase());
}

/**
 * Detect privilege escalation attempts in shell commands or sensitive file access.
 * Checks for sudo/su/doas/pkexec/runuser and access to .env/credentials/.ssh/.gnupg.
 */
export function isPrivilegeEscalation(
  _toolName: string,
  args: Record<string, unknown>,
): boolean {
  const command =
    typeof args.command === "string"
      ? args.command
      : typeof args.input === "string"
        ? args.input
        : "";
  if (/\b(?:sudo|su|doas|pkexec|runuser)\b/.test(command)) return true;
  const paths = extractPathArguments(args);
  for (const p of paths) {
    if (
      p.includes(".env") ||
      p.includes("credentials") ||
      p.includes(".ssh/") ||
      p.includes(".gnupg/")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a tool name represents an MCP (Model Context Protocol) tool.
 * MCP tools use prefixes like "mcp__", "mcp:", or "mcp/".
 */
export function isMcpTool(toolName: string): boolean {
  return (
    toolName.includes("mcp__") ||
    toolName.includes("mcp:") ||
    toolName.startsWith("mcp/")
  );
}

/**
 * Parse an MCP tool name into server name and tool name components.
 * Supports patterns: mcp__server__tool, mcp:server:tool, mcp/server/tool
 */
export function parseMcpToolName(toolName: string): {
  serverName: string;
  toolName: string;
} {
  const separators = [/__/, /:/, /\//];
  for (const sep of separators) {
    const parts = toolName.split(sep).filter(Boolean);
    if (parts.length >= 3 && parts[0] === "mcp") {
      return { serverName: parts[1], toolName: parts.slice(2).join("_") };
    }
    if (parts.length >= 2 && parts[0] === "mcp") {
      return { serverName: parts[1], toolName: parts[1] };
    }
  }
  return { serverName: "unknown", toolName };
}
