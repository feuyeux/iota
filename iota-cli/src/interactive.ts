import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import {
  CliApprovalHook,
  IotaEngine,
  loadConfig,
  runMemoryGc,
  type BackendName,
  type LogQueryOptions,
  type RuntimeEvent,
} from "@iota/engine";
import { formatTraceVisibility } from "./commands/visibility.js";

const BACKENDS = new Set<BackendName>([
  "claude-code",
  "codex",
  "gemini",
  "hermes",
  "opencode",
]);

const LOGO_LINES = [
  "      o",
  "   .--|--.",
  "o-- IOTA --o",
  "   '--|--'",
  "      o",
];

const HELP_TEXT = [
  "",
  chalk.bold("iota TUI Commands"),
  "",
  chalk.cyan("Execution:"),
  "  <prompt>                   Execute a prompt against the current backend",
  "  run <prompt>               Alias for direct prompt execution",
  "",
  chalk.cyan("Session:"),
  "  switch <backend>           Switch to a different backend",
  "  status                     Show backend health status",
  "  metrics                    Show engine metrics",
  "  session                    Show current session info",
  "",
  chalk.cyan("Logs & Traces:"),
  "  logs [--limit N]           Show recent execution logs",
  "  trace [executionId]        Show trace for an execution (default: last)",
  "  visibility [executionId]   Show visibility for an execution (default: last)",
  "",
  chalk.cyan("Maintenance:"),
  "  gc                         Run memory garbage collection",
  "  config get <key>           Get a config value",
  "  config list                List all config values",
  "",
  chalk.cyan("General:"),
  "  help                       Show this help",
  "  clear                      Clear the screen",
  "  exit / quit                Exit the TUI",
].join("\n");

interface TuiState {
  sessionId: string;
  lastExecutionId?: string;
}

export async function interactiveCommand(): Promise<void> {
  const engine = new IotaEngine({
    workingDirectory: process.cwd(),
    approvalHook: new CliApprovalHook(),
    visibility: { chain: "full", rawProtocol: "preview" },
  });
  await engine.init();
  const session = await engine.createSession({
    workingDirectory: process.cwd(),
  });
  const rl = readline.createInterface({ input, output });
  const state: TuiState = { sessionId: session.id };

  console.log(formatIotaBanner(session.id));

  try {
    let running = true;
    while (running) {
      const prompt = (await rl.question(chalk.green("iota> "))).trim();
      if (!prompt) continue;

      try {
        if (prompt === "exit" || prompt === "quit") {
          running = false;
          break;
        }

        if (prompt === "help") {
          console.log(HELP_TEXT);
          continue;
        }

        if (prompt === "clear") {
          console.clear();
          continue;
        }

        // --- Session commands ---
        if (prompt.startsWith("switch ")) {
          const backend = prompt.slice(7).trim();
          if (BACKENDS.has(backend as BackendName)) {
            await engine.switchBackend(state.sessionId, backend as BackendName);
            console.log(chalk.cyan(`Switched to ${backend}`));
          } else {
            console.error(
              chalk.red(
                `Unknown backend: ${backend}. Available: ${[...BACKENDS].join(", ")}`,
              ),
            );
          }
          continue;
        }

        if (prompt === "status") {
          const status = await engine.status();
          console.log(JSON.stringify(status, null, 2));
          continue;
        }

        if (prompt === "metrics") {
          console.log(JSON.stringify(engine.getMetrics(), null, 2));
          continue;
        }

        if (prompt === "session") {
          console.log(chalk.cyan(`Session: ${state.sessionId}`));
          if (state.lastExecutionId) {
            console.log(chalk.dim(`Last execution: ${state.lastExecutionId}`));
          }
          continue;
        }

        // --- Logs command ---
        if (prompt === "logs" || prompt.startsWith("logs ")) {
          const limitMatch = prompt.match(/--limit\s+(\d+)/);
          const limit = limitMatch ? Number(limitMatch[1]) : 20;
          const query: LogQueryOptions = {
            sessionId: state.sessionId,
            limit,
          };
          const logs = await engine.queryLogs(query);
          if (logs.length === 0) {
            console.log(chalk.dim("No log events in this session."));
          } else {
            for (const { event } of logs) {
              const ts = new Date(event.timestamp).toISOString().slice(11, 19);
              const content =
                event.type === "output"
                  ? truncate(event.data.content.replace(/\s+/g, " "), 120)
                  : event.type === "error"
                    ? `${event.data.code}: ${event.data.message}`
                    : event.type === "tool_call"
                      ? `${event.data.toolName}(...)`
                      : event.type;
              console.log(
                `${chalk.dim(ts)} ${chalk.yellow(event.type.padEnd(12))} ${content}`,
              );
            }
          }
          continue;
        }

        // --- Trace command ---
        if (prompt === "trace" || prompt.startsWith("trace ")) {
          const execId = prompt.slice(5).trim() || state.lastExecutionId;
          if (!execId) {
            console.error(
              chalk.red(
                "No execution to trace. Run a prompt first or specify an execution ID.",
              ),
            );
            continue;
          }
          const trace = await engine.getExecutionTrace(execId);
          if (!trace) {
            console.error(chalk.red(`No trace found for execution: ${execId}`));
          } else {
            console.log(formatExecutionTrace(trace));
          }
          continue;
        }

        // --- Visibility command ---
        if (prompt === "visibility" || prompt.startsWith("visibility ")) {
          const execId = prompt.slice(10).trim() || state.lastExecutionId;
          if (!execId) {
            console.error(
              chalk.red(
                "No execution to inspect. Run a prompt first or specify an execution ID.",
              ),
            );
            continue;
          }
          const vis = await engine.getExecutionVisibility(execId);
          if (!vis) {
            console.error(
              chalk.red(`No visibility data for execution: ${execId}`),
            );
          } else {
            console.log(formatTraceVisibility(execId, vis));
          }
          continue;
        }

        // --- GC command ---
        if (prompt === "gc") {
          const result = await runMemoryGc({ cwd: process.cwd() });
          console.log(JSON.stringify(result, null, 2));
          continue;
        }

        // --- Config commands ---
        if (prompt.startsWith("config ")) {
          const sub = prompt.slice(7).trim();
          if (sub === "list") {
            const store = engine.getConfigStore();
            const config = await loadConfig({
              cwd: process.cwd(),
              redisConfigStore: store ?? undefined,
            });
            console.log(JSON.stringify(config, null, 2));
          } else if (sub.startsWith("get ")) {
            const key = sub.slice(4).trim();
            const store = engine.getConfigStore();
            const config = await loadConfig({
              cwd: process.cwd(),
              redisConfigStore: store ?? undefined,
            });
            const value = getNestedValue(
              config as unknown as Record<string, unknown>,
              key,
            );
            console.log(
              value !== undefined
                ? JSON.stringify(value, null, 2)
                : chalk.red(`Config key not found: ${key}`),
            );
          } else {
            console.error(chalk.red("Usage: config list | config get <key>"));
          }
          continue;
        }

        // --- Execute prompt ---
        const executionPrompt = parseRunCommand(prompt) ?? prompt;
        const executionId = randomUUID();
        state.lastExecutionId = executionId;

        for await (const event of engine.stream({
          sessionId: state.sessionId,
          executionId,
          prompt: executionPrompt,
        })) {
          writeTuiEvent(event);
        }
        process.stdout.write("\n");
      } catch (error) {
        console.error(
          chalk.red(
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
  } finally {
    rl.close();
    await engine.destroy();
  }
}

export function writeTuiEvent(event: RuntimeEvent): void {
  const rendered = formatTuiEvent(event);
  if (!rendered) return;
  if (rendered.stream === "stderr") {
    console.error(rendered.text);
  } else if (rendered.newline) {
    console.log(rendered.text);
  } else {
    process.stdout.write(rendered.text);
  }
}

export function formatTuiEvent(
  event: RuntimeEvent,
): { stream: "stdout" | "stderr"; text: string; newline: boolean } | undefined {
  if (event.type === "output") {
    return { stream: "stdout", text: event.data.content, newline: false };
  }
  if (event.type === "error") {
    return {
      stream: "stderr",
      text: chalk.red(`\n${event.data.code}: ${event.data.message}`),
      newline: true,
    };
  }
  if (event.type === "state") {
    if (event.data.state === "waiting_approval") {
      return {
        stream: "stdout",
        text: chalk.yellow("\n⏳ Waiting for approval..."),
        newline: true,
      };
    }
    if (event.data.state === "failed") {
      return {
        stream: "stderr",
        text: chalk.red(
          `\n❌ Execution failed${event.data.message ? `: ${event.data.message}` : ""}`,
        ),
        newline: true,
      };
    }
    return undefined;
  }
  if (event.type === "tool_call") {
    if (!shouldShowToolCall(event)) return undefined;
    return {
      stream: "stdout",
      text: chalk.dim(
        `\n🔧 ${event.data.toolName}(${JSON.stringify(event.data.arguments).slice(0, 100)})`,
      ),
      newline: true,
    };
  }
  if (event.type === "file_delta") {
    return {
      stream: "stdout",
      text: chalk.dim(`\n📁 ${event.data.operation}: ${event.data.path}`),
      newline: true,
    };
  }
  return undefined;
}

function shouldShowToolCall(event: RuntimeEvent): boolean {
  if (event.type !== "tool_call") return false;
  if (event.data.toolName !== "unknown") return true;
  return Object.keys(event.data.arguments).length > 0;
}
function parseRunCommand(prompt: string): string | undefined {
  if (!prompt.startsWith("run ")) return undefined;
  const value = prompt.slice(4).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}

function formatIotaBanner(sessionId: string): string {
  const cyan = chalk.hex("#47bfff");
  const violet = chalk.hex("#aa3bff");
  const mark = LOGO_LINES.map((line, index) => {
    if (index === 2) {
      return line
        .replace("IOTA", violet.bold("IOTA"))
        .replaceAll("o", cyan("o"))
        .replaceAll("-", chalk.dim("-"));
    }
    return chalk.dim(line.replaceAll("o", cyan("o")));
  }).join("\n");

  return [
    mark,
    `${chalk.bold("iota TUI")} ${chalk.dim(`session ${sessionId.slice(0, 8)}`)}`,
    chalk.dim('Type "help" for commands, "exit" to quit.'),
  ].join("\n");
}

function formatExecutionTrace(trace: {
  traceId: string;
  executionId: string;
  sessionId: string;
  backend?: string;
  status: string;
  durationMs?: number;
  spans: Array<{
    spanId: string;
    parentSpanId?: string;
    kind: string;
    status: string;
    startedAt: number;
    endedAt?: number;
    attributes: Record<string, unknown>;
  }>;
}): string {
  const lines = [
    `${chalk.bold("Trace:")} ${trace.traceId}`,
    `Execution: ${trace.executionId}`,
    `Backend: ${trace.backend ?? "unknown"}`,
    `Status: ${trace.status}`,
    `Duration: ${trace.durationMs !== undefined ? `${trace.durationMs}ms` : "n/a"}`,
    `Spans: ${trace.spans.length}`,
    "",
  ];
  for (const span of trace.spans) {
    const duration =
      span.endedAt !== undefined
        ? `${span.endedAt - span.startedAt}ms`
        : "running";
    lines.push(
      `  ${chalk.dim(span.spanId.slice(0, 8))} ${span.kind} ${span.status} ${duration}`,
    );
  }
  return lines.join("\n");
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
