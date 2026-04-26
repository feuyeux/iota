import { useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '../store/useSessionStore';
import { api } from '../lib/api';

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const { sessionId, setWsConnected, mergeDelta, updateSnapshot, setSendMessage, activeExecution } = useSessionStore();

  const subscribedExecutionRef = useRef<string | null>(null);

  // Subscribe to visibility when execution changes
  useEffect(() => {
    const execId = activeExecution?.executionId;
    if (execId && execId !== subscribedExecutionRef.current && ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'subscribe_visibility',
        executionId: execId
      }));
      subscribedExecutionRef.current = execId;
    }
  }, [activeExecution?.executionId]);

  const syncSnapshot = useCallback(async () => {
    if (!sessionId) return;
    try {
      const snapshot = await api.getSessionSnapshot(sessionId);
      updateSnapshot(snapshot);
    } catch (e) {
      console.error('Failed to sync snapshot after WS gap', e);
    }
  }, [sessionId, updateSnapshot]);

  const connect = useCallback(() => {
    // Skip if already connected or connecting
    if (ws.current?.readyState === WebSocket.OPEN || ws.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/v1/stream`;
    console.log('WS Connecting to:', url);

    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      console.log('WS Connected');
      setWsConnected(true);
      if (sessionId) {
        socket.send(JSON.stringify({
          type: 'subscribe_app_session',
          sessionId
        }));
        syncSnapshot();

        const execId = activeExecution?.executionId;
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

        switch (data.type) {
          case 'app_delta': {
            const { needsSync } = mergeDelta(data);
            if (needsSync) {
              syncSnapshot();
            }
            break;
          }
          case 'app_snapshot':
            updateSnapshot(data.snapshot);
            break;
          case 'event': {
            const rawEvent = data.event;
            if (rawEvent && rawEvent.type === 'output') {
              mergeDelta({
                type: 'app_delta',
                sessionId: sessionId!,
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
            setTimeout(syncSnapshot, 300);
            break;
          case 'error':
            console.error('WS Application Error:', data.error);
            break;
          case 'pubsub_event':
            // Cross-instance events bridged via Redis pub/sub.
            // Re-dispatch inner message to trigger snapshot sync.
            if (data.message?.type === 'execution_event' || data.message?.type === 'session_update') {
              syncSnapshot();
            }
            break;
        }
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    socket.onerror = (error) => {
      console.error('WS Error:', error);
    };

    socket.onclose = (event) => {
      console.log('WS Disconnected', event.code, event.reason);
      setWsConnected(false);
      ws.current = null;

      // Reconnect after delay if not a clean close
      if (event.code !== 1000 && event.code !== 1001) {
        setTimeout(() => {
          // Check if sessionId still exists before reconnecting
          if (sessionId || useSessionStore.getState().sessionId) {
            connect();
          }
        }, 3000);
      }
    };
  }, [sessionId, setWsConnected, mergeDelta, updateSnapshot, syncSnapshot, activeExecution?.executionId]);

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
      connect();
    }

    return () => {
      // Cleanup WebSocket on unmount
      if (ws.current) {
        ws.current.onclose = null; // Prevent reconnect
        ws.current.close();
        ws.current = null;
      }
    };
  }, [sessionId]); // Only reconnect when sessionId changes, not on every connect() change

  return null;
}
