import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSessionStore } from './store/useSessionStore'
import { api } from './lib/api'
import { useWebSocket } from './hooks/useWebSocket'
import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import { ChatTimeline } from './components/chat/ChatTimeline'
import { InspectorPanel } from './components/inspector/InspectorPanel'
import { ExecutionReplayModal } from './components/inspector/ExecutionReplayModal'
import { WorkspaceExplorer } from './components/workspace/WorkspaceExplorer'
import { OperationsDrawer } from './components/admin/OperationsDrawer'

function App() {
  const { sessionId, setSessionId, updateSnapshot } = useSessionStore();
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [replayExecutionId, setReplayExecutionId] = useState<string | null>(null);
  
  // 1. Initialize centralized WebSocket logic
  useWebSocket();
  
  // 2. Initialize sessionId from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('session');
    if (id) {
      setSessionId(id);
    }
  }, [setSessionId]);

  // 3. Fetch initial snapshot
  const { data: snapshot, isLoading, error } = useQuery({
    queryKey: ['session-snapshot', sessionId],
    queryFn: () => sessionId ? api.getSessionSnapshot(sessionId) : null,
    enabled: !!sessionId,
    staleTime: Infinity,
  });

  // 4. Sync snapshot to store
  useEffect(() => {
    if (snapshot) {
      updateSnapshot(snapshot);
    }
  }, [snapshot, updateSnapshot]);

  if (!sessionId) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-iota-bg">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-iota-accent rounded-2xl mx-auto flex items-center justify-center text-white text-2xl font-bold shadow-xl shadow-iota-accent/20 cursor-default">I</div>
          <h1 className="text-xl font-semibold text-iota-heading">Iota Agent Engine</h1>
          <button 
            onClick={async () => {
              const { sessionId } = await api.createSession('/Users/han/codingx/iota');
              window.location.search = `?session=${sessionId}`;
            }}
            className="px-6 py-2 bg-iota-accent text-white rounded-xl font-medium hover:bg-iota-accent/90 transition-all shadow-lg shadow-iota-accent/10"
          >
            Create New Session
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-iota-bg">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-4 border-iota-accent/20 border-t-iota-accent rounded-full animate-spin"></div>
          <span className="text-sm font-medium text-iota-text/60 italic tabular-nums tracking-widest uppercase">Initializing...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-iota-bg">
        <div className="text-center p-12 bg-white border border-red-100 rounded-3xl max-w-sm shadow-2xl">
          <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
          <h2 className="text-red-700 font-bold text-lg mb-2">Sync Failed</h2>
          <p className="text-red-600/70 text-sm mb-6">{(error as Error).message}</p>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all">Reconnect</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-screen w-full bg-iota-bg text-iota-text overflow-hidden selection:bg-iota-accent/20">
        <Sidebar onOpenOperations={() => setOperationsOpen(true)} onOpenReplay={(executionId) => setReplayExecutionId(executionId)} />
        <WorkspaceExplorer />

        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />

          <div className="flex-1 flex overflow-hidden">
            <ChatTimeline />
            <InspectorPanel />
          </div>
        </div>
      </div>
      <OperationsDrawer open={operationsOpen} onClose={() => setOperationsOpen(false)} />
      <ExecutionReplayModal executionId={replayExecutionId} onClose={() => setReplayExecutionId(null)} />
    </>
  )
}

import { AlertCircle } from 'lucide-react';

export default App
