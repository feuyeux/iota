import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { CliApprovalHook, IotaEngine, type BackendName } from "@iota/engine";
import { formatTraceVisibility } from "./visibility.js";

export async function runCommand(
  prompt: string,
  options: {
    backend?: string;
    cwd: string;
    trace?: boolean;
    traceJson?: boolean;
  },
): Promise<void> {
  const traceEnabled = options.trace === true || options.traceJson === true;
  const engine = new IotaEngine({
    workingDirectory: options.cwd,
    approvalHook: new CliApprovalHook(),
    visibility: traceEnabled
      ? { chain: "full", rawProtocol: "preview" }
      : undefined,
  });
  await engine.init();
  let failed = false;
  const executionId = randomUUID();

  try {
    const session = await engine.createSession({
      workingDirectory: options.cwd,
    });
    for await (const event of engine.stream({
      sessionId: session.id,
      executionId,
      prompt,
      backend: options.backend as BackendName | undefined,
    })) {
      if (event.type === "output") {
        process.stdout.write(event.data.content);
      } else if (event.type === "error") {
        failed = true;
        const code = event.data.code;
        const hint =
          typeof event.data.details?.hint === "string"
            ? event.data.details.hint
            : undefined;
        console.error(chalk.red(`\n${code}: ${event.data.message}`));
        if (hint) {
          console.error(chalk.yellow(`Hint: ${hint}`));
        }
      } else if (event.type === "state" && event.data.state === "failed") {
        failed = true;
        console.error(chalk.red("\nExecution failed"));
      }
    }
    if (traceEnabled) {
      const visibility = await engine.getExecutionVisibility(executionId);
      console.log("");
      if (options.traceJson) {
        console.log(JSON.stringify(visibility, null, 2));
      } else if (visibility) {
        console.log(formatTraceVisibility(executionId, visibility));
      } else {
        console.log(`No tracing data found for execution: ${executionId}`);
      }
    }
  } finally {
    await engine.destroy();
  }
  if (failed) {
    process.exitCode = 1;
  }
}
