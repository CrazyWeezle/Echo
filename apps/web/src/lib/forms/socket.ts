import { socket } from '../socket';
import type { FormEvents } from './types';

type Handlers = {
  onState?: (p: FormEvents['state']) => void;
  onAnswer?: (p: FormEvents['answer']) => void;
  onCreate?: (p: FormEvents['questionCreate']) => void;
  onUpdate?: (p: FormEvents['questionUpdate']) => void;
  onDelete?: (p: FormEvents['questionDelete']) => void;
};

export function subscribeFormChannel(channelFqId: string, handlers: Handlers) {
  function isMatch(id: string) {
    return id === channelFqId;
  }
  const hState = (p: any) => { if (p?.channelId && isMatch(String(p.channelId))) handlers.onState?.(p); };
  const hAnswer = (p: any) => { if (p?.channelId && isMatch(String(p.channelId))) handlers.onAnswer?.(p); };
  const hCreate = (p: any) => { if (p?.channelId && isMatch(String(p.channelId))) handlers.onCreate?.(p); };
  const hUpdate = (p: any) => { if (p?.channelId && isMatch(String(p.channelId))) handlers.onUpdate?.(p); };
  const hDelete = (p: any) => { if (p?.channelId && isMatch(String(p.channelId))) handlers.onDelete?.(p); };

  socket.on('form:state', hState);
  socket.on('form:answer', hAnswer);
  socket.on('form:question:create', hCreate);
  socket.on('form:question:update', hUpdate);
  socket.on('form:question:delete', hDelete);

  return () => {
    socket.off('form:state', hState);
    socket.off('form:answer', hAnswer);
    socket.off('form:question:create', hCreate);
    socket.off('form:question:update', hUpdate);
    socket.off('form:question:delete', hDelete);
  };
}

