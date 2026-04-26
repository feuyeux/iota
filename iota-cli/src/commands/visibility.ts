import fs from "node:fs/promises";
import { IotaEngine, type BackendName } from "@iota/engine";
import type {
  ExecutionVisibility,
  ExecutionVisibilitySummary,
  VisibilityListOptions,
} from "@iota/engine";
import { withEngine } from "./shared.js";

export interface VisibilityOptions {
  execution?: string;
  memory?: boolean;
  tokens?: boolean;
  chain?: boolean;
  trace?: boolean;
  json?: boolean;
  session?: string;
  summary?: boolean;
  backend?: string;
  export?: string;
  format?: "json" | "yaml" | "csv";
  limit?: string | number;
  offset?: string | number;
}

export interface VisibilityListCommandOptions {
  session?: string;
  backend?: string;
  limit?: string | number;
  offset?: string | number;
  json?: boolean;
  export?: string;
  format?: "json" | "yaml" | "csv";
}

export interface VisibilitySearchCommandOptions extends VisibilityListCommandOptions {
  prompt?: string;
}

export interface VisibilityInteractiveOptions {
  session?: string;
  execution?: string;
  interval?: string | number;
  json?: boolean;
}

interface SessionVisibilityRow {
  summary: ExecutionVisibilitySummary;
  visibility: ExecutionVisibility | null;
}

export async function visibilityCommand(
  executionId: string | undefined,
  options: VisibilityOptions,
): Promise<void> {
  await withEngine(async (engine) => {
    if (options.session) {
      await renderSessionVisibility(engine, options.session, options);
      return;
    }

    if (!executionId) {
      throw new Error(
        "Missing execution ID. Use `iota visibility --execution <executionId>` or `iota visibility --session <sessionId>`.",
      );
    }

    const visibility = await engine.getExecutionVisibility(executionId);
    if (!visibility) {
      console.error(`No visibility data found for execution: ${executionId}`);
      process.exitCode = 1;
      return;
    }

    if (options.backend && visibility.context?.backend !== options.backend) {
      console.error(
        `Execution ${executionId} uses backend ${visibility.context?.backend ?? "unknown"}, not ${options.backend}.`,
      );
      process.exitCode = 1;
      return;
    }

    const selected = selectExecutionView(visibility, options);
    if (options.export) {
      await exportVisibility(selected, {
        output: options.export,
        format: options.format ?? inferFormat(options.export) ?? "json",
      });
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(selected, null, 2));
      return;
    }

    console.log(
      options.trace
        ? formatTraceVisibility(executionId, visibility)
        : formatExecutionVisibility(executionId, visibility, options),
    );
  });
}

export async function visibilityListCommand(
  options: VisibilityListCommandOptions,
): Promise<void> {
  await withEngine(async (engine) => {
    const sessionId = requireSessionId(options.session, "list");
    const rows = await loadSessionRows(engine, sessionId, options);
    const filtered = filterRows(rows, options.backend);
    const payload = filtered.map(toSessionExportRow);

    if (options.export) {
      await exportVisibility(payload, {
        output: options.export,
        format: options.format ?? inferFormat(options.export) ?? "json",
      });
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(formatVisibilityList(sessionId, filtered));
  });
}

export async function visibilitySearchCommand(
  options: VisibilitySearchCommandOptions,
): Promise<void> {
  await withEngine(async (engine) => {
    const sessionId = requireSessionId(options.session, "search");
    const prompt = options.prompt?.trim();
    if (!prompt) {
      throw new Error("Missing --prompt <text> for visibility search.");
    }

    const rows = await loadSessionRows(engine, sessionId, options);
    const filtered = filterRows(rows, options.backend).filter((row) =>
      getPromptPreview(row).toLowerCase().includes(prompt.toLowerCase()),
    );
    const payload = filtered.map(toSessionExportRow);

    if (options.export) {
      await exportVisibility(payload, {
        output: options.export,
        format: options.format ?? inferFormat(options.export) ?? "json",
      });
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(formatSearchResults(prompt, filtered));
  });
}

export async function visibilityInteractiveCommand(
  options: VisibilityInteractiveOptions,
): Promise<void> {
  const intervalMs = parsePositiveInt(options.interval, 1000);
  if (!options.session && !options.execution) {
    throw new Error(
      "Interactive visibility requires --session <sessionId> or --execution <executionId>.",
    );
  }

  await withEngine(async (engine) => {
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    process.once("SIGINT", stop);

    try {
      while (!stopped) {
        const content = options.execution
          ? await renderExecutionSnapshot(engine, options.execution, options)
          : await renderSessionSnapshot(engine, options.session!, options);
        console.clear();
        console.log(content);
        console.log("");
        console.log("[Ctrl+C to exit]");
        await sleep(intervalMs);
      }
    } finally {
      process.off("SIGINT", stop);
    }
  });
}

async function renderSessionVisibility(
  engine: IotaEngine,
  sessionId: string,
  options: VisibilityOptions,
): Promise<void> {
  const rows = await loadSessionRows(engine, sessionId, options);
  const filtered = filterRows(rows, options.backend);
  const payload = filtered.map(toSessionExportRow);

  if (options.export) {
    await exportVisibility(payload, {
      output: options.export,
      format: options.format ?? inferFormat(options.export) ?? "json",
    });
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(formatSessionSummary(sessionId, filtered));
}

async function renderExecutionSnapshot(
  engine: IotaEngine,
  executionId: string,
  options: VisibilityInteractiveOptions,
): Promise<string> {
  const visibility = await engine.getExecutionVisibility(executionId);
  if (!visibility) {
    return `[Live] Execution: ${executionId}\n\nNo visibility data yet.`;
  }
  if (options.json) {
    return JSON.stringify(visibility, null, 2);
  }
  return `[Live] Execution: ${executionId}\n\n${formatExecutionVisibility(
    executionId,
    visibility,
    {},
  )}`;
}

async function renderSessionSnapshot(
  engine: IotaEngine,
  sessionId: string,
  options: VisibilityInteractiveOptions,
): Promise<string> {
  const rows = await loadSessionRows(engine, sessionId, { limit: 20 });
  if (options.json) {
    return JSON.stringify(rows.map(toSessionExportRow), null, 2);
  }
  return `[Live] Session: ${sessionId}\n\n${formatSessionSummary(
    sessionId,
    rows,
  )}`;
}

async function loadSessionRows(
  engine: IotaEngine,
  sessionId: string,
  options: { limit?: string | number; offset?: string | number },
): Promise<SessionVisibilityRow[]> {
  const listOptions: VisibilityListOptions = {
    limit: parsePositiveInt(options.limit, 50),
    offset: parsePositiveInt(options.offset, 0),
  };
  const summaries = await engine.listSessionVisibility(sessionId, listOptions);
  const rows: SessionVisibilityRow[] = [];
  for (const summary of summaries) {
    rows.push({
      summary,
      visibility: await engine.getExecutionVisibility(summary.executionId),
    });
  }
  return rows;
}

function filterRows(
  rows: SessionVisibilityRow[],
  backend?: string,
): SessionVisibilityRow[] {
  if (!backend) return rows;
  return rows.filter((row) => row.summary.backend === backend);
}

function selectExecutionView(
  visibility: ExecutionVisibility,
  options: VisibilityOptions,
): unknown {
  if (options.memory) return visibility.memory ?? null;
  if (options.tokens) return visibility.tokens ?? null;
  if (options.trace) {
    return {
      traceId:
        visibility.link?.traceId ??
        visibility.spans?.[0]?.traceId ??
        visibility.context?.executionId,
      spans: visibility.spans ?? visibility.link?.spans ?? [],
      link: visibility.link,
      mappings: visibility.mappings ?? [],
      tokens: visibility.tokens,
      context: visibility.context,
    };
  }
  if (options.chain) {
    return { link: visibility.link, mappings: visibility.mappings ?? [] };
  }
  return visibility;
}

export function formatTraceVisibility(
  executionId: string,
  visibility: ExecutionVisibility,
): string {
  const spans = [...(visibility.spans ?? visibility.link?.spans ?? [])].sort(
    (a, b) => a.startedAt - b.startedAt,
  );
  const link = visibility.link;
  const traceId = link?.traceId ?? spans[0]?.traceId ?? "unknown";
  const backend =
    visibility.context?.backend ?? visibility.tokens?.backend ?? "unknown";
  const lines: string[] = [
    `Trace: ${traceId}`,
    `Execution: ${executionId}`,
    `Backend: ${backend}`,
  ];

  if (link) {
    const command =
      `${link.command.executable} ${link.command.args.join(" ")}`.trim();
    lines.push(`Command: ${command}`);
    lines.push(`Protocol: ${link.protocol.name}`);
    if (link.process) {
      const exit =
        link.process.exitCode !== undefined
          ? ` exit=${link.process.exitCode}`
          : "";
      const signal = link.process.signal
        ? ` signal=${link.process.signal}`
        : "";
      lines.push(
        `Process: pid=${link.process.pid ?? "unknown"}${exit}${signal}`,
      );
    }
  }

  if (visibility.tokens) {
    const tokens = visibility.tokens;
    lines.push(
      `Tokens: input=${formatNumber(tokens.input.nativeTokens ?? tokens.input.estimatedTokens)} output=${formatNumber(tokens.output.nativeTokens ?? tokens.output.estimatedTokens)} total=${formatNumber(tokens.total.nativeTokens ?? tokens.total.estimatedTokens)} confidence=${tokens.confidence}`,
    );
  }

  lines.push("", "Spans:");
  if (spans.length === 0) {
    lines.push("  (no spans)");
  } else {
    for (const span of spans) {
      const duration = formatDuration(span.startedAt, span.endedAt);
      const parent = span.parentSpanId
        ? ` parent=${shortId(span.parentSpanId)}`
        : "";
      const attrs = formatAttributes(span.attributes);
      lines.push(
        `  ${shortId(span.spanId)}${parent} ${span.kind} ${span.status} ${duration}${attrs ? ` ${attrs}` : ""}`,
      );
    }
  }

  lines.push("", "Native Events:");
  const nativeRefs = link?.nativeEventRefs ?? [];
  if (nativeRefs.length === 0) {
    lines.push("  (no native events)");
  } else {
    for (const ref of nativeRefs) {
      const seq =
        ref.runtimeSequence === undefined ? "" : ` seq=${ref.runtimeSequence}`;
      const parsed = ref.parsedAs ? ` parsed=${ref.parsedAs}` : "";
      const preview = ref.preview
        ? ` preview=${JSON.stringify(ref.preview)}`
        : "";
      lines.push(
        `  ${shortId(ref.refId)} ${ref.direction}${parsed}${seq} hash=${shortId(ref.rawHash)}${preview}`,
      );
    }
  }

  lines.push("", "Runtime Mappings:");
  const mappings = visibility.mappings ?? [];
  if (mappings.length === 0) {
    lines.push("  (no mappings)");
  } else {
    for (const mapping of mappings) {
      const seq =
        mapping.runtimeSequence === undefined
          ? ""
          : ` seq=${mapping.runtimeSequence}`;
      lines.push(
        `  ${shortId(mapping.nativeRefId)} -> ${mapping.runtimeEventType}${seq} rule=${mapping.mappingRule} lossy=${mapping.lossy}`,
      );
    }
  }

  return lines.join("\n").trimEnd();
}

function formatExecutionVisibility(
  executionId: string,
  visibility: ExecutionVisibility,
  options: VisibilityOptions,
): string {
  const backend =
    visibility.context?.backend ?? visibility.tokens?.backend ?? "unknown";
  const lines: string[] = [
    `Execution: ${executionId}`,
    `Backend: ${backend}`,
    "",
  ];

  if (visibility.context && !options.tokens && !options.chain) {
    lines.push("Context:");
    for (const seg of visibility.context.segments) {
      const label = seg.kind.replace(/_/g, " ").padEnd(22);
      const tokens = seg.nativeTokens ?? seg.estimatedTokens;
      const suffix = seg.nativeTokens ? "native" : "estimated";
      lines.push(`  ${label}${formatNumber(tokens)} tokens ${suffix}`);
    }
    lines.push("");
  }

  if (
    visibility.memory &&
    (options.memory || (!options.tokens && !options.chain))
  ) {
    const mem = visibility.memory;
    const selectedCount = mem.selected.length;
    const trimmedCount = mem.selected.filter((s) => s.trimmed).length;
    lines.push("Memory:");
    lines.push(`  candidates          ${formatNumber(mem.candidates.length)}`);
    lines.push(
      `  selected            ${formatNumber(selectedCount)}${trimmedCount > 0 ? `, ${formatNumber(trimmedCount)} trimmed` : ""}`,
    );
    lines.push(`  excluded            ${formatNumber(mem.excluded.length)}`);
    if (mem.extraction) {
      lines.push(
        `  extraction          ${mem.extraction.extracted ? "yes" : "no"}${mem.extraction.reason ? ` (${mem.extraction.reason})` : ""}`,
      );
    }
    lines.push("");
  }

  if (
    visibility.tokens &&
    (options.tokens || (!options.memory && !options.chain))
  ) {
    const tok = visibility.tokens;
    lines.push("Tokens:");
    lines.push(
      `  input               ${formatNumber(tok.input.nativeTokens ?? tok.input.estimatedTokens)} ${tok.input.nativeTokens ? "native" : "estimated"}`,
    );
    lines.push(
      `  output              ${formatNumber(tok.output.nativeTokens ?? tok.output.estimatedTokens)} ${tok.output.nativeTokens ? "native" : "estimated"}`,
    );
    lines.push(
      `  total               ${formatNumber(tok.total.nativeTokens ?? tok.total.estimatedTokens)} ${tok.total.nativeTokens ? "native" : "estimated"}`,
    );
    lines.push(`  confidence          ${tok.confidence}`);
    lines.push("");
  }

  if (options.chain || (!options.memory && !options.tokens)) {
    lines.push("Chain:");
    if (visibility.link) {
      const link = visibility.link;
      lines.push(
        `  command             ${link.command.executable} ${link.command.args.join(" ")}`.trimEnd(),
      );
      lines.push(`  protocol            ${link.protocol.name}`);
      lines.push(
        `  native events       ${formatNumber(link.nativeEventRefs.length)}`,
      );
      lines.push(
        `  runtime mappings    ${formatNumber(visibility.mappings?.length ?? 0)}`,
      );
      for (const span of link.spans.slice(0, 8)) {
        const duration =
          span.endedAt && span.startedAt
            ? `${formatNumber(span.endedAt - span.startedAt)}ms`
            : "running";
        lines.push(`  ${span.kind.padEnd(20)} ${duration}`);
      }
      if (link.process?.exitCode !== undefined) {
        lines.push(`  process.exit        code ${link.process.exitCode}`);
      }
    } else {
      lines.push("  (no chain data available)");
    }
  }

  return lines.join("\n").trimEnd();
}

function formatSessionSummary(
  sessionId: string,
  rows: SessionVisibilityRow[],
): string {
  const totalInput = rows.reduce(
    (sum, row) =>
      sum +
      (row.visibility?.tokens?.input.nativeTokens ??
        row.visibility?.tokens?.input.estimatedTokens ??
        0),
    0,
  );
  const totalOutput = rows.reduce(
    (sum, row) =>
      sum +
      (row.visibility?.tokens?.output.nativeTokens ??
        row.visibility?.tokens?.output.estimatedTokens ??
        0),
    0,
  );
  const selected = rows.reduce(
    (sum, row) => sum + (row.visibility?.memory?.selected.length ?? 0),
    0,
  );
  const trimmed = rows.reduce(
    (sum, row) =>
      sum +
      (row.visibility?.memory?.selected.filter((item) => item.trimmed).length ??
        0),
    0,
  );
  const backendCounts = new Map<BackendName, number>();
  for (const row of rows) {
    backendCounts.set(
      row.summary.backend,
      (backendCounts.get(row.summary.backend) ?? 0) + 1,
    );
  }

  const lines = [
    `Session: ${sessionId}`,
    `Executions: ${formatNumber(rows.length)}`,
    "",
    "Token Summary:",
    `  total input         ${formatNumber(totalInput)}`,
    `  total output        ${formatNumber(totalOutput)}`,
    `  total               ${formatNumber(totalInput + totalOutput)}`,
    `  avg per execution   ${formatNumber(rows.length ? Math.round((totalInput + totalOutput) / rows.length) : 0)} tokens`,
    "",
    "Memory Summary:",
    `  selected blocks     ${formatNumber(selected)}`,
    `  trimmed blocks      ${formatNumber(trimmed)}`,
    "",
    "Backend Distribution:",
  ];

  for (const [backend, count] of backendCounts) {
    const pct = rows.length ? ((count / rows.length) * 100).toFixed(1) : "0.0";
    lines.push(
      `  ${backend.padEnd(20)} ${formatNumber(count)} executions (${pct}%)`,
    );
  }

  return lines.join("\n");
}

function formatVisibilityList(
  sessionId: string,
  rows: SessionVisibilityRow[],
): string {
  const lines = [`Recent Executions for ${sessionId} (${rows.length}):`, ""];
  for (const row of rows) {
    const tokenTotal =
      row.visibility?.tokens?.total.nativeTokens ??
      row.visibility?.tokens?.total.estimatedTokens ??
      0;
    const memoryCount = row.visibility?.memory?.selected.length ?? 0;
    lines.push(
      `${row.summary.executionId} | ${formatDate(row.summary.createdAt)} | ${row.summary.backend.padEnd(11)} | ${formatNumber(tokenTotal)} tokens | ${formatNumber(memoryCount)} memory`,
    );
  }
  return lines.join("\n");
}

function formatSearchResults(
  prompt: string,
  rows: SessionVisibilityRow[],
): string {
  const lines = [`Found ${rows.length} executions matching "${prompt}":`, ""];
  rows.forEach((row, index) => {
    const tokenTotal =
      row.visibility?.tokens?.total.nativeTokens ??
      row.visibility?.tokens?.total.estimatedTokens ??
      0;
    const memoryCount = row.visibility?.memory?.selected.length ?? 0;
    lines.push(
      `${index + 1}. ${row.summary.executionId} | ${formatDate(row.summary.createdAt)} | ${row.summary.backend}`,
    );
    lines.push(`   Prompt: "${getPromptPreview(row)}"`);
    lines.push(
      `   Tokens: ${formatNumber(tokenTotal)} total | Memory: ${formatNumber(memoryCount)} selected`,
    );
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function toSessionExportRow(
  row: SessionVisibilityRow,
): Record<string, unknown> {
  const inputTokens =
    row.visibility?.tokens?.input.nativeTokens ??
    row.visibility?.tokens?.input.estimatedTokens ??
    0;
  const outputTokens =
    row.visibility?.tokens?.output.nativeTokens ??
    row.visibility?.tokens?.output.estimatedTokens ??
    0;
  const totalTokens =
    row.visibility?.tokens?.total.nativeTokens ??
    row.visibility?.tokens?.total.estimatedTokens ??
    inputTokens + outputTokens;
  const spans = row.visibility?.link?.spans ?? [];
  const startedAt = spans[0]?.startedAt;
  const endedAt = [...spans].reverse().find((span) => span.endedAt)?.endedAt;

  return {
    executionId: row.summary.executionId,
    sessionId: row.summary.sessionId,
    backend: row.summary.backend,
    timestamp: new Date(row.summary.createdAt).toISOString(),
    inputTokens,
    outputTokens,
    totalTokens,
    confidence: row.visibility?.tokens?.confidence,
    memorySelected: row.visibility?.memory?.selected.length ?? 0,
    memoryTrimmed:
      row.visibility?.memory?.selected.filter((item) => item.trimmed).length ??
      0,
    durationMs: startedAt && endedAt ? endedAt - startedAt : undefined,
    prompt: getPromptPreview(row),
    hasContext: row.summary.hasContext,
    hasMemory: row.summary.hasMemory,
    hasTokens: row.summary.hasTokens,
    hasLink: row.summary.hasLink,
    mappingCount: row.summary.mappingCount,
  };
}

async function exportVisibility(
  data: unknown,
  options: { output: string; format: "json" | "yaml" | "csv" },
): Promise<void> {
  let content: string;
  if (options.format === "csv") {
    content = toCsv(Array.isArray(data) ? data : [data]);
  } else if (options.format === "yaml") {
    content = toYaml(data);
  } else {
    content = JSON.stringify(data, null, 2);
  }
  await fs.writeFile(options.output, content + "\n", "utf8");
  console.log(`Exported visibility data to ${options.output}`);
}

function toCsv(rows: unknown[]): string {
  const objects = rows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
  if (objects.length === 0) return "";
  const headers = [...new Set(objects.flatMap((row) => Object.keys(row)))];
  return [
    headers.join(","),
    ...objects.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
  ].join("\n");
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          return `${pad}-\n${toYaml(item, indent + 2)}`;
        }
        const scalar = yamlScalar(item);
        if (scalar.startsWith("|\n")) {
          // Block scalar under array dash — indent its body
          const lines = scalar.split("\n");
          return `${pad}- ${lines[0]}\n${lines
            .slice(1)
            .map((l) => `${pad}  ${l}`)
            .join("\n")}`;
        }
        return `${pad}- ${scalar}`;
      })
      .join("\n");
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (typeof item === "object" && item !== null) {
          return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
        }
        const scalar = yamlScalar(item);
        if (scalar.startsWith("|\n")) {
          return `${pad}${key}: ${scalar
            .split("\n")
            .map((l, i) => (i === 0 ? l : `${pad}  ${l}`))
            .join("\n")}`;
        }
        return `${pad}${key}: ${scalar}`;
      })
      .join("\n");
  }
  return `${pad}${yamlScalar(value)}`;
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const str = String(value);
  if (str.includes("\n")) return `|\n  ${str.replace(/\n/g, "\n  ")}`;
  // Quote strings that look like YAML special values
  if (/^(true|false|null|yes|no|on|off)$/i.test(str))
    return JSON.stringify(str);
  // Quote strings that start like numbers
  if (
    /^[+-]?(\d[\d._]*([eE][+-]?\d+)?|0x[\da-f]+|0o[0-7]+|0b[01]+|\.inf|\.nan)$/i.test(
      str,
    )
  )
    return JSON.stringify(str);
  // Quote strings with special YAML characters or leading/trailing whitespace
  const yamlSpecialChars = ":#[]{}&*!|>'\"`,@%";
  if (
    [...yamlSpecialChars].some((char) => str.includes(char)) ||
    str.trim() !== str ||
    str === ""
  ) {
    return JSON.stringify(str);
  }
  return str;
}

function getPromptPreview(row: SessionVisibilityRow): string {
  return row.visibility?.memory?.query.preview ?? "";
}

function requireSessionId(
  sessionId: string | undefined,
  command: string,
): string {
  if (!sessionId) {
    throw new Error(
      `visibility ${command} currently requires --session <sessionId>.`,
    );
  }
  return sessionId;
}

function parsePositiveInt(
  value: string | number | undefined,
  fallback: number,
): number {
  if (value == null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function inferFormat(filePath: string): "json" | "yaml" | "csv" | undefined {
  if (filePath.endsWith(".csv")) return "csv";
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "yaml";
  if (filePath.endsWith(".json")) return "json";
  return undefined;
}

function formatDuration(startedAt: number, endedAt?: number): string {
  return endedAt ? `${formatNumber(endedAt - startedAt)}ms` : "running";
}

function shortId(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 12);
}

function formatAttributes(attributes: Record<string, unknown>): string {
  const entries = Object.entries(attributes).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => `${key}=${formatAttributeValue(value)}`)
    .join(" ");
}

function formatAttributeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  return JSON.stringify(value);
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "unknown";
  return new Date(timestamp).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
