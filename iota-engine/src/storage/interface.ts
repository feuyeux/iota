import type {
  BackendName,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
} from "../event/types.js";
import type {
  MemoryQuery,
  MemoryScope,
  StoredMemory,
} from "../memory/types.js";

export interface SessionRecord {
  id: string;
  workingDirectory: string;
  activeBackend?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionRecord {
  sessionId: string;
  executionId: string;
  backend: BackendName;
  status: RuntimeResponse["status"] | "queued" | "running";
  requestHash: string;
  prompt: string;
  workingDirectory: string;
  output?: string;
  errorJson?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface LogQueryOptions {
  sessionId?: string;
  executionId?: string;
  backend?: BackendName;
  eventType?: RuntimeEvent["type"];
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export interface RuntimeLogEntry {
  execution: ExecutionRecord;
  event: RuntimeEvent;
}

export interface LogAggregation {
  totalEvents: number;
  totalExecutions: number;
  byBackend: Record<string, number>;
  bySession: Record<string, number>;
  byEventType: Record<string, number>;
  byExecution: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface LockLease {
  key: string;
  token: number;
  expiresAt: number;
}

export interface OptionalMemoryStorageOperations {
  saveUnifiedMemory?(memory: StoredMemory): Promise<void>;
  loadUnifiedMemories?(query: MemoryQuery): Promise<StoredMemory[]>;
  deleteUnifiedMemory?(type: StoredMemory["type"], memoryId: string): Promise<boolean>;
  touchUnifiedMemories?(memoryIds: string[], accessedAt: number): Promise<void>;
  searchUnifiedMemories?(
    query: string,
    limit?: number,
    scope?: { scope: MemoryScope; scopeId: string },
  ): Promise<Array<StoredMemory & { score?: number }>>;
  checkHashExists?(
    type: StoredMemory["type"],
    scopeId: string,
    contentHash: string,
    facet?: StoredMemory["facet"],
  ): Promise<boolean>;
  findUnifiedMemoryByHash?(
    type: StoredMemory["type"],
    scopeId: string,
    contentHash: string,
    facet?: StoredMemory["facet"],
  ): Promise<StoredMemory | null>;
  addHistory?(
    memoryId: string,
    event: string,
    oldContent: string | null,
    newContent: string,
  ): Promise<void>;
  searchByVector?(
    vector: number[],
    query: MemoryQuery,
    topK: number,
  ): Promise<Array<StoredMemory & { score?: number }>>;
}
export interface StorageBackend extends OptionalMemoryStorageOperations {
  init(): Promise<void>;
  createSession(record: SessionRecord): Promise<void>;
  updateSession(record: Partial<SessionRecord> & { id: string }): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  listAllSessions?(limit?: number): Promise<SessionRecord[]>;
  appendEvent(event: RuntimeEvent): Promise<void>;
  readEvents(
    executionId: string,
    afterSequence?: number,
  ): Promise<RuntimeEvent[]>;
  createExecution(record: ExecutionRecord): Promise<void>;
  updateExecution(record: ExecutionRecord): Promise<void>;
  getExecution(executionId: string): Promise<ExecutionRecord | null>;
  listSessionExecutions(sessionId: string): Promise<ExecutionRecord[]>;
  queryExecutions?(options?: LogQueryOptions): Promise<ExecutionRecord[]>;
  queryLogs?(options?: LogQueryOptions): Promise<RuntimeLogEntry[]>;
  aggregateLogs?(options?: LogQueryOptions): Promise<LogAggregation>;
  getBackendIsolationReport?(): Promise<{
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
  }>;
  acquireLock(key: string, ttlMs: number): Promise<LockLease | null>;
  renewLock(lease: LockLease, ttlMs: number): Promise<boolean>;
  releaseLock(lease: LockLease): Promise<boolean>;
  deleteSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export function hashRequest(
  request: Pick<
    RuntimeRequest,
    "prompt" | "backend" | "workingDirectory" | "systemPrompt"
  >,
): string {
  return JSON.stringify({
    backend: request.backend,
    prompt: request.prompt,
    systemPrompt: request.systemPrompt,
    workingDirectory: request.workingDirectory,
  });
}
