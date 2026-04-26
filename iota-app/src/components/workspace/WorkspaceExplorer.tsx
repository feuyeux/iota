import React, { useEffect, useState } from 'react';
import { useSessionStore } from '../../store/useSessionStore';
import { api } from '../../lib/api';
import { 
  FileCode, 
  X, 
  Pin, 
  PinOff, 
  FolderTree, 
  Plus, 
  Clock, 
  Zap,
  ChevronRight,
  ChevronDown,
  Save,
  Loader2,
  PencilLine
} from 'lucide-react';

export const WorkspaceExplorer: React.FC = () => {
  const { 
    sessionId, 
    activeFiles, 
    setActiveFiles, 
    upsertActiveFile,
    workingDirectory,
    sessionSnapshot
  } = useSessionStore();
  
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorState, setEditorState] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !selectedPath) return;
    let active = true;
    setEditorState('loading');
    setEditorError(null);
    api.readWorkspaceFile(sessionId, selectedPath)
      .then((file) => {
        if (!active) return;
        setEditorContent(file.content);
        setEditorState('idle');
      })
      .catch((error) => {
        if (!active) return;
        setEditorError((error as Error).message);
        setEditorState('idle');
      });
    return () => {
      active = false;
    };
  }, [sessionId, selectedPath]);

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
    if (selectedPath === path) {
      setSelectedPath(null);
      setEditorContent('');
    }
  };

  const handleOpenFile = async (path: string) => {
    setSelectedPath(path);
    upsertActiveFile({ path });
  };

  const handleSave = async () => {
    if (!sessionId || !selectedPath) return;
    setEditorState('saving');
    setEditorError(null);
    try {
      await api.writeWorkspaceFile(sessionId, selectedPath, editorContent);
      upsertActiveFile({ path: selectedPath });
      setEditorState('idle');
    } catch (error) {
      setEditorError((error as Error).message);
      setEditorState('idle');
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50/50 border-r border-iota-border w-64 overflow-hidden">
      <div className="p-4 border-b border-iota-border flex items-center justify-between bg-white">
        <div className="flex items-center space-x-2 text-iota-heading font-bold">
          <FolderTree size={16} className="text-iota-accent" />
          <span className="text-xs uppercase tracking-tight">Workspace</span>
        </div>
        <button className="p-1 hover:bg-gray-100 rounded text-iota-text/40 hover:text-iota-accent transition-colors">
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Workspace State */}
        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-iota-text/40 uppercase">Root Directory</div>
            <div className="text-[11px] font-mono text-iota-text/80 break-all bg-gray-100 p-2 rounded border border-gray-200">
              {workingDirectory || '/users/han/codingx/iota'}
            </div>
          </div>
          
          <div className="flex items-center justify-between text-[10px] text-iota-text/50">
            <div className="flex items-center space-x-1">
              <Clock size={10} />
              <span>Snapshot: {sessionSnapshot?.session.updatedAt ? new Date(sessionSnapshot.session.updatedAt).toLocaleTimeString() : 'Just now'}</span>
            </div>
          </div>
        </div>

        {/* Active Files Section */}
        <div className="border-t border-iota-border">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center px-4 py-2 hover:bg-gray-100 transition-colors group"
          >
            {isExpanded ? <ChevronDown size={12} className="mr-2" /> : <ChevronRight size={12} className="mr-2" />}
            <span className="text-[10px] font-bold text-iota-text/60 uppercase tracking-wider flex-1 text-left">Active Context ({activeFiles.length})</span>
            <Zap size={10} className="text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          
          {isExpanded && (
            <div className="px-2 pb-4 space-y-0.5">
              {activeFiles.length === 0 ? (
                <div className="px-4 py-6 text-center">
                   <p className="text-[10px] text-iota-text/30 italic">No files in current context. Files are automatically added when referenced.</p>
                </div>
              ) : (
                activeFiles.map(file => (
                  <div 
                    key={file.path} 
                    className={`flex items-center justify-between px-2 py-1.5 rounded-md group hover:bg-white hover:shadow-sm border transition-all ${selectedPath === file.path ? 'border-iota-accent bg-white shadow-sm' : 'border-transparent hover:border-iota-border'} ${file.pinned ? 'bg-iota-accent/5' : ''}`}
                  >
                    <button onClick={() => handleOpenFile(file.path)} className="flex items-center space-x-2 min-w-0 flex-1 text-left">
                       <FileCode size={12} className={file.pinned ? 'text-iota-accent' : 'text-iota-text/40'} />
                       <span className={`text-[11px] truncate font-mono ${file.pinned ? 'text-iota-accent font-semibold' : 'text-iota-text/80'}`}>
                        {file.path.split('/').pop()}
                       </span>
                    </button>
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleTogglePin(file.path)} 
                        className={`p-1 hover:bg-iota-accent/10 rounded transition-colors ${file.pinned ? 'text-iota-accent' : 'text-iota-text/30 hover:text-iota-accent'}`}
                      >
                        {file.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                      </button>
                      <button 
                        onClick={() => handleRemove(file.path)} 
                        className="p-1 hover:bg-red-50 rounded text-iota-text/30 hover:text-red-500 transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="border-t border-iota-border bg-white/70">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-iota-heading font-bold">
              <PencilLine size={14} className="text-iota-accent" />
              <span className="text-[10px] uppercase tracking-wider">Editor</span>
            </div>
            {selectedPath && (
              <button
                onClick={handleSave}
                disabled={editorState === 'saving' || editorState === 'loading'}
                className="inline-flex items-center space-x-1 rounded-md bg-iota-accent px-2 py-1 text-[10px] font-bold uppercase text-white disabled:opacity-50"
              >
                {editorState === 'saving' ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                <span>Save</span>
              </button>
            )}
          </div>
          <div className="px-4 pb-4 space-y-2">
            <div className="min-h-8 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-mono text-iota-text/70 break-all">
              {selectedPath ?? 'Select a file from Active Context to edit'}
            </div>
            {editorError && (
              <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-600">
                {editorError}
              </div>
            )}
            <textarea
              value={editorContent}
              onChange={(event) => setEditorContent(event.target.value)}
              disabled={!selectedPath || editorState === 'loading'}
              className="min-h-[240px] w-full resize-y rounded border border-iota-border bg-white px-3 py-2 font-mono text-[11px] text-iota-text outline-none focus:border-iota-accent disabled:bg-gray-50 disabled:text-iota-text/40"
              placeholder={selectedPath ? 'Loading file...' : 'No file selected'}
            />
          </div>
        </div>
      </div>

      {/* Budget Indicator */}
      <div className="p-4 border-t border-iota-border bg-white space-y-2">
         <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-bold uppercase text-iota-text/40">Context Budget</span>
            <span className="text-[10px] font-bold text-iota-accent">128k max</span>
         </div>
         <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
            <div className="h-full bg-iota-accent/80 w-[42%]" />
            <div className="h-full bg-amber-400/50 w-[15%]" />
         </div>
         <div className="flex justify-between text-[8px] font-bold text-iota-text/30 uppercase">
            <span>42% Persistent</span>
            <span>15% Ephemeral</span>
         </div>
      </div>
    </div>
  );
};
