import { ErrorCode } from "../error/codes.js";
import type { RuntimeEvent, RuntimeRequest } from "../event/types.js";
import type { McpRouter } from "../mcp/router.js";
import type { VisibilityCollector } from "../visibility/collector.js";
import type { SkillManifest, SkillExecutionTool } from "./loader.js";

export type SkillExecutionStatus = "completed" | "failed" | "interrupted";

export interface SkillExecutionResult {
  output: string;
  status: SkillExecutionStatus;
  errorJson?: string;
}

export interface SkillRunnerServices {
  mcpRouter?: McpRouter;
  assertFencingValid(): Promise<void>;
  persistEvent(event: RuntimeEvent): Promise<RuntimeEvent>;
  visibilityCollector?: VisibilityCollector;
}

export function matchExecutableSkill(
  prompt: string,
  skills: SkillManifest[],
): SkillManifest | undefined {
  return skills.find(
    (skill) => skill.execution?.mode === "mcp" && matchesSkill(prompt, skill),
  );
}

export async function* runSkillViaMcp(
  skill: SkillManifest,
  request: RuntimeRequest,
  backend: RuntimeEvent["backend"],
  services: SkillRunnerServices,
): AsyncGenerator<RuntimeEvent, SkillExecutionResult> {
  const execution = skill.execution;
  if (!execution || execution.mode !== "mcp") {
    return yield* failSkill(skill, request, backend, services, {
      code: ErrorCode.CONFIG_INVALID,
      message: `Skill ${skill.name} does not define an MCP execution plan`,
      details: { skill: skill.name },
    });
  }

  const serverName = resolveSkillServerName(
    services.mcpRouter,
    execution.server,
  );
  if (!services.mcpRouter || !serverName) {
    return yield* failSkill(skill, request, backend, services, {
      code: ErrorCode.MCP_SERVER_FAILED,
      message: `Skill ${skill.name} requires configured MCP server ${execution.server}, but it is not available`,
      details: { skill: skill.name, expectedServer: execution.server },
    });
  }

  const toolCallIds = new Map<string, string>();
  for (const tool of execution.tools) {
    const toolCallId = `skill-${request.executionId}-${skill.name}-${tool.as}`;
    toolCallIds.set(tool.as, toolCallId);
    const toolCall = await services.persistEvent({
      type: "tool_call",
      sessionId: request.sessionId,
      executionId: request.executionId,
      backend,
      sequence: 0,
      timestamp: Date.now(),
      data: {
        toolCallId,
        toolName: tool.name,
        rawToolName: `${serverName}/${tool.name}`,
        arguments: tool.arguments ?? {},
        approvalRequired: false,
      },
    } as RuntimeEvent);
    yield toolCall;
  }

  const spanId = services.visibilityCollector?.startSpan("mcp.proxy", {
    serverName,
    skill: skill.name,
    toolCount: execution.tools.length,
    parallel: execution.parallel,
  });
  const settled = execution.parallel
    ? await Promise.allSettled(
        execution.tools.map((tool) =>
          callSkillTool(services.mcpRouter!, serverName, tool),
        ),
      )
    : await callToolsSequentially(
        services.mcpRouter,
        serverName,
        execution.tools,
      );
  if (spanId) {
    services.visibilityCollector!.endSpan(spanId, {
      status: settled.every((result) => result.status === "fulfilled")
        ? "ok"
        : "error",
    });
  }

  const values = new Map<string, string>();
  const failures: Array<{ toolName: string; error: string }> = [];
  for (let index = 0; index < execution.tools.length; index += 1) {
    const tool = execution.tools[index];
    const result = settled[index];
    const toolCallId =
      toolCallIds.get(tool.as) ?? `skill-${request.executionId}-${index}`;

    if (result.status === "fulfilled") {
      values.set(tool.as, result.value.value);
      const toolResult = await services.persistEvent({
        type: "tool_result",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        sequence: 0,
        timestamp: Date.now(),
        data: {
          toolCallId,
          status: "success",
          output: result.value.value,
        },
      } as RuntimeEvent);
      yield toolResult;
    } else {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      failures.push({ toolName: tool.name, error: message });
      const toolResult = await services.persistEvent({
        type: "tool_result",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        sequence: 0,
        timestamp: Date.now(),
        data: {
          toolCallId,
          status: "error",
          error: message,
        },
      } as RuntimeEvent);
      yield toolResult;
    }
  }

  const output =
    failures.length === 0
      ? renderSkillOutput(skill, values)
      : renderSkillFailure(skill, failures);
  const outputEvent = await services.persistEvent({
    type: "output",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: {
      role: "assistant",
      content: output,
      format: "markdown",
      final: true,
    },
  } as RuntimeEvent);
  yield outputEvent;

  const errorJson =
    failures.length > 0
      ? JSON.stringify({
          code: ErrorCode.EXECUTION_FAILED,
          message: `Skill ${skill.name} failed to execute one or more tools`,
          details: { skill: skill.name, failures },
        })
      : undefined;
  return {
    output,
    status: failures.length > 0 ? "failed" : "completed",
    errorJson,
  };
}

function matchesSkill(prompt: string, skill: SkillManifest): boolean {
  const normalized = prompt.trim().toLowerCase();
  return skill.triggers.some((trigger) => {
    const value = trigger.trim().toLowerCase();
    return value.length > 0 && normalized.includes(value);
  });
}

function resolveSkillServerName(
  router: McpRouter | undefined,
  desiredName: string,
): string | undefined {
  const servers = router?.listServers() ?? [];
  return servers.find((server) => server.name === desiredName)?.name;
}

async function callSkillTool(
  router: McpRouter,
  serverName: string,
  tool: SkillExecutionTool,
): Promise<SkillExecutionTool & { value: string }> {
  const result = await router.callTool({
    serverName,
    toolName: tool.name,
    arguments: tool.arguments ?? {},
  });
  const value = extractMcpText(result);
  if (result.isError === true) {
    throw new Error(value);
  }
  return { ...tool, value };
}

async function callToolsSequentially(
  router: McpRouter,
  serverName: string,
  tools: SkillExecutionTool[],
): Promise<
  Array<PromiseSettledResult<SkillExecutionTool & { value: string }>>
> {
  const results: Array<
    PromiseSettledResult<SkillExecutionTool & { value: string }>
  > = [];
  for (const tool of tools) {
    try {
      results.push({
        status: "fulfilled",
        value: await callSkillTool(router, serverName, tool),
      });
    } catch (error) {
      results.push({ status: "rejected", reason: error });
    }
  }
  return results;
}

function extractMcpText(result: Record<string, unknown>): string {
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        typeof (part as Record<string, unknown>).text === "string"
          ? ((part as Record<string, unknown>).text as string)
          : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  if (typeof result.result === "string") return result.result.trim();
  return JSON.stringify(result);
}

function renderSkillOutput(
  skill: SkillManifest,
  values: Map<string, string>,
): string {
  const template = skill.output?.template;
  if (!template) {
    return [...values.entries()]
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
  }
  return template.replace(
    /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g,
    (_, key: string) => values.get(key) ?? "",
  );
}

function renderSkillFailure(
  skill: SkillManifest,
  failures: Array<{ toolName: string; error: string }>,
): string {
  return [
    `${skill.name} 执行失败：以下工具没有返回真实结果，未使用默认值补齐。`,
    "",
    ...failures.map((failure) => `- ${failure.toolName}: ${failure.error}`),
  ].join("\n");
}

async function* failSkill(
  _skill: SkillManifest,
  request: RuntimeRequest,
  backend: RuntimeEvent["backend"],
  services: SkillRunnerServices,
  runtimeError: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  },
): AsyncGenerator<RuntimeEvent, SkillExecutionResult> {
  const errorEvent = await services.persistEvent({
    type: "error",
    sessionId: request.sessionId,
    executionId: request.executionId,
    backend,
    sequence: 0,
    timestamp: Date.now(),
    data: runtimeError,
  } as RuntimeEvent);
  yield errorEvent;
  return {
    output: "",
    status: "failed",
    errorJson: JSON.stringify(runtimeError),
  };
}
