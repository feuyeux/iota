import type { BackendName, MemoryKind } from "../event/types.js";

export type MemoryScope = "session" | "project" | "user";

export interface BackendMemoryEvent {
  backend: BackendName;
  nativeType: string;
  content: string;
  metadata?: Record<string, unknown>;
  confidence?: number;
  timestamp?: number;
}

export interface MemorySource {
  backend: BackendName;
  nativeType: string;
  executionId: string;
}

export interface UnifiedMemory {
  type: MemoryKind;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
  metadata: Record<string, unknown>;
  confidence: number;
  timestamp: number;
  ttlDays: number;
}

export interface StoredMemory extends UnifiedMemory {
  id: string;
  scopeId: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  expiresAt: number;
}

export interface MemoryQuery {
  type: MemoryKind;
  scope: MemoryScope;
  scopeId: string;
  limit?: number;
  minConfidence?: number;
  tags?: string[];
}

export interface MemorySearchResult extends StoredMemory {
  score?: number;
}

export interface MemoryScopeContext {
  sessionId: string;
  projectId?: string;
  userId?: string;
  workingDirectory: string;
}

export interface MemoryContext {
  episodic: StoredMemory[];
  procedural: StoredMemory[];
  factual: StoredMemory[];
  strategic: StoredMemory[];
}

