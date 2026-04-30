import { ACP_METHODS, encodeAcp, type AcpMessage } from "../protocol/acp.js";
import { composeEffectivePrompt } from "./prompt-composer.js";
import { SubprocessBackendAdapter, type SubprocessAdapterOptions } from "./subprocess.js";
import { mapAcpNotificationToEvent } from "./acp-event-mapper.js";
import type { BackendName, McpServerDescriptor, RuntimeEvent, RuntimeRequest } from "../event/types.js";

type AcpBackendOptions = Omit<
  SubprocessAdapterOptions,
  "processMode" | "protocol" | "buildArgs" | "buildInput" | "buildMessage" | "buildNativeResponse" | "mapNativeEvent" | "initMessage"
> & {
  commandArgs: string[];
  mcpServers?: McpServerDescriptor[];
  mapMcpServer?: (server: McpServerDescriptor) => Record<string, unknown>;
  promptParamName?: "prompt" | "content";
  mapAcpEvent?: (
    backend: BackendName,
    request: RuntimeRequest,
    message: AcpMessage,
  ) => RuntimeEvent | RuntimeEvent[] | null;
};

export class AcpBackendAdapter extends SubprocessBackendAdapter {
  private readonly sessionMap = new Map<string, string>();
  private readonly pendingNewSessions = new Map<string, string>();
  private readonly deferredPrompts = new Map<string, { id: string; prompt: string }>();
  private readonly executionSessions = new Map<string, string>();
  private adapterReady = false;

  constructor(private readonly acpOptions: AcpBackendOptions) {
    super({
      name: acpOptions.name,
      defaultExecutable: acpOptions.defaultExecutable,
      processMode: "long-lived",
      capabilities: acpOptions.capabilities,
      protocol: {
        name: "acp",
        stdinMode: "message",
        stdoutMode: "ndjson",
        stderrCaptured: true,
      },
      buildArgs: () => acpOptions.commandArgs,
      initMessage: () => this.buildInitializeMessage(),
      buildMessage: (request) => this.buildPromptLifecycleMessage(request),
      buildNativeResponse: (event) => this.buildAcpNativeResponse(event),
      mapNativeEvent: (backend, request, value) => this.mapAcpMessage(backend, request, value),
    });
    this.adapterReady = true;
  }

  protected buildSessionNewParams(request: RuntimeRequest): Record<string, unknown> {
    const mcpServers = (this.acpOptions.mcpServers ?? []).map((server) =>
      this.acpOptions.mapMcpServer ? this.acpOptions.mapMcpServer(server) : server,
    );
    return {
      cwd: request.workingDirectory || process.cwd(),
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
    };
  }

  protected buildPromptParams(agentSessionId: string, prompt: string): Record<string, unknown> {
    const content = [{ type: "text", text: prompt }];
    return this.acpOptions.promptParamName === "content"
      ? { sessionId: agentSessionId, content }
      : { sessionId: agentSessionId, prompt: content };
  }

  protected onSessionCreated(_requestSessionId: string, _agentSessionId: string): void {}

  private buildInitializeMessage(): string {
    return encodeAcp({
      id: "init-0",
      method: ACP_METHODS.INITIALIZE,
      params: {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "iota-engine", version: "0.1.0" },
      },
    });
  }

  private buildPromptLifecycleMessage(request: RuntimeRequest): string {
    this.executionSessions.set(request.executionId, request.sessionId);
    const agentSessionId = this.sessionMap.get(request.sessionId);
    const prompt = composeEffectivePrompt(request, this.adapterReady ? this : undefined);
    if (agentSessionId) {
      return encodeAcp({
        id: request.executionId,
        method: ACP_METHODS.SESSION_PROMPT,
        params: this.buildPromptParams(agentSessionId, prompt),
      });
    }

    const newRequestId = `${request.executionId}:new`;
    this.pendingNewSessions.set(newRequestId, request.sessionId);
    this.deferredPrompts.set(request.sessionId, { id: request.executionId, prompt });
    return encodeAcp({
      id: newRequestId,
      method: ACP_METHODS.SESSION_NEW,
      params: this.buildSessionNewParams(request),
    });
  }

  private mapAcpMessage(
    backend: BackendName,
    request: RuntimeRequest,
    value: Record<string, unknown>,
  ): RuntimeEvent | RuntimeEvent[] | null {
    const message = { jsonrpc: "2.0", ...value } as AcpMessage;
    if ((message.result !== undefined || message.error !== undefined) && message.id !== undefined) {
      const id = String(message.id);
      const requestSessionId = this.pendingNewSessions.get(id);
      if (requestSessionId && message.error !== undefined) {
        this.cleanupSession(requestSessionId);
        return mapAcpNotificationToEvent(backend, request, message);
      }
      if (requestSessionId) {
        this.pendingNewSessions.delete(id);
        const result = asRecord(message.result);
        const agentSessionId = typeof result?.sessionId === "string" ? result.sessionId : requestSessionId;
        this.sessionMap.set(requestSessionId, agentSessionId);
        this.onSessionCreated(requestSessionId, agentSessionId);

        const deferred = this.deferredPrompts.get(requestSessionId);
        if (deferred) {
          this.deferredPrompts.delete(requestSessionId);
          this.writeToStdin(
            deferred.id,
            encodeAcp({
              id: deferred.id,
              method: ACP_METHODS.SESSION_PROMPT,
              params: this.buildPromptParams(agentSessionId, deferred.prompt),
            }),
          );
        }
        return null;
      }
      if (id === "init-0") return null;
    }

    const mapped = this.acpOptions.mapAcpEvent
      ? this.acpOptions.mapAcpEvent(backend, request, message)
      : mapAcpNotificationToEvent(backend, request, message);
    if (isTerminalMappedEvent(mapped)) {
      this.executionSessions.delete(request.executionId);
    }
    return mapped;
  }

  async interrupt(executionId: string): Promise<void> {
    const sessionId = this.executionSessions.get(executionId);
    const agentSessionId = sessionId ? this.sessionMap.get(sessionId) : undefined;
    if (agentSessionId) {
      this.writeToStdin(
        executionId,
        encodeAcp({
          id: `${executionId}:interrupt`,
          method: ACP_METHODS.SESSION_INTERRUPT,
          params: { sessionId: agentSessionId },
        }),
      );
    }
    this.executionSessions.delete(executionId);
    return super.interrupt(executionId);
  }

  async destroy(): Promise<void> {
    for (const [sessionId, agentSessionId] of this.sessionMap) {
      this.writeToStdin(
        `session-destroy:${sessionId}`,
        encodeAcp({
          id: `destroy:${sessionId}`,
          method: ACP_METHODS.SESSION_DESTROY,
          params: { sessionId: agentSessionId },
        }),
      );
    }
    this.sessionMap.clear();
    this.pendingNewSessions.clear();
    this.deferredPrompts.clear();
    this.executionSessions.clear();
    return super.destroy();
  }

  private cleanupSession(sessionId: string): void {
    this.sessionMap.delete(sessionId);
    this.deferredPrompts.delete(sessionId);
    for (const [requestId, pendingSessionId] of this.pendingNewSessions) {
      if (pendingSessionId === sessionId) this.pendingNewSessions.delete(requestId);
    }
    for (const [executionId, executionSessionId] of this.executionSessions) {
      if (executionSessionId === sessionId) this.executionSessions.delete(executionId);
    }
  }

  private buildAcpNativeResponse(event: RuntimeEvent): string | undefined {
    if (event.type === "extension" && event.data.name === "approval_decision") {
      const requestId = event.data.payload?.requestId;
      return encodeAcp({
        id: typeof requestId === "string" || typeof requestId === "number" ? requestId : null,
        result: { approved: event.data.payload?.approved === true },
      });
    }

    if (event.type === "tool_result") {
      return encodeAcp({
        id: event.data.toolCallId,
        result: {
          output: event.data.output ?? event.data.error ?? "",
          error: event.data.status === "error" ? event.data.error : undefined,
        },
      });
    }
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}


function isTerminalMappedEvent(mapped: RuntimeEvent | RuntimeEvent[] | null): boolean {
  const events = mapped ? (Array.isArray(mapped) ? mapped : [mapped]) : [];
  return events.some((event) => {
    if (event.type === "error") return true;
    if (event.type === "output" && event.data.final) return true;
    return (
      event.type === "state" &&
      (event.data.state === "completed" ||
        event.data.state === "failed" ||
        event.data.state === "interrupted")
    );
  });
}
