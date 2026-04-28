#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { statusCommand } from "./commands/status.js";
import { configCommand } from "./commands/config.js";
import { gcCommand } from "./commands/gc.js";
import { logsCommand } from "./commands/logs.js";
import { traceCommand } from "./commands/trace.js";
import { switchCommand } from "./commands/switch.js";
import {
  visibilityCommand,
  visibilityInteractiveCommand,
  visibilityListCommand,
  visibilitySearchCommand,
} from "./commands/visibility.js";
import { interactiveCommand } from "./interactive.js";

const program = new Command();

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

interface RunCliOptions {
  backend?: string;
  cwd: string;
  trace?: boolean;
  traceJson?: boolean;
}

function readRunOptions(
  commandOrOptions: Command | Partial<RunCliOptions>,
): RunCliOptions {
  const opts: Partial<RunCliOptions> =
    "optsWithGlobals" in commandOrOptions &&
    typeof commandOrOptions.optsWithGlobals === "function"
      ? (commandOrOptions.optsWithGlobals() as Partial<RunCliOptions>)
      : "opts" in commandOrOptions &&
          typeof commandOrOptions.opts === "function"
        ? (commandOrOptions.opts() as Partial<RunCliOptions>)
        : (commandOrOptions as Partial<RunCliOptions>);
  return {
    backend: opts.backend,
    cwd: opts.cwd ?? process.cwd(),
    trace: opts.trace,
    traceJson: opts.traceJson,
  };
}

program
  .name("iota")
  .description("Unified runtime for coding agent CLIs")
  .version(pkg.version, "-V, --version")
  .option("--backend <backend>", "backend to use")
  .option("--cwd <cwd>", "working directory", process.cwd())
  .option("--trace", "show full tracing details after the run")
  .option("--trace-json", "show tracing data as JSON after the run")
  .argument("[prompt...]", "prompt to execute")
  .action(async (promptParts: string[]) => {
    const prompt = promptParts.join(" ").trim();
    if (prompt) {
      await runCommand(prompt, readRunOptions(program));
    } else {
      program.help();
    }
  });

program
  .command("run")
  .description("run a single prompt")
  .option("--backend <backend>", "backend to use")
  .option("--cwd <cwd>", "working directory", process.cwd())
  .option("--trace", "show full tracing details after the run")
  .option("--trace-json", "show tracing data as JSON after the run")
  .argument("<prompt...>")
  .action(
    async (
      promptParts: string[],
      _options: Partial<RunCliOptions>,
      command: Command,
    ) => {
      await runCommand(promptParts.join(" "), readRunOptions(command));
    },
  );

program
  .command("interactive")
  .alias("i")
  .description("start an interactive session")
  .action(interactiveCommand);
program
  .command("status")
  .description("show backend status")
  .action(statusCommand);
program
  .command("switch")
  .argument("<backend>")
  .description("set the project default backend")
  .option("--cwd <cwd>", "working directory", process.cwd())
  .action(async (backend: string, options: { cwd: string }) => {
    await switchCommand(backend, options.cwd);
  });
program.addCommand(configCommand());
program
  .command("gc")
  .description("run local garbage collection")
  .action(gcCommand);

program
  .command("logs")
  .description("query distributed execution logs")
  .option("--session <sessionId>", "filter by session ID")
  .option("--execution <executionId>", "filter by execution ID")
  .option("--backend <backend>", "filter by backend")
  .option("--event-type <type>", "filter by runtime event type")
  .option("--since <time>", "filter events after ISO time or Unix ms")
  .option("--until <time>", "filter events before ISO time or Unix ms")
  .option("--offset <n>", "offset for event results", "0")
  .option("--limit <n>", "maximum events to return", "100")
  .option("--aggregate", "show aggregate counts instead of events")
  .option("--json", "output raw JSON events")
  .action(logsCommand);

program
  .command("trace")
  .description("query distributed execution traces")
  .option("--execution <executionId>", "show one execution trace")
  .option("--session <sessionId>", "aggregate traces for a session")
  .option("--backend <backend>", "filter by backend")
  .option("--since <time>", "filter traces after ISO time or Unix ms")
  .option("--until <time>", "filter traces before ISO time or Unix ms")
  .option("--offset <n>", "offset for aggregate execution results", "0")
  .option("--limit <n>", "maximum executions to aggregate", "100")
  .option("--aggregate", "aggregate even when --execution is provided")
  .option("--json", "output raw JSON")
  .action(traceCommand);

const visibility = program
  .command("visibility")
  .alias("vis")
  .description("show execution visibility data")
  .option("--execution <executionId>", "execution ID to inspect")
  .option("--summary", "show summary output for a session")
  .option("--memory", "show memory visibility only")
  .option("--tokens", "show token visibility only")
  .option("--chain", "show chain visibility only")
  .option("--trace", "show full tracing details")
  .option("--backend <backend>", "filter by backend")
  .option("--export <file>", "export visibility data to a file")
  .option("--format <format>", "export format: json, yaml, or csv")
  .option("--limit <n>", "maximum records for session queries")
  .option("--offset <n>", "offset for session queries")
  .option("--json", "output as JSON")
  .action(
    async (options: {
      execution?: string;
      session?: string;
      summary?: boolean;
      memory?: boolean;
      tokens?: boolean;
      chain?: boolean;
      trace?: boolean;
      backend?: string;
      export?: string;
      format?: "json" | "yaml" | "csv";
      limit?: string;
      offset?: string;
      json?: boolean;
    }) => {
      await visibilityCommand(options.execution, options);
    },
  );

visibility
  .command("list")
  .description("list visibility records for a session")
  .requiredOption("--session <sessionId>", "session ID to list")
  .option("--backend <backend>", "filter by backend")
  .option("--limit <n>", "maximum records", "10")
  .option("--offset <n>", "offset", "0")
  .option("--export <file>", "export list data to a file")
  .option("--format <format>", "export format: json, yaml, or csv")
  .option("--json", "output as JSON")
  .action(visibilityListCommand);

visibility
  .command("search")
  .description("search visibility records by prompt preview")
  .requiredOption("--session <sessionId>", "session ID to search")
  .requiredOption("--prompt <text>", "prompt preview text to match")
  .option("--backend <backend>", "filter by backend")
  .option("--limit <n>", "maximum records", "50")
  .option("--offset <n>", "offset", "0")
  .option("--export <file>", "export search results to a file")
  .option("--format <format>", "export format: json, yaml, or csv")
  .option("--json", "output as JSON")
  .action(visibilitySearchCommand);

visibility
  .command("interactive")
  .description("poll visibility data in a live terminal view")
  .option("--session <sessionId>", "session ID to monitor")
  .option("--execution <executionId>", "execution ID to monitor")
  .option("--interval <ms>", "refresh interval in milliseconds", "1000")
  .option("--json", "render raw JSON")
  .action(visibilityInteractiveCommand);

program.parseAsync(process.argv).then(
  () => {
    // All commands run to completion; force exit so any lingering
    // (already-cleaned-up) handles do not keep the CLI alive.
    process.exit(process.exitCode ?? 0);
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  },
);
