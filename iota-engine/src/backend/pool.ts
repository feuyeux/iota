import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";
import { HermesAdapter } from "./hermes.js";
import { CircuitBreaker } from "../error/circuit-breaker.js";
import { ErrorCode, IotaError } from "../error/codes.js";
import type { BackendName } from "../event/types.js";
import type { BackendSection, IotaConfig } from "../config/schema.js";
import type { RedisConfigStore } from "../config/redis-store.js";
import type {
  BackendCapabilities,
  BackendConfig,
  BackendSnapshot,
  HealthStatus,
  RuntimeBackend,
} from "./interface.js";
import type { VisibilityCollector } from "../visibility/collector.js";
import type {
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
} from "../event/types.js";

export class BackendPool {
  private readonly backends = new Map<BackendName, RuntimeBackend>();
  private readonly breakers = new Map<BackendName, CircuitBreaker>();
  private initialized = false;

  constructor(
    private readonly config: IotaConfig,
    private readonly workingDirectory: string,
    private readonly configStore?: RedisConfigStore,
  ) {
    const mcpServers = config.mcp?.servers ?? [];
    this.backends.set("claude-code", new ClaudeCodeAdapter(mcpServers));
    this.backends.set("codex", new CodexAdapter(mcpServers));
    this.backends.set("gemini", new GeminiAdapter(mcpServers));
    this.backends.set("hermes", new HermesAdapter(config.mcp?.servers ?? []));
    for (const name of this.backends.keys()) {
      this.breakers.set(name, new CircuitBreaker());
    }
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initPromises: Promise<void>[] = [];

    for (const [name, backend] of this.backends) {
      if (this.config.routing.disabledBackends.includes(name)) {
        continue;
      }
      const backendConfig = await this.resolveBackendConfig(name);
      initPromises.push(
        backend.init({
          executable: backendConfig.executable,
          timeoutMs: backendConfig.timeoutMs,
          workingDirectory: this.workingDirectory,
          env: backendConfig.env,
        }),
      );
    }

    // Initialize all enabled backends (warm processes start during init for long-lived)
    const results = await Promise.allSettled(initPromises);
    for (const result of results) {
      if (result.status === "rejected") {
        // Non-fatal: backend may not be installed
        // The circuit breaker will handle it at execution time
      }
    }

    this.initialized = true;
  }

  get(name: BackendName): RuntimeBackend {
    const backend = this.backends.get(name);
    if (!backend || this.config.routing.disabledBackends.includes(name)) {
      throw new IotaError({
        code: ErrorCode.BACKEND_NOT_FOUND,
        message: `Backend ${name} is not available`,
      });
    }
    const breaker = this.breakers.get(name);
    if (breaker && !breaker.canPass()) {
      throw new IotaError({
        code: ErrorCode.BACKEND_UNAVAILABLE,
        message: `Backend ${name} circuit breaker is open`,
        retryable: true,
      });
    }
    return breaker ? new CircuitBreakerBackend(backend, breaker) : backend;
  }

  async probeAll(): Promise<void> {
    for (const [name, backend] of this.backends) {
      if (this.config.routing.disabledBackends.includes(name)) continue;
      try {
        const health = await backend.probe();
        const breaker = this.breakers.get(name);
        if (breaker) {
          if (health.healthy) {
            breaker.success();
          } else if (health.status === "crashed") {
            breaker.failure();
          }
        }
      } catch {
        this.breakers.get(name)?.failure();
      }
    }
  }

  async status(): Promise<
    Record<BackendName, Awaited<ReturnType<RuntimeBackend["probe"]>>>
  > {
    const result = {} as Record<
      BackendName,
      Awaited<ReturnType<RuntimeBackend["probe"]>>
    >;
    for (const [name, backend] of this.backends) {
      const status = await backend.probe();
      const breakerState = this.breakers.get(name)?.getState();
      result[name] =
        breakerState === "open"
          ? {
              ...status,
              healthy: false,
              status: "degraded",
              lastError: status.lastError ?? "Circuit breaker is open",
            }
          : status;
    }
    return result;
  }

  getCapabilities(): Record<BackendName, BackendCapabilities> {
    const result = {} as Record<BackendName, BackendCapabilities>;
    for (const [name, backend] of this.backends) {
      result[name] = backend.capabilities;
    }
    return result;
  }

  resetBreaker(name: BackendName): boolean {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
      return true;
    }
    return false;
  }

  async destroy(): Promise<void> {
    await Promise.all(
      [...this.backends.values()].map((backend) => backend.destroy()),
    );
    this.initialized = false;
  }

  private backendConfig(name: BackendName): {
    executable: string;
    timeoutMs: number;
    env: Record<string, string>;
  } {
    switch (name) {
      case "claude-code":
        return this.config.backend.claudeCode;
      case "codex":
        return this.config.backend.codex;
      case "gemini":
        return this.config.backend.gemini;
      case "hermes":
        return this.config.backend.hermes;
    }
  }

  private async resolveBackendConfig(
    name: BackendName,
  ): Promise<BackendSection> {
    const base = this.backendConfig(name);
    const resolved: BackendSection = {
      ...base,
      env: { ...base.env },
    };
    const scoped = await this.configStore?.get("backend", name);
    if (!scoped) {
      return resolved;
    }

    const sectionKey = backendSectionKey(name);
    const fullPrefix = `backend.${sectionKey}.`;
    for (const [rawKey, rawValue] of Object.entries(scoped)) {
      const key = rawKey.startsWith(fullPrefix)
        ? rawKey.slice(fullPrefix.length)
        : rawKey;
      applyBackendScopedValue(resolved, key, rawValue);
    }
    return resolved;
  }
}

function backendSectionKey(name: BackendName): keyof IotaConfig["backend"] {
  switch (name) {
    case "claude-code":
      return "claudeCode";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "hermes":
      return "hermes";
  }
}

function applyBackendScopedValue(
  config: BackendSection,
  key: string,
  value: string,
): void {
  if (key === "executable") {
    config.executable = value;
    return;
  }
  if (key === "timeoutMs" || key === "timeout") {
    const timeoutMs = Number(value);
    if (!Number.isFinite(timeoutMs)) {
      throw new Error(`Invalid backend timeout: ${value}`);
    }
    config.timeoutMs = timeoutMs;
    return;
  }
  if (key.startsWith("env.")) {
    const envKey = key.slice("env.".length);
    if (envKey) {
      config.env[envKey] = value;
    }
  }
}

class CircuitBreakerBackend implements RuntimeBackend {
  constructor(
    private readonly inner: RuntimeBackend,
    private readonly breaker: CircuitBreaker,
  ) {}

  get name(): BackendName {
    return this.inner.name;
  }

  get capabilities(): RuntimeBackend["capabilities"] {
    return this.inner.capabilities;
  }

  async init(config: BackendConfig): Promise<void> {
    return this.inner.init(config);
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeEvent> {
    let failed = false;
    try {
      for await (const event of this.inner.stream(request)) {
        if (event.type === "error") {
          failed = true;
        }
        yield event;
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (failed) {
        this.breaker.failure();
      } else {
        this.breaker.success();
      }
    }
  }

  async execute(request: RuntimeRequest): Promise<RuntimeResponse> {
    const response = await this.inner.execute(request);
    if (response.status === "completed") {
      this.breaker.success();
    } else {
      this.breaker.failure();
    }
    return response;
  }

  async interrupt(executionId: string): Promise<void> {
    return this.inner.interrupt(executionId);
  }

  async snapshot(sessionId: string): Promise<BackendSnapshot> {
    return this.inner.snapshot(sessionId);
  }

  async probe(): Promise<HealthStatus> {
    return this.inner.probe();
  }

  async destroy(): Promise<void> {
    return this.inner.destroy();
  }

  setVisibilityCollector(
    collector: VisibilityCollector | undefined,
    executionId?: string,
  ): void {
    this.inner.setVisibilityCollector?.(collector, executionId);
  }

  sendNativeResponse(executionId: string, event: RuntimeEvent): boolean {
    if (this.inner.sendNativeResponse) {
      return this.inner.sendNativeResponse(executionId, event);
    }
    return false;
  }
}
