import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createHabit, deleteHabit, getHabitState, leaveHabit, optIntoHabit, renameHabit, toggleHabitEntry } from '../lib/habits/api';
import { subscribeHabitChannel } from '../lib/habits/socket';
import type { HabitStatePayload } from '../lib/habits/types';

const EMPTY_STATE: HabitStatePayload = {
  defs: [],
  my: {},
  publicByHabit: {},
  optedByHabit: {},
  leaderboard: [],
  participants: [],
};

export function useHabitChannel(fid: string) {
  const [data, setData] = useState<HabitStatePayload>(EMPTY_STATE);
  const loadingRef = useRef(false);

  const load = useCallback(async (): Promise<HabitStatePayload | undefined> => {
    if (!fid) return undefined;
    loadingRef.current = true;
    try {
      const snapshot = await getHabitState(fid);
      setData(snapshot);
      return snapshot;
    } finally {
      loadingRef.current = false;
    }
  }, [fid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!fid) return;
    const unsub = subscribeHabitChannel(fid, (payload) => {
      setData({
        defs: payload.defs,
        my: payload.my,
        publicByHabit: payload.publicByHabit,
        optedByHabit: payload.optedByHabit,
        leaderboard: payload.leaderboard,
        participants: payload.participants,
      });
    });
    return () => unsub();
  }, [fid]);

  const ensureJoined = useCallback(async (habitId: string) => {
    if (data.my[habitId]) return data.my[habitId];
    try {
      await optIntoHabit(habitId, true);
    } catch {}
    const refreshed = await load();
    return refreshed?.my[habitId] || data.my[habitId];
  }, [data.my, load]);

  const actions = useMemo(() => ({
    async create(prompt: string) {
      if (!prompt.trim()) return;
      await createHabit(fid, prompt.trim());
      await load();
    },
    async rename(habitId: string, name: string) {
      if (!name.trim()) return;
      await renameHabit(habitId, name.trim());
      await load();
    },
    async remove(habitId: string) {
      await deleteHabit(habitId);
      await load();
    },
    async toggleOpt(habitId: string, join: boolean, isPublic: boolean) {
      if (join) await optIntoHabit(habitId, isPublic);
      else await leaveHabit(habitId);
      await load();
    },
    async setPublic(habitId: string, isPublic: boolean) {
      await optIntoHabit(habitId, isPublic);
      await load();
    },
    async toggleDay(habitId: string, day: string, done: boolean) {
      const joined = await ensureJoined(habitId);
      const trackerId = joined?.trackerId;
      await toggleHabitEntry({ trackerId, habitId, day, done });
      setData((prev) => {
        const next = { ...prev };
        const mine = { ...(next.my || {}) };
        const current = {
          trackerId: trackerId || mine[habitId]?.trackerId,
          public: mine[habitId]?.public ?? true,
          days: [...(mine[habitId]?.days || [])],
        };
        const idx = current.days.indexOf(day);
        if (done && idx === -1) current.days.push(day);
        if (!done && idx !== -1) current.days.splice(idx, 1);
        mine[habitId] = current;
        next.my = mine;
        return next;
      });
      await load();
    },
  }), [fid, ensureJoined, load]);

  return { data, actions };
}
