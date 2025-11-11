import { api } from '../api';
import type { HabitStatePayload } from './types';

function token() {
  try {
    return localStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

export async function getHabitState(channelFqId: string): Promise<HabitStatePayload> {
  const res = await api.getAuth(`/habits?channelId=${encodeURIComponent(channelFqId)}`, token());
  const safe = (res && typeof res === 'object') ? res : {};
  return {
    defs: Array.isArray(safe.defs) ? safe.defs : [],
    my: typeof safe.my === 'object' && safe.my ? safe.my as HabitStatePayload['my'] : {},
    publicByHabit: typeof safe.publicByHabit === 'object' && safe.publicByHabit ? safe.publicByHabit as HabitStatePayload['publicByHabit'] : {},
    optedByHabit: typeof safe.optedByHabit === 'object' && safe.optedByHabit ? safe.optedByHabit as HabitStatePayload['optedByHabit'] : {},
    leaderboard: Array.isArray(safe.leaderboard) ? safe.leaderboard : [],
    participants: Array.isArray(safe.participants) ? safe.participants : [],
  };
}

export async function createHabit(channelFqId: string, name: string): Promise<void> {
  await api.postAuth('/habits/defs', { channelId: channelFqId, channel_id: channelFqId, name }, token());
}

export async function renameHabit(habitId: string, name: string): Promise<void> {
  await api.patchAuth('/habits/defs', { habitId, habit_id: habitId, name }, token());
}

export async function deleteHabit(habitId: string): Promise<void> {
  await api.deleteAuth('/habits/defs', { habitId, habit_id: habitId }, token());
}

export async function optIntoHabit(habitId: string, isPublic: boolean): Promise<void> {
  await api.postAuth('/habits/opt', { habitId, habit_id: habitId, isPublic }, token());
}

export async function leaveHabit(habitId: string): Promise<void> {
  await api.deleteAuth('/habits/opt', { habitId, habit_id: habitId }, token());
}

export async function toggleHabitEntry(params: { trackerId?: string; habitId: string; day: string; done: boolean }): Promise<void> {
  const { trackerId, habitId, day, done } = params;
  await api.postAuth('/habits/entry', { trackerId, tracker_id: trackerId, defId: habitId, habitId, day, done }, token());
}
