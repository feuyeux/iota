import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSessionStore } from '../../store/useSessionStore';
import { api } from '../../lib/api';
import { AlertTriangle } from 'lucide-react';

export const Header: React.FC = () => {
  const { activeBackend, setActiveBackend, wsConnected, backends, setBackends } = useSessionStore();

  // Supplement backends from snapshot with fresh status
  const { data: statusData } = useQuery({
    queryKey: ['backend-status'],
    queryFn: () => api.getStatus(),
    refetchInterval: 5000, // Poll every 5s
  });

  // Sync fresh status to store backends (always, even without a session)
  useEffect(() => {
    if (statusData?.backends) {
       const updatedBackends = statusData.backends.map(b => {
         const existing = backends.find(eb => eb.backend === b.backend);
         return { ...b, active: b.backend === activeBackend || existing?.active || false };
       });
       setBackends(updatedBackends);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusData, activeBackend]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'busy': return 'bg-amber-500';
      case 'degraded': return 'bg-orange-500';
      case 'offline': return 'bg-red-500';
      case 'circuit_open': return 'bg-red-600 animate-pulse';
      default: return 'bg-gray-400';
    }
  };

  const currentStatus = backends.find(b => b.backend === activeBackend);

  const describeBackend = (backend: typeof backends[number]) => {
    const caps = backend.capabilities;
    const mcpMode = caps.mcp
      ? caps.mcpResponseChannel
        ? 'MCP with response channel'
        : 'MCP without response channel'
      : 'MCP unavailable';
    return `${backend.label}: ${backend.status}. ${mcpMode}.`;
  };

  return (
    <header className="h-14 border-b border-iota-border flex items-center justify-between px-4 bg-white/80 backdrop-blur-md sticky top-0 z-10">
      <div className="flex items-center space-x-3">
        <h2 className="text-lg font-semibold text-iota-heading">New Session</h2>
        <div className="flex items-center px-2 py-0.5 bg-green-50 text-green-700 text-[10px] font-bold uppercase tracking-wider rounded border border-green-100">
          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
          {wsConnected ? 'Connected' : 'Disconnected'}
        </div>
        {currentStatus?.status === 'circuit_open' && (
          <div className="flex items-center space-x-1 text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100 text-[10px] font-bold animate-bounce">
            <AlertTriangle size={10} />
            <span>Circuit Breaker Active</span>
          </div>
        )}
      </div>
      <div className="flex items-center space-x-1 p-1 bg-gray-100 rounded-lg">
        {backends.map((b) => (
          <button
            key={b.backend}
            onClick={() => setActiveBackend(b.backend)}
            disabled={b.status === 'offline' || b.status === 'circuit_open'}
            title={b.status === 'circuit_open' ? 'Backend unavailable due to repeated failures' : describeBackend(b)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 flex items-center space-x-2 ${
              activeBackend === b.backend 
                ? 'bg-white text-iota-accent shadow-sm' 
                : 'text-iota-text/60 hover:text-iota-text hover:bg-gray-50'
            } ${(b.status === 'offline' || b.status === 'circuit_open') ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${getStatusColor(b.status)}`} />
            <span>{b.label}</span>
          </button>
        ))}
      </div>
    </header>
  );
};
