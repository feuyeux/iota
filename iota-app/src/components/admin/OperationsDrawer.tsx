import React, { useEffect, useMemo, useState } from 'react';
import {
  Database,
  FileSearch,
  Layers3,
  RefreshCw,
  Settings2,
  Shield,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useSessionStore } from '../../store/useSessionStore';
import type {
  BackendIsolationResponse,
  ConfigEntryMap,
  ConfigScopeListResponse,
  LogQueryParams,
  LogsAggregateResponse,
  LogsQueryResponse,
} from '../../types';

type DrawerTab = 'config' | 'logs' | 'cross';

interface OperationsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export const OperationsDrawer: React.FC<OperationsDrawerProps> = ({ open, onClose }) => {
  const [tab, setTab] = useState<DrawerTab>('config');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 backdrop-blur-sm">
      <button className="flex-1 cursor-default" aria-label="Close drawer backdrop" onClick={onClose} />
      <aside className="h-full w-full max-w-2xl overflow-hidden border-l border-iota-border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-iota-border px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-iota-text/45">Operations</div>
            <h2 className="text-lg font-semibold text-iota-heading">Runtime surfaces</h2>
          </div>
          <button onClick={onClose} className="rounded-lg border border-iota-border px-3 py-1 text-xs font-bold uppercase text-iota-text/60 hover:text-iota-heading">
            Close
          </button>
        </div>

        <div className="flex h-[calc(100%-73px)] overflow-hidden">
          <div className="w-40 border-r border-iota-border bg-stone-50/70 p-3">
            <DrawerTabButton icon={<Settings2 size={14} />} label="Config" active={tab === 'config'} onClick={() => setTab('config')} />
            <DrawerTabButton icon={<FileSearch size={14} />} label="Logs" active={tab === 'logs'} onClick={() => setTab('logs')} />
            <DrawerTabButton icon={<Layers3 size={14} />} label="Cross-Session" active={tab === 'cross'} onClick={() => setTab('cross')} />
          </div>

          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            {tab === 'config' && <ConfigManager />}
            {tab === 'logs' && <LogsPanel />}
            {tab === 'cross' && <CrossSessionPanel />}
          </div>
        </div>
      </aside>
    </div>
  );
};

const DrawerTabButton: React.FC<{ icon: React.ReactNode; label: string; active: boolean; onClick: () => void }> = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`mb-2 flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-bold uppercase tracking-wide transition ${
      active ? 'border-iota-accent bg-white text-iota-accent' : 'border-transparent text-iota-text/55 hover:border-iota-border hover:bg-white hover:text-iota-heading'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const ConfigManager: React.FC = () => {
  const { sessionId, activeBackend } = useSessionStore();
  const [scope, setScope] = useState<'global' | 'backend' | 'session' | 'user'>('global');
  const [scopeId, setScopeId] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [valueInput, setValueInput] = useState('');
  const [entries, setEntries] = useState<ConfigEntryMap>({});
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (scope === 'backend' && !scopeId) setScopeId(activeBackend);
    if (scope === 'session' && !scopeId && sessionId) setScopeId(sessionId);
  }, [activeBackend, scope, scopeId, sessionId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (scope === 'global') {
        const result = await api.listConfigScope('global');
        setEntries(result as ConfigEntryMap);
        setIds([]);
      } else if (scopeId) {
        const result = await api.getScopedConfig(scope, scopeId);
        setEntries(result);
        const list = await api.listConfigScope(scope);
        setIds((list as ConfigScopeListResponse).ids ?? []);
      } else {
        const list = await api.listConfigScope(scope);
        setEntries({});
        setIds((list as ConfigScopeListResponse).ids ?? []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [scope, scopeId]);

  const save = async () => {
    if (!keyInput.trim()) return;
    if (scope === 'global') {
      await api.setGlobalConfig(keyInput.trim(), valueInput);
    } else if (scopeId.trim()) {
      await api.setScopedConfig(scope, scopeId.trim(), keyInput.trim(), valueInput);
    } else {
      return;
    }
    setKeyInput('');
    setValueInput('');
    await load();
  };

  const remove = async (key: string) => {
    if (scope === 'global' || !scopeId) return;
    await api.deleteScopedConfig(scope, scopeId, key);
    await load();
  };

  return (
    <section className="space-y-4">
      <PanelHeader icon={<Settings2 size={14} />} title="Config manager" description="Read and modify resolved runtime config scopes." />
      <div className="grid gap-3 rounded-2xl border border-iota-border bg-stone-50/70 p-4 md:grid-cols-[140px_1fr_120px]">
        <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="rounded-xl border border-iota-border bg-white px-3 py-2 text-xs">
          <option value="global">global</option>
          <option value="backend">backend</option>
          <option value="session">session</option>
          <option value="user">user</option>
        </select>
        <input value={scopeId} onChange={(event) => setScopeId(event.target.value)} placeholder="scope id" disabled={scope === 'global'} className="rounded-xl border border-iota-border bg-white px-3 py-2 text-xs disabled:bg-stone-100" />
        <button onClick={() => void load()} className="rounded-xl bg-iota-accent px-3 py-2 text-xs font-bold text-white">
          Reload
        </button>
      </div>
      {ids.length > 0 && (
        <div className="rounded-2xl border border-iota-border p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-iota-text/45">Known scope ids</div>
          <div className="flex flex-wrap gap-2">
            {ids.map((id) => (
              <button key={id} onClick={() => setScopeId(id)} className="rounded-full border border-iota-border px-2 py-1 text-[10px] font-semibold text-iota-text/70 hover:border-iota-accent hover:text-iota-accent">
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 rounded-2xl border border-iota-border p-4 md:grid-cols-[1fr_1fr_110px]">
        <input value={keyInput} onChange={(event) => setKeyInput(event.target.value)} placeholder="config key" className="rounded-xl border border-iota-border px-3 py-2 text-xs" />
        <input value={valueInput} onChange={(event) => setValueInput(event.target.value)} placeholder="value" className="rounded-xl border border-iota-border px-3 py-2 text-xs" />
        <button onClick={() => void save()} className="rounded-xl border border-iota-accent bg-iota-accent/5 px-3 py-2 text-xs font-bold uppercase text-iota-accent">
          Save
        </button>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
      <div className="rounded-2xl border border-iota-border">
        <div className="flex items-center justify-between border-b border-iota-border px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-iota-text/45">Entries</div>
          {loading && <RefreshCw size={12} className="animate-spin text-iota-text/45" />}
        </div>
        <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
          {Object.entries(entries).length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-iota-text/45">No config entries loaded.</div>
          ) : (
            Object.entries(entries).map(([key, value]) => (
              <div key={key} className="grid gap-3 border-b border-stone-100 px-4 py-3 md:grid-cols-[1fr_1fr_64px]">
                <div className="break-all font-mono text-[11px] text-iota-heading">{key}</div>
                <div className="break-all font-mono text-[11px] text-iota-text/70">{value}</div>
                {scope === 'global' ? <div /> : <button onClick={() => void remove(key)} className="text-[10px] font-bold uppercase text-red-500">Delete</button>}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};

const LogsPanel: React.FC = () => {
  const { sessionId, activeExecution, activeBackend } = useSessionStore();
  const [params, setParams] = useState<LogQueryParams>({
    sessionId: sessionId ?? undefined,
    executionId: activeExecution?.executionId,
    backend: activeBackend,
    limit: 50,
  });
  const [logs, setLogs] = useState<LogsQueryResponse | null>(null);
  const [aggregate, setAggregate] = useState<LogsAggregateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setParams((current) => ({
      ...current,
      sessionId: sessionId ?? undefined,
      executionId: activeExecution?.executionId,
      backend: activeBackend,
    }));
  }, [activeBackend, activeExecution?.executionId, sessionId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [logData, aggregateData] = await Promise.all([
        api.queryLogs(params),
        api.aggregateLogs(params),
      ]);
      setLogs(logData);
      setAggregate(aggregateData);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const aggregatePairs = useMemo(() => {
    const source = aggregate?.aggregate ?? aggregate ?? {};
    return Object.entries(source).slice(0, 8);
  }, [aggregate]);

  return (
    <section className="space-y-4">
      <PanelHeader icon={<FileSearch size={14} />} title="Logs explorer" description="Query persisted runtime events with filterable log aggregation." />
      <div className="grid gap-3 rounded-2xl border border-iota-border bg-stone-50/70 p-4 md:grid-cols-2">
        <input value={params.sessionId ?? ''} onChange={(event) => setParams((current) => ({ ...current, sessionId: event.target.value || undefined }))} placeholder="session id" className="rounded-xl border border-iota-border bg-white px-3 py-2 text-xs" />
        <input value={params.executionId ?? ''} onChange={(event) => setParams((current) => ({ ...current, executionId: event.target.value || undefined }))} placeholder="execution id" className="rounded-xl border border-iota-border bg-white px-3 py-2 text-xs" />
        <input value={params.backend ?? ''} onChange={(event) => setParams((current) => ({ ...current, backend: (event.target.value || undefined) as typeof current.backend }))} placeholder="backend" className="rounded-xl border border-iota-border bg-white px-3 py-2 text-xs" />
        <input value={params.eventType ?? ''} onChange={(event) => setParams((current) => ({ ...current, eventType: event.target.value || undefined }))} placeholder="event type" className="rounded-xl border border-iota-border bg-white px-3 py-2 text-xs" />
        <input value={params.limit ? String(params.limit) : ''} onChange={(event) => setParams((current) => ({ ...current, limit: Number(event.target.value) || undefined }))} placeholder="limit" className="rounded-xl border border-iota-border bg-white px-3 py-2 text-xs" />
        <button onClick={() => void load()} className="rounded-xl bg-iota-accent px-3 py-2 text-xs font-bold uppercase text-white">Run query</button>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="rounded-2xl border border-iota-border p-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-iota-text/45">
            <Database size={12} />
            Aggregate
            {loading && <RefreshCw size={12} className="animate-spin" />}
          </div>
          <div className="space-y-2">
            {aggregatePairs.length === 0 ? (
              <div className="text-xs text-iota-text/45">No aggregate data.</div>
            ) : (
              aggregatePairs.map(([key, value]) => (
                <div key={key} className="rounded-xl bg-stone-50 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase text-iota-text/45">{key}</div>
                  <div className="mt-1 break-all font-mono text-[11px] text-iota-heading">{typeof value === 'string' ? value : JSON.stringify(value)}</div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-iota-border">
          <div className="border-b border-iota-border px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-iota-text/45">
            Runtime events {logs ? `(${logs.count})` : ''}
          </div>
          <div className="max-h-[520px] overflow-y-auto custom-scrollbar">
            {logs?.logs.length ? logs.logs.map((log, index) => (
              <div key={`${log.executionId ?? 'log'}-${index}`} className="border-b border-stone-100 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-iota-accent">{log.type}</div>
                  <div className="text-[10px] text-iota-text/45">{new Date(log.timestamp).toLocaleString()}</div>
                </div>
                <div className="mt-1 text-[11px] text-iota-text/65">{log.backend ?? 'unknown'} · {log.sessionId ?? 'n/a'} · {log.executionId ?? 'n/a'}</div>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-stone-50 p-3 text-[10px] text-iota-text/80">{JSON.stringify(log.payload ?? {}, null, 2)}</pre>
              </div>
            )) : <div className="px-4 py-8 text-center text-xs text-iota-text/45">No logs loaded.</div>}
          </div>
        </div>
      </div>
    </section>
  );
};

const CrossSessionPanel: React.FC = () => {
  const [query, setQuery] = useState('memory');
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  const [logs, setLogs] = useState<LogsQueryResponse | null>(null);
  const [aggregate, setAggregate] = useState<LogsAggregateResponse | null>(null);
  const [memories, setMemories] = useState<string[]>([]);
  const [isolation, setIsolation] = useState<BackendIsolationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [sessionData, logData, aggregateData, memoryData, isolationData] = await Promise.all([
        api.listCrossSessionSessions(),
        api.queryCrossSessionLogs({ limit: 25 }),
        api.aggregateCrossSessionLogs({}),
        api.searchCrossSessionMemories(query, 8),
        api.getBackendIsolation(),
      ]);
      setSessions(sessionData.sessions);
      setLogs(logData);
      setAggregate(aggregateData);
      setMemories(memoryData.memories.map((item) => item.content));
      setIsolation(isolationData);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="space-y-4">
      <PanelHeader icon={<Shield size={14} />} title="Cross-session inspector" description="Inspect sessions, search memories, and review backend isolation summaries." />
      <div className="flex gap-3 rounded-2xl border border-iota-border bg-stone-50/70 p-4">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="memory search query" className="flex-1 rounded-xl border border-iota-border bg-white px-3 py-2 text-xs" />
        <button onClick={() => void load()} className="rounded-xl bg-iota-accent px-3 py-2 text-xs font-bold uppercase text-white">Refresh</button>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title="Sessions" value={String(sessions.length)} detail="Visible across storage" />
        <InfoCard title="Cross logs" value={String(logs?.count ?? 0)} detail="Recent persisted events" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Session list">
          <div className="space-y-2 text-[11px]">
            {sessions.slice(0, 10).map((session, index) => (
              <div key={index} className="rounded-xl bg-stone-50 px-3 py-2 font-mono text-iota-text/75">{JSON.stringify(session)}</div>
            ))}
          </div>
        </Card>
        <Card title="Memory search hits">
          <div className="space-y-2 text-[11px] text-iota-text/75">
            {memories.length === 0 ? 'No hits' : memories.map((memory, index) => (
              <div key={index} className="rounded-xl bg-stone-50 px-3 py-2">{memory}</div>
            ))}
          </div>
        </Card>
        <Card title="Isolation report">
          <pre className="overflow-x-auto rounded-xl bg-stone-50 p-3 text-[10px] text-iota-text/80">{JSON.stringify({ aggregate, isolation }, null, 2)}</pre>
        </Card>
      </div>
    </section>
  );
};

const PanelHeader: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({ icon, title, description }) => (
  <div className="flex items-start gap-3">
    <div className="rounded-xl bg-iota-accent/10 p-2 text-iota-accent">{icon}</div>
    <div>
      <h3 className="text-sm font-semibold text-iota-heading">{title}</h3>
      <p className="text-xs text-iota-text/55">{description}</p>
    </div>
  </div>
);

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-2xl border border-iota-border p-4">
    <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-iota-text/45">{title}</div>
    {children}
  </div>
);

const InfoCard: React.FC<{ title: string; value: string; detail: string }> = ({ title, value, detail }) => (
  <div className="rounded-2xl border border-iota-border bg-gradient-to-br from-stone-50 to-white p-4">
    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-iota-text/45">{title}</div>
    <div className="mt-2 text-2xl font-semibold text-iota-heading">{value}</div>
    <div className="text-xs text-iota-text/55">{detail}</div>
  </div>
);
