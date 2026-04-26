import React, { useEffect, useMemo, useState } from 'react';
import { Clock3, PlaySquare, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { ExecutionReplayView } from '../../types';

interface ExecutionReplayModalProps {
  executionId: string | null;
  onClose: () => void;
}

export const ExecutionReplayModal: React.FC<ExecutionReplayModalProps> = ({ executionId, onClose }) => {
  const [replay, setReplay] = useState<ExecutionReplayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!executionId) return;
    let active = true;
    setLoading(true);
    setError(null);
    api.getExecutionReplay(executionId)
      .then((data) => {
        if (!active) return;
        setReplay(data);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [executionId]);

  const duration = useMemo(() => {
    if (!replay) return null;
    const end = replay.finishedAt ?? Date.now();
    return Math.max(end - replay.startedAt, 0);
  }, [replay]);

  if (!executionId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-iota-border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-iota-border px-6 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-iota-text/45">Execution Replay</div>
            <h3 className="text-lg font-semibold text-iota-heading">{executionId}</h3>
          </div>
          <button onClick={onClose} className="rounded-xl border border-iota-border p-2 text-iota-text/55 hover:text-iota-heading">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-iota-text/55">Loading replay…</div>
        ) : error ? (
          <div className="m-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        ) : replay ? (
          <>
            <div className="grid gap-4 border-b border-iota-border bg-stone-50/70 px-6 py-4 md:grid-cols-4">
              <ReplayStat label="Status" value={replay.status} />
              <ReplayStat label="Backend" value={replay.backend} />
              <ReplayStat label="Events" value={String(replay.events.length)} />
              <ReplayStat label="Duration" value={duration !== null ? `${duration}ms` : 'n/a'} />
            </div>

            {replay.prompt && (
              <div className="border-b border-iota-border px-6 py-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-iota-text/45">
                  <PlaySquare size={12} />
                  Prompt
                </div>
                <div className="max-h-24 overflow-y-auto rounded-2xl bg-stone-50 p-3 text-sm text-iota-text/80">{replay.prompt}</div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
              <div className="space-y-4">
                {replay.events.length === 0 ? (
                  <div className="py-12 text-center text-sm text-iota-text/45">No replay events available.</div>
                ) : (
                  replay.events.map((event) => (
                    <div key={event.id} className="rounded-2xl border border-iota-border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-iota-accent">{event.role}</div>
                        <div className="flex items-center gap-1 text-[10px] text-iota-text/45">
                          <Clock3 size={11} />
                          {new Date(event.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm text-iota-text/80">{event.content}</div>
                      {event.metadata && Object.keys(event.metadata).length > 0 && (
                        <pre className="mt-3 overflow-x-auto rounded-xl bg-stone-50 p-3 text-[10px] text-iota-text/75">{JSON.stringify(event.metadata, null, 2)}</pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

const ReplayStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl border border-iota-border bg-white px-4 py-3">
    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-iota-text/45">{label}</div>
    <div className="mt-2 text-sm font-semibold text-iota-heading">{value}</div>
  </div>
);
