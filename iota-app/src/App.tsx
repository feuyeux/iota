import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { useSessionStore } from './store/useSessionStore'
import { api } from './lib/api'
import { useWebSocket } from './hooks/useWebSocket'
import { Header } from './components/layout/Header'
import { ChatTimeline } from './components/chat/ChatTimeline'
import { InspectorPanel } from './components/inspector/InspectorPanel'
import { IotaLogo } from './components/brand/IotaLogo'

function App() {
  const { sessionId, setSessionId, updateSnapshot } = useSessionStore();
  const storeError = useSessionStore(s => s.error);

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

  // 3. Auto-create session if none exists
  const sessionCreatingRef = useRef(false);
  useEffect(() => {
    if (!sessionId && !sessionCreatingRef.current) {
      sessionCreatingRef.current = true;
      api.createSession('.').then(({ sessionId: newId }) => {
        setSessionId(newId);
        window.history.replaceState(null, '', `?session=${newId}`);
      }).catch(e => {
        console.error('Failed to create session', e);
        useSessionStore.getState().setError('Failed to create session');
        sessionCreatingRef.current = false;
      });
    }
  }, [sessionId, setSessionId]);

  // 4. Fetch initial snapshot
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

  // Auto-dismiss error toast
  useEffect(() => {
    if (storeError) {
      const t = setTimeout(() => useSessionStore.getState().setError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [storeError]);

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-iota-bg">
        <div className="flex flex-col items-center space-y-3">
          <IotaLogo showWordmark />
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
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />

          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 min-w-0 overflow-hidden">
              <ChatTimeline />
            </div>
            <div className="flex-[2] min-w-0 overflow-hidden">
              <InspectorPanel />
            </div>
          </div>
        </div>
      </div>
      {storeError && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm flex items-center space-x-2 z-50">
          <span>{storeError}</span>
          <button onClick={() => useSessionStore.getState().setError(null)} className="ml-2 font-bold hover:text-red-200">&times;</button>
        </div>
      )}
    </>
  )
}

export default App
