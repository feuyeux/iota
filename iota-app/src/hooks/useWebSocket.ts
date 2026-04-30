import { useEffect, useRef } from 'react';
import { useSessionStore } from '../store/useSessionStore';
import { api } from '../lib/api';

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const sessionId = useSessionStore(s => s.sessionId);
  const setSendMessage = useSessionStore(s => s.setSendMessage);
  const activeExecutionId = useSessionStore(s => s.activeExecution?.executionId);

  const subscribedExecutionRef = useRef<string | null>(null);

  // Subscribe to visibility when execution changes
  useEffect(() => {
    const execId = activeExecutionId;
    if (execId && execId !== subscribedExecutionRef.current && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'subscribe_visibility',
        executionId: execId
      }));
      subscribedExecutionRef.current = execId;
    }
  }, [activeExecutionId]);

  const connectRef = useRef<() => void>(() => {});

  connectRef.current = () => {
    // Skip if already connected or connecting
    if (ws.current?.readyState === WebSocket.OPEN || ws.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Always read the latest state from the store to avoid stale closures
    const state = useSessionStore.getState();
    const currentSessionId = state.sessionId;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/v1/stream`;
    console.log('WS Connecting to:', url, 'sessionId:', currentSessionId);

    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      console.log('WS Connected');
      state.setWsConnected(true);
      const latestState = useSessionStore.getState();
      const sid = latestState.sessionId;
      if (sid) {
        socket.send(JSON.stringify({
          type: 'subscribe_app_session',
          sessionId: sid
        }));
        // Sync snapshot
        api.getSessionSnapshot(sid).then(snap => {
          useSessionStore.getState().updateSnapshot(snap);
        }).catch(e => { console.error('Failed to sync snapshot', e); useSessionStore.getState().setError('Failed to sync snapshot'); });

        const execId = latestState.activeExecution?.executionId;
        if (execId) {
          socket.send(JSON.stringify({
            type: 'subscribe_visibility',
            executionId: execId
          }));
          subscribedExecutionRef.current = execId;
        }
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const store = useSessionStore.getState();

        switch (data.type) {
          case 'app_delta': {
            const { needsSync } = store.mergeDelta(data);
            if (needsSync && store.sessionId) {
              api.getSessionSnapshot(store.sessionId).then(snap => {
                useSessionStore.getState().updateSnapshot(snap);
              }).catch(e => { console.error('Failed to sync snapshot', e); useSessionStore.getState().setError('Failed to sync snapshot'); });
            }
            break;
          }
          case 'app_snapshot':
            store.updateSnapshot(data.snapshot);
            break;
          case 'event': {
            const rawEvent = data.event;
            if (rawEvent && rawEvent.type === 'output') {
              store.mergeDelta({
                type: 'app_delta',
                sessionId: store.sessionId!,
                revision: undefined,
                delta: {
                  type: 'conversation_delta',
                  executionId: data.executionId,
                  item: {
                    id: `${data.executionId}-${rawEvent.sequence}`,
                    role: rawEvent.data.role === 'assistant' ? 'assistant' : 'system',
                    content: rawEvent.data.content,
                    timestamp: rawEvent.timestamp,
                    executionId: data.executionId,
                    eventSequence: rawEvent.sequence
                  }
                }
              });
            }
            break;
          }
          case 'complete':
            setTimeout(() => {
              const s = useSessionStore.getState();
              if (s.sessionId) {
                api.getSessionSnapshot(s.sessionId).then(snap => {
                  useSessionStore.getState().updateSnapshot(snap);
                }).catch(e => { console.error('Failed to sync snapshot', e); useSessionStore.getState().setError('Failed to sync snapshot'); });
              }
            }, 300);
            break;
          case 'error':
            console.error('WS Application Error:', data.error);
            useSessionStore.getState().setError(data.error || 'WebSocket error');
            break;
          case 'pubsub_event':
            if (data.message?.type === 'execution_event' || data.message?.type === 'session_update') {
              const s = useSessionStore.getState();
              if (s.sessionId) {
                api.getSessionSnapshot(s.sessionId).then(snap => {
                  useSessionStore.getState().updateSnapshot(snap);
                }).catch(e => { console.error('Failed to sync snapshot', e); useSessionStore.getState().setError('Failed to sync snapshot'); });
              }
            }
            break;
        }
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    socket.onerror = (error) => {
      console.error('WS Error:', error);
      useSessionStore.getState().setError('WebSocket connection error');
    };

    socket.onclose = (event) => {
      console.log('WS Disconnected', event.code, event.reason);
      useSessionStore.getState().setWsConnected(false);
      ws.current = null;

      // Reconnect after delay if not a clean close
      if (event.code !== 1000 && event.code !== 1001) {
        setTimeout(() => {
          if (useSessionStore.getState().sessionId) {
            connectRef.current();
          }
        }, 3000);
      }
    };
  };

  // Set centralized send method
  useEffect(() => {
    setSendMessage((message: unknown) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(message));
      }
    });
  }, [setSendMessage]);

  // Connect when sessionId is available
  useEffect(() => {
    if (sessionId) {
      // Use a longer delay to survive React StrictMode's double-invoke in dev
      const timer = setTimeout(() => connectRef.current(), 300);
      return () => {
        clearTimeout(timer);
        if (ws.current) {
          ws.current.onclose = null;
          ws.current.close();
          ws.current = null;
        }
      };
    }
    return () => {
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
        ws.current = null;
      }
    };
  }, [sessionId]);

  return null;
}
