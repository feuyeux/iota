import React from 'react';
import { 
  MessageSquare, 
  PlusCircle,
  Settings,
  Trash2,
  User
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useSessionStore } from '../../store/useSessionStore';
import { api } from '../../lib/api';
import { IotaLogo } from '../brand/IotaLogo';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatRelativeTime(ts?: number): string {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const Sidebar: React.FC<{
  onOpenOperations: () => void;
  onOpenReplay: (executionId: string) => void;
}> = ({ onOpenOperations, onOpenReplay }) => {
  const { conversations, activeExecution, sessionId } = useSessionStore();

  const handleDeleteSession = async () => {
    if (!sessionId) return;
    const confirmed = window.confirm(`Delete session ${sessionId}?`);
    if (!confirmed) return;
    await api.deleteSession(sessionId);
    window.location.search = '';
  };

  return (
    <aside className="w-64 flex flex-col h-full bg-white border-r border-iota-border">
      <div className="p-4 border-b border-iota-border">
        <IotaLogo showWordmark />
      </div>

      <div className="p-3">
         <button 
          onClick={() => window.location.search = ''}
          className="w-full flex items-center justify-center space-x-2 py-2 px-4 bg-iota-accent text-white rounded-xl text-xs font-bold hover:bg-iota-accent/90 transition-all shadow-md shadow-iota-accent/10"
         >
           <PlusCircle size={14} />
           <span>New Workspace</span>
         </button>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-6">
        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold text-iota-text/40 uppercase tracking-widest mb-2">Main</div>
          <NavItem icon={<MessageSquare size={16} />} label="Workspace" active />
          <NavItem icon={<Settings size={16} />} label="Operations" onClick={onOpenOperations} />
        </div>

        <div className="space-y-1">
          <div className="px-3 text-[10px] font-bold text-iota-text/40 uppercase tracking-widest mb-2">Recent Session</div>
          {conversations.length === 0 ? (
            <p className="px-3 text-[10px] text-iota-text/30 italic">No history yet</p>
          ) : (
            conversations.slice(0, 8).map((c, i) => (
              <SessionItem 
                key={c.executionId ? `exec-${c.executionId}` : `sess-${c.sessionId}-${i}`} 
                title={c.title || 'Untitled Session'} 
                active={c.executionId === activeExecution?.executionId}
                timestamp={c.updatedAt}
                onClick={() => window.location.search = `?session=${c.sessionId}${c.executionId ? `&execution=${c.executionId}` : ''}`}
                onReplay={c.executionId ? () => onOpenReplay(c.executionId as string) : undefined}
              />
            ))
          )}
        </div>
      </nav>

      <div className="p-3 border-t border-iota-border space-y-1">
         <NavItem icon={<Settings size={16} />} label="Settings" onClick={onOpenOperations} />
         <NavItem icon={<Trash2 size={16} />} label="Delete Session" onClick={() => void handleDeleteSession()} />
         <div className="p-3 flex items-center space-x-3 bg-gray-50 rounded-xl mt-2 border border-gray-100">
            <div className="w-8 h-8 rounded-full bg-iota-accent/10 flex items-center justify-center text-iota-accent">
               <User size={16} />
            </div>
            <div className="flex-1 min-w-0">
               <div className="text-[10px] font-bold text-iota-heading truncate">Developer</div>
               <div className="text-[8px] text-iota-text/50 truncate">iota-local-agent</div>
            </div>
         </div>
      </div>
    </aside>
  );
};

const NavItem: React.FC<{ icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }> = ({ icon, label, active, onClick }) => (
  <button onClick={onClick} className={cn(
    "flex items-center space-x-3 px-3 py-2 rounded-xl cursor-pointer transition-all duration-200 group",
    "w-full text-left",
    active 
      ? "bg-iota-accent/5 text-iota-accent border border-iota-accent/10" 
      : "text-iota-text/60 hover:bg-gray-50 hover:text-iota-heading"
  )}>
    <span className={active ? "text-iota-accent" : "text-iota-text/40 group-hover:text-iota-accent/60"}>
      {icon}
    </span>
    <span className="text-xs font-bold uppercase tracking-tight">{label}</span>
  </button>
);

const SessionItem: React.FC<{ title: string; active?: boolean; timestamp?: number; onClick: () => void; onReplay?: () => void }> = ({ title, active, timestamp, onClick, onReplay }) => (
  <div 
    onClick={onClick}
    className={cn(
      "px-3 py-2 rounded-xl cursor-pointer transition-all group relative overflow-hidden",
      active 
        ? "bg-white shadow-sm ring-1 ring-iota-border border-l-4 border-l-iota-accent" 
        : "hover:bg-gray-50 text-iota-text/60"
    )}
  >
    <div className={cn(
      "text-[11px] font-medium truncate",
      active ? "text-iota-heading font-bold" : "group-hover:text-iota-heading"
    )}>
      {title}
    </div>
    <div className="text-[8px] text-iota-text/30 uppercase mt-0.5 font-bold">{formatRelativeTime(timestamp)}</div>
    {onReplay && (
      <button
        onClick={(event) => {
          event.stopPropagation();
          onReplay();
        }}
        className="mt-2 text-[9px] font-bold uppercase text-iota-accent hover:underline"
      >
        Replay
      </button>
    )}
  </div>
);
