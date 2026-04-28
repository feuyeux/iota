import type { RuntimeError } from "../error/codes.js";

export type BackendName = "claude-code" | "codex" | "gemini" | "hermes";

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: number;
}

export type MemoryKind = "episodic" | "procedural" | "factual" | "strategic";

export interface MemoryBlock {
  id: string;
  type?: MemoryKind;
  content: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface McpServerDescriptor {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ApprovalPolicy {
  shell?: "auto" | "ask" | "deny";
  fileOutside?: "auto" | "ask" | "deny";
  network?: "auto" | "ask" | "deny";
  container?: "auto" | "ask" | "deny";
  mcpExternal?: "auto" | "ask" | "deny";
  privilegeEscalation?: "auto" | "ask" | "deny";
  timeoutMs?: number;
}

export interface RuntimeContext {
  conversation: Message[];
  injectedMemory: MemoryBlock[];
  workspaceSummary?: string;
  activeFiles?: string[];
  mcpServers?: McpServerDescriptor[];
}

export interface RuntimeRequest {
  sessionId: string;
  executionId: string;
  prompt: string;
  systemPrompt?: string;
  backend?: BackendName;
  workingDirectory: string;
  context?: RuntimeContext;
  approvals?: ApprovalPolicy;
  metadata?: Record<string, unknown>;
  lastSequence?: number;
}

export interface RuntimeResponse {
  sessionId: string;
  executionId: string;
  backend: BackendName;
  status: "completed" | "interrupted" | "failed";
  output: string;
  events: RuntimeEvent[];
  usage?: TokenUsage;
  error?: RuntimeError;
}

export interface RuntimeEventBase {
  type: RuntimeEvent["type"];
  sessionId: string;
  executionId: string;
  backend: BackendName;
  sequence: number;
  timestamp: number;
}

export interface OutputEvent extends RuntimeEventBase {
  type: "output";
  data: {
    role: "assistant" | "tool" | "system";
    content: string;
    format: "text" | "markdown" | "json";
    final?: boolean;
    /** Native token usage extracted from backend protocol (Section 5.3) */
    usage?: TokenUsage;
  };
}

export interface StateEvent extends RuntimeEventBase {
  type: "state";
  data: {
    state:
      | "queued"
      | "starting"
      | "running"
      | "waiting_approval"
      | "completed"
      | "interrupted"
      | "failed";
    message?: string;
  };
}

export interface ToolCallEvent extends RuntimeEventBase {
  type: "tool_call";
  data: {
    toolCallId: string;
    toolName: string;
    rawToolName: string;
    arguments: Record<string, unknown>;
    approvalRequired: boolean;
  };
}

export interface ToolResultEvent extends RuntimeEventBase {
  type: "tool_result";
  data: {
    toolCallId: string;
    status: "success" | "error" | "denied";
    output?: string;
    error?: string;
    durationMs?: number;
  };
}

export interface FileDeltaEvent extends RuntimeEventBase {
  type: "file_delta";
  data: {
    path: string;
    operation: "created" | "modified" | "deleted" | "renamed";
    oldPath?: string;
    hashBefore?: string;
    hashAfter?: string;
    sizeBytes?: number;
  };
}

export interface ErrorEvent extends RuntimeEventBase {
  type: "error";
  data: RuntimeError;
}

export interface ExtensionEvent extends RuntimeEventBase {
  type: "extension";
  data: {
    name: string;
    payload: Record<string, unknown>;
  };
}

export interface MemoryEvent extends RuntimeEventBase {
  type: "memory";
  data: {
    nativeType: string;
    content: string;
    metadata?: {
      confidence?: number;
      tags?: string[];
      [key: string]: unknown;
    };
  };
}

export type RuntimeEvent =
  | OutputEvent
  | StateEvent
  | ToolCallEvent
  | ToolResultEvent
  | FileDeltaEvent
  | ErrorEvent
  | ExtensionEvent
  | MemoryEvent;

export type NewRuntimeEvent = Omit<RuntimeEvent, "sequence" | "timestamp"> & {
  sequence?: number;
  timestamp?: number;
};
