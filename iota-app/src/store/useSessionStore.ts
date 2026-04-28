import { create } from 'zustand';
import type { 
  BackendName, 
  AppSessionSnapshot, 
  AppExecutionSnapshot, 
  AppDeltaEnvelope,
  ActiveFile,
  BackendStatusView,
  ConversationListItem
} from '../types';

interface SessionState {
  sessionId: string | null;
  activeBackend: BackendName;
  workingDirectory: string;
  backends: BackendStatusView[];
  activeFiles: ActiveFile[];
  conversations: ConversationListItem[];
  mcpServers: import('../types').McpServerDescriptor[];
  sessionSnapshot: AppSessionSnapshot | null;
  activeExecution: AppExecutionSnapshot | null;
  wsConnected: boolean;
  
  // Revision Tracking
  sessionRevision: number;
  
  // Actions
  setSessionId: (id: string) => void;
  setActiveBackend: (backend: BackendName) => void;
  setWsConnected: (connected: boolean) => void;
  updateSnapshot: (snapshot: AppSessionSnapshot) => void;
  mergeDelta: (envelope: AppDeltaEnvelope) => { needsSync: boolean };
  setActiveFiles: (files: ActiveFile[]) => void;
  setBackends: (backends: BackendStatusView[]) => void;
  upsertActiveFile: (file: ActiveFile) => void;
  
  // Messaging (Centralized)
  sendMessage: (message: unknown) => void;
  setSendMessage: (fn: (message: unknown) => void) => void;
}

const createInitialExecution = (executionId: string, backend: BackendName, sessionId: string): AppExecutionSnapshot => ({
  sessionId,
  executionId,
  backend,
  conversation: {
    items: [],
    state: 'running'
  },
  tracing: {
    live: true,
    steps: [],
    tabs: {
      overview: {},
      detail: {
        nativeEventCount: 0,
        runtimeEventCount: 0,
        parseErrorCount: 0,
        approvalCount: 0,
        mcpProxyCount: 0,
      },
      performance: { latencyMs: { p50: 0, p95: 0, p99: 0 } },
    }
  },
  memory: {
    tabs: { longTerm: [], session: [], knowledge: [] },
    hitCount: 0,
    selectedCount: 0,
    trimmedCount: 0,
  },
  tokens: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    confidence: 'estimated'
  },
  summary: {
    text: 'Starting...',
    createdAt: Date.now(),
    messageCount: 0
  }
});

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  activeBackend: 'claude-code',
  workingDirectory: '',
  backends: [],
  activeFiles: [],
  conversations: [],
  mcpServers: [],
  sessionSnapshot: null,
  activeExecution: null,
  wsConnected: false,
  
  sessionRevision: 0,

  setSessionId: (id) => set({ sessionId: id, sessionRevision: 0 }),
  setActiveBackend: (backend) => set({ activeBackend: backend }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
  
  updateSnapshot: (snapshot) => set((state) => ({
    sessionSnapshot: snapshot,
    activeBackend: state.activeBackend || snapshot.session.activeBackend || 'claude-code',
    workingDirectory: snapshot.session.workingDirectory,
    backends: snapshot.backends || [],
    activeFiles: snapshot.activeFiles || [],
    conversations: snapshot.conversations || [],
    mcpServers: snapshot.mcpServers || [],
    activeExecution: snapshot.activeExecution || null,
    sessionRevision: 0
  })),

  setActiveFiles: (files) => set({ activeFiles: files }),
  setBackends: (backends) => set({ backends }),
  upsertActiveFile: (file) => set((state) => {
    const existing = state.activeFiles.find((entry) => entry.path === file.path);
    if (existing) {
      return {
        activeFiles: state.activeFiles.map((entry) =>
          entry.path === file.path ? { ...entry, ...file } : entry,
        ),
      };
    }
    return { activeFiles: [...state.activeFiles, file] };
  }),

  sendMessage: () => { console.warn('WS not connected'); },
  setSendMessage: (fn) => set({ sendMessage: fn }),

  mergeDelta: (envelope) => {
    const { delta, revision, sessionId } = envelope;
    const state = get();

    if (sessionId !== state.sessionId) return { needsSync: false };

    if (revision !== undefined) {
      if (revision > state.sessionRevision + 1 && state.sessionRevision !== 0) {
        return { needsSync: true };
      }
      if (revision <= state.sessionRevision && state.sessionRevision !== 0) {
        return { needsSync: false };
      }
    }

    const executionId = delta.executionId;
    
    set((state) => {
      const nextState = { 
        ...state, 
        sessionRevision: revision !== undefined ? revision : state.sessionRevision 
      };
      
      let activeExec = state.activeExecution;

      if (!activeExec || activeExec.executionId !== executionId) {
        activeExec = createInitialExecution(executionId, state.activeBackend, sessionId);
      } else {
        activeExec = { ...activeExec };
      }

      switch (delta.type) {
        case 'conversation_delta': {
          const items = [...activeExec.conversation.items];
          const exists = items.some(i => i.id === delta.item.id || (i.eventSequence === delta.item.eventSequence && i.eventSequence !== -1 && i.eventSequence !== undefined));
          if (!exists) {
            items.push(delta.item);
          }
          activeExec.conversation = {
            ...activeExec.conversation,
            items
          };
          break;
        }
        case 'trace_step_delta': {
          const steps = [...activeExec.tracing.steps];
          const stepIndex = steps.findIndex(s => s.key === delta.step.key);
          if (stepIndex > -1) {
            steps[stepIndex] = { ...steps[stepIndex], ...delta.step };
          } else {
            steps.push(delta.step);
          }
          activeExec.tracing = { ...activeExec.tracing, steps };
          break;
        }
        case 'memory_delta': {
          const memory = { ...activeExec.memory };
          if (delta.memory.added) {
            for (const card of delta.memory.added) {
              if (card.source === 'dialogue') {
                if (!memory.tabs.session.some(c => c.id === card.id)) memory.tabs.session.push(card);
              } else if (card.source === 'redis') {
                if (!memory.tabs.knowledge.some(c => c.id === card.id)) memory.tabs.knowledge.push(card);
              } else {
                if (!memory.tabs.longTerm.some(c => c.id === card.id)) memory.tabs.longTerm.push(card);
              }
            }
          }
          if (delta.memory.removedIds) {
            const ids = new Set(delta.memory.removedIds);
            memory.tabs.session = memory.tabs.session.filter(c => !ids.has(c.id));
            memory.tabs.longTerm = memory.tabs.longTerm.filter(c => !ids.has(c.id));
            memory.tabs.knowledge = memory.tabs.knowledge.filter(c => !ids.has(c.id));
          }
          if (delta.memory.selectedCount !== undefined) memory.selectedCount = delta.memory.selectedCount;
          if (delta.memory.trimmedCount !== undefined) memory.trimmedCount = delta.memory.trimmedCount;
          activeExec.memory = memory;
          break;
        }
        case 'token_delta':
          activeExec.tokens = delta.tokens;
          break;
        case 'summary_delta':
          activeExec.summary = delta.summary;
          break;
      }

      return { ...nextState, activeExecution: activeExec };
    });

    return { needsSync: false };
  }
}));
