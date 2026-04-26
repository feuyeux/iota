import type {
  BackendName,
  LogQueryOptions,
  RuntimeEvent,
  RuntimeLogEntry,
} from "@iota/engine";
import { withEngine } from "./shared.js";

export interface LogsCommandOptions {
  session?: string;
  execution?: string;
  backend?: BackendName;
  eventType?: RuntimeEvent["type"];
  since?: string;
  until?: string;
  offset?: string;
  limit?: string;
  aggregate?: boolean;
  json?: boolean;
}

export async function logsCommand(options: LogsCommandOptions): Promise<void> {
  const query = parseLogOptions(options);
  await withEngine(async (engine) => {
    if (options.aggregate) {
      const aggregate = await engine.aggregateLogs(query);
      console.log(JSON.stringify(aggregate, null, 2));
      return;
    }

    const logs = await engine.queryLogs(query);
    if (options.json) {
      console.log(JSON.stringify(logs, null, 2));
      return;
    }
    renderLogs(logs);
  });
}

function parseLogOptions(options: LogsCommandOptions): LogQueryOptions {
  return {
    sessionId: options.session,
    executionId: options.execution,
    backend: options.backend,
    eventType: options.eventType,
    since: parseTimeOption(options.since, "since"),
    until: parseTimeOption(options.until, "until"),
    offset: options.offset ? Number(options.offset) : undefined,
    limit: options.limit ? Number(options.limit) : undefined,
  };
}

function parseTimeOption(
  value: string | undefined,
  fieldName: string,
): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(
      `--${fieldName} must be a Unix timestamp in milliseconds or an ISO date`,
    );
  }
  return timestamp;
}

function renderLogs(logs: RuntimeLogEntry[]): void {
  if (logs.length === 0) {
    console.log("No log events matched.");
    return;
  }

  for (const { execution, event } of logs) {
    const prefix = [
      new Date(event.timestamp).toISOString(),
      event.backend,
      event.sessionId,
      event.executionId,
      `#${event.sequence}`,
      event.type,
    ].join(" ");
    console.log(`${prefix} ${formatEventData(event)}`);
    if (execution.status === "failed" && execution.errorJson) {
      console.log(`  execution error: ${execution.errorJson}`);
    }
  }
}

function formatEventData(event: RuntimeEvent): string {
  if (event.type === "output") {
    return truncate(event.data.content.replace(/\s+/g, " "), 240);
  }
  if (event.type === "state") {
    return event.data.message
      ? `${event.data.state}: ${event.data.message}`
      : event.data.state;
  }
  if (event.type === "tool_call") {
    return `${event.data.toolName} ${JSON.stringify(event.data.arguments)}`;
  }
  if (event.type === "tool_result") {
    return `${event.data.status} ${truncate(event.data.output ?? event.data.error ?? "", 180)}`;
  }
  if (event.type === "file_delta") {
    return `${event.data.operation} ${event.data.path}`;
  }
  if (event.type === "error") {
    return `${event.data.code}: ${event.data.message}`;
  }
  return `${event.data.name} ${JSON.stringify(event.data.payload)}`;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}
