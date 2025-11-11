import { useEffect, useMemo, useState } from 'react';
import { useHabitChannel } from '../../hooks/useHabitChannel';
import type { HabitUserProgress } from '../../lib/habits/types';
import { askConfirm, toast } from '../../lib/ui';

type Member = { id: string; name?: string; username?: string };
type AskInputFn = (cfg: { title?: string; label?: string; placeholder?: string; initialValue?: string; textarea?: boolean; okText?: string }) => Promise<string | null>;

function loadRange(fid: string) {
  try {
    const raw = localStorage.getItem(`habitRange:${fid}`);
    const n = raw ? Number(raw) : 14;
    return n === 7 || n === 14 || n === 30 ? n : 14;
  } catch {
    return 14;
  }
}

const fallbackAskInput: AskInputFn = async (cfg) => {
  const res = window.prompt(cfg?.label || cfg?.title || 'Input', cfg?.initialValue || '');
  return res == null ? null : res;
};

export default function HabitChannelView({ fid, members, meId, askInput = fallbackAskInput }: { fid: string; members: Member[]; meId?: string | null; askInput?: AskInputFn }) {
  const { data, actions } = useHabitChannel(fid);
  const [range, setRange] = useState(() => loadRange(fid));
  const [newHabit, setNewHabit] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setRange(loadRange(fid));
    setNewHabit('');
  }, [fid]);

  const daysAsc = useMemo(() => {
    const today = new Date();
    const out: string[] = [];
    for (let i = (range || 14) - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${dd}`);
    }
    return out;
  }, [range]);
  const days = useMemo(() => [...daysAsc].reverse(), [daysAsc]);
  const todayKey = days[0] || null;

  const totalsToday = useMemo(() => {
    if (!todayKey) return 0;
    let count = 0;
    for (const habitId of Object.keys(data.my || {})) {
      if (data.my[habitId]?.days?.includes(todayKey)) count++;
    }
    return count;
  }, [data.my, todayKey]);

  const teamProgress = useMemo(() => {
    const map: Record<string, HabitUserProgress[]> = {};
    for (const def of data.defs) {
      map[def.id] = data.publicByHabit[def.id] || [];
    }
    return map;
  }, [data.defs, data.publicByHabit]);

  const handleCreate = async () => {
    const name = newHabit.trim();
    if (!name) return;
    setCreating(true);
    try {
      await actions.create(name);
      setNewHabit('');
    } catch (e: any) {
      toast(e?.message || 'Failed to add habit', 'error');
    } finally {
      setCreating(false);
    }
  };

  const fmtLabel = (day: string) => day.slice(5);
  const fmtFriendly = (day: string) => {
    const d = new Date(`${day}T00:00:00Z`);
    return isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const roster = useMemo(() => {
    if (Array.isArray(data.participants) && data.participants.length > 0) return data.participants;
    return members.map((m) => ({ userId: m.id, name: m.name || m.username || 'Member' }));
  }, [data.participants, members]);

  const stats = [
    { label: 'Habits', value: data.defs.length },
    { label: 'Completed today', value: totalsToday },
    { label: 'Public teammates', value: Object.values(teamProgress).reduce((sum, arr) => sum + arr.length, 0) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-neutral-800 bg-neutral-950/70 px-4 py-3 shadow-inner shadow-black/30">
            <div className="text-xs uppercase tracking-wide text-neutral-500">{s.label}</div>
            <div className="text-2xl font-semibold text-neutral-50">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-inner shadow-black/40 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-100">Add a habit</h3>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-50 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            placeholder="Daily walk, stretch, drink water..."
            value={newHabit}
            onChange={(e) => setNewHabit(e.target.value)}
          />
          <button
            className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
            disabled={!newHabit.trim() || creating}
            onClick={handleCreate}
          >
            {creating ? 'Adding…' : 'Add Habit'}
          </button>
        </div>
      </div>

      {todayKey && (
        <div className="rounded-2xl border border-emerald-900/40 bg-neutral-950/70 p-4 shadow-inner shadow-emerald-900/20">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-neutral-400">Today</div>
              <div className="text-lg font-semibold text-neutral-50">{fmtFriendly(todayKey)}</div>
            </div>
            <select
              className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200"
              value={range}
              onChange={(e) => {
                const val = Number(e.target.value);
                const next = val === 7 || val === 14 || val === 30 ? val : 14;
                setRange(next);
                try { localStorage.setItem(`habitRange:${fid}`, String(next)); } catch {}
              }}
            >
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.defs.length === 0 && <span className="text-neutral-500 text-sm">No habits yet</span>}
      {data.defs.map((def) => {
        const mine = data.my[def.id];
        const opted = !!mine;
        const done = opted && mine.days?.includes(todayKey);
        return (
          <button
            key={`today-${def.id}`}
            className={`px-3 py-2 rounded-xl border text-sm transition ${done ? 'border-emerald-500 bg-emerald-500/15 text-emerald-100' : 'border-neutral-800 bg-neutral-900/70 text-neutral-200'} ${!opted ? 'opacity-70 border-dashed' : 'hover:border-emerald-500/70'}`}
            onClick={() => actions.toggleDay(def.id, todayKey, !done)}
          >
            {done ? '✓ ' : ''}{def.name}
          </button>
        );
      })}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-neutral-100">History</div>
          <div className="text-xs text-neutral-500">Last {range} days</div>
        </div>

        <div className="mt-4 overflow-auto">
          <table className="min-w-[640px] w-full text-sm border-separate border-spacing-y-1">
            <thead>
              <tr>
                <th className="text-left text-neutral-300 px-2">Habit</th>
                {days.map((d, idx) => (
                  <th key={d} className={`text-[11px] px-2 text-center ${idx === 0 ? 'text-emerald-300' : 'text-neutral-400'}`}>{fmtLabel(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.defs.map((def) => {
                const mine = data.my[def.id];
                const opted = !!mine;
                const joinedCount = data.optedByHabit?.[def.id]?.length || 0;
                const totalMembers = roster.length;
                return (
                  <tr key={def.id} className="bg-neutral-900/40">
                    <td className="px-2 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-neutral-50">{def.name}</span>
                          <button
                            className="text-xs text-neutral-400 hover:text-neutral-100"
                            onClick={async () => {
                              const next = await askInput({ title: 'Rename Habit', label: 'Name', placeholder: def.name, initialValue: def.name });
                              if (!next || next === def.name) return;
                              try { await actions.rename(def.id, next); } catch (e: any) { toast(e?.message || 'Failed to rename', 'error'); }
                            }}
                          >
                            ✎
                          </button>
                          <button
                            className="text-xs text-red-400 hover:text-red-200"
                            onClick={async () => {
                              const ok = await askConfirm({ title: 'Delete Habit', message: `Remove "${def.name}" for everyone?`, confirmText: 'Delete' });
                              if (!ok) return;
                              try { await actions.remove(def.id); } catch (e: any) { toast(e?.message || 'Failed to delete', 'error'); }
                            }}
                          >
                            ✕
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={opted}
                              onChange={async (e) => {
                                try { await actions.toggleOpt(def.id, e.target.checked, mine?.public ?? true); }
                                catch (err: any) { toast(err?.message || 'Failed to update', 'error'); }
                              }}
                            />
                            Participate
                          </label>
                          {opted && (
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={mine?.public ?? true}
                                onChange={async (e) => {
                                  try { await actions.setPublic(def.id, e.target.checked); }
                                  catch (err: any) { toast(err?.message || 'Failed to update', 'error'); }
                                }}
                              />
                              Share with team
                            </label>
                          )}
                          <span className="text-neutral-500">
                            {joinedCount}/{totalMembers || '—'} joined · {teamProgress[def.id]?.length || 0} sharing
                          </span>
                        </div>
                      </div>
                    </td>
                    {days.map((day, idx) => {
                      const done = !!mine?.days?.includes(day);
                      return (
                        <td key={day} className={`px-2 py-1 text-center ${idx === 0 ? 'bg-emerald-500/5' : ''}`}>
                          <input
                            type="checkbox"
                            className="accent-emerald-500"
                            checked={done}
                            onChange={async (e) => {
                              try { await actions.toggleDay(def.id, day, e.target.checked); }
                              catch (err: any) { toast(err?.message || 'Failed to update', 'error'); }
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.defs.length === 0 && (
            <div className="py-6 text-center text-neutral-500 text-sm">No habits yet. Create one to get started.</div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 space-y-3">
        <div className="text-sm font-semibold text-neutral-100">Team check-ins (last 7 days)</div>
        {Object.entries(teamProgress).every(([, arr]) => arr.length === 0) ? (
          <div className="text-neutral-500 text-sm">No public updates yet.</div>
        ) : (
          <div className="space-y-3">
            {data.defs.map((def) => (
              <div key={def.id}>
                <div className="text-xs uppercase tracking-wide text-neutral-400 mb-1">{def.name}</div>
                <div className="flex flex-wrap gap-2">
                  {(teamProgress[def.id] || []).map((entry) => {
                    const highlight = meId && entry.userId === meId;
                    return (
                      <span
                        key={`${def.id}:${entry.userId}`}
                        className={`rounded-full px-3 py-1 text-xs ${highlight ? 'border-emerald-600 bg-emerald-500/10 text-emerald-100' : 'border border-neutral-800 bg-neutral-900/70 text-neutral-200'}`}
                      >
                        {entry.name || 'Member'} · {entry.days.length} days
                      </span>
                    );
                  })}
                  {(teamProgress[def.id] || []).length === 0 && (
                    <span className="text-neutral-500 text-xs">No shared data</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4">
        <div className="text-sm font-semibold text-neutral-100 mb-2">Leaders (public activity)</div>
        <div className="flex flex-wrap gap-2 text-sm">
          {(data.leaderboard || []).map((entry, index) => (
            <span key={entry.userId} className="px-3 py-1 rounded border border-emerald-700/40 bg-emerald-500/10 text-emerald-100">
              {index + 1}. {entry.name || 'Member'} · {entry.count}
            </span>
          ))}
          {(data.leaderboard || []).length === 0 && (
            <span className="text-neutral-500 text-sm">No leaderboard data yet</span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
        <div className="text-sm font-semibold text-neutral-100 mb-2">Participants</div>
        <div className="flex flex-wrap gap-2 text-xs text-neutral-300">
          {roster.length === 0
            ? <span className="text-neutral-500">No members yet</span>
            : roster.map((p) => {
                const highlight = meId && p.userId === meId;
                return (
                  <span
                    key={p.userId}
                    className={`px-3 py-1 rounded-full ${highlight ? 'border-emerald-600 bg-emerald-500/10 text-emerald-100' : 'border border-neutral-800 bg-neutral-900/70'}`}
                  >
                    {p.name || 'Member'}
                  </span>
                );
              })}
        </div>
      </div>
    </div>
  );
}
