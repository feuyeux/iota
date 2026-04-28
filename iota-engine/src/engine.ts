import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  expandHome,
  loadConfig,
  type LoadConfigOptions,
} from "./config/loader.js";
import { RedisConfigStore } from "./config/redis-store.js";
import { BackendPool } from "./backend/pool.js";
import { BackendResolver } from "./routing/resolver.js";
import { RuntimeEventStore } from "./event/store.js";
import { EventMultiplexer } from "./event/multiplexer.js";
import { RedisStorage } from "./storage/redis.js";
import { RedisPubSub } from "./storage/pubsub.js";
import { MinioSnapshotStore } from "./storage/minio.js";
import {
  hashRequest,
  type ExecutionRecord,
  type LogAggregation,
  type LogQueryOptions,
  type LockLease,
  type RuntimeLogEntry,
  type SessionRecord,
  type StorageBackend,
} from "./storage/interface.js";
import { ErrorCode, IotaError, toRuntimeError } from "./error/codes.js";
import { scanWorkspace } from "./workspace/hash-scan.js";
import { diffManifests } from "./workspace/delta.js";
import { DialogueMemory } from "./memory/dialogue.js";
import { WorkingMemory } from "./memory/working.js";
import {
  MemoryInjector,
  injectMemoryWithVisibility,
} from "./memory/injector.js";
import { AuditLogger } from "./audit/logger.js";
import { MetricsCollector } from "./metrics/collector.js";
import { McpRouter } from "./mcp/router.js";
import { MemoryStorage, type MemoryStorageBackend } from "./memory/storage.js";
import { memoryMapper } from "./memory/mapper.js";
import type {
  BackendMemoryEvent,
  StoredMemory,
} from "./memory/types.js";
import {
  AutoApprovalHook,
  type ApprovalHook,
  type ApprovalDecision,
} from "./approval/hook.js";
import { DeferredApprovalHook } from "./approval/deferred-hook.js";
import { enforceApprovalPolicy } from "./approval/policy.js";
import { checkWorkspacePath } from "./workspace/path-guard.js";
import {
  appendDeltaJournal,
  createWorkspaceSnapshot,
  writeWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./workspace/snapshot.js";
import { buildSwitchContext } from "./workspace/switcher.js";
import { runMemoryGc, type GcResult } from "./memory/gc.js";
import { VisibilityCollector } from "./visibility/collector.js";
import {
  redactText,
  contentHash,
  redactStructuredData,
} from "./visibility/redaction.js";
import { RedisVisibilityStore } from "./visibility/redis-store.js";
import { LocalVisibilityStore } from "./visibility/local-store.js";
import type { VisibilityStore } from "./visibility/store.js";
import type {
  ExecutionVisibility,
  ExecutionVisibilitySummary,
  ExecutionTrace,
  MemoryCandidateVisibility,
  MemoryExcludedVisibility,
  MemorySelectedVisibility,
  TraceAggregation,
  TraceAggregationOptions,
  VisibilityPolicy,
  VisibilityListOptions,
} from "./visibility/types.js";
import {
  aggregateExecutionTraces,
  buildExecutionTrace,
} from "./visibility/trace.js";
import type {
  ApprovalPolicy,
  BackendName,
  RuntimeContext,
  RuntimeEvent,
  RuntimeResponse,
} from "./event/types.js";
import type { RuntimeRequest } from "./event/types.js";
import type { IotaConfig } from "./config/schema.js";
import type { AuditEntry } from "./audit/logger.js";
import { IotaFunEngine } from "./fun-engine.js";
import { detectFunIntent } from "./fun-intent.js";

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface IotaEngineOptions extends LoadConfigOptions {
  workingDirectory?: string;
  storage?: StorageBackend;
  approvalHook?: ApprovalHook;
  visibility?: Partial<VisibilityPolicy>;
}

export interface CreateSessionOptions {
  workingDirectory?: string;
  metadata?: Record<string, unknown>;
}

export interface Session {
  id: string;
  workingDirectory: string;
  createdAt: number;
}

export type StreamInput = Omit<
  Partial<RuntimeRequest>,
  "sessionId" | "prompt"
> & {
  sessionId: string;
  prompt: string;
};

type RuntimeRequestWithVisibility = RuntimeRequest & {
  __memoryVisibility?: {
    candidates: MemoryCandidateVisibility[];
    selected: MemorySelectedVisibility[];
    excluded: MemoryExcludedVisibility[];
  };
};

export class IotaEngine {
  private config?: IotaConfig;
  private storage?: StorageBackend;
  private pool?: BackendPool;
  private resolver?: BackendResolver;
  private eventStore?: RuntimeEventStore;
  private multiplexer?: EventMultiplexer;
  private readonly dialogueMemory = new DialogueMemory();
  private readonly workingMemory = new WorkingMemory();
  private memoryStorage?: MemoryStorage;
  private memoryInjector?: MemoryInjector;
  private readonly metrics = new MetricsCollector();
  private readonly approvalHook: ApprovalHook;
  private mcpRouter?: McpRouter;
  private minioStore?: MinioSnapshotStore;
  private audit?: AuditLogger;
  private visibilityStore?: VisibilityStore;
  private pubsub?: RedisPubSub;
  private configStore?: RedisConfigStore;
  private readonly funEngine = new IotaFunEngine(ENGINE_DIR);

  /** Track in-flight executions for multiplexer stream reuse */
  private readonly runningExecutions = new Set<string>();

  constructor(private readonly options: IotaEngineOptions = {}) {
    this.approvalHook = options.approvalHook ?? new AutoApprovalHook();
  }

  async init(): Promise<void> {
    const config = await loadConfig({
      ...this.options,
      cwd: this.options.workingDirectory ?? this.options.cwd,
    });
    const workingDirectory = path.resolve(
      this.options.workingDirectory ?? config.engine.workingDirectory,
    );
    this.config = {
      ...config,
      engine: { ...config.engine, workingDirectory },
      visibility: { ...config.visibility, ...this.options.visibility },
    };

    // Select storage backend based on mode (Section 13.2 / 13.3)
    if (this.options.storage) {
      this.storage = this.options.storage;
    } else {
      const redisCfg =
        config.engine.mode === "production"
          ? config.storage.production.redis
          : config.storage.development.redis;
      this.storage = new RedisStorage({
        sentinels:
          redisCfg.sentinels.length > 0 ? redisCfg.sentinels : undefined,
        masterName: redisCfg.masterName,
        password: redisCfg.password,
        host: redisCfg.host ?? "localhost",
        port: redisCfg.port ?? 6379,
        streamPrefix: redisCfg.streamPrefix,
      });
    }
    await this.storage.init();

    if (this.storage instanceof RedisStorage) {
      const redisCfg =
        config.engine.mode === "production"
          ? config.storage.production.redis
          : config.storage.development.redis;
      this.pubsub = new RedisPubSub({
        sentinels:
          redisCfg.sentinels.length > 0 ? redisCfg.sentinels : undefined,
        masterName: redisCfg.masterName,
        password: redisCfg.password,
        host: redisCfg.host ?? "localhost",
        port: redisCfg.port ?? 6379,
      });
      await this.pubsub.init();

      this.configStore = new RedisConfigStore({
        sentinels:
          redisCfg.sentinels.length > 0 ? redisCfg.sentinels : undefined,
        masterName: redisCfg.masterName,
        password: redisCfg.password,
        host: redisCfg.host ?? "localhost",
        port: redisCfg.port ?? 6379,
        pubsub: this.pubsub,
      });
      await this.configStore.init();

      const distributedConfig = await loadConfig({
        ...this.options,
        cwd: this.options.workingDirectory ?? this.options.cwd,
        redisConfigStore: this.configStore,
      });
      this.config = {
        ...distributedConfig,
        engine: { ...distributedConfig.engine, workingDirectory },
        visibility: {
          ...distributedConfig.visibility,
          ...this.options.visibility,
        },
      };
    }

    this.pool = new BackendPool(
      this.config,
      workingDirectory,
      this.configStore,
    );
    await this.pool.init();
    this.resolver = new BackendResolver(this.config);
    this.eventStore = new RuntimeEventStore(this.storage);
    this.multiplexer = new EventMultiplexer(this.eventStore);

    if (hasUnifiedMemoryStorage(this.storage)) {
      this.memoryStorage = new MemoryStorage(this.storage);
      this.memoryInjector = new MemoryInjector(this.memoryStorage);
    }

    // Production mode: MinIO for snapshots
    if (this.config.engine.mode === "production") {
      const minioCfg = this.config.storage.production.minio;
      this.minioStore = new MinioSnapshotStore({
        endPoint: minioCfg.endPoint,
        port: minioCfg.port,
        useSSL: minioCfg.useSSL,
        accessKey: minioCfg.accessKey,
        secretKey: minioCfg.secretKey,
        bucket: minioCfg.bucket,
      });
      try {
        await this.minioStore.init();
      } catch (err) {
        // Non-fatal: fall back to local snapshots
        console.warn(
          "[iota-engine] MinIO init failed, falling back to local snapshots:",
          err,
        );
        this.minioStore = undefined;
      }
    }

    this.audit = new AuditLogger(
      path.resolve(this.iotaHome(), "logs", "audit.jsonl"),
      hasAuditSink(this.storage) ? this.storage : undefined,
    );

    // Initialize Redis Pub/Sub for real-time coordination
    if (this.pubsub) {
      // Subscribe to config change events for dynamic reload
      await this.pubsub.subscribe("iota:config:changes", () => {
        // Config reload is lazy — next loadConfig call picks up new values
      });

      // Subscribe to session updates for multi-instance coordination (Section 4.2)
      await this.pubsub.subscribe("iota:session:updates", async (message) => {
        if (message.type === "session_update") {
          // Invalidate any local caches on remote session changes
          // Currently dialogue/working memory are per-instance; log for observability
          if (process.env.IOTA_DEBUG_PUBSUB === "true") {
            console.debug(
              `[iota-engine] Remote session update: ${message.action} ${message.sessionId}`,
            );
          }
        }
      });

      // Subscribe to execution events for multi-instance coordination (Section 4.2)
      await this.pubsub.subscribe("iota:execution:events", async (message) => {
        if (message.type === "execution_event") {
          if (process.env.IOTA_DEBUG_PUBSUB === "true") {
            console.debug(
              `[iota-engine] Remote execution event: ${message.action} ${message.executionId}`,
            );
          }
        }
      });
    }

    // Initialize MCP router with configured servers
    const mcpServers = this.config.mcp?.servers ?? [];
    if (mcpServers.length > 0) {
      this.mcpRouter = new McpRouter(mcpServers);
    }

    // Initialize Visibility Store (Section 8)
    const retentionHours = this.config.engine.eventRetentionHours;
    if (hasRedisClient(this.storage)) {
      const redisStorage = this.storage as StorageBackend & {
        client: ConstructorParameters<typeof RedisVisibilityStore>[0];
      };
      this.visibilityStore = new RedisVisibilityStore(
        redisStorage.client,
        retentionHours ? { retentionHours } : undefined,
      );
    } else {
      this.visibilityStore = new LocalVisibilityStore(
        path.resolve(this.iotaHome(), "visibility"),
      );
    }
  }

  async createSession(options: CreateSessionOptions = {}): Promise<Session> {
    const config = this.requireConfig();
    const storage = this.requireStorage();
    const now = Date.now();
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      workingDirectory: path.resolve(
        options.workingDirectory ?? config.engine.workingDirectory,
      ),
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata,
    };
    await storage.createSession(session);

    // Publish session creation event
    await this.pubsub?.publishSessionUpdate({
      sessionId: session.id,
      action: "created",
      timestamp: now,
    });

    return {
      id: session.id,
      workingDirectory: session.workingDirectory,
      createdAt: session.createdAt,
    };
  }

  async *stream(input: StreamInput): AsyncIterable<RuntimeEvent> {
    const request = await this.buildRequest(input);
    const storage = this.requireStorage();
    const multiplexer = this.requireMultiplexer();
    const existing = await storage.getExecution(request.executionId);
    const requestHash = hashRequest(request);

    // Section 5.3: Idempotency semantics
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IotaError({
          code: ErrorCode.IDEMPOTENCY_CONFLICT,
          message: `Execution ${request.executionId} has different request content`,
        });
      }
      // Already completed → replay persisted events
      if (
        existing.status === "completed" ||
        existing.status === "failed" ||
        existing.status === "interrupted"
      ) {
        for (const event of await this.requireEventStore().replay(
          request.executionId,
          request.lastSequence,
        )) {
          yield event;
        }
        return;
      }
      // Still running → join existing live stream via multiplexer (Section 8.3)
      if (this.runningExecutions.has(request.executionId)) {
        yield* multiplexer.subscribe(request.executionId, request.lastSequence);
        return;
      }
    }

    // Acquire execution lock with longer TTL + periodic renewal
    const lockTtlMs = 120_000; // 2 minutes
    const lease = await storage.acquireLock(
      `execution:${request.executionId}`,
      lockTtlMs,
    );
    if (!lease) {
      // Another holder: attempt to subscribe via multiplexer
      if (this.runningExecutions.has(request.executionId)) {
        yield* multiplexer.subscribe(request.executionId, request.lastSequence);
        return;
      }
      throw new IotaError({
        code: ErrorCode.WORKSPACE_LOCKED,
        message: `Execution ${request.executionId} is already running`,
      });
    }

    // Renew lock periodically (every 1/3 of TTL)
    const renewInterval = setInterval(async () => {
      try {
        await storage.renewLock(lease, lockTtlMs);
      } catch (err) {
        // Non-fatal: lock may have expired, execution will notice on next write
        console.warn("[iota-engine] Lock renewal failed:", err);
      }
    }, lockTtlMs / 3);
    renewInterval.unref?.();

    // Drive the execution — first consumer
    this.runningExecutions.add(request.executionId);
    try {
      yield* this.runExecution(request, requestHash, existing, lease);
    } finally {
      clearInterval(renewInterval);
      this.runningExecutions.delete(request.executionId);
      multiplexer.complete(request.executionId);
      await storage.releaseLock(lease);
    }
  }

  async execute(input: StreamInput): Promise<RuntimeResponse> {
    const events: RuntimeEvent[] = [];
    const output: string[] = [];
    let backend: BackendName | undefined;
    let error: RuntimeResponse["error"];
    let status: RuntimeResponse["status"] = "completed";

    for await (const event of this.stream(input)) {
      events.push(event);
      backend = event.backend;
      if (event.type === "output") {
        output.push(event.data.content);
      }
      if (event.type === "error") {
        error = event.data;
        status = "failed";
      }
      if (event.type === "state") {
        if (event.data.state === "interrupted") status = "interrupted";
        if (event.data.state === "failed") status = "failed";
      }
    }

    return {
      sessionId: input.sessionId,
      executionId:
        input.executionId ?? events[0]?.executionId ?? crypto.randomUUID(),
      backend: backend ?? this.requireConfig().routing.defaultBackend,
      status,
      output: output.join(""),
      events,
      error,
    };
  }

  /** Section 5.4: Interrupt semantics — graceful SIGINT → grace period → SIGKILL */
  async interrupt(executionId: string): Promise<void> {
    const storage = this.requireStorage();
    const eventStore = this.requireEventStore();
    const multiplexer = this.requireMultiplexer();
    const record = await storage.getExecution(executionId);
    if (!record) return;
    // Skip if already in terminal state
    if (
      record.status === "completed" ||
      record.status === "failed" ||
      record.status === "interrupted"
    )
      return;

    const backend = this.requirePool().get(record.backend);

    // Step 1: Send native cancel if backend supports it
    if (backend.sendNativeResponse) {
      backend.sendNativeResponse(executionId, {
        type: "extension",
        sessionId: record.sessionId,
        executionId,
        backend: record.backend,
        sequence: 0,
        timestamp: Date.now(),
        data: { name: "cancel_request", payload: { executionId } },
      } as RuntimeEvent);
    }

    // Step 2: SIGINT for graceful stop, then SIGKILL after grace period
    await backend.interrupt(executionId);

    // Step 3: Persist interrupted state and publish to subscribers
    const interruptedEvt = await eventStore.appendState(
      record.sessionId,
      executionId,
      record.backend,
      "interrupted",
    );
    await multiplexer.publish(interruptedEvt);

    await storage.updateExecution({
      ...record,
      status: "interrupted",
      finishedAt: Date.now(),
    });

    // Publish execution interrupted event
    await this.pubsub?.publishExecutionEvent({
      executionId,
      sessionId: record.sessionId,
      action: "interrupted",
      backend: record.backend,
      timestamp: Date.now(),
    });

    await this.auditAction(
      record.sessionId,
      executionId,
      record.backend,
      "execution_finish",
      "failure",
      { status: "interrupted" },
    );
  }

  /**
   * Resolve a pending deferred approval request (e.g. from a WebSocket client).
   * Only works when the engine was constructed with a DeferredApprovalHook.
   * Returns true if the request was found and resolved, false otherwise.
   */
  resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
    if (this.approvalHook instanceof DeferredApprovalHook) {
      return this.approvalHook.resolve(requestId, decision);
    }
    return false;
  }

  /** Get execution record by ID. Returns null if not found. */
  async getExecution(executionId: string): Promise<ExecutionRecord | null> {
    return this.requireStorage().getExecution(executionId);
  }

  async listSessionExecutions(sessionId: string): Promise<ExecutionRecord[]> {
    return this.requireStorage().listSessionExecutions(sessionId);
  }

  async queryLogs(options: LogQueryOptions = {}): Promise<RuntimeLogEntry[]> {
    const storage = this.requireStorage();
    if (!storage.queryLogs) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message: "The configured storage backend does not support log queries",
      });
    }
    return storage.queryLogs(options);
  }

  async aggregateLogs(options: LogQueryOptions = {}): Promise<LogAggregation> {
    const storage = this.requireStorage();
    if (!storage.aggregateLogs) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message:
          "The configured storage backend does not support log aggregation",
      });
    }
    return storage.aggregateLogs(options);
  }

  async getExecutionTrace(executionId: string): Promise<ExecutionTrace | null> {
    const visibility = await this.getExecutionVisibility(executionId);
    const spans = visibility?.spans ?? visibility?.link?.spans ?? [];
    return buildExecutionTrace(executionId, spans);
  }

  async aggregateTraces(
    options: TraceAggregationOptions = {},
  ): Promise<TraceAggregation> {
    const executions = await this.queryTraceExecutions(options);
    const traces: ExecutionTrace[] = [];
    for (const execution of executions) {
      const trace = await this.getExecutionTrace(execution.executionId);
      if (trace) traces.push(trace);
    }
    return aggregateExecutionTraces(traces);
  }

  /** Get session record by ID. Returns null if not found. */
  async getSession(sessionId: string): Promise<SessionRecord | null> {
    return this.requireStorage().getSession(sessionId);
  }

  /** Delete a session by ID. */
  async deleteSession(sessionId: string): Promise<void> {
    return this.requireStorage().deleteSession(sessionId);
  }

  getActiveFiles(
    sessionId: string,
  ): import("./memory/working.js").ActiveFile[] {
    return this.workingMemory.getActiveFiles(sessionId);
  }

  getMcpServers():
    | import("./visibility/app-read-model.js").McpServerDescriptor[]
    | undefined {
    return this.config?.mcp?.servers;
  }

  setActiveFiles(
    sessionId: string,
    files: import("./memory/working.js").ActiveFile[],
  ): void {
    this.workingMemory.setActiveFiles(sessionId, files);
  }

  async readWorkspaceFile(
    sessionId: string,
    filePath: string,
  ): Promise<{
    path: string;
    absolutePath: string;
    content: string;
  }> {
    const session = await this.requireStorage().getSession(sessionId);
    if (!session) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message: `Session ${sessionId} does not exist`,
      });
    }
    const check = checkWorkspacePath(session.workingDirectory, filePath);
    if (!check.insideRoot) {
      throw new IotaError({
        code: ErrorCode.WORKSPACE_OUTSIDE_ROOT,
        message: `Path is outside workspace root: ${filePath}`,
        details: { absolutePath: check.absolutePath },
      });
    }
    const content = await fs.readFile(check.absolutePath, "utf8");
    return { path: filePath, absolutePath: check.absolutePath, content };
  }

  async writeWorkspaceFile(
    sessionId: string,
    filePath: string,
    content: string,
  ): Promise<{
    path: string;
    absolutePath: string;
    size: number;
  }> {
    const session = await this.requireStorage().getSession(sessionId);
    if (!session) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message: `Session ${sessionId} does not exist`,
      });
    }
    const check = checkWorkspacePath(session.workingDirectory, filePath);
    if (!check.insideRoot) {
      throw new IotaError({
        code: ErrorCode.WORKSPACE_OUTSIDE_ROOT,
        message: `Path is outside workspace root: ${filePath}`,
        details: { absolutePath: check.absolutePath },
      });
    }
    await fs.mkdir(path.dirname(check.absolutePath), { recursive: true });
    await fs.writeFile(check.absolutePath, content, "utf8");
    this.workingMemory.addFiles(sessionId, [filePath]);
    return {
      path: filePath,
      absolutePath: check.absolutePath,
      size: Buffer.byteLength(content, "utf8"),
    };
  }

  async listSessionMemories(
    sessionId: string,
    limit = 50,
  ): Promise<StoredMemory[]> {
    const session = await this.requireStorage().getSession(sessionId);
    if (!session) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message: `Session ${sessionId} does not exist`,
      });
    }
    return this.requireMemoryStorage().retrieve({
      type: "episodic",
      scope: "session",
      scopeId: sessionId,
      limit,
    });
  }

  async createSessionMemory(sessionId: string, content: string): Promise<StoredMemory> {
    const session = await this.requireStorage().getSession(sessionId);
    if (!session) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message: `Session ${sessionId} does not exist`,
      });
    }

    return this.requireMemoryStorage().store(
      {
        type: "episodic",
        scope: "session",
        content,
        source: {
          backend: (session.activeBackend as BackendName | undefined) ?? "claude-code",
          nativeType: "manual_session_note",
          executionId: `manual:${sessionId}`,
        },
        metadata: { source: "manual" },
        confidence: 1,
        timestamp: Date.now(),
        ttlDays: 7,
      },
      sessionId,
    );
  }

  async deleteSessionMemory(
    sessionId: string,
    memoryId: string,
  ): Promise<boolean> {
    const session = await this.requireStorage().getSession(sessionId);
    if (!session) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message: `Session ${sessionId} does not exist`,
      });
    }
    return this.requireMemoryStorage().delete("episodic", memoryId);
  }

  /**
   * Subscribe to live events for an execution across any connection.
   * Replays persisted events first, then streams live events until completion.
   */
  async *subscribeExecution(
    executionId: string,
    afterSequence?: number,
  ): AsyncIterable<RuntimeEvent> {
    yield* this.requireMultiplexer().subscribe(executionId, afterSequence);
  }

  /** Get execution events, optionally starting after a given sequence number. */
  async getExecutionEvents(
    executionId: string,
    afterSequence = 0,
    limit?: number,
  ): Promise<RuntimeEvent[]> {
    const events = await this.requireEventStore().replay(
      executionId,
      afterSequence,
    );
    return limit ? events.slice(0, limit) : events;
  }

  /** Section 11: Switch backend with snapshot and context handoff */
  async switchBackend(
    sessionId: string,
    newBackend: BackendName,
  ): Promise<void> {
    const storage = this.requireStorage();
    const session = await storage.getSession(sessionId);
    if (!session) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message: `Session ${sessionId} does not exist`,
      });
    }
    const config = this.requireConfig();
    const pool = this.requirePool();
    const currentBackend =
      (session.activeBackend as BackendName) ?? config.routing.defaultBackend;

    // 1. Snapshot old backend
    const oldBackend = pool.get(currentBackend);
    await oldBackend.snapshot(sessionId);

    // 2. Create base snapshot
    const manifest = await scanWorkspace(session.workingDirectory);
    await writeWorkspaceSnapshot(
      this.iotaHome(),
      createWorkspaceSnapshot({
        sessionId,
        workingDirectory: session.workingDirectory,
        activeBackend: currentBackend,
        conversationHistory: this.dialogueMemory.getConversation(sessionId),
        activeTools: [],
        mcpServers: [],
        fileManifest: [...manifest.values()],
        metadata: {},
      }),
      manifest,
    );

    // 3. Build context for new backend
    const context: RuntimeContext = {
      conversation: this.dialogueMemory.getConversation(sessionId),
      injectedMemory: [],
      workspaceSummary: `Switching backend from ${currentBackend} to ${newBackend}.`,
      activeFiles: this.workingMemory
        .getActiveFiles(sessionId)
        .map((f) => f.path),
    };
    buildSwitchContext(currentBackend, newBackend, context);

    // 4. Persist active backend in session
    await storage.updateSession({ id: sessionId, activeBackend: newBackend });

    // 5. Publish session update event for multi-instance coordination
    await this.pubsub?.publishSessionUpdate({
      sessionId,
      action: "backend_switched",
      backend: newBackend,
      timestamp: Date.now(),
    });

    // 6. Audit the switch
    await this.auditAction(
      sessionId,
      "",
      newBackend,
      "backend_switch",
      "success",
      { from: currentBackend, to: newBackend },
    );
  }

  async status(): Promise<
    Record<BackendName, Awaited<ReturnType<BackendPool["status"]>>[BackendName]>
  > {
    return this.requirePool().status();
  }

  backendCapabilities(): Record<
    BackendName,
    import("./backend/interface.js").BackendCapabilities
  > {
    return this.requirePool().getCapabilities();
  }

  getMetrics() {
    return this.metrics.getSnapshot();
  }

  resetCircuitBreaker(backend: BackendName): boolean {
    return this.requirePool().resetBreaker(backend);
  }

  /** Get the distributed config store (if Redis is available). */
  getConfigStore(): RedisConfigStore | undefined {
    return this.configStore;
  }

  /** Get the pub/sub instance (if Redis is available). */
  getPubSub(): RedisPubSub | undefined {
    return this.pubsub;
  }

  async searchMemories(
    query: string,
    limit?: number,
  ): Promise<Array<StoredMemory & { score?: number }>> {
    return this.requireMemoryStorage().searchAcrossScopes(query, limit);
  }

  /** Get backend isolation report (cross-session query). */
  async getBackendIsolationReport(): Promise<{
    sessions: Array<{
      sessionId: string;
      backend: string;
      executionCount: number;
    }>;
    executions: Array<{
      executionId: string;
      sessionId: string;
      backend: string;
    }>;
    isolation: {
      backendSwitches: number;
      crossBackendSessions: string[];
    };
  }> {
    const storage = this.requireStorage();
    if (!storage.getBackendIsolationReport) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message:
          "The configured storage backend does not support backend isolation reports",
      });
    }
    return storage.getBackendIsolationReport();
  }

  /** List all sessions across the system (cross-session query). */
  async listAllSessions(limit?: number): Promise<SessionRecord[]> {
    const storage = this.requireStorage();
    if (!storage.listAllSessions) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message:
          "The configured storage backend does not support listing all sessions",
      });
    }
    return storage.listAllSessions(limit);
  }

  /** Section 9.1: Query visibility data for a specific execution. */
  async getExecutionVisibility(
    executionId: string,
  ): Promise<ExecutionVisibility | null> {
    return this.visibilityStore?.getExecutionVisibility(executionId) ?? null;
  }

  /** Section 9.1: List visibility summaries for all executions in a session. */
  async listSessionVisibility(
    sessionId: string,
    options?: VisibilityListOptions,
  ): Promise<ExecutionVisibilitySummary[]> {
    return (
      this.visibilityStore?.listSessionVisibility(sessionId, options) ?? []
    );
  }

  async snapshot(
    sessionId: string,
    backendName?: BackendName,
  ): Promise<WorkspaceSnapshot> {
    const session = await this.requireStorage().getSession(sessionId);
    if (!session) {
      throw new IotaError({
        code: ErrorCode.SNAPSHOT_FAILED,
        message: `Session ${sessionId} does not exist`,
      });
    }
    const backend = this.requirePool().get(
      backendName ?? this.requireConfig().routing.defaultBackend,
    );
    const manifest = await scanWorkspace(session.workingDirectory);
    await backend.snapshot(sessionId);
    return writeWorkspaceSnapshot(
      this.iotaHome(),
      createWorkspaceSnapshot({
        sessionId,
        workingDirectory: session.workingDirectory,
        activeBackend: backend.name,
        conversationHistory: this.dialogueMemory.getConversation(sessionId),
        activeTools: [],
        mcpServers: [],
        fileManifest: [...manifest.values()],
        metadata: {},
      }),
      manifest,
    );
  }

  async gc(): Promise<GcResult & { visibilityRemoved?: number }> {
    const result = await runMemoryGc({
      cwd: this.requireConfig().engine.workingDirectory,
    });

    // GC visibility data if the store supports it
    let visibilityRemoved: number | undefined;
    if (this.visibilityStore?.gc) {
      const retentionHours =
        this.requireConfig().engine.eventRetentionHours ?? 24;
      const visGc = await this.visibilityStore.gc(retentionHours);
      visibilityRemoved = visGc.removed;
    }

    return { ...result, visibilityRemoved };
  }

  async destroy(): Promise<void> {
    this.runningExecutions.clear();
    await this.pubsub?.close();
    await this.configStore?.close();
    await this.mcpRouter?.close();
    await this.minioStore?.close();
    await this.pool?.destroy();
    await this.storage?.close();
  }

  // ─── Core execution flow (Section 5.1) ────────────────────────

  private runExecution(
    request: RuntimeRequest,
    requestHash: string,
    existing: ExecutionRecord | null,
    lease: LockLease,
  ): AsyncGenerator<RuntimeEvent> {
    async function* generator(
      engine: IotaEngine,
    ): AsyncGenerator<RuntimeEvent> {
      const storage = engine.requireStorage();
      const eventStore = engine.requireEventStore();
      const multiplexer = engine.requireMultiplexer();
      const funIntent = detectFunIntent(request.prompt);

      if (funIntent) {
        yield* engine.runFunExecution(
          request,
          requestHash,
          existing,
          lease,
          funIntent.language,
        );
        return;
      }

      const backend = engine
        .requirePool()
        .get(request.backend ?? engine.requireConfig().routing.defaultBackend);
      const startedAt = Date.now();
      let status: RuntimeResponse["status"] = "completed";
      let errorJson: string | undefined;
      const output: string[] = [];
      let requestSpanId: string | undefined;

      // Initialize VisibilityCollector for this execution
      const visibilityCollector = engine.visibilityStore
        ? new VisibilityCollector({
            store: engine.visibilityStore,
            policy: engine.requireConfig().visibility,
          })
        : undefined;
      if (visibilityCollector) {
        visibilityCollector.begin(request);
        requestSpanId = visibilityCollector.startSpan("engine.request", {
          prompt: redactText(request.prompt.slice(0, 100)).text,
        });
        // Build context segments for visibility
        // Build memory ID → segmentId map so context segments correlate with selected records
        const memVis = (request as RuntimeRequestWithVisibility)
          .__memoryVisibility;
        let selectedMemoryMap: Map<string, string> | undefined;
        if (memVis?.selected) {
          selectedMemoryMap = new Map<string, string>();
          for (const sel of memVis.selected) {
            if (sel.memoryId && sel.injectedSegmentId) {
              selectedMemoryMap.set(sel.memoryId, sel.injectedSegmentId);
            }
          }
        }
        if (request.context) {
          const contextSpanId = visibilityCollector.startSpan(
            "engine.context.build",
            {},
          );
          visibilityCollector.buildContextFromRequest(
            request,
            request.context,
            backend.capabilities.maxContextTokens,
            backend.capabilities.promptOnlyInput ?? false,
            selectedMemoryMap,
          );
          visibilityCollector.endSpan(contextSpanId);
        }
        // Record memory injection visibility if available
        if (memVis) {
          const searchSpanId = visibilityCollector.startSpan("memory.search", {
            candidateCount: memVis.candidates.length,
          });
          visibilityCollector.endSpan(searchSpanId);
          const injectSpanId = visibilityCollector.startSpan("memory.inject", {
            selectedCount: memVis.selected.length,
            excludedCount: memVis.excluded.length,
          });
          visibilityCollector.recordMemoryInjection(
            memVis.candidates,
            memVis.selected,
            memVis.excluded,
          );
          visibilityCollector.endSpan(injectSpanId);
        }
      }

      // Pass visibility collector to backend adapter for link/native event tracking
      backend.setVisibilityCollector?.(
        visibilityCollector,
        request.executionId,
      );

      /** Validate fencing token; throws if stale so execution aborts. */
      async function assertFencingValid(): Promise<void> {
        if ("validateFencingToken" in storage) {
          const valid = await (
            storage as StorageBackend & {
              validateFencingToken(
                key: string,
                token: number,
              ): Promise<boolean>;
            }
          ).validateFencingToken(lease.key, lease.token);
          if (!valid) {
            throw new IotaError({
              code: ErrorCode.WORKSPACE_LOCKED,
              message:
                "Stale fencing token — another execution has superseded this lock",
            });
          }
        }
      }

      // Pre-execution hash scan (Section 10.2)
      const wsSpanId = visibilityCollector?.startSpan("workspace.scan", {
        directory: request.workingDirectory,
      });
      const before = await scanWorkspace(request.workingDirectory);
      visibilityCollector?.endSpan(wsSpanId!, {
        attributes: { fileCount: before.size },
      });
      await writeWorkspaceSnapshot(
        engine.iotaHome(),
        createWorkspaceSnapshot({
          sessionId: request.sessionId,
          workingDirectory: request.workingDirectory,
          activeBackend: backend.name,
          conversationHistory: request.context?.conversation ?? [],
          activeTools: [],
          mcpServers: [],
          fileManifest: [...before.values()],
          metadata: {},
        }),
        before,
      );

      // Create execution record
      if (!existing) {
        await assertFencingValid();
        await storage.createExecution({
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: backend.name,
          status: "queued",
          requestHash,
          prompt: request.prompt,
          workingDirectory: request.workingDirectory,
          startedAt,
        });

        // Publish execution started event
        await engine.pubsub?.publishExecutionEvent({
          executionId: request.executionId,
          sessionId: request.sessionId,
          action: "started",
          backend: backend.name,
          timestamp: startedAt,
        });
      }

      await engine.auditAction(
        request.sessionId,
        request.executionId,
        backend.name,
        "execution_start",
        "success",
        {},
      );

      // Emit state machine transitions: queued → starting → running
      for (const state of ["queued", "starting", "running"] as const) {
        const evt = await eventStore.appendState(
          request.sessionId,
          request.executionId,
          backend.name,
          state,
        );
        await multiplexer.publish(evt);
        visibilityCollector?.recordEventPersist(evt.sequence);
        yield evt;
      }

      try {
        for await (const rawEvent of backend.stream({
          ...request,
          backend: backend.name,
        })) {
          if (rawEvent.type === "memory") {
            const stored = await engine.storeBackendMemoryEvent(rawEvent);
            if (stored && visibilityCollector) {
              visibilityCollector.recordMemoryExtraction({
                extracted: true,
                memoryId: stored.id,
                type: stored.type,
                contentHash: contentHash(stored.content),
                estimatedTokens: Math.ceil(stored.content.length / 4),
                persistedTo: ["redis"],
              });
            }
            continue;
          }

          // Check for approval_request extensions from adapters (native backend approval)
          if (
            rawEvent.type === "extension" &&
            rawEvent.data.name === "approval_request"
          ) {
            // Persist and yield the approval_request so subscribers see the request details
            await assertFencingValid();
            const approvalReqEvt = await eventStore.append(rawEvent);
            await multiplexer.publish(approvalReqEvt);
            visibilityCollector?.backfillLastSequence(approvalReqEvt.sequence);
            visibilityCollector?.recordEventPersist(approvalReqEvt.sequence);
            yield approvalReqEvt;

            const gen = engine.handleApprovalExtension(
              request,
              rawEvent,
              assertFencingValid,
              visibilityCollector,
            );
            let decision: "approved" | "denied" = "approved";
            // Yield intermediate state events (waiting_approval, running) as they happen
            for (;;) {
              const { value, done } = await gen.next();
              if (done) {
                decision = value;
                break;
              }
              yield value; // waiting_approval / running / error yielded immediately
            }
            // Persist approval_decision BEFORE sending to backend (fencing-first)
            const requestId = rawEvent.data.payload?.requestId;
            const approvalDecisionEvt: RuntimeEvent = {
              type: "extension",
              sessionId: request.sessionId,
              executionId: request.executionId,
              backend: backend.name,
              sequence: 0,
              timestamp: Date.now(),
              data: {
                name: "approval_decision",
                payload: { approved: decision === "approved", requestId },
              },
            } as RuntimeEvent;
            await assertFencingValid();
            const persistedDecision =
              await eventStore.append(approvalDecisionEvt);
            await multiplexer.publish(persistedDecision);
            visibilityCollector?.recordEventPersist(persistedDecision.sequence);
            // Only send native response after successful persist
            const nativeWritten = engine.sendBackendNativeResponse(
              backend,
              request.executionId,
              persistedDecision,
            );
            if (!nativeWritten) {
              // Decision (approved or denied) couldn't reach backend — it will stall
              const stallEvt = await eventStore.append({
                type: "error",
                sessionId: request.sessionId,
                executionId: request.executionId,
                backend: backend.name,
                sequence: 0,
                timestamp: Date.now(),
                data: {
                  code: ErrorCode.EXECUTION_FAILED,
                  message: `Approval decision could not be written to ${backend.name} — backend process may be stalled`,
                  details: { decision },
                },
              } as RuntimeEvent);
              await multiplexer.publish(stallEvt);
              visibilityCollector?.recordEventPersist(stallEvt.sequence);
              yield persistedDecision;
              yield stallEvt;
              status = "failed";
              errorJson = JSON.stringify(stallEvt.data);
              continue;
            }
            yield persistedDecision;
            if (decision === "denied") {
              status = "failed";
              errorJson = JSON.stringify({
                code: ErrorCode.APPROVAL_DENIED,
                message: "Native backend approval denied",
              });
            }
            continue;
          }

          // Guard: path protection, approval enforcement, MCP routing
          // guardEvent is an async generator: it yields waiting_approval/running states
          // before the final event (original, error, or tool_result)
          let lastGuardEvent: RuntimeEvent = rawEvent;
          let guardWasTransformed = false;
          for await (const guardedEvt of engine.guardEvent(
            request,
            rawEvent,
            assertFencingValid,
            backend.capabilities.mcpResponseChannel,
            visibilityCollector,
          )) {
            if (guardedEvt.type === "state") {
              // Intermediate state events (waiting_approval, running) — yield immediately
              yield guardedEvt;
            } else {
              lastGuardEvent = guardedEvt;
              guardWasTransformed = guardedEvt !== rawEvent;
            }
          }

          if (guardWasTransformed) {
            if (lastGuardEvent.type === "tool_result") {
              // MCP proxy result: persist original tool_call + the tool_result
              await assertFencingValid();
              const toolCallEvt = await eventStore.append(rawEvent);
              await multiplexer.publish(toolCallEvt);
              visibilityCollector?.backfillLastSequence(toolCallEvt.sequence);
              visibilityCollector?.recordEventPersist(toolCallEvt.sequence);
              yield toolCallEvt;
              const resultEvt = await eventStore.append(lastGuardEvent);
              await multiplexer.publish(resultEvt);
              visibilityCollector?.recordEventPersist(resultEvt.sequence);
              yield resultEvt;
              const written = engine.sendBackendNativeResponse(
                backend,
                request.executionId,
                lastGuardEvent,
              );
              if (!written) {
                const writeFailEvt = await eventStore.append({
                  type: "error",
                  sessionId: request.sessionId,
                  executionId: request.executionId,
                  backend: backend.name,
                  sequence: 0,
                  timestamp: Date.now(),
                  data: {
                    code: ErrorCode.EXECUTION_FAILED,
                    message: `MCP tool_result could not be written to ${backend.name} — backend process may be stalled`,
                    details: {},
                  },
                } as RuntimeEvent);
                await multiplexer.publish(writeFailEvt);
                visibilityCollector?.recordEventPersist(writeFailEvt.sequence);
                yield writeFailEvt;
                status = "failed";
                errorJson = JSON.stringify(writeFailEvt.data);
              }
              continue;
            }
            // Denial / error — send native denial back so backend doesn't hang
            await assertFencingValid();
            const denied = await eventStore.append(lastGuardEvent);
            await multiplexer.publish(denied);
            visibilityCollector?.backfillLastSequence(denied.sequence);
            visibilityCollector?.recordEventPersist(denied.sequence);
            yield denied;
            if (rawEvent.type === "tool_call") {
              const denialWritten = engine.sendBackendNativeResponse(
                backend,
                request.executionId,
                {
                  type: "tool_result",
                  sessionId: request.sessionId,
                  executionId: request.executionId,
                  backend: backend.name,
                  sequence: 0,
                  timestamp: Date.now(),
                  data: {
                    toolCallId: rawEvent.data.toolCallId,
                    status: "error" as const,
                    output: undefined,
                    error:
                      denied.type === "error"
                        ? denied.data.message
                        : "Denied by approval policy",
                  },
                } as RuntimeEvent,
              );
              if (!denialWritten) {
                const writeFailEvt = await eventStore.append({
                  type: "error",
                  sessionId: request.sessionId,
                  executionId: request.executionId,
                  backend: backend.name,
                  sequence: 0,
                  timestamp: Date.now(),
                  data: {
                    code: ErrorCode.EXECUTION_FAILED,
                    message: `Denial tool_result could not be written to ${backend.name} — backend process may be stalled`,
                    details: {},
                  },
                } as RuntimeEvent);
                await multiplexer.publish(writeFailEvt);
                visibilityCollector?.recordEventPersist(writeFailEvt.sequence);
                await engine.auditAction(
                  request.sessionId,
                  request.executionId,
                  backend.name,
                  "error",
                  "failure",
                  { message: "denial native write failed" },
                );
                yield writeFailEvt;
              }
            }
            status = "failed";
            errorJson = JSON.stringify(
              denied.type === "error" ? denied.data : undefined,
            );
            continue;
          }

          await assertFencingValid();
          const event = await eventStore.append(lastGuardEvent);
          await multiplexer.publish(event);

          // Backfill runtimeSequence on visibility records (Finding 5)
          visibilityCollector?.backfillLastSequence(event.sequence);
          visibilityCollector?.recordEventPersist(event.sequence);

          if (event.type === "output") {
            output.push(event.data.content);
            // Extract native usage from backend output events (Section 5.3)
            if (visibilityCollector && event.data.usage) {
              const u = event.data.usage as Record<string, unknown>;
              visibilityCollector.setNativeUsage({
                backend: backend.name,
                inputTokens:
                  typeof u.inputTokens === "number" ? u.inputTokens : undefined,
                outputTokens:
                  typeof u.outputTokens === "number"
                    ? u.outputTokens
                    : undefined,
                totalTokens:
                  typeof u.totalTokens === "number" ? u.totalTokens : undefined,
                cacheReadTokens:
                  typeof u.cacheReadTokens === "number"
                    ? u.cacheReadTokens
                    : undefined,
                cacheWriteTokens:
                  typeof u.cacheWriteTokens === "number"
                    ? u.cacheWriteTokens
                    : undefined,
              });
            }
          }
          if (event.type === "error") {
            status = "failed";
            errorJson = JSON.stringify(event.data);
          }

          // Audit tool calls and errors
          await engine.auditEvent(request, event);
          yield event;
        }
      } catch (error) {
        status = "failed";
        const runtimeError = toRuntimeError(error);
        errorJson = JSON.stringify(runtimeError);
        await assertFencingValid();
        const errEvt = await eventStore.append({
          type: "error",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend: backend.name,
          data: runtimeError,
        });
        await multiplexer.publish(errEvt);
        visibilityCollector?.recordEventPersist(errEvt.sequence);
        yield errEvt;
      }

      // Post-execution hash scan and delta generation (Section 10.2)
      const after = await scanWorkspace(request.workingDirectory);
      const deltas = diffManifests(before, after, {
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend: backend.name,
      });

      // Persist delta journal (Section 10.4)
      await assertFencingValid();
      await appendDeltaJournal(
        engine.iotaHome(),
        request.sessionId,
        request.executionId,
        deltas,
      );

      // Post-execution snapshot
      const snapshotData = createWorkspaceSnapshot({
        sessionId: request.sessionId,
        workingDirectory: request.workingDirectory,
        activeBackend: backend.name,
        conversationHistory: [
          ...(request.context?.conversation ?? []),
          { role: "user", content: request.prompt, timestamp: startedAt },
          {
            role: "assistant",
            content: output.join(""),
            timestamp: Date.now(),
          },
        ],
        activeTools: [],
        mcpServers: [],
        fileManifest: [...after.values()],
        metadata: {},
      });
      await writeWorkspaceSnapshot(engine.iotaHome(), snapshotData, after);
      // Upload to MinIO in production
      await engine.minioStore
        ?.putSnapshot(
          request.sessionId,
          request.executionId,
          snapshotData as unknown as Record<string, unknown>,
        )
        .catch((err: unknown) => {
          console.warn("[iota-engine] MinIO snapshot upload failed:", err);
        });

      // Emit file delta events
      for (const delta of deltas) {
        await assertFencingValid();
        const evt = await eventStore.append(delta);
        await multiplexer.publish(evt);
        visibilityCollector?.recordEventPersist(evt.sequence);
        yield evt;
      }

      // Update working memory with changed files
      const changedFiles = deltas.map((d) => d.data.path);
      if (changedFiles.length > 0) {
        engine.workingMemory.addFiles(request.sessionId, changedFiles);
      }

      // Final state event
      await assertFencingValid();
      const finalEvt = await eventStore.appendState(
        request.sessionId,
        request.executionId,
        backend.name,
        status,
      );
      await multiplexer.publish(finalEvt);
      visibilityCollector?.recordEventPersist(finalEvt.sequence);
      yield finalEvt;

      // Memory extraction (Section 12.5)
      const memExtractSpanId = visibilityCollector?.startSpan(
        "memory.extract",
        {},
      );
      const memory = await engine.captureExecutionMemory({
        backend: backend.name,
        executionId: request.executionId,
        sessionId: request.sessionId,
        prompt: request.prompt,
        output: output.join(""),
        workingDirectory: request.workingDirectory,
      });
      const hasNativeMemoryExtraction = visibilityCollector
        ? Boolean(visibilityCollector.getMemoryExtraction()?.extracted)
        : false;
      if (memory && !hasNativeMemoryExtraction) {
        // Record extraction in visibility
        if (visibilityCollector) {
          visibilityCollector.recordMemoryExtraction({
            extracted: true,
            memoryId: memory.id,
            type: memory.type,
            contentHash: contentHash(memory.content),
            estimatedTokens: Math.ceil(memory.content.length / 4),
            persistedTo: ["redis"],
          });
        }
      } else if (!memory && visibilityCollector && !hasNativeMemoryExtraction) {
        visibilityCollector.recordMemoryExtraction({
          extracted: false,
          reason: "no_signal",
        });
      }
      if (memExtractSpanId) {
        visibilityCollector?.endSpan(memExtractSpanId, {
          attributes: { extracted: !!memory },
        });
      }
      engine.dialogueMemory.append(request.sessionId, {
        role: "user",
        content: request.prompt,
        timestamp: startedAt,
      });
      engine.dialogueMemory.append(request.sessionId, {
        role: "assistant",
        content: output.join(""),
        timestamp: Date.now(),
      });

      // Record output tokens and finalize visibility
      if (visibilityCollector) {
        const finalOutput = output.join("");
        const finalEvents = await eventStore.replay(request.executionId);
        if (finalOutput) {
          visibilityCollector.addOutputTokens(
            finalOutput,
            "assistant_output",
          );
        }
        if (requestSpanId) {
          visibilityCollector.endSpan(requestSpanId, {
            status: status === "completed" ? "ok" : "error",
            attributes: {
              status,
              eventCount: finalEvents.length,
              outputChars: finalOutput.length,
            },
          });
        }
        await visibilityCollector
          .finalize({
            sessionId: request.sessionId,
            executionId: request.executionId,
            backend: backend.name,
            status,
            output: finalOutput,
            events: finalEvents,
            error: errorJson
              ? (JSON.parse(errorJson) as RuntimeResponse["error"])
              : undefined,
          })
          .catch((err) => {
          engine.audit
            ?.append({
              timestamp: Date.now(),
              sessionId: request.sessionId,
              executionId: request.executionId,
              backend: backend.name,
              action: "error",
              result: "failure",
              details: {
                message: "Visibility finalize failed",
                error: String(err),
              },
            })
            .catch((auditErr: unknown) => {
              console.warn(
                "[iota-engine] Audit append after visibility finalize failure:",
                auditErr,
              );
            });
          });
      }

      // Clear visibility collector from backend adapter
      backend.setVisibilityCollector?.(undefined, request.executionId);

      // Metrics
      engine.metrics.recordExecution({
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend: backend.name,
        status,
        output: output.join(""),
        events: await eventStore.replay(request.executionId),
        error: errorJson
          ? (JSON.parse(errorJson) as RuntimeResponse["error"])
          : undefined,
      });

      // Record visibility metrics if available
      if (engine.visibilityStore) {
        const vis = await engine.visibilityStore.getExecutionVisibility(
          request.executionId,
        );
        if (vis) {
          engine.metrics.recordVisibility(vis);
        }
      }

      // Persist execution result
      await assertFencingValid();
      const finishedAt = Date.now();
      await storage.updateExecution({
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend: backend.name,
        status,
        requestHash,
        prompt: request.prompt,
        workingDirectory: request.workingDirectory,
        output: output.join(""),
        errorJson,
        startedAt,
        finishedAt,
      });

      // Publish execution completed/failed event
      await engine.pubsub?.publishExecutionEvent({
        executionId: request.executionId,
        sessionId: request.sessionId,
        action: status === "completed" ? "completed" : "failed",
        backend: backend.name,
        timestamp: finishedAt,
      });

      await engine.auditAction(
        request.sessionId,
        request.executionId,
        backend.name,
        "execution_finish",
        status === "completed" ? "success" : "failure",
        { status },
      );
    }
    return generator(this);
  }

  private runFunExecution(
    request: RuntimeRequest,
    requestHash: string,
    existing: ExecutionRecord | null,
    lease: LockLease,
    language: import("./fun-engine.js").FunLanguage,
  ): AsyncGenerator<RuntimeEvent> {
    async function* generator(
      engine: IotaEngine,
    ): AsyncGenerator<RuntimeEvent> {
      const storage = engine.requireStorage();
      const eventStore = engine.requireEventStore();
      const multiplexer = engine.requireMultiplexer();
      const backend = request.backend ?? engine.requireConfig().routing.defaultBackend;
      const startedAt = Date.now();
      let status: RuntimeResponse["status"] = "completed";
      let errorJson: string | undefined;
      let output = "";

      async function assertFencingValid(): Promise<void> {
        if ("validateFencingToken" in storage) {
          const valid = await (
            storage as StorageBackend & {
              validateFencingToken(
                key: string,
                token: number,
              ): Promise<boolean>;
            }
          ).validateFencingToken(lease.key, lease.token);
          if (!valid) {
            throw new IotaError({
              code: ErrorCode.WORKSPACE_LOCKED,
              message:
                "Stale fencing token — another execution has superseded this lock",
            });
          }
        }
      }

      if (!existing) {
        await assertFencingValid();
        await storage.createExecution({
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend,
          status: "queued",
          requestHash,
          prompt: request.prompt,
          workingDirectory: request.workingDirectory,
          startedAt,
        });

        await engine.pubsub?.publishExecutionEvent({
          executionId: request.executionId,
          sessionId: request.sessionId,
          action: "started",
          backend,
          timestamp: startedAt,
        });
      }

      for (const state of ["queued", "starting", "running"] as const) {
        const evt = await eventStore.appendState(
          request.sessionId,
          request.executionId,
          backend,
          state,
        );
        await multiplexer.publish(evt);
        yield evt;
      }

      const toolCall = await eventStore.append({
        type: "tool_call",
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        data: {
          toolCallId: `fun-${request.executionId}`,
          toolName: `fun.${language}`,
          rawToolName: `fun.${language}`,
          arguments: { language },
          approvalRequired: false,
        },
      });
      await multiplexer.publish(toolCall);
      yield toolCall;
      const toolCallId = toolCall.type === "tool_call" ? toolCall.data.toolCallId : `fun-${request.executionId}`;

      try {
        const result = await engine.funEngine.execute({ language });
        output = result.value;

        const toolResult = await eventStore.append({
          type: "tool_result",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend,
          data: {
            toolCallId,
            status: "success",
            output: result.value,
          },
        });
        await multiplexer.publish(toolResult);
        yield toolResult;

        const outEvt = await eventStore.append({
          type: "output",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend,
          data: {
            role: "assistant",
            content: result.value,
            format: "text",
            final: true,
          },
        });
        await multiplexer.publish(outEvt);
        yield outEvt;
      } catch (error) {
        status = "failed";
        const runtimeError = toRuntimeError(error);
        errorJson = JSON.stringify(runtimeError);

        const toolResult = await eventStore.append({
          type: "tool_result",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend,
          data: {
            toolCallId,
            status: "error",
            error: runtimeError.message,
          },
        });
        await multiplexer.publish(toolResult);
        yield toolResult;

        const errEvt = await eventStore.append({
          type: "error",
          sessionId: request.sessionId,
          executionId: request.executionId,
          backend,
          data: runtimeError,
        });
        await multiplexer.publish(errEvt);
        yield errEvt;
      }

      const finalEvt = await eventStore.appendState(
        request.sessionId,
        request.executionId,
        backend,
        status,
      );
      await multiplexer.publish(finalEvt);
      yield finalEvt;

      await assertFencingValid();
      const finishedAt = Date.now();
      await storage.updateExecution({
        sessionId: request.sessionId,
        executionId: request.executionId,
        backend,
        status,
        requestHash,
        prompt: request.prompt,
        workingDirectory: request.workingDirectory,
        output,
        errorJson,
        startedAt,
        finishedAt,
      });
    }

    return generator(this);
  }

  // ─── Request building with memory injection (Section 12.2) ────

  private async buildRequest(input: StreamInput): Promise<RuntimeRequest> {
    const config = this.requireConfig();
    const session = await this.requireStorage().getSession(input.sessionId);
    if (!session) {
      throw new IotaError({
        code: ErrorCode.EXECUTION_FAILED,
        message: `Session ${input.sessionId} does not exist`,
      });
    }
    const backend = this.requireResolver().resolve(
      input.backend ?? (session.activeBackend as BackendName),
    );

    // Build context with 3-layer memory injection (Section 12.2)
    let context: RuntimeContext = input.context ?? {
      conversation: this.dialogueMemory.getConversation(input.sessionId),
      injectedMemory: [],
      workspaceSummary: undefined,
      activeFiles: this.workingMemory
        .getActiveFiles(input.sessionId)
        .map((f) => f.path),
    };

    // Inject unified memory from session/project/user scopes.
    let memoryContext = undefined;
    let memoryVisibility:
      | RuntimeRequestWithVisibility["__memoryVisibility"]
      | undefined;
    if (this.memoryInjector) {
      memoryContext = await this.memoryInjector.buildContext({
        sessionId: input.sessionId,
        projectId: this.resolveProjectScopeId(session),
        userId: this.resolveUserScopeId(session),
        workingDirectory: path.resolve(
          input.workingDirectory ??
            session.workingDirectory ??
            config.engine.workingDirectory,
        ),
      });

      const visibilityPolicy = this.requireConfig().visibility;
      const result = injectMemoryWithVisibility(context, memoryContext, {
        backend,
        visibilityPolicy,
      });
      context = result.context;
      memoryVisibility = {
        candidates: result.candidates,
        selected: result.selected,
        excluded: result.excluded,
      };
    }

    const runtimeRequest: RuntimeRequestWithVisibility = {
      sessionId: input.sessionId,
      executionId: input.executionId ?? crypto.randomUUID(),
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      backend,
      workingDirectory: path.resolve(
        input.workingDirectory ??
          session.workingDirectory ??
          config.engine.workingDirectory,
      ),
      context,
      approvals: input.approvals ?? config.approval,
      metadata: input.metadata,
      lastSequence: input.lastSequence,
    };
    if (memoryVisibility) {
      runtimeRequest.__memoryVisibility = memoryVisibility;
    }
    return runtimeRequest;
  }

  // ─── Approval enforcement (Section 15) ────────────────────────

  /**
   * Async generator that yields intermediate state events (e.g. waiting_approval)
   * before yielding the final guarded event. This ensures waiting_approval is
   * yielded to consumers BEFORE blocking on the approval decision.
   */
  private async *guardEvent(
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
    const eventStore = this.requireEventStore();
    const multiplexer = this.requireMultiplexer();

    // Helper: emit waiting_approval state, yield it, then block on approval
    const emitWaitAndEnforce = async function* (
      engine: IotaEngine,
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
        vc?.recordEventPersist(waitEvt.sequence);
        yield waitEvt;
      }
      await enforceApprovalPolicy(policy, engine.approvalHook, {
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
        vc?.recordEventPersist(runEvt.sequence);
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
            this,
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
          };
          return;
        }
      }
    }

    // Shell execution approval
    if (isShellTool(event.data.toolName)) {
      try {
        yield* emitWaitAndEnforce(
          this,
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
        };
        return;
      }
    }

    // Privilege escalation detection
    if (isPrivilegeEscalation(event.data.toolName, event.data.arguments)) {
      try {
        yield* emitWaitAndEnforce(
          this,
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
        };
        return;
      }
    }

    // MCP tool routing: detect MCP-prefixed tools and route through McpRouter
    // Only proxy if backend supports receiving MCP tool_result responses
    if (this.mcpRouter && isMcpTool(event.data.toolName)) {
      if (!backendCanReceiveMcpResult) {
        // Backend cannot receive tool_result mid-execution; return error so backend doesn't hang
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
      // Require mcpExternal approval
      try {
        yield* emitWaitAndEnforce(
          this,
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
        };
        return;
      }

      // Proxy the tool call through McpRouter and return a tool_result event
      const mcpSpanId = vc?.startSpan("mcp.proxy", {
        serverName,
        toolName,
      });
      try {
        const result = await this.mcpRouter.callTool({
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
   * If approved and nothing to yield, yields nothing (caller continues normally).
   * Final yield is either an error event (denied) or undefined (approved).
   */
  private async *handleApprovalExtension(
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
    const eventStore = this.requireEventStore();
    const multiplexer = this.requireMultiplexer();

    await this.auditAction(
      request.sessionId,
      request.executionId,
      event.backend,
      "approval_request",
      "success",
      { operationType, ...payload },
    );

    const approvalSpanId = vc?.startSpan("approval.wait", {
      operationType,
    });

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
        vc?.recordEventPersist(waitEvt.sequence);
        yield waitEvt;
      }
      await enforceApprovalPolicy(policy, this.approvalHook, {
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
        vc?.recordEventPersist(runEvt.sequence);
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
      vc?.recordEventPersist(persisted.sequence);
      yield persisted;
      return "denied";
    }
  }

  // ─── Approval timeout (Section 15.2) ──────────────────────────

  private resolveApprovalPolicy(
    policy?: ApprovalPolicy,
  ): Required<ApprovalPolicy> {
    return { ...this.requireConfig().approval, ...policy };
  }

  // ─── Audit helpers ─────────────────────────────────────────────

  private async auditAction(
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
    await this.audit?.append({
      timestamp: Date.now(),
      sessionId,
      executionId,
      backend,
      action,
      result,
      details: redactedDetails,
    });
  }

  private async auditEvent(
    request: RuntimeRequest,
    event: RuntimeEvent,
  ): Promise<void> {
    if (event.type === "tool_call") {
      await this.auditAction(
        request.sessionId,
        request.executionId,
        event.backend,
        "tool_call",
        "success",
        event.data,
      );
    }
    if (event.type === "tool_result") {
      await this.auditAction(
        request.sessionId,
        request.executionId,
        event.backend,
        "tool_call",
        event.data.status === "error"
          ? "failure"
          : event.data.status === "denied"
            ? "denied"
            : "success",
        event.data,
      );
    }
    if (event.type === "error") {
      await this.auditAction(
        request.sessionId,
        request.executionId,
        event.backend,
        "error",
        "failure",
        event.data as unknown as Record<string, unknown>,
      );
    }
  }

  // ─── Native backend response injection ─────────────────────

  /**
   * Send a native-protocol response to the backend subprocess.
   * Returns true if successfully written, false otherwise.
   * Logs a warning on failure — callers should handle false appropriately.
   */
  private sendBackendNativeResponse(
    backend: import("./backend/interface.js").RuntimeBackend,
    executionId: string,
    event: RuntimeEvent,
  ): boolean {
    if (backend.sendNativeResponse) {
      return backend.sendNativeResponse(executionId, event);
    }
    return false;
  }

  // ─── Utility ───────────────────────────────────────────────────

  private iotaHome(): string {
    return path.resolve(expandHome(process.env.IOTA_HOME ?? "~/.iota"));
  }

  private requireConfig(): IotaConfig {
    if (!this.config) throw new Error("IotaEngine.init() must be called first");
    return this.config;
  }

  private requireStorage(): StorageBackend {
    if (!this.storage)
      throw new Error("IotaEngine.init() must be called first");
    return this.storage;
  }

  private requirePool(): BackendPool {
    if (!this.pool) throw new Error("IotaEngine.init() must be called first");
    return this.pool;
  }

  private requireResolver(): BackendResolver {
    if (!this.resolver)
      throw new Error("IotaEngine.init() must be called first");
    return this.resolver;
  }

  private requireEventStore(): RuntimeEventStore {
    if (!this.eventStore)
      throw new Error("IotaEngine.init() must be called first");
    return this.eventStore;
  }

  private requireMultiplexer(): EventMultiplexer {
    if (!this.multiplexer)
      throw new Error("IotaEngine.init() must be called first");
    return this.multiplexer;
  }

  private requireMemoryStorage(): MemoryStorage {
    if (!this.memoryStorage) {
      throw new Error("Unified memory storage is not available");
    }
    return this.memoryStorage;
  }

  private resolveProjectScopeId(session: SessionRecord): string {
    return session.workingDirectory;
  }

  private resolveUserScopeId(session: SessionRecord): string {
    const userId = session.metadata?.userId;
    return typeof userId === "string" && userId.length > 0 ? userId : "default";
  }

  private async captureExecutionMemory(input: {
    backend: BackendName;
    executionId: string;
    sessionId: string;
    prompt: string;
    output: string;
    workingDirectory: string;
  }): Promise<StoredMemory | null> {
    const content = this.extractMemoryContent(input.prompt, input.output);
    if (!content) {
      return null;
    }

    const session = await this.requireStorage().getSession(input.sessionId);
    if (!session) {
      return null;
    }

    const nativeType = this.resolveNativeMemoryType(input.backend, content);
    const unified = memoryMapper.map(
      {
        backend: input.backend,
        nativeType,
        content,
        metadata: {
          sessionId: input.sessionId,
          workingDirectory: input.workingDirectory,
        },
      },
      input.executionId,
    );

    if (unified.confidence < 0.7) {
      return null;
    }

    const scopeId = this.resolveScopeId(unified.scope, session);
    return this.requireMemoryStorage().store(unified, scopeId);
  }

  private extractMemoryContent(prompt: string, output: string): string | null {
    const promptText = prompt.trim();
    const outputText = output.trim();
    if (!promptText && !outputText) {
      return null;
    }

    const responseSummary = outputText.slice(0, 800);
    const combined = promptText
      ? `User request: ${promptText}\nResult: ${responseSummary}`
      : responseSummary;

    return combined.length >= 20 ? combined.slice(0, 2000) : null;
  }

  private resolveNativeMemoryType(
    backend: BackendName,
    content: string,
  ): BackendMemoryEvent["nativeType"] {
    const lower = content.toLowerCase();
    if (lower.includes("decided") || lower.includes("plan") || lower.includes("architecture")) {
      return backend === "claude-code"
        ? "project_context"
        : backend === "codex"
          ? "task_planning"
          : backend === "gemini"
            ? "goal_tracking"
            : "intention_memory";
    }
    if (lower.includes("use ") || lower.includes("run ") || lower.includes("command")) {
      return backend === "claude-code"
        ? "code_context"
        : backend === "codex"
          ? "tool_usage"
          : backend === "gemini"
            ? "execution_patterns"
            : "skill_memory";
    }
    return backend === "claude-code"
      ? "conversation_context"
      : backend === "codex"
        ? "session_history"
        : backend === "gemini"
          ? "interaction_log"
          : "dialogue_memory";
  }

  private resolveScopeId(
    scope: StoredMemory["scope"],
    session: SessionRecord,
  ): string {
    switch (scope) {
      case "project":
        return this.resolveProjectScopeId(session);
      case "user":
        return this.resolveUserScopeId(session);
      case "session":
      default:
        return session.id;
    }
  }

  private async storeBackendMemoryEvent(
    event: import("./event/types.js").MemoryEvent,
  ): Promise<StoredMemory | null> {
    const session = await this.requireStorage().getSession(event.sessionId);
    if (!session) {
      return null;
    }

    const unified = memoryMapper.map(
      {
        backend: event.backend,
        nativeType: event.data.nativeType,
        content: event.data.content,
        metadata: event.data.metadata,
        confidence:
          typeof event.data.metadata?.confidence === "number"
            ? event.data.metadata.confidence
            : undefined,
        timestamp: event.timestamp,
      },
      event.executionId,
    );

    if (unified.confidence < 0.7) {
      return null;
    }

    return this.requireMemoryStorage().store(
      unified,
      this.resolveScopeId(unified.scope, session),
    );
  }

  private async queryTraceExecutions(
    options: TraceAggregationOptions,
  ): Promise<ExecutionRecord[]> {
    const storage = this.requireStorage();
    const query: LogQueryOptions = {
      sessionId: options.sessionId,
      executionId: options.executionId,
      backend: options.backend,
      since: options.since,
      until: options.until,
      limit: options.limit,
      offset: options.offset,
    };

    if (storage.queryExecutions) {
      return storage.queryExecutions(query);
    }
    if (options.executionId) {
      const execution = await storage.getExecution(options.executionId);
      return execution ? [execution] : [];
    }
    if (options.sessionId) {
      return storage.listSessionExecutions(options.sessionId);
    }
    return [];
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function hasAuditSink(storage: StorageBackend): storage is StorageBackend & {
  appendAuditEntry(entry: AuditEntry): Promise<void>;
} {
  return (
    "appendAuditEntry" in storage &&
    typeof (storage as { appendAuditEntry?: unknown }).appendAuditEntry ===
      "function"
  );
}

function hasUnifiedMemoryStorage(
  storage: StorageBackend,
) : storage is MemoryStorageBackend {
  const candidate = storage as {
    saveUnifiedMemory?: unknown;
    loadUnifiedMemories?: unknown;
    deleteUnifiedMemory?: unknown;
    touchUnifiedMemories?: unknown;
    searchUnifiedMemories?: unknown;
  };
  return (
    typeof candidate.saveUnifiedMemory === "function" &&
    typeof candidate.loadUnifiedMemories === "function" &&
    typeof candidate.deleteUnifiedMemory === "function" &&
    typeof candidate.touchUnifiedMemories === "function" &&
    typeof candidate.searchUnifiedMemories === "function"
  );
}

function hasRedisClient(storage: StorageBackend): boolean {
  const candidate = storage as {
    client?: { get?: unknown };
  };
  return "client" in storage && typeof candidate.client?.get === "function";
}

function extractPathArguments(args: Record<string, unknown>): string[] {
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

function isShellTool(toolName: string): boolean {
  const shellTools = new Set([
    "bash",
    "shell",
    "terminal",
    "exec",
    "execute",
    "run",
    "command",
    "run_command",
    "execute_command",
  ]);
  return shellTools.has(toolName.toLowerCase());
}

function isPrivilegeEscalation(
  _toolName: string,
  args: Record<string, unknown>,
): boolean {
  const command =
    typeof args.command === "string"
      ? args.command
      : typeof args.input === "string"
        ? args.input
        : "";
  if (/\b(?:sudo|su|doas|pkexec|runuser)\b/.test(command)) return true;
  // Check for .env / credential file modifications
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

function isMcpTool(toolName: string): boolean {
  return (
    toolName.includes("mcp__") ||
    toolName.includes("mcp:") ||
    toolName.startsWith("mcp/")
  );
}

function parseMcpToolName(toolName: string): {
  serverName: string;
  toolName: string;
} {
  // Patterns: mcp__server__tool__name, mcp:server:tool:name, mcp/server/tool/name
  // Split only on the first two separator boundaries so that additional separators
  // within the tool name are preserved (e.g. mcp__fs__read__file → server=fs, tool=read__file).
  const prefixes: Array<{ prefix: string; sep: string }> = [
    { prefix: "mcp__", sep: "__" },
    { prefix: "mcp:", sep: ":" },
    { prefix: "mcp/", sep: "/" },
  ];
  for (const { prefix, sep } of prefixes) {
    if (!toolName.startsWith(prefix)) continue;
    const rest = toolName.slice(prefix.length); // after "mcp<sep>"
    const idx = rest.indexOf(sep);
    if (idx < 0) {
      // Only server, no tool portion → use server name as tool name
      return { serverName: rest, toolName: rest };
    }
    return { serverName: rest.slice(0, idx), toolName: rest.slice(idx + sep.length) };
  }
  return { serverName: "unknown", toolName };
}
