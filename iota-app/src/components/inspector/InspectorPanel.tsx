import React, { useEffect, useState, useMemo } from 'react';
import { useSessionStore } from '../../store/useSessionStore';
import { api } from '../../lib/api';
import type { 
  TraceStepView, 
  MemoryCardView,
  SessionSummaryView,
  MemoryPanelView,
  BackendStatusView,
  AppExecutionSnapshot,
  SessionMemoryItem
} from '../../types';
import { 
  Activity, 
  Brain, 
  Box, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Database,
  FileCode,
  X,
  Pin,
  PinOff,
  LayoutList,
  Wrench,
  Info,
  Server,
  Terminal,
  Activity as PerformanceIcon,
  Plus,
  Eye,
  History
} from 'lucide-react';

import { useVirtualizer } from '@tanstack/react-virtual';

type Tab = 'tracing' | 'memory' | 'context' | 'mcp' | 'summary';

export const InspectorPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('tracing');
  const { activeExecution, backends, activeBackend } = useSessionStore();
  const tokens = activeExecution?.tokens;

  const currentBackend = backends.find(b => b.backend === activeBackend);
  const caps = currentBackend?.capabilities;

  return (
    <aside className="h-full w-full flex flex-col overflow-hidden bg-white border-l border-iota-border">
      {/* Tabs */}
      <div className="h-10 border-b border-iota-border flex bg-gray-50/50">
        <TabButton 
          label="Tracing" 
          icon={<Activity size={12} />} 
          active={activeTab === 'tracing'} 
          onClick={() => setActiveTab('tracing')} 
        />
        <TabButton 
          label="Memory" 
          icon={<Brain size={12} />} 
          active={activeTab === 'memory'} 
          onClick={() => setActiveTab('memory')} 
        />
        <TabButton 
          label="Context" 
          icon={<Box size={12} />} 
          active={activeTab === 'context'} 
          onClick={() => setActiveTab('context')} 
        />
        <TabButton 
          label="MCP" 
          icon={<Wrench size={12} />} 
          active={activeTab === 'mcp'} 
          onClick={() => setActiveTab('mcp')} 
        />
        <TabButton 
          label="Summary" 
          icon={<LayoutList size={12} />} 
          active={activeTab === 'summary'} 
          onClick={() => setActiveTab('summary')} 
        />
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'tracing' && (
          caps?.chainVisibility !== false 
            ? <TracingView execution={activeExecution} />
            : <UnsupportedView message="Chain tracing not supported by this backend" backend={currentBackend} />
        )}
        {activeTab === 'memory' && (
          caps?.memoryVisibility !== false
            ? <MemoryView memory={activeExecution?.memory} />
            : <UnsupportedView message="Memory visibility not supported by this backend" backend={currentBackend} />
        )}
        {activeTab === 'context' && <ContextView />}
        {activeTab === 'mcp' && (
          caps?.mcp !== false
            ? <MCPView execution={activeExecution} />
            : <UnsupportedView message="MCP tool usage not supported by this backend" backend={currentBackend} />
        )}
        {activeTab === 'summary' && <SummaryView summary={activeExecution?.summary} />}
      </div>

      {/* Token Usage Stats */}
      <div className="border-t border-iota-border p-4 bg-gray-50/80">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-iota-text/50 flex items-center">
            <Database size={12} className="mr-1.5" />
            Token Usage
          </h3>
          <span className={`text-[10px] font-bold ${tokens?.totalTokens && tokens.totalTokens > 80000 ? 'text-red-500' : 'text-iota-accent'}`}>
            {tokens?.totalTokens ? `${(tokens.totalTokens / 128).toFixed(1)}k budget` : 'N/A'}
          </span>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xl font-bold text-iota-heading tabular-nums">
              {tokens?.totalTokens?.toLocaleString() || '0'}
            </div>
            <div className="text-[10px] text-iota-text/40 font-semibold uppercase">Total Tokens</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-iota-text/60 font-medium italic mb-1 flex items-center justify-end">
               {tokens?.confidence === 'native' ? <CheckCircle2 size={10} className="mr-1 text-green-500" /> : <Clock size={10} className="mr-1 text-amber-500" />}
               {tokens?.confidence || 'estimated'}
            </div>
            <div className="text-[10px] text-iota-text/60 font-medium">In: {tokens?.inputTokens || 0}</div>
            <div className="text-[10px] text-iota-text/60 font-medium">Out: {tokens?.outputTokens || 0}</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

const TabButton: React.FC<{ label: string; icon: React.ReactNode; active: boolean; onClick: () => void; disabled?: boolean }> = ({ label, icon, active, onClick, disabled }) => (
  <button 
    onClick={onClick}
    disabled={disabled}
    className={`flex-1 flex flex-col items-center justify-center space-y-0.5 transition-all duration-200 border-b-2 ${
      active 
        ? 'border-iota-accent text-iota-accent bg-white' 
        : 'border-transparent text-iota-text/40 hover:text-iota-text/60 hover:bg-white/50'
    } ${disabled ? 'opacity-30 cursor-not-allowed grayscale' : ''}`}
  >
    {icon}
    <span className="text-[9px] font-bold uppercase tracking-tighter">{label}</span>
  </button>
);

const UnsupportedView: React.FC<{ message: string; backend?: BackendStatusView }> = ({ message, backend }) => (
  <div className="p-10 flex flex-col items-center justify-center space-y-3 text-center">
    <Info size={24} className="text-iota-text/20" />
    <p className="text-xs text-iota-text/40 italic">{message}</p>
    {backend?.status === 'degraded' && (
      <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-[10px] text-amber-700">
        Backend is currently in a degraded state.
      </div>
    )}
    <button className="text-[10px] text-iota-accent font-bold hover:underline">Capabilities Documentation</button>
  </div>
);

const TracingView: React.FC<{ execution?: AppExecutionSnapshot | null }> = ({ execution }) => {
  const steps = execution?.tracing?.steps || [];
  const tabs = execution?.tracing?.tabs;
  const [subTab, setSubTab] = useState<'timeline' | 'details' | 'perf' | 'raw'>('timeline');
  const parentRef = React.useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-iota-border h-8 bg-gray-50/30 shrink-0">
        <button onClick={() => setSubTab('timeline')} className={`flex-1 text-[9px] font-bold uppercase ${subTab === 'timeline' ? 'text-iota-accent border-b border-iota-accent' : 'text-iota-text/40'}`}>Timeline</button>
        <button onClick={() => setSubTab('details')} className={`flex-1 text-[9px] font-bold uppercase ${subTab === 'details' ? 'text-iota-accent border-b border-iota-accent' : 'text-iota-text/40'}`}>Details</button>
        <button onClick={() => setSubTab('perf')} className={`flex-1 text-[9px] font-bold uppercase ${subTab === 'perf' ? 'text-iota-accent border-b border-iota-accent' : 'text-iota-text/40'}`}>Perf</button>
        <button onClick={() => setSubTab('raw')} className={`flex-1 text-[9px] font-bold uppercase ${subTab === 'raw' ? 'text-iota-accent border-b border-iota-accent' : 'text-iota-text/40'}`}>Raw</button>
      </div>

      <div className="p-4 flex-1 overflow-hidden flex flex-col">
        {subTab === 'timeline' && (
          <div ref={parentRef} className="flex-1 overflow-y-auto custom-scrollbar">
            {steps.length === 0 ? (
              <div className="text-center py-10 text-iota-text/30 italic text-sm">No active trace</div>
            ) : (
              <div 
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const step = steps[virtualItem.index];
                  const isLast = virtualItem.index === steps.length - 1;
                  return (
                    <div
                      key={step.key}
                      data-index={virtualItem.index}
                      ref={rowVirtualizer.measureElement}
                      className="absolute top-0 left-0 w-full pl-6 pb-4 group"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      {!isLast && <div className="absolute left-1.5 top-1.5 bottom-0 w-[1px] bg-iota-border" />}
                      <div className="absolute left-0 top-1">
                        {step.status === 'completed' && <CheckCircle2 size={12} className="text-green-500 bg-white" />}
                        {step.status === 'running' && <Clock size={12} className="text-iota-accent animate-pulse bg-white" />}
                        {step.status === 'failed' && <AlertCircle size={12} className="text-red-500 bg-white" />}
                        {step.status === 'pending' && <div className="w-3 h-3 rounded-full border border-gray-300 bg-white" />}
                      </div>
                      <div className="flex flex-col">
                        <span className={`text-xs font-semibold ${step.status === 'pending' ? 'text-iota-text/30' : 'text-iota-heading'}`}>
                          {step.label}
                        </span>
                        {step.durationMs !== undefined && (
                          <span className="text-[10px] text-iota-text/40 tabular-nums">{step.durationMs}ms</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {subTab === 'details' && tabs?.detail && (
          <div className="space-y-4 text-xs">
            <DetailItem label="Protocol" value={tabs.detail.protocol} icon={<Terminal size={12} />} />
            <DetailItem label="Native Events" value={tabs.detail.nativeEventCount} />
            <DetailItem label="Runtime Events" value={tabs.detail.runtimeEventCount} />
            <DetailItem label="Approvals" value={tabs.detail.approvalCount} />
            <div className="mt-4">
               <span className="text-[10px] font-bold text-iota-text/40 uppercase mb-1 block">Executable Command</span>
               <div className="p-2 bg-gray-900 text-gray-100 rounded font-mono text-[9px] break-all">
                  {tabs.detail.command || 'internal'}
               </div>
            </div>
          </div>
        )}

        {subTab === 'perf' && tabs?.performance && (
          <div className="space-y-4">
             <div className="flex items-center space-x-2 text-iota-accent">
                <PerformanceIcon size={14} />
                <span className="text-[10px] font-bold uppercase">Latency Stats</span>
             </div>
             <div className="grid grid-cols-3 gap-2 text-center">
                <PerfBox label="P50" value={tabs.performance.latencyMs.p50} />
                <PerfBox label="P95" value={tabs.performance.latencyMs.p95} />
                <PerfBox label="P99" value={tabs.performance.latencyMs.p99} />
             </div>
             <PerfTrend values={[tabs.performance.latencyMs.p50, tabs.performance.latencyMs.p95, tabs.performance.latencyMs.p99]} />
             {tabs.performance.memoryHitRatio !== undefined && (
               <div className="space-y-1 mt-4">
                 <div className="flex justify-between text-[9px] font-bold uppercase text-iota-text/50">
                    <span>Memory Hit Ratio</span>
                    <span>{(tabs.performance.memoryHitRatio * 100).toFixed(1)}%</span>
                 </div>
                 <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500" style={{ width: `${tabs.performance.memoryHitRatio * 100}%` }} />
                 </div>
               </div>
             )}
          </div>
        )}

        {subTab === 'raw' && execution && (
          <RawMappingView executionId={execution.executionId} />
        )}
      </div>
    </div>
  );
};

const RawMappingView: React.FC<{ executionId: string }> = ({ executionId }) => {
  const [data, setData] = useState<{ mappings?: Array<Record<string, unknown>> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setTimeout(() => {
      if (active) setLoading(true);
    }, 0);
    
    api.getExecutionChain(executionId)
      .then(res => {
        if (active) {
          setData(res as { mappings?: Array<Record<string, unknown>> });
          setLoading(false);
        }
      })
      .catch(err => {
        if (active) {
          setError((err as Error).message);
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [executionId]);

  if (loading) return <div className="text-center py-10 text-xs text-iota-text/40">Loading native chain...</div>;
  if (error) return <div className="text-center py-10 text-xs text-red-500">{error}</div>;
  if (!data || !data.mappings) return <div className="text-center py-10 text-xs text-iota-text/40">No mapping data</div>;

  return (
    <div className="space-y-4 overflow-y-auto custom-scrollbar pr-2 h-full pb-10">
      <div className="text-[10px] font-bold text-iota-text/40 uppercase mb-2">Event Mappings ({data.mappings.length})</div>
      {data.mappings.map((mapping, i) => (
        <div key={i} className="p-3 bg-gray-50 border border-iota-border rounded-lg text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-bold text-iota-heading">{String(mapping.mappingRule)}</span>
            {Boolean(mapping.lossy) && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-bold rounded uppercase">Lossy</span>}
          </div>
          <div className="text-[10px] text-iota-text/60">
            <div><span className="font-semibold text-iota-text/40 w-16 inline-block">Native:</span> {(mapping.nativeEventRef as Record<string, string>)?.sourceType} ({(mapping.nativeEventRef as Record<string, number>)?.payloadByteSize}b)</div>
            <div><span className="font-semibold text-iota-text/40 w-16 inline-block">Runtime:</span> {(mapping.runtimeEvent as Record<string, string>)?.type}</div>
          </div>
        </div>
      ))}
    </div>
  );
};


const DetailItem: React.FC<{ label: string; value: string | number | undefined; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex justify-between items-center py-1 border-b border-gray-50">
    <div className="flex items-center space-x-2 text-iota-text/60">
      {icon}
      <span>{label}</span>
    </div>
    <span className="font-semibold text-iota-heading">{value ?? 'N/A'}</span>
  </div>
);

const PerfBox: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="p-2 bg-gray-50 rounded border border-iota-border">
    <div className="text-[8px] font-bold text-iota-text/40 uppercase">{label}</div>
    <div className="text-xs font-bold text-iota-heading tabular-nums">{value}ms</div>
  </div>
);

const PerfTrend: React.FC<{ values: number[] }> = ({ values }) => {
  const width = 220;
  const height = 72;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const path = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 8) - 4;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="rounded border border-iota-border bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between text-[8px] font-bold uppercase text-iota-text/40">
        <span>Latency Trend</span>
        <span>{min}ms - {max}ms</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[72px] w-full">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-iota-accent" />
      </svg>
    </div>
  );
};

const MemoryView: React.FC<{ memory?: MemoryPanelView }> = ({ memory }) => {
  const [activeSubTab, setActiveSubTab] = useState<'all' | 'session' | 'knowledge'>('all');
  const { sessionId } = useSessionStore();
  const [query, setQuery] = useState('');
  const [newMemory, setNewMemory] = useState('');
  const [newMemoryType, setNewMemoryType] = useState<SessionMemoryItem['type']>('episodic');
  const [managedMemories, setManagedMemories] = useState<SessionMemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    setLoading(true);
    setError(null);
    api.listSessionMemories(sessionId, query || undefined)
      .then((result) => {
        if (!active) return;
        setManagedMemories(result.memories);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error).message);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId, query]);

  const handleDelete = async (memoryId: string) => {
    if (!sessionId) return;
    await api.deleteSessionMemory(sessionId, memoryId);
    setManagedMemories((items) => items.filter((item) => item.id !== memoryId));
  };

  const handleCreate = async () => {
    if (!sessionId || !newMemory.trim()) return;
    const created = await api.createSessionMemory(sessionId, {
      content: newMemory.trim(),
      type: newMemoryType,
    });
    setManagedMemories((items) => [created, ...items]);
    setNewMemory('');
  };
  
  const items = useMemo(() => {
    const tabs = memory?.tabs || { longTerm: [], session: [], knowledge: [] };
    if (activeSubTab === 'session') return tabs.session;
    if (activeSubTab === 'knowledge') return tabs.knowledge;
    return [...tabs.longTerm, ...tabs.session, ...tabs.knowledge];
  }, [memory?.tabs, activeSubTab]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-iota-border h-8 bg-gray-50/30">
        <button onClick={() => setActiveSubTab('all')} className={`flex-1 text-[9px] font-bold uppercase ${activeSubTab === 'all' ? 'text-iota-accent border-b border-iota-accent' : 'text-iota-text/40'}`}>All ({items.length})</button>
        <button onClick={() => setActiveSubTab('session')} className={`flex-1 text-[9px] font-bold uppercase ${activeSubTab === 'session' ? 'text-iota-accent border-b border-iota-accent' : 'text-iota-text/40'}`}>Session</button>
        <button onClick={() => setActiveSubTab('knowledge')} className={`flex-1 text-[9px] font-bold uppercase ${activeSubTab === 'knowledge' ? 'text-iota-accent border-b border-iota-accent' : 'text-iota-text/40'}`}>Knowledge</button>
      </div>

      <div className="p-4 space-y-3 flex-1 overflow-y-auto custom-scrollbar">
        <div className="space-y-2 rounded-lg border border-iota-border bg-white p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-iota-text/50">Memory Manager</div>
          <div className="grid grid-cols-[1fr_96px_72px] gap-2">
            <input
              value={newMemory}
              onChange={(event) => setNewMemory(event.target.value)}
              placeholder="Create manual memory"
              className="w-full rounded border border-iota-border px-2 py-1.5 text-xs outline-none focus:border-iota-accent"
            />
            <select
              value={newMemoryType}
              onChange={(event) => setNewMemoryType(event.target.value as SessionMemoryItem['type'])}
              className="rounded border border-iota-border px-2 py-1.5 text-xs outline-none focus:border-iota-accent"
            >
              <option value="episodic">episodic</option>
              <option value="procedural">procedural</option>
              <option value="factual">factual</option>
              <option value="strategic">strategic</option>
            </select>
            <button onClick={() => void handleCreate()} className="flex items-center justify-center rounded border border-iota-accent bg-iota-accent/5 px-2 py-1.5 text-[10px] font-bold uppercase text-iota-accent">
              <Plus size={12} className="mr-1" /> Add
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search session memories"
            className="w-full rounded border border-iota-border px-2 py-1.5 text-xs outline-none focus:border-iota-accent"
          />
          {error && <div className="text-[10px] text-red-500">{error}</div>}
          <div className="max-h-40 space-y-1 overflow-y-auto custom-scrollbar">
            {loading ? (
              <div className="py-3 text-center text-[10px] text-iota-text/40">Loading...</div>
            ) : managedMemories.length === 0 ? (
              <div className="py-3 text-center text-[10px] text-iota-text/40">No stored memories</div>
            ) : (
              managedMemories.map((item) => (
                <div key={item.id} className="rounded border border-gray-100 bg-gray-50 px-2 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[10px] font-bold uppercase text-iota-text/40">{item.type ?? 'episodic'}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-iota-text/80">{item.content}</div>
                    </div>
                    <button onClick={() => handleDelete(item.id)} className="p-1 text-iota-text/30 hover:text-red-500">
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-10 text-iota-text/30 italic text-sm">No memory items</div>
        ) : (
          items.map((card: MemoryCardView) => (
            <div key={card.id} className="p-3 rounded-lg bg-gray-50 border border-iota-border hover:border-iota-accent/30 transition-colors group">
              <div className="flex justify-between items-start mb-1">
                <h4 className="text-[10px] font-bold text-iota-text/40 uppercase flex items-center">
                  <Brain size={10} className="mr-1" />
                  {card.source}
                </h4>
                {card.visibleToBackend && <span title="Visible to backend"><Eye size={10} className="text-green-500" /></span>}
              </div>
              <div className="text-xs text-iota-text/80 line-clamp-2 italic mb-1 font-medium group-hover:text-iota-heading">{card.title}</div>
              <div className="text-[10px] text-iota-text/50 truncate font-mono">{card.preview}</div>
            </div>
          ))
        )}
      </div>
      
      <div className="p-2 border-t border-iota-border bg-gray-50/50 flex justify-around text-[9px] font-bold uppercase text-iota-text/40">
        <span>Hits: {memory?.hitCount || 0}</span>
        <span>Selected: {memory?.selectedCount || 0}</span>
        <span>Trimmed: {memory?.trimmedCount || 0}</span>
      </div>
    </div>
  );
};

const ContextView: React.FC = () => {
  const { sessionId, activeFiles, setActiveFiles, activeExecution } = useSessionStore();

  const handleTogglePin = async (path: string) => {
    const newFiles = activeFiles.map(f => 
      f.path === path ? { ...f, pinned: !f.pinned } : f
    );
    setActiveFiles(newFiles);
    if (sessionId) await api.updateSessionContext(sessionId, newFiles);
  };

  const handleRemove = async (path: string) => {
    const newFiles = activeFiles.filter(f => f.path !== path);
    setActiveFiles(newFiles);
    if (sessionId) await api.updateSessionContext(sessionId, newFiles);
  };

  const handleClearAll = async () => {
    setActiveFiles([]);
    if (sessionId) await api.updateSessionContext(sessionId, []);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex justify-between items-center">
           <h4 className="text-[10px] font-bold text-iota-text/60 uppercase flex items-center">
            <FileCode size={12} className="mr-1.5" />
            Active Files ({activeFiles.length})
          </h4>
          <button onClick={handleClearAll} className="text-[9px] font-bold text-red-500 uppercase hover:underline">Clear All</button>
        </div>
        
        <div className="space-y-1">
          {activeFiles.length === 0 ? (
            <div className="text-center py-8 text-iota-text/30 italic text-xs">No files in context</div>
          ) : (
            activeFiles.map(file => (
              <div key={file.path} className="flex items-center justify-between text-xs py-1.5 px-2 hover:bg-gray-50 rounded group border border-transparent hover:border-iota-border transition-all">
                <span className={`truncate font-mono ${file.pinned ? 'text-iota-accent font-semibold' : 'text-iota-text/80'}`}>
                  {file.path}
                </span>
                <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleTogglePin(file.path)} className="p-1 hover:text-iota-accent" title={file.pinned ? "Unpin" : "Pin to context"}>
                    {file.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  </button>
                  <button onClick={() => handleRemove(file.path)} className="p-1 hover:text-red-500" title="Remove from context">
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      <div className="p-3 bg-iota-accent/5 border border-iota-accent/10 rounded-lg">
         <div className="flex justify-between items-center mb-1">
            <span className="text-[9px] font-bold uppercase text-iota-accent/60">Context Budget</span>
            <span className="text-[9px] font-bold text-iota-accent">{activeExecution?.tokens?.totalTokens ? `${Math.round(activeExecution.tokens.totalTokens / 1000)}k` : '—'}</span>
         </div>
         <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-iota-accent transition-all" style={{ width: `${Math.min(100, Math.round((activeExecution?.tokens?.totalTokens ?? 0) / 1280))}%` }} />
         </div>
      </div>
    </div>
  );
};

const MCPView: React.FC<{ execution?: AppExecutionSnapshot | null }> = ({ execution }) => {
  const mcpSteps = useMemo(() => execution?.tracing?.steps?.filter((s: TraceStepView) => s.key === 'mcp') || [], [execution]);
  const { mcpServers } = useSessionStore();

  return (
    <div className="p-4 space-y-6">
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-iota-heading font-bold">
          <Server size={14} className="text-iota-accent" />
          <span className="text-[10px] uppercase tracking-wider">Active MCP Servers</span>
        </div>
        {(!mcpServers || mcpServers.length === 0) ? (
          <div className="p-4 bg-gray-50 border border-iota-border rounded-xl text-center text-xs text-iota-text/40 italic">
            No external MCP servers registered in current session.
          </div>
        ) : (
          <div className="space-y-2">
             {mcpServers.map(server => (
               <MCPServerItem key={server.name} name={server.name} status="online" tools={server.args?.length || 0} />
             ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-iota-heading font-bold">
          <Wrench size={14} className="text-iota-accent" />
          <span className="text-[10px] uppercase tracking-wider">Tool Call History</span>
        </div>
        {mcpSteps.length === 0 ? (
          <div className="p-8 border border-dashed border-iota-border rounded-xl text-center text-xs text-iota-text/20">
            No tool calls in this execution.
          </div>
        ) : (
          <div className="space-y-2">
            {mcpSteps.map((step: TraceStepView, i: number) => (
              <div key={i} className="p-2 bg-white border border-iota-border rounded-lg shadow-sm hover:border-iota-accent/30 transition-all cursor-default">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-iota-heading">{step.label}</span>
                  <div className={`w-1.5 h-1.5 rounded-full ${step.status === 'completed' ? 'bg-green-500' : 'bg-red-500'}`} />
                </div>
                <div className="flex justify-between items-center text-[9px] text-iota-text/40">
                  <span className="font-mono">args: {"{...}"}</span>
                  <span className="tabular-nums">{step.durationMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const MCPServerItem: React.FC<{ name: string; status: 'online' | 'busy' | 'offline'; tools: number }> = ({ name, status, tools }) => (
  <div className="flex items-center justify-between p-2 rounded-lg border border-gray-50 bg-gray-50/30">
    <div className="flex items-center space-x-2">
      <div className={`w-1.5 h-1.5 rounded-full ${status === 'online' ? 'bg-green-500' : status === 'busy' ? 'bg-amber-500' : 'bg-gray-400'}`} />
      <span className="text-[11px] font-bold text-iota-heading">{name}</span>
    </div>
    <span className="text-[9px] text-iota-text/40 font-bold uppercase">{tools} Tools</span>
  </div>
);

const SummaryView: React.FC<{ summary?: SessionSummaryView }> = ({ summary }) => (
  <div className="p-4 space-y-4">
    {summary ? (
       <div className="space-y-4">
          <div className="p-4 rounded-xl bg-iota-accent/5 border border-iota-accent/10">
            <div className="flex items-center space-x-2 mb-2">
               <History size={14} className="text-iota-accent" />
               <h4 className="text-[10px] font-bold text-iota-accent uppercase">Executive Summary</h4>
            </div>
            <div className="text-sm text-iota-heading leading-relaxed font-medium">{summary.text}</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SummaryStat label="Duration" value={summary.totalDurationMs ? `${(summary.totalDurationMs / 1000).toFixed(1)}s` : 'N/A'} />
            <SummaryStat label="Messages" value={summary.messageCount || 0} />
          </div>
          <div className="p-3 rounded-lg border border-iota-border bg-gray-50/50">
             <div className="text-[9px] font-bold text-iota-text/40 uppercase mb-1">Last Execution ID</div>
             <div className="text-[10px] font-mono text-iota-text/60 truncate">{summary.lastExecutionId}</div>
          </div>
       </div>
    ) : (
      <div className="text-center py-10 text-iota-text/30 italic text-sm">No summary available</div>
    )}
  </div>
);

const SummaryStat: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="p-3 rounded-lg bg-gray-50 border border-iota-border">
     <div className="text-[9px] font-bold text-iota-text/40 uppercase mb-0.5">{label}</div>
     <div className="text-sm font-bold text-iota-heading tabular-nums">{value}</div>
  </div>
);
