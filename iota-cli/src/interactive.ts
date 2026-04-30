import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { CliApprovalHook, IotaEngine, type BackendName } from "@iota/engine";

const BACKENDS = new Set<BackendName>([
  "claude-code",
  "codex",
  "gemini",
  "hermes",
  "opencode",
]);

export async function interactiveCommand(): Promise<void> {
  const engine = new IotaEngine({
    workingDirectory: process.cwd(),
    approvalHook: new CliApprovalHook(),
  });
  await engine.init();
  const session = await engine.createSession({
    workingDirectory: process.cwd(),
  });
  const rl = readline.createInterface({ input, output });

  console.log(
    chalk.cyan(
      'Iota interactive session started. Type "exit" to quit, "switch <backend>" to change backend.',
    ),
  );

  try {
    let running = true;
    while (running) {
      const prompt = (await rl.question(chalk.green("iota> "))).trim();
      if (!prompt) continue;
      if (prompt === "exit" || prompt === "quit") {
        running = false;
        break;
      }

      // Handle in-session commands
      if (prompt.startsWith("switch ")) {
        const backend = prompt.slice(7).trim();
        if (BACKENDS.has(backend as BackendName)) {
          try {
            await engine.switchBackend(session.id, backend as BackendName);
            console.log(chalk.cyan(`Switched to ${backend}`));
          } catch (error) {
            console.error(
              chalk.red(
                `Switch failed: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          }
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

      const executionPrompt = parseRunCommand(prompt) ?? prompt;

      // Execute prompt
      for await (const event of engine.stream({
        sessionId: session.id,
        prompt: executionPrompt,
      })) {
        if (event.type === "output") {
          process.stdout.write(event.data.content);
        } else if (event.type === "error") {
          console.error(
            chalk.red(`\n${event.data.code}: ${event.data.message}`),
          );
        } else if (event.type === "state") {
          if (event.data.state === "waiting_approval") {
            console.log(chalk.yellow("\n⏳ Waiting for approval..."));
          } else if (event.data.state === "failed") {
            console.error(
              chalk.red(
                `\n❌ Execution failed${event.data.message ? `: ${event.data.message}` : ""}`,
              ),
            );
          }
        } else if (event.type === "tool_call") {
          console.log(
            chalk.dim(
              `\n🔧 ${event.data.toolName}(${JSON.stringify(event.data.arguments).slice(0, 100)})`,
            ),
          );
        } else if (event.type === "file_delta") {
          console.log(
            chalk.dim(`\n📁 ${event.data.operation}: ${event.data.path}`),
          );
        }
      }
      process.stdout.write("\n");
    }
  } finally {
    rl.close();
    await engine.destroy();
  }
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
