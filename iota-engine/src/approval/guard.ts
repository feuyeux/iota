import { ErrorCode, toRuntimeError } from "../error/codes.js";
import { enforceApprovalPolicy } from "./policy.js";
import type { ApprovalHook } from "./hook.js";
import { checkWorkspacePath } from "../workspace/path-guard.js";
import { redactStructuredData } from "../visibility/redaction.js";
import type { VisibilityCollector } from "../visibility/collector.js";
import type { RuntimeEventStore } from "../event/store.js";
import type { EventMultiplexer } from "../event/multiplexer.js";
import type { StorageBackend } from "../storage/interface.js";
import type { McpRouter } from "../mcp/router.js";
import type { AuditLogger, AuditEntry } from "../audit/logger.js";
import type {
  ApprovalPolicy,
  BackendName,
  RuntimeEvent,
  RuntimeRequest,
} from "../event/types.js";
import type { IotaConfig } from "../config/schema.js";

// ─── Shared services interface ──────────────────────────────────

export interface EngineServices {
  config: IotaConfig;
  storage: StorageBackend;
  eventStore: RuntimeEventStore;
  multiplexer: EventMultiplexer;
  approvalHook: ApprovalHook;
  mcpRouter?: McpRouter;
  audit?: AuditLogger;
}

// ─── ApprovalGuard ──────────────────────────────────────────────

export class ApprovalGuard {
  constructor(private readonly services: EngineServices) {}

  /**
   * Async generator that yields intermediate state events (e.g. waiting_approval)
   * before yielding the final guarded event. This ensures waiting_approval is
   * yielded to consumers BEFORE blocking on the approval decision.
   */
  async *guardEvent(
    request: RuntimeRequest,
    event: RuntimeEvent,
    fencingValidator?: () => Promise<void>,
    backendCanReceiveMcpResult?: boolean,
    vc?: VisibilityCollector,
  ): AsyncGenerator<RuntimeEvent> {
    if (event.type !== "tool_call") {
      yield event;
      return;
    }

    const policy = this.resolveApprovalPolicy(request.approvals);
    const { approvalHook, eventStore, multiplexer } = this.services;

    // Helper: emit waiting_approval state, yield it, then block on approval
    const emitWaitAndEnforce = async function* (
      operationType:
        | "shell"
        | "fileOutside"
        | "network"
        | "container"
        | "mcpExternal"
        | "privilegeEscalation",
      description: string,
      details: Record<string, unknown>,
    ): AsyncGenerator<RuntimeEvent, void> {
      const mode = policy[operationType];
      if (mode === "ask") {
        if (fencingValidator) await fencingValidator();
        const waitEvt = await eventStore.appendState(
          request.sessionId,
          request.executionId,
          event.backend,
          "waiting_approval",
        );
        await multiplexer.publish(waitEvt);
        yield waitEvt;
      }
      await enforceApprovalPolicy(policy, approvalHook, {
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend: event.backend,
        operationType,
        description,
        details,
      });
      if (mode === "ask") {
        if (fencingValidator) await fencingValidator();
        const runEvt = await eventStore.appendState(
          request.sessionId,
          request.executionId,
          event.backend,
          "running",
        );
        await multiplexer.publish(runEvt);
        yield runEvt;
      }
    };

    // Path guard: check workspace boundary (Section 15.3)
    const paths = extractPathArguments(event.data.arguments);
    for (const candidatePath of paths) {
      const check = checkWorkspacePath(request.workingDirectory, candidatePath);
      if (!check.insideRoot) {
        await this.auditAction(
          request.sessionId,
          request.executionId,
          event.backend,
          "approval_request",
          "success",
          {
            operationType: "fileOutside",
            path: candidatePath,
            absolutePath: check.absolutePath,
          },
        );
        try {
          yield* emitWaitAndEnforce(
            "fileOutside",
            `Tool ${event.data.toolName} references a path outside the workspace: ${candidatePath}`,
            { path: candidatePath, absolutePath: check.absolutePath },
          );
          await this.auditAction(
            request.sessionId,
            request.executionId,
            event.backend,
            "approval_decision",
            "success",
            {
              decision: "approve",
              operationType: "fileOutside",
              path: candidatePath,
            },
          );
        } catch (error) {
          const runtimeError = toRuntimeError(error);
          await this.auditAction(
            request.sessionId,
            request.executionId,
            event.backend,
            "approval_decision",
            "denied",
            {
              decision: "deny",
              operationType: "fileOutside",
              path: candidatePath,
            },
          );
          yield {
            type: "error",
            sessionId: request.sessionId,
            executionId: request.executionId,
            backend: event.backend,
            sequence: 0,
            timestamp: Date.now(),
            data: runtimeError,
          } as RuntimeEvent;
          return;
        }
      }
    }

    // Shell execution approval
    if (isShellTool(event.data.toolName)) {
      try {
        yield* emitWaitAndEnforce(
          "shell",
          `Shell execution: ${event.data.toolName}`,
          event.data.arguments,
        );
      } catch (error) {
        const runtimeError = toRuntimeError(error);
        await this.auditAction(
          request.sessionId,
          request.executionId,
          event.backend,
          "approval_decision",
          "denied",
          { decision: "deny", operationType: "shell" },
        );
        yield {
          type: "error",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: event.backend,
          sequence: 0,
          timestamp: Date.now(),
          data: runtimeError,
        } as RuntimeEvent;
        return;
      }
    }

    // Privilege escalation detection
    if (isPrivilegeEscalation(event.data.toolName, event.data.arguments)) {
      try {
        yield* emitWaitAndEnforce(
          "privilegeEscalation",
          `Potential privilege escalation: ${event.data.toolName}`,
          event.data.arguments,
        );
      } catch (error) {
        const runtimeError = toRuntimeError(error);
        await this.auditAction(
          request.sessionId,
          request.executionId,
          event.backend,
          "approval_decision",
          "denied",
          { decision: "deny", operationType: "privilegeEscalation" },
        );
        yield {
          type: "error",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: event.backend,
          sequence: 0,
          timestamp: Date.now(),
          data: runtimeError,
        } as RuntimeEvent;
        return;
      }
    }

    // MCP tool routing: detect MCP-prefixed tools and route through McpRouter
    if (this.services.mcpRouter && isMcpTool(event.data.toolName)) {
      if (!backendCanReceiveMcpResult) {
        yield {
          type: "error" as const,
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: event.backend,
          sequence: 0,
          timestamp: Date.now(),
          data: {
            code: ErrorCode.EXECUTION_FAILED,
            message: `MCP tool ${event.data.toolName} cannot be proxied: backend ${event.backend} does not support mid-execution response channel`,
            details: { toolName: event.data.toolName },
          },
        } as RuntimeEvent;
        return;
      }
      const { serverName, toolName } = parseMcpToolName(event.data.toolName);
      try {
        yield* emitWaitAndEnforce(
          "mcpExternal",
          `MCP tool call: ${serverName}/${toolName}`,
          { serverName, toolName, arguments: event.data.arguments },
        );
      } catch (error) {
        const runtimeError = toRuntimeError(error);
        await this.auditAction(
          request.sessionId,
          request.executionId,
          event.backend,
          "approval_decision",
          "denied",
          {
            decision: "deny",
            operationType: "mcpExternal",
            serverName,
            toolName,
          },
        );
        yield {
          type: "error",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: event.backend,
          sequence: 0,
          timestamp: Date.now(),
          data: runtimeError,
        } as RuntimeEvent;
        return;
      }

      // Proxy the tool call through McpRouter and return a tool_result event
      const mcpSpanId = vc?.startSpan("mcp.proxy", { serverName, toolName });
      try {
        const result = await this.services.mcpRouter.callTool({
          serverName,
          toolName,
          arguments: event.data.arguments,
        });
        if (mcpSpanId) vc!.endSpan(mcpSpanId, { status: "ok" });
        await this.auditAction(
          request.sessionId,
          request.executionId,
          event.backend,
          "tool_call",
          "success",
          { serverName, toolName, mcp: true },
        );
        yield {
          type: "tool_result" as const,
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: event.backend,
          sequence: 0,
          timestamp: Date.now(),
          data: {
            toolCallId: event.data.toolCallId,
            status: "success" as const,
            output: JSON.stringify(result),
          },
        } as RuntimeEvent;
      } catch (error) {
        if (mcpSpanId) vc!.endSpan(mcpSpanId, { status: "error" });
        const runtimeError = toRuntimeError(error, ErrorCode.EXECUTION_FAILED);
        await this.auditAction(
          request.sessionId,
          request.executionId,
          event.backend,
          "tool_call",
          "failure",
          { serverName, toolName, mcp: true, error: runtimeError.message },
        );
        yield {
          type: "tool_result" as const,
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: event.backend,
          sequence: 0,
          timestamp: Date.now(),
          data: {
            toolCallId: event.data.toolCallId,
            status: "error" as const,
            output: undefined,
            error: runtimeError.message,
          },
        } as RuntimeEvent;
      }
      return;
    }

    yield event;
  }

  /**
   * Async generator for handling approval_request extensions from backend adapters.
   * Yields: waiting_approval state (before blocking), then either error or running state.
   * Returns "approved" or "denied".
   */
  async *handleApprovalExtension(
    request: RuntimeRequest,
    event: RuntimeEvent,
    fencingValidator?: () => Promise<void>,
    vc?: VisibilityCollector,
  ): AsyncGenerator<RuntimeEvent, "approved" | "denied"> {
    if (event.type !== "extension" || event.data.name !== "approval_request") {
      return "approved";
    }

    const payload = event.data.payload;
    const operationType =
      typeof payload.operationType === "string"
        ? (payload.operationType as
            | "shell"
            | "fileOutside"
            | "network"
            | "container"
            | "mcpExternal"
            | "privilegeEscalation")
        : "shell";
    const policy = this.resolveApprovalPolicy(request.approvals);
    const { eventStore, multiplexer } = this.services;

    await this.auditAction(
      request.sessionId,
      request.executionId,
      event.backend,
      "approval_request",
      "success",
      { operationType, ...payload },
    );

    const approvalSpanId = vc?.startSpan("approval.wait", { operationType });

    try {
      if (policy[operationType] === "ask") {
        if (fencingValidator) await fencingValidator();
        const waitEvt = await eventStore.appendState(
          request.sessionId,
          request.executionId,
          event.backend,
          "waiting_approval",
        );
        await multiplexer.publish(waitEvt);
        yield waitEvt;
      }
      await enforceApprovalPolicy(policy, this.services.approvalHook, {
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend: event.backend,
        operationType,
        description:
          typeof payload.description === "string"
            ? payload.description
            : `${operationType} approval requested`,
        details: payload,
      });
      if (approvalSpanId) vc!.endSpan(approvalSpanId, { status: "ok" });
      await this.auditAction(
        request.sessionId,
        request.executionId,
        event.backend,
        "approval_decision",
        "success",
        { decision: "approve", operationType },
      );
      if (policy[operationType] === "ask") {
        if (fencingValidator) await fencingValidator();
        const runEvt = await eventStore.appendState(
          request.sessionId,
          request.executionId,
          event.backend,
          "running",
        );
        await multiplexer.publish(runEvt);
        yield runEvt;
      }
      return "approved";
    } catch (error) {
      if (approvalSpanId) vc!.endSpan(approvalSpanId, { status: "error" });
      const runtimeError = toRuntimeError(error);
      await this.auditAction(
        request.sessionId,
        request.executionId,
        event.backend,
        "approval_decision",
        "denied",
        { decision: "deny", operationType },
      );
      if (fencingValidator) await fencingValidator();
      const errorEvt: RuntimeEvent = {
        type: "error",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend: event.backend,
        sequence: 0,
        timestamp: Date.now(),
        data: runtimeError,
      };
      const persisted = await eventStore.append(errorEvt);
      await multiplexer.publish(persisted);
      yield persisted;
      return "denied";
    }
  }

  resolveApprovalPolicy(policy?: ApprovalPolicy): Required<ApprovalPolicy> {
    return { ...this.services.config.approval, ...policy };
  }

  // ─── Audit helper ───────────────────────────────────────────

  async auditAction(
    sessionId: string,
    executionId: string,
    backend: BackendName,
    action: AuditEntry["action"],
    result: AuditEntry["result"],
    details: Record<string, unknown>,
  ): Promise<void> {
    const redactedDetails = redactStructuredData(details) as Record<
      string,
      unknown
    >;
    await this.services.audit?.append({
      timestamp: Date.now(),
      sessionId,
      executionId,
      backend,
      action,
      result,
      details: redactedDetails,
    });
  }
}

// ─── Pure helper functions ──────────────────────────────────────

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

export function isShellTool(toolName: string): boolean {
  const shellTools = [
    "bash",
    "shell",
    "terminal",
    "exec",
    "run_command",
    "execute_command",
    "Bash",
  ];
  return shellTools.some((t) =>
    toolName.toLowerCase().includes(t.toLowerCase()),
  );
}

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
  if (command.includes("sudo ") || command.includes("su ")) return true;
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

export function isMcpTool(toolName: string): boolean {
  return (
    toolName.includes("mcp__") ||
    toolName.includes("mcp:") ||
    toolName.startsWith("mcp/")
  );
}

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
