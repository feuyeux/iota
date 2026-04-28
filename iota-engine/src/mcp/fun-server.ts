/**
 * iota-fun MCP stdio server.
 *
 * Exposes 7 fun.* tools (cpp, typescript, rust, zig, java, python, go) via the
 * Model Context Protocol JSON-RPC 2.0 stdio transport.  Hermes (or any MCP
 * client) can register this server and call the tools directly, letting the LLM
 * drive tool invocation without any engine-side rule matching.
 *
 * Tools are located in iota-skill/pet-generator/iota-fun/
 *
 * Usage (registered as an mcpServer in hermes session/new):
 *   command: "node"
 *   args:    ["<dist>/mcp/fun-server.js"]
 */

import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IotaFunEngine, type FunLanguage } from "../fun-engine.js";

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const funEngine = new IotaFunEngine(ENGINE_DIR);

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
};

function send(msg: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function ok(id: number | string | null, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function err(id: number | string | null, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const TOOLS: Array<{
  name: FunLanguage;
  description: string;
  attribute: string;
  examples: string[];
}> = [
  { name: "cpp",        description: "随机返回一个动作词（中文）",     attribute: "action",    examples: ["睡觉","奔跑","喝水","吃饭","捕捉","发呆"] },
  { name: "typescript", description: "随机返回一个颜色名（英文）",     attribute: "color",     examples: ["red","blue","green","yellow","black","white"] },
  { name: "rust",       description: "随机返回一种材质名（英文）",     attribute: "material",  examples: ["wood","metal","glass","plastic","stone"] },
  { name: "zig",        description: "随机返回一个尺寸词（中文）",     attribute: "size",      examples: ["大","中","小"] },
  { name: "java",       description: "随机返回一种动物名（中文）",     attribute: "animal",    examples: ["猫","狗","鸟"] },
  { name: "python",     description: "随机返回 1-100 的整数",         attribute: "lengthCm",  examples: ["42","7","99"] },
  { name: "go",         description: "随机返回一种形状名（英文）",     attribute: "toyShape",  examples: ["circle","square","triangle","star","hexagon"] },
];

const toolDefs = TOOLS.map((t) => ({
  name: `fun.${t.name}`,
  description: `[iota-skill/pet-generator/iota-fun/${t.name}] ${t.description} — 属性: ${t.attribute}，示例: ${t.examples.join(" / ")}`,
  inputSchema: { type: "object", properties: {}, required: [] },
}));

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    return;
  }

  const { id, method, params } = req;

  if (method === "initialize") {
    ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "iota-fun-mcp", version: "1.0.0" },
    });
    return;
  }

  if (method === "tools/list") {
    ok(id, { tools: toolDefs });
    return;
  }

  if (method === "tools/call") {
    const p = params as { name?: string; arguments?: unknown } | undefined;
    const toolName = p?.name ?? "";
    if (!toolName.startsWith("fun.")) {
      err(id, -32602, `Unknown tool: ${toolName}`);
      return;
    }
    const lang = toolName.slice("fun.".length) as FunLanguage;
    try {
      const result = await funEngine.execute({ language: lang });
      ok(id, {
        content: [{ type: "text", text: result.value }],
        isError: false,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      ok(id, {
        content: [{ type: "text", text: `ERROR: ${message}` }],
        isError: true,
      });
    }
    return;
  }

  // ping / notifications/initialized — silently ack
  if (method === "ping") {
    ok(id, {});
    return;
  }
  if (method?.startsWith("notifications/")) {
    // Notifications don't need a response
    return;
  }

  err(id, -32601, `Method not found: ${method}`);
});
