import { socket } from '../socket';
import type { HabitStatePayload } from './types';

type Handler = (payload: { channelId: string } & HabitStatePayload) => void;

export function subscribeHabitChannel(channelFqId: string, handler: Handler) {
  const match = (cid: string) => cid === channelFqId;
  const onState = (payload: any) => {
    if (!payload || typeof payload !== 'object') return;
    const cid = String(payload.channelId || '');
    if (!cid || !match(cid)) return;
    handler({
      channelId: cid,
      defs: Array.isArray(payload.defs) ? payload.defs : [],
      my: typeof payload.my === 'object' && payload.my ? payload.my : {},
      publicByHabit: typeof payload.publicByHabit === 'object' && payload.publicByHabit ? payload.publicByHabit : {},
      optedByHabit: typeof payload.optedByHabit === 'object' && payload.optedByHabit ? payload.optedByHabit : {},
      leaderboard: Array.isArray(payload.leaderboard) ? payload.leaderboard : [],
      participants: Array.isArray(payload.participants) ? payload.participants : [],
    });
  };
  socket.on('habit:state', onState);
  return () => {
    socket.off('habit:state', onState);
  };
}
