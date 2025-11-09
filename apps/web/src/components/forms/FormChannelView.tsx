import React, { useMemo, useState } from 'react';
import { useFormChannel } from '../../hooks/useFormChannel';
import { askConfirm, toast } from '../../lib/ui';

export default function FormChannelView({ fid, members, meId }: { fid: string; members: { id: string; name?: string; username?: string }[]; meId?: string | null }) {
  const { data, mySubmitted, allSubmitted, actions } = useFormChannel(fid, members, meId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="min-h-full">
      <div className="mb-3 flex items-center gap-2">
        <button
          className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60"
          onClick={async () => {
            const prompt = window.prompt('Question prompt') || '';
            if (!prompt) return;
            const lock = await askConfirm({ title: 'Lock Answers', message: 'Hide others’ answers until everyone submits?', confirmText: 'Enable Lock', cancelText: 'No' });
            try { await actions.create(prompt, !!lock); } catch (e: any) { toast(e?.message || 'Failed to add question', 'error'); }
          }}
        >
          + Add Question
        </button>
      </div>

      <div className="space-y-3">
        {data.questions.map(q => {
          const everyoneDone = allSubmitted(q.id);
          return (
            <div key={q.id} className="p-2 rounded border border-neutral-800 bg-neutral-900/50">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-neutral-200 mb-2 flex items-center gap-2">
                    <span>{q.prompt}</span>
                    {q.locked ? <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-700 text-amber-300">Locked</span> : null}
                  </div>
                  <div className="space-y-1">
                    {members.map(m => {
                      const isMe = meId && m.id === meId;
                      const val = isMe ? (data.myAnswers[q.id] ?? '') : (data.answersByUser?.[m.id]?.[q.id] ?? '');
                      return (
                        <div key={m.id} className="flex items-center gap-2">
                          <div className="w-28 shrink-0 truncate text-xs text-neutral-400">{isMe ? 'You' : (m.name || m.username)}</div>
                          {isMe ? (
                            <input
                              className="flex-1 p-2 rounded bg-neutral-950 text-neutral-100 border border-neutral-800"
                              value={drafts[q.id] ?? val}
                              onChange={(e)=>{ const v=e.target.value; setDrafts(prev=>({ ...prev, [q.id]: v })); }}
                              onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); const v=(e.currentTarget as HTMLInputElement).value; actions.submit(q.id, v).then(()=>{ setDrafts(prev=>{ const { [q.id]:_, ...rest } = prev; return rest; }); }).catch(()=>{}); (e.currentTarget as HTMLInputElement).blur(); } }}
                              placeholder="Your answer"
                            />
                          ) : (
                            <div className="flex-1 p-2 rounded bg-neutral-950/40 text-neutral-200 border border-neutral-800/50 min-h-[36px]">
                              {(q.locked && !everyoneDone) ? (
                                val ? <span className="text-neutral-500">Submitted (hidden until everyone submits)</span> : <span className="text-neutral-500">Hidden until everyone submits</span>
                              ) : (
                                val || <span className="text-neutral-500">No answer yet</span>
                              )}
                            </div>
                          )}
                          <div className="w-5 text-right">
                            {isMe ? (
                              mySubmitted[q.id] ? (<span title="Submitted" aria-label="Submitted" className="text-emerald-400">✓</span>) : null
                            ) : (
                              String(val||'').trim() ? <span title="Answer ready" aria-label="Answer ready" className="text-emerald-400">✓</span> : null
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button className="text-xs text-neutral-400 hover:text-neutral-200" title="Rename" onClick={async()=>{
                    const nv = window.prompt('Edit question', q.prompt) || '';
                    if (!nv || nv === q.prompt) return;
                    try { await actions.rename(q.id, nv); } catch (e: any) { toast(e?.message || 'Failed to rename', 'error'); }
                  }}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                  </button>
                  <button className="text-xs text-neutral-400 hover:text-neutral-200" title={q.locked ? 'Unlock' : 'Lock'} onClick={async()=>{
                    try { await actions.setLocked(q.id, !q.locked); } catch (e: any) { toast(e?.message || 'Failed to toggle lock', 'error'); }
                  }}>
                    {q.locked ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9 1"/></svg>
                    )}
                  </button>
                  <button className="text-xs text-red-400 hover:text-red-300" title="Delete" onClick={async()=>{
                    const ok = await askConfirm({ title:'Delete Question', message:'Delete this question?', confirmText:'Delete' }); if (!ok) return;
                    try { await actions.remove(q.id); } catch (e: any) { toast(e?.message || 'Failed to delete', 'error'); }
                  }}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {data.questions.length === 0 && (
          <div className="text-neutral-500 text-sm">No questions yet</div>
        )}
      </div>
    </div>
  );
}
