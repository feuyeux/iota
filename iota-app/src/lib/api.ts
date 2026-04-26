import type {
  AppSessionSnapshot,
  BackendIsolationResponse,
  BackendStatusView,
  ConfigEntryMap,
  ConfigScopeListResponse,
  CrossSessionMemoriesResponse,
  CrossSessionSessionsResponse,
  ExecutionReplayView,
  LogQueryParams,
  LogsAggregateResponse,
  LogsQueryResponse,
  SessionMemoryItem,
  WorkspaceFileView,
} from '../types';

const API_BASE = '/api/v1';

export const api = {
  async getStatus(): Promise<{ backends: BackendStatusView[] }> {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) throw new Error('Failed to fetch status');
    return res.json();
  },

  async getSessionSnapshot(sessionId: string): Promise<AppSessionSnapshot> {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/app-snapshot`);
    if (!res.ok) throw new Error('Failed to fetch session snapshot');
    return res.json();
  },

  async createSession(workingDirectory: string): Promise<{ sessionId: string }> {
    const res = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workingDirectory }),
    });
    if (!res.ok) throw new Error('Failed to create session');
    return res.json();
  },

  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete session');
  },

  async interruptExecution(executionId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/executions/${executionId}/interrupt`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to interrupt execution');
  },

  async updateSessionContext(sessionId: string, activeFiles: Array<{ path: string; pinned?: boolean }>): Promise<void> {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/context`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeFiles }),
    });
    if (!res.ok) throw new Error('Failed to update session context');
  },

  async getExecutionChain(executionId: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}/executions/${executionId}/visibility/chain`);
    if (!res.ok) throw new Error('Failed to fetch execution chain');
    return res.json();
  },

  async readWorkspaceFile(sessionId: string, filePath: string): Promise<WorkspaceFileView> {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) throw new Error('Failed to read workspace file');
    return res.json();
  },

  async writeWorkspaceFile(sessionId: string, filePath: string, content: string): Promise<{ path: string; absolutePath: string; size: number }> {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    });
    if (!res.ok) throw new Error('Failed to save workspace file');
    return res.json();
  },

  async listSessionMemories(sessionId: string, query?: string, limit = 50): Promise<{ count: number; memories: SessionMemoryItem[] }> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query?.trim()) params.set('query', query.trim());
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/memories?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to load memories');
    return res.json();
  },

  async deleteSessionMemory(sessionId: string, memoryId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete memory');
  },

  async createSessionMemory(sessionId: string, payload: { content: string; type?: SessionMemoryItem['type'] }): Promise<SessionMemoryItem> {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to create memory');
    return res.json();
  },

  async getExecutionReplay(executionId: string): Promise<ExecutionReplayView> {
    const res = await fetch(`${API_BASE}/executions/${executionId}/replay`);
    if (!res.ok) throw new Error('Failed to load execution replay');
    return res.json();
  },

  async getConfig(params?: { backend?: string; sessionId?: string; userId?: string }): Promise<ConfigEntryMap> {
    const search = new URLSearchParams();
    if (params?.backend) search.set('backend', params.backend);
    if (params?.sessionId) search.set('sessionId', params.sessionId);
    if (params?.userId) search.set('userId', params.userId);
    const res = await fetch(`${API_BASE}/config${search.toString() ? `?${search.toString()}` : ''}`);
    if (!res.ok) throw new Error('Failed to load config');
    return res.json();
  },

  async listConfigScope(scope: 'global' | 'backend' | 'session' | 'user'): Promise<ConfigEntryMap | ConfigScopeListResponse> {
    const res = await fetch(`${API_BASE}/config/${scope}`);
    if (!res.ok) throw new Error('Failed to list config scope');
    return res.json();
  },

  async getScopedConfig(scope: 'backend' | 'session' | 'user', scopeId: string): Promise<ConfigEntryMap> {
    const res = await fetch(`${API_BASE}/config/${scope}/${encodeURIComponent(scopeId)}`);
    if (!res.ok) throw new Error('Failed to load scoped config');
    return res.json();
  },

  async setGlobalConfig(key: string, value: string): Promise<void> {
    const res = await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error('Failed to save config');
  },

  async setScopedConfig(scope: 'backend' | 'session' | 'user', scopeId: string, key: string, value: string): Promise<void> {
    const res = await fetch(`${API_BASE}/config/${scope}/${encodeURIComponent(scopeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error('Failed to save scoped config');
  },

  async deleteScopedConfig(scope: 'backend' | 'session' | 'user', scopeId: string, key: string): Promise<void> {
    const res = await fetch(`${API_BASE}/config/${scope}/${encodeURIComponent(scopeId)}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete config key');
  },

  async queryLogs(params: LogQueryParams = {}): Promise<LogsQueryResponse> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value));
      }
    }
    const res = await fetch(`${API_BASE}/logs?${search.toString()}`);
    if (!res.ok) throw new Error('Failed to query logs');
    return res.json();
  },

  async aggregateLogs(params: LogQueryParams = {}): Promise<LogsAggregateResponse> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value));
      }
    }
    const res = await fetch(`${API_BASE}/logs/aggregate?${search.toString()}`);
    if (!res.ok) throw new Error('Failed to aggregate logs');
    return res.json();
  },

  async queryCrossSessionLogs(params: LogQueryParams = {}): Promise<LogsQueryResponse> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value));
      }
    }
    const res = await fetch(`${API_BASE}/cross-session/logs?${search.toString()}`);
    if (!res.ok) throw new Error('Failed to query cross-session logs');
    return res.json();
  },

  async aggregateCrossSessionLogs(params: LogQueryParams = {}): Promise<LogsAggregateResponse> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value));
      }
    }
    const res = await fetch(`${API_BASE}/cross-session/logs/aggregate?${search.toString()}`);
    if (!res.ok) throw new Error('Failed to aggregate cross-session logs');
    return res.json();
  },

  async listCrossSessionSessions(limit = 100): Promise<CrossSessionSessionsResponse> {
    const res = await fetch(`${API_BASE}/cross-session/sessions?limit=${limit}`);
    if (!res.ok) throw new Error('Failed to list sessions');
    return res.json();
  },

  async searchCrossSessionMemories(query: string, limit = 10): Promise<CrossSessionMemoriesResponse> {
    const params = new URLSearchParams({ query, limit: String(limit) });
    const res = await fetch(`${API_BASE}/cross-session/memories/search?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to search memories');
    return res.json();
  },

  async getBackendIsolation(): Promise<BackendIsolationResponse> {
    const res = await fetch(`${API_BASE}/cross-session/backend-isolation`);
    if (!res.ok) throw new Error('Failed to load backend isolation report');
    return res.json();
  },
};
