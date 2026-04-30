import type { BackendName } from "../event/types.js";

export type MemoryType = "semantic" | "episodic" | "procedural";
export type MemoryFacet = "identity" | "preference" | "strategic" | "domain";
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
  type: MemoryType;
  facet?: MemoryFacet;
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
  contentHash: string;
  embeddingJson?: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  expiresAt: number;
}

export interface MemoryQuery {
  type: MemoryType;
  facet?: MemoryFacet;
  scope: MemoryScope;
  scopeId: string;
  limit?: number;
  minConfidence?: number;
  tags?: string[];
  vector?: number[];
}

export interface MemorySearchResult extends StoredMemory {
  score?: number;
}

export interface MemoryScopeContext {
  sessionId: string;
  projectId?: string;
  userId?: string;
  workingDirectory: string;
  prompt?: string;
}

export interface MemoryContext {
  episodic: StoredMemory[];
  procedural: StoredMemory[];
  identity: StoredMemory[];
  preference: StoredMemory[];
  domain: StoredMemory[];
  strategic: StoredMemory[];
}
