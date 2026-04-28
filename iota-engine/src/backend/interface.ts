import type {
  BackendName,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
} from "../event/types.js";
import type { VisibilityCollector } from "../visibility/collector.js";

export interface BackendCapabilities {
  sandbox: boolean;
  mcp: boolean;
  /** Whether backend can receive MCP tool_result responses mid-execution via stdin. */
  mcpResponseChannel: boolean;
  acp: boolean;
  streaming: boolean;
  thinking: boolean;
  multimodal: boolean;
  maxContextTokens: number;
  /** True when backend manages its own context and only receives the user prompt. */
  promptOnlyInput?: boolean;
}

export interface BackendConfig {
  executable?: string;
  workingDirectory: string;
  timeoutMs: number;
  env?: Record<string, string>;
  resourceLimits?: {
    maxMemoryMb?: number;
    maxCpuPercent?: number;
  };
}

export interface HealthStatus {
  healthy: boolean;
  status: "starting" | "ready" | "busy" | "degraded" | "crashed" | "stopped";
  latencyMs?: number;
  uptimeMs: number;
  activeExecutions: number;
  lastError?: string;
}

export interface BackendSnapshot {
  sessionId: string;
  backend: BackendName;
  createdAt: number;
  payload: Record<string, unknown>;
}

export interface RuntimeBackend {
  readonly name: BackendName;
  readonly capabilities: BackendCapabilities;

  init(config: BackendConfig): Promise<void>;
  stream(request: RuntimeRequest): AsyncIterable<RuntimeEvent>;
  execute(request: RuntimeRequest): Promise<RuntimeResponse>;
  interrupt(executionId: string): Promise<void>;
  snapshot(sessionId: string): Promise<BackendSnapshot>;
  probe(): Promise<HealthStatus>;
  destroy(): Promise<void>;

  /**
   * Optional: send a native-protocol response back to the backend process.
   * Used for approval decisions and MCP tool results.
   * Returns true if the response was written, false if unsupported.
   */
  sendNativeResponse?(executionId: string, event: RuntimeEvent): boolean;

  /**
   * Optional: attach the per-execution visibility collector to adapters that
   * can record native protocol refs and mapping details.
   */
  setVisibilityCollector?(
    collector: VisibilityCollector | undefined,
    executionId?: string,
  ): void;

  /**
   * Optional: get the configured model name for this backend.
   * Returns the model identifier (e.g., "claude-sonnet-4", "gpt-4", "gemini-2.0-flash").
   */
  getModel?(): string | undefined;
}
