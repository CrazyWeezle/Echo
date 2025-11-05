// apps/web/src/App.tsx
import { useEffect, useRef, useState, Suspense, lazy } from "react";
import Login from "./pages/Login"; // match actual filename case for Linux builds
import { socket, connectSocket, disconnectSocket, getLocalUser, setLocalUser } from "./lib/socket";
import { debounce } from "./lib/debounce";
import { signUpload, api } from "./lib/api";
import { initPush } from "./lib/push";
import { registerWebPush } from "./lib/webpush";
import FriendsModal from "./components/FriendsModal";
import MemberProfileModal from "./components/MemberProfileModal";
import InputModal from "./components/InputModal";
const GifPicker = lazy(() => import("./components/GifPicker"));
const EmojiPanel = lazy(() => import("./components/EmojiPanel"));
import UnifiedSettingsModal from "./components/UnifiedSettingsModal";
import ToastHost from "./components/ToastHost";
import ConfirmHost from "./components/ConfirmHost";
import { askConfirm, toast } from "./lib/ui";

type Msg = {
  id: string;
  content: string;
  optimistic?: boolean;
  createdAt?: string;
  updatedAt?: string | null;
  authorId?: string;
  authorName?: string;
  authorColor?: string | null;
  reactions?: Record<string, { count: number; mine?: boolean }>;
  attachments?: { url: string; contentType?: string; name?: string; size?: number }[];
  spoiler?: boolean;
  seenBy?: string[]; // display names (legacy)
  seenByIds?: string[]; // user ids for avatars
  replyTo?: { id: string; authorId?: string; authorName?: string; authorColor?: string | null; content?: string } | null;
};
type KanbanItem = { id: string; content: string; pos: number; done?: boolean };
type KanbanList = { id: string; name: string; pos: number; items: KanbanItem[] };
type FormQuestion = { id: string; prompt: string; kind?: string; pos: number };
type FormState = { questions: FormQuestion[]; answers: Record<string, string>; answersByUser?: Record<string, Record<string, string>> };
type Channel = { id: string; name: string; voidId: string; type?: 'text' | 'voice' | 'announcement' | 'kanban' | 'form' | 'habit' | 'gallery' | string; linkedGalleryId?: string | null };
type VoidWS = { id: string; name: string; avatarUrl?: string | null };

// --- Gate component: no conditional hooks here, only simple state ---
export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [user, setUser]   = useState<any>(() => {
    try { const raw = localStorage.getItem("user"); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });

  const handleAuth = (t: string, u: any) => {
    localStorage.setItem("token", t);
    localStorage.setItem("user", JSON.stringify(u));
    setToken(t);
    setUser(u);
  };

  return token ? <ChatApp token={token} user={user} /> : <Login onAuth={handleAuth} />;
}

// --- Authenticated app: all your previous logic lives here unconditionally ---
function ChatApp({ token, user }: { token: string; user: any }) {
  const [status, setStatus] = useState<"connecting" | "connected" | "error" | "disconnected">("connecting");

  // identity
  const [me, setMe] = useState<{ userId?: string; name?: string; avatarUrl?: string | null }>(() => getLocalUser());
  const [askName, setAskName] = useState(false);
  const [tempName, setTempName] = useState(me.name || "");

  // Register for push notifications in Capacitor environments (no-op on web)
  useEffect(() => {
    if (!token) return;
    initPush(token).catch(() => {});
    // Register Web Push (PWA) on supported Android browsers
    registerWebPush(token).catch(() => {});
  }, [token]);

  // Optional: handle postMessage from SW to open channels (basic example)
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      try {
        if (e.data && e.data.type === 'OPEN_CHANNEL' && e.data.data?.channelId) {
          const rid = String(e.data.data.channelId);
          const [voidId, short] = rid.split(':');
          if (voidId && short) { setCurrentVoidId(voidId); setCurrentChannelId(short); }
        }
      } catch {}
    }
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', onMsg as any);
    return () => { if (navigator.serviceWorker) navigator.serviceWorker.removeEventListener('message', onMsg as any); };
  }, []);

  // Voids / Channels
  const [voids, setVoids] = useState<VoidWS[]>([]);
  const [currentVoidId, setCurrentVoidId] = useState<string>(() => {
    try {
      const v = localStorage.getItem('currentVoidId') || "";
      // Avoid auto-opening a DM space on fresh load/login
      return String(v).startsWith('dm_') ? "" : v;
    } catch { return ""; }
  });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [currentChannelId, setCurrentChannelId] = useState<string>(() => {
    try { return localStorage.getItem('currentChannelId') || "general"; } catch { return "general"; }
  });
  // Track current void id in a ref to avoid race in socket handlers
  const currentVoidIdRef = useRef<string>(currentVoidId);
  useEffect(() => { currentVoidIdRef.current = currentVoidId; }, [currentVoidId]);
  // One-shot guard so we only auto-redirect away from DMs on first load
  const initialSpaceSetRef = useRef<boolean>(false);

  // Messages
  const [msgsByKey, setMsgsByKey] = useState<Record<string, Msg[]>>({ ["home:general"]: [] });
  const listRef = useRef<HTMLDivElement>(null);
  const k = (vId: string, cId: string) => (cId.includes(':') ? cId : `${vId}:${cId}`);
  const fq = (vId: string, cId: string) => (cId.includes(':') ? cId : `${vId}:${cId}`);
  const msgs = msgsByKey[k(currentVoidId, currentChannelId)] ?? [];

  // typing + presence
  const [typers, setTypers] = useState<Record<string, string>>({});
  const typingTimers = useRef(new Map<string, number>());
  const lastTypingTextRef = useRef<string>('');
  const [roomUserIds, setRoomUserIds] = useState<string[]>([]);
  const [spaceUserIds, setSpaceUserIds] = useState<string[]>([]);
  const [globalUserIds, setGlobalUserIds] = useState<string[]>([]);
  // Habit UI preferences (range per channel)
  const [habitRangeByChan, setHabitRangeByChan] = useState<Record<string, number>>(() => {
    try { const raw = localStorage.getItem('habitRangeByChan'); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem('habitRangeByChan', JSON.stringify(habitRangeByChan)); } catch {} }, [habitRangeByChan]);
  const [roomMobileIds, setRoomMobileIds] = useState<string[]>([]);
  const [spaceMobileIds, setSpaceMobileIds] = useState<string[]>([]);
  const [globalMobileIds, setGlobalMobileIds] = useState<string[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string; username?: string; avatarUrl?: string | null; status?: string; nameColor?: string | null; role?: string }[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  // Throttle notifications: one per channel until user visits it.
  // Persist across reloads so you don't get spam after refresh.
  const [notified, setNotified] = useState<Record<string, boolean>>(() => {
    try { const raw = localStorage.getItem('notifiedChannels'); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem('notifiedChannels', JSON.stringify(notified)); } catch {} }, [notified]);
  const notifiedRef = useRef<Record<string, boolean>>({});
  useEffect(() => { notifiedRef.current = notified; }, [notified]);
  // Reaction hover details cache: messageId -> emoji -> items
  const [reactionInfoByMsg, setReactionInfoByMsg] = useState<Record<string, Record<string, { users: { userId: string; name: string; createdAt?: string }[] }>>>({});
  const [hoverReaction, setHoverReaction] = useState<{ messageId: string; emoji: string } | null>(null);

  async function loadReactionsFor(messageId: string) {
    if (reactionInfoByMsg[messageId]) return;
    try {
      const tok = localStorage.getItem('token') || '';
      const res = await api.getAuth(`/messages/reactions?messageId=${encodeURIComponent(messageId)}`, tok);
      const map: Record<string, { users: { userId: string; name: string; createdAt?: string }[] }> = {};
      for (const [emoji, list] of Object.entries(res?.reactions || {})) {
        map[emoji] = { users: (list as any[]).map(it => ({ userId: String((it as any).userId || ''), name: String((it as any).name || 'User'), createdAt: (it as any).createdAt })) };
      }
      setReactionInfoByMsg(prev => ({ ...prev, [messageId]: map }));
    } catch {}
  }

  function timeAgo(ts?: string) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const s = Math.floor((Date.now() - d.getTime()) / 1000);
      if (s < 60) return `${s}s ago`;
      const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
      const dd = Math.floor(h / 24); if (dd < 7) return `${dd}d ago`;
      return d.toLocaleString();
    } catch { return ''; }
  }

  // sheets (mobile)
  const [voidSheetOpen, setVoidSheetOpen] = useState(false);
  const [chanSheetOpen, setChanSheetOpen] = useState(false);
  const [usersSheetOpen, setUsersSheetOpen] = useState(false);
  // Mobile swipe gesture state (interactive drawers)
  const [swipePanel, setSwipePanel] = useState<null | 'chan' | 'users'>(null);
  const [swipeMode, setSwipeMode] = useState<null | 'open' | 'close'>(null);
  const [swipeProgress, setSwipeProgress] = useState(0); // 0..1
  const swipeProgRef = useRef(0);
  const swipePanelRef = useRef<null | 'chan' | 'users'>(null);
  const swipeModeRef = useRef<null | 'open' | 'close'>(null);
  const chanOpenRef = useRef(false);
  const usersOpenRef = useRef(false);
  useEffect(() => { chanOpenRef.current = chanSheetOpen; }, [chanSheetOpen]);
  useEffect(() => { usersOpenRef.current = usersSheetOpen; }, [usersSheetOpen]);
  // Reorder state persisted locally
  const [spaceOrder, setSpaceOrder] = useState<string[]>(() => {
    try { const s = localStorage.getItem('spaceOrder'); return s ? JSON.parse(s) : []; } catch { return []; }
  });

  // People column visible on all pages except landing (no current space)
  const showPeople = !!currentVoidId;

  // --- Mobile gestures: swipe anywhere to open drawers ---
  useEffect(() => {
    const el = document;
    // Detect browser support for passive event listeners and prepare options objects safely
    let supportsPassive = false;
    try {
      const opts = Object.defineProperty({}, 'passive', { get() { supportsPassive = true; return false; } });
      window.addEventListener('test-passive', () => {}, opts);
      window.removeEventListener('test-passive', () => {}, opts as any);
    } catch {}
    const optPassiveTrue = supportsPassive ? { passive: true } as any : false as any;
    const optPassiveFalse = supportsPassive ? { passive: false } as any : false as any;
    let startX = 0, startY = 0, active = false, decided = false;
    const thresh = 60; // min dx to commit open/close
    const drawerW = Math.min(window.innerWidth * 0.8, 360); // px
    function onStart(e: TouchEvent) {
      if (!currentVoidId) return; // nothing when no space selected
      const t = e.touches[0]; if (!t) return;
      startX = t.clientX; startY = t.clientY; active = true; decided = false;
      setSwipePanel(null); setSwipeMode(null); setSwipeProgress(0);
      swipePanelRef.current = null; swipeModeRef.current = null; swipeProgRef.current = 0;
    }
    function onMove(e: TouchEvent) {
      if (!active) return;
      const t = e.touches[0]; if (!t) return;
      const dx = t.clientX - startX; const dy = t.clientY - startY;
      if (!decided) {
        if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy)) {
          decided = true;
          const chanOpen = chanOpenRef.current;
          const usersOpen = usersOpenRef.current;
          // If a drawer is open, prefer closing gesture (standard: left closes channels, right closes users)
          if (chanOpen && dx < 0) {
            setSwipePanel('chan'); swipePanelRef.current = 'chan';
            setSwipeMode('close'); swipeModeRef.current = 'close';
          } else if (usersOpen && dx > 0) {
            setSwipePanel('users'); swipePanelRef.current = 'users';
            setSwipeMode('close'); swipeModeRef.current = 'close';
          } else if (!chanOpen && !usersOpen) {
            // Decide panel based on initial direction (opening)
            if (dx > 0) {
              setSwipePanel('chan'); swipePanelRef.current = 'chan';
              setSwipeMode('open'); swipeModeRef.current = 'open';
              setUsersSheetOpen(false);
            } else if (dx < 0 && showPeople) {
              setSwipePanel('users'); swipePanelRef.current = 'users';
              setSwipeMode('open'); swipeModeRef.current = 'open';
              setChanSheetOpen(false);
            } else {
              decided = false; active = false; return;
            }
          } else {
            // Wrong direction for closing, ignore
            decided = false; active = false; return;
          }
        } else {
          return; // wait for clear horizontal intent
        }
      }
      // When actively swiping a panel, prevent vertical scroll jitter
      if (decided && (e as any)?.cancelable) e.preventDefault();
      let dist = 0;
      if (swipeModeRef.current === 'open') {
        dist = Math.min(drawerW, Math.max(0, Math.abs(dx)));
      } else if (swipeModeRef.current === 'close') {
        if (swipePanelRef.current === 'chan') {
          dist = Math.min(drawerW, Math.max(0, -dx)); // closing chan with left swipe (dx negative)
        } else if (swipePanelRef.current === 'users') {
          dist = Math.min(drawerW, Math.max(0, dx)); // closing users with right swipe (dx positive)
        }
      }
      const p = Math.min(1, dist / drawerW);
      swipeProgRef.current = p;
      setSwipeProgress(p);
    }
    function onEnd(e: TouchEvent) {
      if (!active) return; active = false;
      const prog = swipeProgRef.current;
      const panel = swipePanelRef.current;
      const mode = swipeModeRef.current;
      swipeProgRef.current = 0; swipePanelRef.current = null;
      swipeModeRef.current = null;
      setSwipeProgress(0); setSwipePanel(null); setSwipeMode(null);
      if (!panel) return;
      if (prog > 0.35) {
        if (mode === 'open') {
          if (panel === 'chan') { setChanSheetOpen(true); setUsersSheetOpen(false); }
          else if (panel === 'users') { setUsersSheetOpen(true); setChanSheetOpen(false); }
        } else if (mode === 'close') {
          if (panel === 'chan') { setChanSheetOpen(false); }
          else if (panel === 'users') { setUsersSheetOpen(false); }
        }
      }
    }
    el.addEventListener('touchstart', onStart, optPassiveTrue);
    el.addEventListener('touchmove', onMove, optPassiveFalse);
    el.addEventListener('touchend', onEnd, optPassiveTrue);
    return () => {
      el.removeEventListener('touchstart', onStart as any, optPassiveTrue);
      el.removeEventListener('touchmove', onMove as any, optPassiveFalse);
      el.removeEventListener('touchend', onEnd as any, optPassiveTrue);
    };
  }, [currentVoidId, showPeople]);
  const [chanOrder, setChanOrder] = useState<Record<string,string[]>>(() => {
    try { const s = localStorage.getItem('chanOrder'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem('spaceOrder', JSON.stringify(spaceOrder)); } catch {} }, [spaceOrder]);
  useEffect(() => { try { localStorage.setItem('chanOrder', JSON.stringify(chanOrder)); } catch {} }, [chanOrder]);
  // Persist current selection so refresh restores the view
  useEffect(() => { try { localStorage.setItem('currentVoidId', currentVoidId); } catch {} }, [currentVoidId]);
  useEffect(() => { try { localStorage.setItem('currentChannelId', currentChannelId); } catch {} }, [currentChannelId]);
  // Load and refresh friends list for DM actions and badges
  async function refreshFriends() {
    try {
      const tok = localStorage.getItem('token') || '';
      const r = await api.getAuth('/friends/list', tok);
      const map: Record<string, boolean> = {};
      (r.friends || []).forEach((f: any) => { map[f.id] = true; });
      setFriendIds(map);
    } catch {}
  }
  useEffect(() => { refreshFriends(); }, []);
  useEffect(() => {
    const onFU = () => refreshFriends();
    socket.on('friends:update', onFU);
    return () => { socket.off('friends:update', onFU); };
  }, []);

  // Resizable columns (desktop)
  const [chanW, setChanW] = useState<number>(() => {
    const v = Number(localStorage.getItem('chanW') || '208');
    return isFinite(v) && v >= 160 && v <= 420 ? v : 208;
  });
  const [peopleW, setPeopleW] = useState<number>(() => {
    const v = Number(localStorage.getItem('peopleW') || '224');
    return isFinite(v) && v >= 160 && v <= 420 ? v : 224;
  });
  useEffect(() => { try { localStorage.setItem('chanW', String(chanW)); } catch {} }, [chanW]);
  useEffect(() => { try { localStorage.setItem('peopleW', String(peopleW)); } catch {} }, [peopleW]);

  

  function startDrag(which: 'chan' | 'people', clientX: number) {
    const startX = clientX;
    const start = which === 'chan' ? chanW : peopleW;
    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      if (which === 'chan') setChanW(Math.max(160, Math.min(420, start + dx)));
      else setPeopleW(Math.max(160, Math.min(420, start - dx)));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const [text, setText] = useState("");
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const [pendingUploads, setPendingUploads] = useState<{ url: string; contentType?: string; name?: string; size?: number }[]>([]);
  const [spoiler, setSpoiler] = useState<boolean>(false);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [kanbanByChan, setKanbanByChan] = useState<Record<string, KanbanList[]>>({});
  // Track per-list toggle for showing all completed items
  const [showAllCompleted, setShowAllCompleted] = useState<Record<string, boolean>>({});
  const [listDrag, setListDrag] = useState<{ dragId?: string; overId?: string; pos?: 'before' | 'after' }>({});
  const [itemDrag, setItemDrag] = useState<{ dragId?: string; overId?: string; pos?: 'before' | 'after'; listId?: string }>({});
  const [formByChan, setFormByChan] = useState<Record<string, FormState>>({});
  // Habit tracker state
  type HabitDef = { id: string; name: string; pos: number };
  type HabitState = { defs: HabitDef[]; my: Record<string, { public: boolean; days: string[] }>; leaderboard?: { userId: string; name: string; count: number }[] };
  const [habitByChan, setHabitByChan] = useState<Record<string, HabitState>>({});
  // Favorites: fully-qualified channel ids (e.g. "space123:general" or "dm_abc:chat")
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { const raw = localStorage.getItem('favorites'); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('favorites', JSON.stringify(favorites)); } catch {} }, [favorites]);
  const isFav = (vId: string, cId: string) => favorites.includes(fq(vId, cId));
  const toggleFav = (vId: string, cId: string) => {
    const id = fq(vId, cId);
    setFavorites(prev => { if (prev.includes(id)) return prev.filter(x => x !== id); if (prev.length >= 4) { toast('You can pin up to 4 favorites', 'error'); return prev; } return [...prev, id]; });
  };
  // Kanban list favorites support (id format: klist:<voidId>:<channelId>:<listId>)
  const listFavId = (vId: string, cId: string, listId: string) => `klist:${vId}:${cId}:${listId}`;
  const isListFav = (vId: string, cId: string, listId: string) => favorites.includes(listFavId(vId, cId, listId));
  const toggleListFav = (vId: string, cId: string, listId: string) => {
    const id = listFavId(vId, cId, listId);
    setFavorites(prev => { if (prev.includes(id)) return prev.filter(x => x !== id); if (prev.length >= 4) { toast('You can pin up to 4 favorites', 'error'); return prev; } return [...prev, id]; });
  };
  function parseListFav(fid: string): { vId: string; cIdRaw: string; fqid: string; listId: string } | null {
    if (!fid.startsWith('klist:')) return null;
    const rest = fid.slice(6); // after 'klist:'
    const last = rest.lastIndexOf(':');
    if (last === -1) return null;
    const listId = rest.slice(last + 1);
    const vc = rest.slice(0, last);
    const first = vc.indexOf(':');
    if (first === -1) return null;
    const vId = vc.slice(0, first);
    const cIdRaw = vc.slice(first + 1); // may be short or fully-qualified
    const fqid = cIdRaw.includes(':') ? cIdRaw : `${vId}:${cIdRaw}`;
    return { vId, cIdRaw, fqid, listId };
  }
  // Ensure kanban data is loaded for any favorited lists
  useEffect(() => {
    for (const fid of favorites) {
      if (fid.startsWith('klist:')) {
        const parts = fid.split(':');
        const vId = parts[1]; const cId = parts[2];
        if (vId && cId) loadKanbanIfNeeded(fq(vId, cId));
      }
    }
  }, [favorites]);

  // Lightweight previews fed by user:notify for channels we might not be subscribed to
  // Lightweight previews fed by user:notify for channels we might not be subscribed to
  const [previewsByChan, setPreviewsByChan] = useState<Record<string, { id:string; content:string; authorName?:string; createdAt?:string; attachments?: { url:string; contentType?: string; name?: string; size?: number }[] }[]>>({});
  async function loadPreviewIfNeeded(fqChanId: string, force = false) {
    try {
      if (!force && Object.prototype.hasOwnProperty.call(previewsByChan, fqChanId)) return;
      const tok = localStorage.getItem('token') || '';
      const res = await api.getAuth(`/channels/preview?channelId=${encodeURIComponent(fqChanId)}&limit=5`, tok);
      const msgs = Array.isArray(res?.messages) ? res.messages as any[] : [];
      const mapped = msgs.map(m => ({ id: String(m.id), content: String(m.content||''), authorName: String(m.authorName||''), createdAt: String(m.createdAt||''), attachments: Array.isArray(m.attachments)? m.attachments : [] }));
      setPreviewsByChan(old => ({ ...old, [fqChanId]: mapped }));
    } catch {
      // mark as attempted to avoid spinner loops
      setPreviewsByChan(old => (Object.prototype.hasOwnProperty.call(old, fqChanId) ? old : { ...old, [fqChanId]: [] }));
    }
  }
  const refreshPreview = (fqChanId: string) => loadPreviewIfNeeded(fqChanId, true);

  // Quick reply text per favorite card (landing dashboard)
  const [quickTextByFav, setQuickTextByFav] = useState<Record<string, string>>({});
  function setQuick(fid: string, v: string) { setQuickTextByFav(old => ({ ...old, [fid]: v })); }
  async function quickSend(fid: string) {
    const text = (quickTextByFav[fid] || '').trim();
    if (!text) return;
    const parts = fid.split(':');
    const vId = parts[0]; const cId = parts.slice(1).join(':') || 'general';
    const tempId = crypto.randomUUID();
    const fqid = fq(vId, cId);
    setMsgsByKey(old => {
      const list = old[fqid] ?? [];
      return { ...old, [fqid]: [...list, { id: tempId, content: text, optimistic: true }] };
    });
    socket.emit('message:send', { voidId: vId, channelId: fq(vId, cId), content: text, tempId, attachments: [] });
    setQuickTextByFav(old => ({ ...old, [fid]: '' }));
  }
  // Favorites dashboard scroll refs for auto-scroll to newest
  const favScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // message editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  // Render *wrapped* segments in italics
  function renderWithItalics(text: string) {
    const parts = text.split(/(\*[^*]+\*)/g);
    return parts.map((seg, i) => {
      if (seg.startsWith('*') && seg.endsWith('*') && seg.length >= 2) {
        return <em key={i} className="italic">{seg.slice(1, -1)}</em>;
      }
      return seg;
    });
  }

  // Reactions palette; using Unicode escapes for portability (used in message action pill)
  const REACTION_EMOJIS = [
    "\uD83D\uDC4D", // thumbs up
    "\u2764\uFE0F", // heart
    "\uD83D\uDE02", // joy
    "\u2705",       // check
    "\uD83D\uDD25", // fire
    "\uD83D\uDE4F", // pray
    "\uD83D\uDE2E", // open mouth
    "\uD83D\uDE22", // cry
  ];
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // Reaction picker click-outside handling
  const reactionBtnRef = useRef<HTMLButtonElement | null>(null);
  const reactionMenuRef = useRef<HTMLDivElement | null>(null);
  // Close reaction picker when clicking outside or pressing Escape
  useEffect(() => {
    if (!pickerFor) return;
    const onOutside = (e: Event) => {
      const t = e.target as Node | null;
      const insideBtn = reactionBtnRef.current && t ? reactionBtnRef.current.contains(t) : false;
      const insideMenu = reactionMenuRef.current && t ? reactionMenuRef.current.contains(t) : false;
      if (!insideBtn && !insideMenu) setPickerFor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerFor(null); };
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('touchstart', onOutside, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('touchstart', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerFor]);

  // emoji picker for composer (full panel with categories + recents)
  const [composerPickerOpen, setComposerPickerOpen] = useState(false);
  const EMOJI_CATEGORIES: Record<string, string[]> = {
    'Smileys': [
      '??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??'
    ],
    'People': [
      '??','??','??','??','??','??','??','??','??','??','??','??','??','?','???','??','??','??','??','??','??','??','??','??','??','??','??','??'
    ],
    'Animals': [
      '??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??'
    ],
    'Food': [
      '??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??'
    ],
    'Activities': [
      '?','??','??','?','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??'
    ],
    'Travel': [
      '??','??','??','??','??','???','??','??','??','??','??','??','??','??','???','??','?','???','??','??','??','??','??','??','???','??','??','???'
    ],
    'Objects': [
      '?','??','??','??','???','???','???','??','??','??','??','??','???','??','??','??','??','??','??','??','??','??','??','??','??','??','??'
    ],
    'Symbols': [
      '??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','??','?','?','??','??','??','??','?','??','?','?','?','??','?','?'
    ],
  };
  function loadRecentEmojis(): string[] {
    try { const s = localStorage.getItem('emojiRecent'); return s ? JSON.parse(s) : []; } catch { return []; }
  }
  const [recentEmojis, setRecentEmojis] = useState<string[]>(loadRecentEmojis());
  const [emojiTab, setEmojiTab] = useState<string>(() => (loadRecentEmojis().length>0 ? 'Recent' : 'Smileys'));
  function addRecentEmoji(ch: string) {
    // Ignore corrupted placeholders from older builds
    if (!ch || ch === '?' || ch === '??') return;
    setRecentEmojis(prev => {
      const arr = [ch, ...prev.filter(c => c !== ch)].slice(0, 24);
      try { localStorage.setItem('emojiRecent', JSON.stringify(arr)); } catch {}
      return arr;
    });
  }
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const galleryFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(200, el.scrollHeight) + 'px';
  }, [text]);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  // Profile modal removed; avatar now navigates to landing
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const lastTouchAtRef = useRef<number>(0);
  // Removed: reaction picker refs (cleanup)

  // Close the add menu when clicking or tapping outside, or on Escape
  useEffect(() => {
    if (!addOpen) return;
    const onOutside = (e: Event) => {
      const t = e.target as Node | null;
      const insideBtn = addBtnRef.current && t ? addBtnRef.current.contains(t) : false;
      const insideMenu = addMenuRef.current && t ? addMenuRef.current.contains(t) : false;
      if (!insideBtn && !insideMenu) setAddOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddOpen(false); };
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('touchstart', onOutside, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('touchstart', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [addOpen]);

  // Removed: reaction picker outside/escape handling
  const [showJump, setShowJump] = useState(false);
  const [unreadMarkerByChan, setUnreadMarkerByChan] = useState<Record<string, string | null>>({});
  const [friendIds, setFriendIds] = useState<Record<string, boolean>>({});
  const [friendRingEnabled, setFriendRingEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('user');
      if (raw) { const u = JSON.parse(raw); if (typeof u?.friendRingEnabled === 'boolean') return !!u.friendRingEnabled; }
      const f = localStorage.getItem('friendRingEnabled');
      if (f === '0') return false; if (f === '1') return true;
    } catch {}
    return true;
  });
  const [friendRingColor, setFriendRingColor] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        if (u && u.friendRingColor) return String(u.friendRingColor);
      }
      const fallback = localStorage.getItem('friendRingColor');
      return fallback || '#34d399';
    } catch { return '#34d399'; }
  });
  // DM icons can be hidden from the Spaces column (still available under Direct Messages)
  const [hiddenDms, setHiddenDms] = useState<string[]>(() => {
    try { const s = localStorage.getItem('hiddenDMs'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('hiddenDMs', JSON.stringify(hiddenDms)); } catch {} }, [hiddenDms]);
  // Mute spaces/DMs: suppress notifications and prevent DM pop-ups
  const [mutedSpaces, setMutedSpaces] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('mutedSpaces'); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mutedSpaces', JSON.stringify(mutedSpaces));
      // Inform service worker (for push suppression)
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SET_MUTED_SPACES', data: mutedSpaces });
      }
    } catch {}
  }, [mutedSpaces]);
  // Listen for external mutedSpaces updates (from settings modal)
  useEffect(() => {
    function onMuted(e: any) { try { const ms = e?.detail || {}; if (ms && typeof ms === 'object') setMutedSpaces(ms); } catch {} }
    (window as any).addEventListener('echo:mutedSpaces', onMuted);
    return () => (window as any).removeEventListener('echo:mutedSpaces', onMuted);
  }, []);
  // Dedup set for incoming notification events (by messageId)
  const notifySeenIdsRef = useRef<Set<string>>(new Set());
  // sleek input modal
  const inputResolveRef = useRef<((v: string|null)=>void)|null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [inputCfg, setInputCfg] = useState<{ title?: string; label?: string; placeholder?: string; initialValue?: string; textarea?: boolean; okText?: string }>({});
  function askInput(cfg: { title?: string; label?: string; placeholder?: string; initialValue?: string; textarea?: boolean; okText?: string }): Promise<string|null> {
    setInputCfg(cfg);
    setInputOpen(true);
    return new Promise((resolve) => { inputResolveRef.current = resolve; });
  }
  function closeInput(val: string|null) {
    setInputOpen(false);
    const r = inputResolveRef.current; inputResolveRef.current = null;
    if (r) r(val);
  }

  // Notes channel UI state
  const [noteSearch, setNoteSearch] = useState<string>('');
  const [noteTag, setNoteTag] = useState<string | null>(null);
  const [noteModalId, setNoteModalId] = useState<string | null>(null);
  const [noteEditTitle, setNoteEditTitle] = useState<string>('');
  const [noteEditBody, setNoteEditBody] = useState<string>('');

  // Voice chat state
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voicePeers, setVoicePeers] = useState<Record<string, { userId?: string; name?: string }>>({});
  const pcMapRef = useRef(new Map<string, RTCPeerConnection>());
  const remoteStreamsRef = useRef(new Map<string, MediaStream>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [voiceLevels, setVoiceLevels] = useState<Record<string, number>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterNodesRef = useRef(new Map<string, { analyser: AnalyserNode; data: Uint8Array; source: MediaStreamAudioSourceNode }>());
  const meterLoopRef = useRef<number | null>(null);
  // Device management for voice
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [voiceVolumes, setVoiceVolumes] = useState<Record<string, number>>({});
  const [voiceSilenced, setVoiceSilenced] = useState<Record<string, boolean>>({});

  function startMetersLoop() {
    if (meterLoopRef.current != null) return;
    const tick = () => {
      const levels: Record<string, number> = {};
      for (const [id, node] of meterNodesRef.current.entries()) {
        const { analyser, data } = node;
        analyser.getByteTimeDomainData(data as any);
        // Compute simple peak normalized 0..1
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128; // -1..1
          const a = Math.abs(v);
          if (a > peak) peak = a;
        }
        levels[id] = Math.min(1, peak * 1.5);
      }
      if (Object.keys(levels).length > 0) setVoiceLevels(prev => ({ ...prev, ...levels }));
      meterLoopRef.current = requestAnimationFrame(tick);
    };
    meterLoopRef.current = requestAnimationFrame(tick);
  }
  function stopMetersLoop() {
    if (meterLoopRef.current != null) { cancelAnimationFrame(meterLoopRef.current); meterLoopRef.current = null; }
  }
  function startMeter(id: string, stream: MediaStream) {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current!;
      if (ctx.state === 'suspended') { ctx.resume().catch(()=>{}); }
      if (meterNodesRef.current.has(id)) return;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const data = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      meterNodesRef.current.set(id, { analyser, data, source });
      startMetersLoop();
    } catch {}
  }
  function stopMeter(id: string) {
    const node = meterNodesRef.current.get(id);
    if (!node) return;
    try { node.source.disconnect(); } catch {}
    meterNodesRef.current.delete(id);
    setVoiceLevels(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (meterNodesRef.current.size === 0) stopMetersLoop();
  }

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const ins = list.filter(d => d.kind === 'audioinput');
      const outs = list.filter(d => d.kind === 'audiooutput');
      setInputs(ins);
      setOutputs(outs);
      // Try to align selection with current stream
      const cur = localStreamRef.current?.getAudioTracks?.()[0];
      const curId = (cur?.getSettings?.() as any)?.deviceId || null;
      if (curId && !selectedInputId) setSelectedInputId(curId);
    } catch {}
  }

  async function applyOutputDevice(sinkId: string | null) {
    try {
      for (const el of audioElsRef.current.values()) {
        try { if (el && typeof (el as any).setSinkId === 'function' && sinkId) { await (el as any).setSinkId(sinkId); } } catch {}
      }
    } catch {}
  }

  async function switchMicrophone(deviceId: string) {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } as any,
        video: false
      });
      const newTrack = newStream.getAudioTracks()[0];
      // Replace on all peer connections
      for (const pc of pcMapRef.current.values()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        try { await sender?.replaceTrack(newTrack); } catch {}
      }
      // Stop previous track and update local stream
      if (localStreamRef.current) { for (const t of localStreamRef.current.getAudioTracks()) { try { t.stop(); } catch {} } }
      localStreamRef.current = newStream;
      // Update meter
      stopMeter('self');
      startMeter('self', newStream);
    } catch (e) {
      toast('Failed to switch microphone', 'error');
    }
  }

  // Refresh devices when joining voice or opening the devices panel
  useEffect(() => {
    if (voiceJoined && devicesOpen) refreshDevices();
  }, [voiceJoined, devicesOpen]);

  // Re-apply output device when selection changes
  useEffect(() => {
    if (voiceJoined) applyOutputDevice(selectedOutputId || null);
  }, [selectedOutputId, voiceJoined]);

  // Voice helpers (component scope to avoid TDZ in minified builds)
  function ensurePc(peerId: string) {
    let pc = pcMapRef.current.get(peerId);
    if (!pc) {
      // Build ICE servers (STUN + optional TURN via env)
      const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
      try {
        const turnUrl = (import.meta.env.VITE_TURN_URL ?? '').trim();
        const turnUser = (import.meta.env.VITE_TURN_USERNAME ?? '').trim();
        const turnPass = (import.meta.env.VITE_TURN_PASSWORD ?? '').trim();
        if (turnUrl) {
          if (turnUser && turnPass) iceServers.push({ urls: turnUrl, username: turnUser, credential: turnPass });
          else iceServers.push({ urls: turnUrl });
        }
      } catch {}
      pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit('voice:signal', { targetId: peerId, payload: { type: 'candidate', candidate: ev.candidate } });
        }
      };
      pc.ontrack = (ev) => {
        let ms = remoteStreamsRef.current.get(peerId);
        if (!ms) { ms = new MediaStream(); remoteStreamsRef.current.set(peerId, ms); }
        ms.addTrack(ev.track);
        setVoicePeers((prev) => ({ ...prev }));
        startMeter(peerId, ms);
      };
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getAudioTracks()) pc.addTrack(track, localStreamRef.current);
      }
      pcMapRef.current.set(peerId, pc);
    }
    return pc;
  }
  async function createAndSendOffer(peerId: string) {
    const pc = ensurePc(peerId);
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false } as any);
    await pc.setLocalDescription(offer);
    socket.emit('voice:signal', { targetId: peerId, payload: { type: 'offer', sdp: offer.sdp } });
  }
  async function handleVoiceSignal({ from, payload }: any) {
    const type = payload?.type;
    if (!type) return;
    const pc = ensurePc(from);
    if (type === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp } as any);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice:signal', { targetId: from, payload: { type: 'answer', sdp: answer.sdp } });
    } else if (type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp } as any);
    } else if (type === 'candidate') {
      try { await pc.addIceCandidate(payload.candidate); } catch {}
    }
  }
  function cleanupVoicePeer(peerId: string) {
    const pc = pcMapRef.current.get(peerId);
    if (pc) { try { pc.close(); } catch {} pcMapRef.current.delete(peerId); }
    remoteStreamsRef.current.delete(peerId);
    stopMeter(peerId);
    setVoicePeers((prev) => { const n = { ...prev }; delete n[peerId]; return n; });
    setVoiceVolumes((prev) => { const n = { ...prev }; delete n[peerId]; return n; });
    setVoiceSilenced((prev) => { const n = { ...prev }; delete n[peerId]; return n; });
  }

  async function createSpace() {
    const nm = await askInput({ title: 'Create Space', label: 'Space name', placeholder: 'My Team' });
    if (!nm) return;
    try {
      const res = await api.postAuth('/spaces', { name: nm }, token);
      const sid = res.id;
      socket.emit('void:list');
      setCurrentVoidId(sid);
      setCurrentChannelId('general');
      socket.emit('void:switch', { voidId: sid });
      socket.emit('channel:list', { voidId: sid });
      socket.emit('channel:switch', { voidId: sid, channelId: `${sid}:general` });
    } catch (e: any) {
      toast(e?.message || 'Failed to create space', 'error');
    }
  }

  async function inviteToSpace() {
    const sid = currentVoidId;
    if (!sid) return;
    const code = await askInput({ title:'Create Invite', label:'Custom code (optional)', placeholder:'TEAM-ALPHA' }) || '';
    const usesRaw = await askInput({ title:'Create Invite', label:'Max uses (default 1)', placeholder:'1' }) || '1';
    const hoursRaw = await askInput({ title:'Create Invite', label:'Expires in hours (blank for none)', placeholder:'' }) || '';
    const maxUses = Number(usesRaw) || 1;
    const expiresInHours = hoursRaw.trim() === '' ? undefined : Number(hoursRaw) || undefined;
    try {
      const res = await api.postAuth('/spaces/invite', { spaceId: sid, maxUses, expiresInHours, code: code.trim() }, token);
      navigator.clipboard?.writeText(res.code).catch(() => {});
      toast(`Invite code: ${res.code}`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Failed to create invite', 'error');
    }
  }

  async function acceptInvite() {
    const code = await askInput({ title:'Join Space', label:'Invite code', placeholder:'enter code' });
    if (!code) return;
    try {
      const { spaceId } = await api.postAuth('/invites/accept', { code: code.trim() }, token);
      socket.emit('void:list');
      setCurrentVoidId(spaceId);
      setCurrentChannelId('general');
      socket.emit('void:switch', { voidId: spaceId });
      socket.emit('channel:list', { voidId: spaceId });
      socket.emit('channel:switch', { voidId: spaceId, channelId: `${spaceId}:general` });
    } catch (e: any) {
      toast(e?.message || 'Failed to accept invite', 'error');
    }
  }

  async function deleteSpace() {
    const sid = currentVoidId;
    if (!sid) return;
    {
      const ok = await askConfirm({ title: 'Delete Space', message: `Delete space "${sid}"? This cannot be undone.`, confirmText: 'Delete', cancelText: 'Cancel' });
      if (!ok) return;
    }
    try {
      await api.deleteAuth('/spaces', { spaceId: sid }, token);
      // Refresh and switch to home or first available space
      socket.emit('void:list');
      const fallback = 'home';
      setCurrentVoidId(fallback);
      setCurrentChannelId('general');
      socket.emit('void:switch', { voidId: fallback });
      socket.emit('channel:list', { voidId: fallback });
      socket.emit('channel:switch', { voidId: fallback, channelId: `${fallback}:general` });
    } catch (e: any) {
      toast(e?.message || 'Failed to delete space', 'error');
    }
  }

  async function createChannel() {
    if (String(currentVoidId || '').startsWith('dm_')) {
      toast('Direct Messages do not support multiple channels', 'error');
      return;
    }
    const nm = await askInput({ title: 'Create Channel', label: 'Channel name', placeholder: 'planning' });
    if (!nm) return;
    try {
      // Ask for channel type
      let ctypeRaw = await askInput({ title: 'Channel Type', label: 'Type (text, voice, announcement, kanban, form, habit, gallery, notes)', placeholder: 'text' });
      let ctype = String(ctypeRaw || 'text').trim().toLowerCase();
      const allowed = new Set(['text','voice','announcement','kanban','form','habit','gallery','notes']);
      if (!allowed.has(ctype)) ctype = 'text';
      const res = await api.postAuth('/channels', { spaceId: currentVoidId, name: nm, type: ctype }, token);
      const cid = res.id;
      setCurrentChannelId(cid.includes(':') ? cid.split(':')[1] : cid);
      socket.emit('channel:list', { voidId: currentVoidId });
      socket.emit('channel:switch', { voidId: currentVoidId, channelId: cid });
    } catch (e: any) {
      toast(e?.message || 'Failed to create channel', 'error');
    }
  }

  // space image is now handled inside Space Settings modal

  async function deleteChannel() {
    const cid = fq(currentVoidId, currentChannelId);
    if (!cid) return;
    // replaced native confirm with sleek modal
    // (legacy confirm removed)
    const okCh = await askConfirm({ title: 'Delete Channel', message: `Delete channel "${currentChannel?.name || currentChannelId}"?`, confirmText: 'Delete', cancelText: 'Cancel' });
    if (!okCh) return;
    try {
      await api.postAuth('/channels/delete', { spaceId: currentVoidId, channelId: cid }, token);
      // After deletion, refresh list and switch to general
      socket.emit('channel:list', { voidId: currentVoidId });
      setCurrentChannelId('general');
      socket.emit('channel:switch', { voidId: currentVoidId, channelId: fq(currentVoidId, 'general') });
    } catch (e: any) {
      toast(e?.message || 'Failed to delete channel', 'error');
    }
  }

  // --- socket lifecycle ---
  useEffect(() => {
    // ensure socket handshake includes the latest token
    (socket as any).auth = { ...(socket as any).auth, token };

    const onConnect = () => {
      setStatus("connected");
      socket.emit("void:list");
      if (currentVoidId) {
        socket.emit("void:switch", { voidId: currentVoidId });
        socket.emit("channel:list", { voidId: currentVoidId });
        const fid = fq(currentVoidId, currentChannelId);
        socket.emit("channel:switch", { voidId: currentVoidId, channelId: fid });
        const meta = channels.find(c => c.id === currentChannelId);
        if (meta && meta.type === 'kanban') { loadKanbanIfNeeded(fid); }
        if (meta && meta.type === 'form') { loadFormIfNeeded(fid); }
        if (meta && meta.type === 'habit') { loadHabitIfNeeded(fid); }
        // load members for current space
        (async () => {
          try {
            const tok = localStorage.getItem('token') || '';
            const res = await api.getAuth(`/spaces/members?spaceId=${encodeURIComponent(currentVoidId)}`, tok);
            setMembers(res.members || []);
          } catch {}
        })();
      }
      // seed toneUrl so notifications use custom sound even before profile is reopened
      (async () => {
        try {
          const tok = localStorage.getItem('token') || '';
          const u = await api.getAuth('/users/me', tok);
          if (u?.toneUrl) localStorage.setItem('toneUrl', u.toneUrl);
          if (u?.nameColor) localStorage.setItem('nameColor', u.nameColor); else localStorage.removeItem('nameColor');
        } catch {}
      })();
    };
    const onDisconnect = () => { setStatus("disconnected"); if (voiceJoined) leaveVoice(); };
    const onError = async (err: any) => {
      console.error("socket error", err);
      setStatus("error");
      try {
        const res = await fetch(`/api/auth/refresh`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          const nt = data?.token as string | undefined;
          if (nt) {
            localStorage.setItem('token', nt);
            setStatus('connecting');
            // auth will be updated by effect; reconnect shortly
            setTimeout(() => { try { connectSocket(); } catch {} }, 50);
          }
        }
      } catch {}
    };

    const onAuthAccepted = ({ userId, name, avatarUrl }: { userId: string; name: string; avatarUrl?: string | null }) => {
      const merged = { userId, name, avatarUrl: avatarUrl ?? null };
      setMe(merged);
      setLocalUser(merged);
      if (!name) setAskName(true);
    };

    const onVoidList = ({ voids }: { voids: VoidWS[] }) => {
      setVoids(voids);
      // Seed order with any new spaces
      setSpaceOrder((prev) => {
        const known = new Set(prev);
        const next = prev.filter(id => voids.find(v=>v.id===id));
        for (const v of voids) if (!known.has(v.id)) next.push(v.id);
        return next;
      });
      // Only on first load: if current space is empty or a DM, switch to a non-DM space
      if (!initialSpaceSetRef.current) {
        initialSpaceSetRef.current = true;
        if (!currentVoidIdRef.current || String(currentVoidIdRef.current).startsWith('dm_')) {
          const nonDm = voids.find(v => !String(v.id).startsWith('dm_'));
          if (nonDm) {
            setCurrentVoidId(nonDm.id);
            socket.emit('void:switch', { voidId: nonDm.id });
            socket.emit('channel:list', { voidId: nonDm.id });
            setCurrentChannelId('general');
            socket.emit('channel:switch', { voidId: nonDm.id, channelId: `${nonDm.id}:general` });
          }
        }
      }
    };
    const onVoidReady = (_: any) => {};

    const onChannelList = ({ voidId, channels }: { voidId: string; channels: Channel[] }) => {
      if (voidId !== currentVoidIdRef.current) return;
      setChannels(channels.sort((a,b) => a.name.localeCompare(b.name)));
      setChanOrder((prev) => {
        const cur = prev[voidId] || [];
        const known = new Set(cur);
        const next = cur.filter(id => channels.find(c=>c.id===id));
        for (const c of channels) if (!known.has(c.id)) next.push(c.id);
        return { ...prev, [voidId]: next };
      });
      setMsgsByKey((old) => {
        const next = { ...old };
        for (const c of channels) {
          const kk = k(voidId, c.id);
          if (!next[kk]) next[kk] = [];
        }
        return next;
      });
      if (!channels.find(c => c.id === currentChannelId) && channels[0]) {
        setCurrentChannelId(channels[0].id);
        socket.emit("channel:switch", { voidId: currentVoidId, channelId: fq(currentVoidId, channels[0].id) });
      }
    };

    const onBacklog = ({ voidId, channelId, messages }: { voidId: string; channelId: string; messages: Msg[] }) => {
      setMsgsByKey((old) => ({ ...old, [k(voidId, channelId)]: messages }));
      // Send read receipt up to the last message on backlog load
      const last = messages[messages.length - 1];
      if (voidId === currentVoidId && channelId === fq(voidId, currentChannelId) && last?.id) {
        socket.emit('read:up_to', { channelId: fq(voidId, channelId), lastMessageId: last.id });
      }
    };

    function onKanbanState({ channelId, lists }: { channelId: string; lists: KanbanList[] }) {
      setKanbanByChan(old => ({ ...old, [channelId]: lists }));
    }
    function onFormState({ channelId, questions }: { channelId: string; questions: FormQuestion[] }) {
      setFormByChan(old => ({ ...old, [channelId]: { questions, answers: (old[channelId]?.answers || {}), answersByUser: old[channelId]?.answersByUser || {} } }));
    }

    const onNew = ({ voidId, channelId, message, tempId }: { voidId: string; channelId: string; message: Msg; tempId?: string }) => {
      const kk = k(voidId, channelId);
      setMsgsByKey((old) => {
        const list = old[kk] ?? [];
        if (tempId && voidId === currentVoidId && channelId === currentChannelId) {
          const idx = list.findIndex((x) => x.optimistic && x.id === tempId);
          if (idx !== -1) {
            const copy = [...list];
            copy[idx] = { ...message, optimistic: false };
            return { ...old, [kk]: copy };
          }
        }
        return { ...old, [kk]: [...list, message] };
      });
      // If we are viewing this channel and window is visible, mark seen up to this message
      if (voidId === currentVoidId && channelId === fq(currentVoidId, currentChannelId) && document.visibilityState === 'visible') {
        socket.emit('read:up_to', { channelId: fq(voidId, channelId), lastMessageId: message.id });
      }
      // If user is scrolled up, remember first unseen message id for divider
      if (voidId === currentVoidId && channelId === currentChannelId) {
        const el = listRef.current;
        if (el) {
          const nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40;
          if (!nearBottom) {
            const cid = fq(voidId, channelId);
            setUnreadMarkerByChan(prev => prev[cid] ? prev : ({ ...prev, [cid]: message.id }));
          }
        }
      }
    };

    const onSeen = ({ channelId, messageId, userId, name }: { channelId: string; messageId: string; userId: string; name?: string }) => {
      const fqChan = fq(currentVoidId, currentChannelId);
      if (channelId !== fqChan) return;
      const kk = k(currentVoidId, channelId);
      setMsgsByKey((old) => {
        const list = old[kk] ?? [];
        const lastIdx = list.length - 1;
        if (lastIdx < 0) return old;
        // We render a single receipt on the latest message only.
        // Do not count the author as a viewer on their own (latest) message.
        const latest = list[lastIdx];
        if (latest && latest.authorId && latest.authorId === userId) return old;
        const copy = [...list];
        const sbIds = new Set(copy[lastIdx].seenByIds || []);
        sbIds.add(userId);
        // keep legacy names as best effort
        const sb = new Set(copy[lastIdx].seenBy || []);
        const nm = (name && name.trim()) ? name : (userId || "Someone"); if (nm) sb.add(nm);
        copy[lastIdx] = { ...copy[lastIdx], seenBy: Array.from(sb), seenByIds: Array.from(sbIds) };
        return { ...old, [kk]: copy };
      });
    };

    const onEdited = ({ channelId, messageId, content, updatedAt }: { channelId: string; messageId: string; content: string; updatedAt?: string }) => {
      const kk = k(currentVoidId, channelId);
      setMsgsByKey((old) => {
        const list = old[kk] ?? [];
        const idx = list.findIndex(m => m.id === messageId);
        if (idx === -1) return old;
        const copy = [...list];
        copy[idx] = { ...copy[idx], content, optimistic: false, updatedAt: updatedAt || new Date().toISOString() };
        return { ...old, [kk]: copy };
      });
      if (editingId === messageId) { setEditingId(null); setEditText(""); }
    };

    const onDeleted = ({ channelId, messageId }: { channelId: string; messageId: string }) => {
      const kk = k(currentVoidId, channelId);
      setMsgsByKey((old) => {
        const list = old[kk] ?? [];
        const copy = list.filter(m => m.id !== messageId);
        return { ...old, [kk]: copy };
      });
    };

    const onReactions = ({ channelId, messageId, reactions }: { channelId: string; messageId: string; reactions: Record<string,{count:number}> }) => {
      const kk = k(currentVoidId, channelId);
      setMsgsByKey((old) => {
        const list = old[kk] ?? [];
        const idx = list.findIndex(m => m.id === messageId);
        if (idx === -1) return old;
        const copy = [...list];
        const prev = copy[idx].reactions || {};
        const next: Record<string,{count:number; mine?:boolean}> = {};
        // preserve mine flags while updating counts
        for (const key of Object.keys(reactions)) {
          next[key] = { count: reactions[key].count, mine: prev[key]?.mine };
        }
        copy[idx] = { ...copy[idx], reactions: next };
        return { ...old, [kk]: copy };
      });
    };

    const onTypingStart = ({ voidId: v, channelId: ch, userId, name }: { voidId: string; channelId: string; userId: string, name?: string }) => {
      if (v !== currentVoidId || ch !== currentChannelId) return;
      setTypers((t) => (t[userId] ? t : { ...t, [userId]: name || userId }));
      const prev = typingTimers.current.get(userId);
      if (prev) clearTimeout(prev);
      // Auto-expire a typing indicator if no further events arrive
      const tid = window.setTimeout(() => {
        setTypers((t) => { const n = { ...t }; delete n[userId]; return n; });
        typingTimers.current.delete(userId);
      }, 8000);
      typingTimers.current.set(userId, tid);
    };
    const onTypingStop = ({ voidId: v, channelId: ch, userId }: { voidId: string; channelId: string; userId: string }) => {
      if (v !== currentVoidId || ch !== currentChannelId) return;
      const prev = typingTimers.current.get(userId);
      if (prev) clearTimeout(prev);
      // Gracefully hide after a short delay to prevent flicker from rapid start/stop
      const tid = window.setTimeout(() => {
        setTypers((t) => { const n = { ...t }; delete n[userId]; return n; });
        typingTimers.current.delete(userId);
      }, 1200);
      typingTimers.current.set(userId, tid);
    };

    const onPresenceRoom = ({ room, userIds, mobileUserIds }: { room: string; userIds: string[]; mobileUserIds?: string[] }) => {
      setRoomUserIds(userIds);
      setRoomMobileIds(mobileUserIds || []);
    };
    const onPresenceSpace = ({ spaceId, userIds, mobileUserIds }: { spaceId: string; userIds: string[]; mobileUserIds?: string[] }) => {
      if (spaceId !== currentVoidId) return;
      setSpaceUserIds(userIds);
      setSpaceMobileIds(mobileUserIds || []);
    };
  const onPresenceGlobal = ({ userIds, mobileUserIds }: { userIds: string[]; mobileUserIds?: string[] }) => {
    setGlobalUserIds(userIds);
    setGlobalMobileIds(mobileUserIds || []);
  };


    const onSpaceNotify = ({ voidId, channelId, authorId, authorName, content, messageId }: { voidId: string; channelId: string; authorId?: string; authorName?: string; content?: string; messageId?: string }) => {
      const fid = fq(voidId, channelId);
      // Do not notify for our own messages
      if (authorId && me.userId && authorId === me.userId) return;
      // Deduplicate same messageId arriving from multiple paths
      if (messageId) {
        const seen = notifySeenIdsRef.current;
        if (seen.has(messageId)) return;
        seen.add(messageId);
        // keep set size reasonable
        if (seen.size > 5000) {
          // clear oldest by recreating (simple approach)
          notifySeenIdsRef.current = new Set(Array.from(seen).slice(-1000));
        }
      }
      const isCurrent = (voidId === currentVoidId) && (fid === fq(currentVoidId, currentChannelId));
      // If user is actively viewing this channel, do not notify
      if (isCurrent && document.visibilityState === 'visible' && document.hasFocus()) {
        return;
      }
      if (!isCurrent || document.visibilityState === 'hidden' || !document.hasFocus()) {
        setUnread(prev => ({ ...prev, [fid]: (prev[fid] || 0) + 1 }));
      }
      // Feed preview list so landing dashboard can show latest activity
      const preview = { id: messageId || String(Date.now()), content: content || '', authorName, createdAt: new Date().toISOString() };
      setPreviewsByChan(old => {
        const list = old[fid] ? [...old[fid]] : [];
        list.push(preview);
        while (list.length > 20) list.shift();
        return { ...old, [fid]: list };
      });
      // Suppress notifications for muted spaces/DMs
      if (mutedSpaces[voidId]) return;
      // Notify only once per channel until visited
      if (notifiedRef.current[fid]) return;
      setNotified(prev => ({ ...prev, [fid]: true }));
      try {
        const soundEnabled = (localStorage.getItem('soundEnabled') || '1') === '1';
        const notifEnabled = (localStorage.getItem('notifEnabled') || '0') === '1';
        // Only play sound when not actively viewing/focused
        const inBackground = (document.visibilityState === 'hidden' || !document.hasFocus());
        if (soundEnabled && inBackground) {
          // Prefer persisted toneUrl; fallback to user JSON if needed
          let toneUrl = localStorage.getItem('toneUrl');
          if (!toneUrl) {
            const stored = localStorage.getItem('user'); let u: any = null; try { if (stored) u = JSON.parse(stored); } catch {}
            toneUrl = u?.toneUrl || null;
          }
        if (toneUrl) new Audio(toneUrl).play().catch(()=>{}); else {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const o = ctx.createOscillator(); const g = ctx.createGain(); o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01); o.start(); o.stop(ctx.currentTime + 0.15);
          }
        }
        if (notifEnabled && 'Notification' in window && (document.visibilityState === 'hidden' || !document.hasFocus())) {
          if (Notification.permission === 'granted') {
            const title = `#${(channels.find(c=>fq(voidId, c.id)===fid)?.name || 'channel')}`;
            const body = `${authorName || 'User'}: ${(content||'').slice(0,80)}`;
            const n = new Notification(title, { body, icon: '/brand/Echo_logo_plant.png' });
            n.onclick = () => { window.focus(); n.close(); };
          }
        }
      } catch {}
      try {
        // Proactively refresh preview data for favorites (keeps gallery frame fresh)
        const fid = fq(voidId, channelId);
        if (favorites.includes(fid)) refreshPreview(fid);
      } catch {}
      };

    connectSocket();

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onError);
    socket.on("auth:accepted", onAuthAccepted);
    socket.on("void:list", onVoidList);
    socket.on("void:ready", onVoidReady);
    socket.on("channel:list", onChannelList);
    socket.on("channel:backlog", onBacklog);
    socket.on("kanban:state", onKanbanState);
    socket.on("form:state", onFormState);
    function onHabitState(payload: any) {
      const { channelId, defs, my, leaderboard } = payload || {};
      if (!channelId) return;
      setHabitByChan(old => ({ ...old, [channelId]: { defs: defs||[], my: my||{}, leaderboard: leaderboard||[] } }));
    }
    socket.on('habit:state', onHabitState);
    socket.on("message:new", onNew);
    socket.on("message:seen", onSeen);
    socket.on("message:edited", onEdited);
    socket.on("message:deleted", onDeleted);
    socket.on("message:reactions", onReactions);
    socket.on("typing:start", onTypingStart);
    socket.on("typing:stop", onTypingStop);
    socket.on("presence:room", onPresenceRoom);
    socket.on("presence:space", onPresenceSpace);
    socket.on("presence:global", onPresenceGlobal);
    // Voice signaling handlers
    const onVoicePeers = ({ peers }: { peers: { peerId: string; userId?: string; name?: string }[] }) => {
      const map: Record<string, { userId?: string; name?: string }> = {};
      for (const p of peers) map[p.peerId] = { userId: p.userId, name: p.name };
      setVoicePeers((prev) => ({ ...prev, ...map }));
      peers.forEach(p => { createAndSendOffer(p.peerId).catch(()=>{}); });
    };

    const onVoicePeerJoined = ({ peerId, userId, name }: { peerId: string; userId?: string; name?: string }) => {
      // Avoid offer glare: existing peers should not immediately send offers.
      setVoicePeers((prev) => ({ ...prev, [peerId]: { userId, name } }));
      ensurePc(peerId);
      // The joiner will send offers based on the initial peers list.
    };
    const onVoicePeerLeft = ({ peerId }: { peerId: string }) => { cleanupVoicePeer(peerId); };
    const onVoiceSignal = (msg: any) => { handleVoiceSignal(msg); };
    socket.on('voice:peers', onVoicePeers);
    socket.on('voice:peer-joined', onVoicePeerJoined);
    socket.on('voice:peer-left', onVoicePeerLeft);
    socket.on('voice:signal', onVoiceSignal);
    // Receive live form answer updates
    const onFormAnswer = ({ channelId, questionId, userId, answer }: { channelId: string; questionId: string; userId: string; answer: string }) => {
      setFormByChan(old => {
        const cur = old[channelId];
        if (!cur) return old;
        const byUser = { ...(cur.answersByUser || {}) };
        const urec = { ...(byUser[userId] || {}) };
        urec[questionId] = answer || '';
        byUser[userId] = urec;
        // if it's me, also reflect in my own answers map
        const self = { ...cur.answers };
        if (me.userId && userId === me.userId) self[questionId] = answer || '';
        return { ...old, [channelId]: { ...cur, answersByUser: byUser, answers: self } };
      });
    };
    socket.on('form:answer', onFormAnswer);
    const onUserStatus = ({ userId, status }: { userId: string; status: string }) => {
      setMembers(prev => prev.map(m => m.id === userId ? { ...m, status } : m));
      // If it's me, reflect in local snapshot too
      if (me.userId && userId === me.userId) {
        try {
          const raw = localStorage.getItem('user');
          const prev = raw ? JSON.parse(raw) : {};
          localStorage.setItem('user', JSON.stringify({ ...prev, status }));
        } catch {}
      }
    };
    socket.on("user:status", onUserStatus);
    // Only use per-user notify; avoids duplicate notifications
    socket.on("user:notify", onSpaceNotify);

    const onVis = () => {
      if (document.visibilityState === "visible" && !socket.connected) connectSocket();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onError);
      socket.off("auth:accepted", onAuthAccepted);
      socket.off("void:list", onVoidList);
      socket.off("void:ready", onVoidReady);
      socket.off("channel:list", onChannelList);
      socket.off("channel:backlog", onBacklog);
      socket.off("kanban:state", onKanbanState);
      socket.off("form:state", onFormState);
      socket.off('habit:state', onHabitState);
      socket.off("message:new", onNew);
      socket.off("message:seen", onSeen);
      socket.off("message:edited", onEdited);
      socket.off("message:deleted", onDeleted);
      socket.off("message:reactions", onReactions);
      socket.off("typing:start", onTypingStart);
      socket.off("typing:stop", onTypingStop);
      socket.off("presence:room", onPresenceRoom);
      socket.off("presence:space", onPresenceSpace);
      socket.off("presence:global", onPresenceGlobal);
      socket.off('voice:peers', onVoicePeers);
      socket.off('voice:peer-joined', onVoicePeerJoined);
      socket.off('voice:peer-left', onVoicePeerLeft);
      socket.off('voice:signal', onVoiceSignal);
      socket.off('form:answer', onFormAnswer);
      socket.off("user:status", onUserStatus);
      socket.off("user:notify", onSpaceNotify);
      document.removeEventListener("visibilitychange", onVis);
      disconnectSocket();
    };
  }, [currentVoidId, currentChannelId, token]);

  // Auto-scroll behavior per channel type
  // - text-like channels: scroll to bottom (newest)
  // - kanban/gallery: scroll to top (boards and galleries start at top)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const meta = channels.find(c => c.id === currentChannelId);
    if (meta && (meta.type === 'kanban' || meta.type === 'gallery')) {
      el.scrollTop = 0; // show top of board
    } else {
      el.scrollTop = el.scrollHeight; // show latest messages
    }
  }, [msgs.length, currentVoidId, currentChannelId, channels]);

  // Mobile UX: show "Jump to present" when scrolled up; clear unread divider when near bottom
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40;
      setShowJump(!nearBottom);
      if (nearBottom) {
        const cid = fq(currentVoidId, currentChannelId);
        setUnreadMarkerByChan(prev => ({ ...prev, [cid]: null }));
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true } as any);
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [currentVoidId, currentChannelId]);

  // Autoscroll favorites widgets to show most recent content
  useEffect(() => {
    try {
      for (const fid of favorites.slice(0, 4)) {
        const el = favScrollRefs.current[fid];
        if (el) el.scrollTop = el.scrollHeight;
      }
    } catch {}
  }, [favorites, msgsByKey, previewsByChan, kanbanByChan]);

  // actions
  const sendTypingTrue  = () => socket.emit("typing:set", { voidId: currentVoidId, channelId: fq(currentVoidId, currentChannelId), isTyping: true });
  const sendTypingFalse = () => socket.emit("typing:set", { voidId: currentVoidId, channelId: fq(currentVoidId, currentChannelId), isTyping: false });
  const debouncedStop   = debounce(sendTypingFalse, 1500);
  const lastTypingTrueAtRef = useRef<number>(0);
  function onInputChange(v: string) {
    setText(v);
    const now = Date.now();
    if (now - (lastTypingTrueAtRef.current || 0) > 1000) { // throttle true to 1s
      lastTypingTrueAtRef.current = now;
      sendTypingTrue();
    }
    debouncedStop();
  }

  function insertEmojiAtCaret(e: string) {
    const el = inputRef.current;
    if (!el) { setText(t => (t + e)); return; }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + e + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + e.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onComposerEmojiClick(e: string) {
    addRecentEmoji(e);
    insertEmojiAtCaret(e);
    setComposerPickerOpen(false);
  }
  async function send() {
    const content = text.trim();
    if (!content && pendingUploads.length === 0) return;
    const tempId = crypto.randomUUID();
    const kk = k(currentVoidId, currentChannelId);
    setMsgsByKey((old) => {
      const list = old[kk] ?? [];
      return { ...old, [kk]: [...list, { id: tempId, content, optimistic: true, attachments: pendingUploads, spoiler: !!spoiler, replyTo: replyTo ? { id: replyTo.id, authorId: replyTo.authorId, authorName: replyTo.authorName, authorColor: replyTo.authorColor ?? null, content: replyTo.content } : null }] };
    });
    socket.emit("message:send", { voidId: currentVoidId, channelId: fq(currentVoidId, currentChannelId), content, tempId, attachments: pendingUploads, replyToId: replyTo?.id, spoiler: !!spoiler });
    setText(""); setPendingUploads([]); setReplyTo(null); setSpoiler(false); sendTypingFalse();
  }

  // Quick reaction bar: take last used emojis with sensible fallbacks
  function getQuickEmojis(): string[] {
    try {
      const raw = localStorage.getItem('emojiRecent');
      const list: string[] = raw ? JSON.parse(raw) : [];
      // Filter out corrupted placeholders like '??' from older builds
      const valid = list.filter((ch) => typeof ch === 'string' && ch.trim() && ch !== '??' && ch !== '?');
      const fallback = ['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02']; // ?? ?? ??
      const uniq = Array.from(new Set([...valid.slice(-5).reverse(), ...fallback]));
      return uniq.slice(0, 3);
    } catch { return ['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02']; }
  }

  async function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const token = localStorage.getItem('token') || '';
    const MAX = 10 * 1024 * 1024; // 10MB
    for (const f of Array.from(files)) {
      if (f.size > MAX) { console.warn('File too large'); continue; }
      try {
        const lower = (f.name || '').toLowerCase();
        // Prefer browser-provided type; fall back to common image extensions
        let ctype = (f.type || '').toLowerCase();
        if (!ctype) {
          if (/(\.png)(\?.*)?$/.test(lower)) ctype = 'image/png';
          else if (/(\.jpe?g|\.jfif)(\?.*)?$/.test(lower)) ctype = 'image/jpeg';
          else if (/(\.gif)(\?.*)?$/.test(lower)) ctype = 'image/gif';
          else if (/(\.webp)(\?.*)?$/.test(lower)) ctype = 'image/webp';
          else if (/(\.svg)(\?.*)?$/.test(lower)) ctype = 'image/svg+xml';
          else if (/(\.avif)(\?.*)?$/.test(lower)) ctype = 'image/avif';
          else if (/(\.heic)(\?.*)?$/.test(lower)) ctype = 'image/heic';
          else if (/(\.bmp)(\?.*)?$/.test(lower)) ctype = 'image/bmp';
          else if (/(\.tiff?)(\?.*)?$/.test(lower)) ctype = 'image/tiff';
        }
        const signType = ctype || 'application/octet-stream';
        const { url, headers, publicUrl } = await signUpload({ filename: f.name, contentType: signType, size: f.size }, token);
        await fetch(url, { method: 'PUT', headers, body: f });
        setPendingUploads(prev => [...prev, { url: publicUrl, contentType: ctype || f.type, name: f.name, size: f.size }]);
      } catch (e) {
        console.error('Upload failed', e);
      }
    }
  }

  // Fetch a remote image/GIF and attach it by uploading to our storage
  async function addRemoteAsUpload(remoteUrl: string, fallbackName?: string) {
    try {
      const r = await fetch(remoteUrl, { mode: 'cors' });
      if (!r.ok) throw new Error('fetch failed');
      const blob = await r.blob();
      const type = blob.type || 'image/gif';
      const ext = type.startsWith('image/') ? type.split('/')[1] : 'gif';
      const name = fallbackName || `image-${Date.now()}.${ext}`;
      const token = localStorage.getItem('token') || '';
      const { url, headers, publicUrl } = await signUpload({ filename: name, contentType: type, size: blob.size }, token);
      await fetch(url, { method: 'PUT', headers, body: blob });
      setPendingUploads(prev => [...prev, { url: publicUrl, contentType: type, name, size: blob.size }]);
    } catch (e) {
      console.error('Failed to import remote image', e);
      // As a last resort, show the remote image URL directly
      setPendingUploads(prev => [...prev, { url: remoteUrl, contentType: 'image/gif', name: fallbackName || 'image.gif', size: 0 }]);
    }
  }

  // Paste images directly into the composer
  async function onComposerPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    try {
      const dt = e.clipboardData;
      if (!dt) return;
      const images: File[] = [];
      // Prefer items for accurate detection
      if (dt.items && dt.items.length > 0) {
        for (let i = 0; i < dt.items.length; i++) {
          const it = dt.items[i];
          if (it.kind === 'file') {
            const f = it.getAsFile();
            if (f && f.type && f.type.startsWith('image/')) images.push(f);
          }
        }
      }
      if (images.length === 0 && dt.files && dt.files.length > 0) {
        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files[i];
          if (f && f.type && f.type.startsWith('image/')) images.push(f);
        }
      }
      if (images.length === 0) return;
      e.preventDefault(); // prevent raw image/text paste into input
      const token = localStorage.getItem('token') || '';
      const MAX = 10 * 1024 * 1024; // 10MB
      for (const f of images) {
        if (f.size > MAX) { console.warn('Pasted image too large'); continue; }
        const ext = (f.type && f.type.startsWith('image/')) ? f.type.split('/')[1] : 'png';
        const name = f.name && f.name.trim() ? f.name : `pasted-${Date.now()}.${ext}`;
        try {
          const { url, headers, publicUrl } = await signUpload({ filename: name, contentType: f.type || 'image/png', size: f.size }, token);
          await fetch(url, { method: 'PUT', headers, body: f });
          setPendingUploads(prev => [...prev, { url: publicUrl, contentType: f.type || 'image/png', name, size: f.size }]);
        } catch (err) {
          console.error('Paste upload failed', err);
        }
      }
    } catch {}
  }

  function isMine(m: Msg) {
    return !!m.optimistic || (!!m.authorId && m.authorId === me.userId);
  }

  function startEdit(m: Msg) {
    if (!isMine(m)) return;
    try { setPickerFor(null); } catch {}
    setEditingId(m.id);
    setEditText(m.content);
  }

  // Add images directly to a gallery channel
  async function addGalleryFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const token = localStorage.getItem('token') || '';
      const atts: { url: string; contentType?: string; name?: string; size?: number }[] = [];
      for (const f of Array.from(files)) {
        const name = f.name || 'image.jpg';
        const lower = name.toLowerCase();
        const type = (f.type || '').toLowerCase();
        const isPngJpg = type === 'image/png' || type === 'image/jpeg' || /\.(png|jpe?g)(\?.*)?$/.test(lower);
        if (!isPngJpg) continue; // skip non-png/jpeg (e.g., gif)
        const signType = type || (lower.endsWith('.png') ? 'image/png' : 'image/jpeg');
        const up = await signUpload({ filename: name, contentType: signType, size: f.size }, token);
        await fetch(up.url, { method: 'PUT', headers: up.headers, body: f });
        atts.push({ url: up.publicUrl, contentType: signType, name, size: f.size });
      }
      if (atts.length === 0) return;
      const tempId = crypto.randomUUID();
      const kk = k(currentVoidId, currentChannelId);
      setMsgsByKey(old => ({ ...old, [kk]: [...(old[kk] ?? []), { id: tempId, content: '', optimistic: true, attachments: atts }] }));
      socket.emit('message:send', { voidId: currentVoidId, channelId: fq(currentVoidId, currentChannelId), content: '', tempId, attachments: atts });
    } catch (e: any) {
      toast(e?.message || 'Failed to add photos', 'error');
    } finally {
      try { if (galleryFileRef.current) galleryFileRef.current.value = ''; } catch {}
    }
  }

  function saveEdit() {
    const mid = editingId; if (!mid) return;
    const content = editText.trim();
    if (content.length === 0) return;
    socket.emit("message:edit", { messageId: mid, content });
    // optimistic update
    const kk = k(currentVoidId, currentChannelId);
    setMsgsByKey((old) => {
      const list = old[kk] ?? [];
      const idx = list.findIndex(m => m.id === mid);
      if (idx === -1) return old;
      const copy = [...list];
      copy[idx] = { ...copy[idx], content, optimistic: true };
      return { ...old, [kk]: copy };
    });
    // Close editor immediately after saving; server event will clear optimistic flag
    setEditingId(null);
    setEditText("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  function deleteMsg(m: Msg) {
    if (!isMine(m)) return;
    socket.emit("message:delete", { messageId: m.id });
    const kk = k(currentVoidId, currentChannelId);
    setMsgsByKey((old) => {
      const list = old[kk] ?? [];
      return { ...old, [kk]: list.filter(x => x.id !== m.id) };
    });
  }

  async function loadKanbanIfNeeded(fqChanId: string) {
    try {
      if (Object.prototype.hasOwnProperty.call(kanbanByChan, fqChanId)) return;
      const tok = localStorage.getItem('token') || '';
      const res = await api.getAuth(`/kanban?channelId=${encodeURIComponent(fqChanId)}`, tok);
      const lists = Array.isArray(res?.lists) ? res.lists as KanbanList[] : [];
      setKanbanByChan(old => ({ ...old, [fqChanId]: lists }));
    } catch {
      // Mark as loaded (empty) to avoid endless "Loading" and allow UI to render fallback
      setKanbanByChan(old => (Object.prototype.hasOwnProperty.call(old, fqChanId) ? old : { ...old, [fqChanId]: [] }));
    }
  }

  async function reloadKanban(fqChanId: string) {
    try {
      const tok = localStorage.getItem('token') || '';
      const res = await api.getAuth(`/kanban?channelId=${encodeURIComponent(fqChanId)}`, tok);
      const lists = Array.isArray(res?.lists) ? res.lists as KanbanList[] : [];
      setKanbanByChan(old => ({ ...old, [fqChanId]: lists }));
    } catch {
      // keep existing state on error
    }
  }

  // Proactively load kanban data for any favorited lists (works on landing)
  useEffect(() => {
    try {
      const need: string[] = [];
      for (const fid of favorites) {
        if (fid.startsWith('klist:')) {
          const parsed = parseListFav(fid);
          if (parsed) {
            const fqid = parsed.fqid;
            if (!(fqid in kanbanByChan)) need.push(fqid);
          }
        }
      }
      // De-dupe
      Array.from(new Set(need)).forEach(id => { loadKanbanIfNeeded(id); });
    } catch {}
  }, [favorites, kanbanByChan]);

  // Proactively load message previews for favorited channels
  useEffect(() => {
    try {
      for (const fid of favorites) {
        if (fid.startsWith('klist:')) continue; // handled separately
        const [vId, cId] = fid.split(':');
        if (!vId || !cId) continue;
        const fqid = fq(vId, cId);
        const haveMsgs = Array.isArray(msgsByKey[fqid]) && msgsByKey[fqid].length > 0;
        const havePrev = Object.prototype.hasOwnProperty.call(previewsByChan, fqid);
        if (!haveMsgs && !havePrev) {
          loadPreviewIfNeeded(fqid);
        }
      }
    } catch {}
  }, [favorites, previewsByChan, msgsByKey]);

  // If kanban exists but came back empty (due to timing or transient error), try one reload per channel
  const kanbanReloadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    try {
      for (const fid of favorites) {
        if (!fid.startsWith('klist:')) continue;
        const parsed = parseListFav(fid); if (!parsed) continue;
        const { fqid } = parsed;
        const lists = kanbanByChan[fqid];
        if (Array.isArray(lists) && lists.length === 0 && !kanbanReloadedRef.current.has(fqid)) {
          kanbanReloadedRef.current.add(fqid);
          reloadKanban(fqid);
        }
      }
    } catch {}
  }, [favorites, kanbanByChan]);

  async function loadFormIfNeeded(fqChanId: string) {
    try {
      if (formByChan[fqChanId]) return;
      const tok = localStorage.getItem('token') || '';
      const res = await api.getAuth(`/forms?channelId=${encodeURIComponent(fqChanId)}`, tok);
      const questions = Array.isArray(res?.questions) ? res.questions as FormQuestion[] : [];
      const answersObj: Record<string, string> = {};
      if (res?.answers && typeof res.answers === 'object') {
        for (const [qid, v] of Object.entries(res.answers as any)) { answersObj[qid] = String((v as any)?.answer || ''); }
      }
      const answersByUser: Record<string, Record<string, string>> = {};
      if (res?.answersByUser && typeof res.answersByUser === 'object') {
        for (const [uid, amap] of Object.entries(res.answersByUser as any)) {
          const inner: Record<string, string> = {};
          for (const [qid, a] of Object.entries(amap as any)) inner[qid] = String(a || '');
          answersByUser[String(uid)] = inner;
        }
      }
      setFormByChan(old => ({ ...old, [fqChanId]: { questions, answers: answersObj, answersByUser } }));
    } catch {}
  }
  async function loadHabitIfNeeded(fqChanId: string) {
    try {
      if (habitByChan[fqChanId]) return;
      const tok = localStorage.getItem('token') || '';
      const res = await api.getAuth(`/habits?channelId=${encodeURIComponent(fqChanId)}`, tok);
      setHabitByChan(old => ({ ...old, [fqChanId]: res }));
    } catch {}
  }

  // --- Voice controls ---
  async function joinVoice() {
    if (!currentVoidId || !currentChannelId) return;
    if (voiceJoined) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as any,
        video: false
      });
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach(t => t.enabled = !voiceMuted);
      setVoiceJoined(true);
      socket.emit('voice:join', { channelId: fq(currentVoidId, currentChannelId) });
      startMeter('self', stream);
    } catch {
      toast('Microphone permission denied or unavailable', 'error');
    }
  }
  function leaveVoice() {
    try { socket.emit('voice:leave'); } catch {}
    for (const pc of pcMapRef.current.values()) { try { pc.close(); } catch {} }
    pcMapRef.current.clear();
    remoteStreamsRef.current.clear();
    setVoicePeers({});
    if (localStreamRef.current) { for (const t of localStreamRef.current.getTracks()) { try { t.stop(); } catch {} } }
    localStreamRef.current = null;
    stopMeter('self');
    // close audio context if any
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    setVoiceJoined(false);
  }
  function toggleMute() {
    setVoiceMuted((m) => {
      const nm = !m;
      const ls = localStreamRef.current;
      if (ls) ls.getAudioTracks().forEach(t => t.enabled = !nm);
      return nm;
    });
  }

  function formatTime(ts?: string) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      // Include date + time for clarity in DMs and channels
      // Example: Jan 05, 3:42 PM
      return d.toLocaleString([], {
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      } as Intl.DateTimeFormatOptions);
    } catch { return ''; }
  }

  function toggleReaction(m: Msg, emoji: string) {
    const kk = k(currentVoidId, currentChannelId);
    const mine = !!m.reactions?.[emoji]?.mine;
    // optimistic update
    setMsgsByKey((old) => {
      const list = old[kk] ?? [];
      const idx = list.findIndex(x => x.id === m.id);
      if (idx === -1) return old;
      const copy = [...list];
      const prev = copy[idx].reactions || {};
      const cur = prev[emoji] || { count: 0, mine: false };
      const nextCount = Math.max(0, cur.count + (mine ? -1 : 1));
      const next = { ...prev, [emoji]: { count: nextCount, mine: !mine } };
      if (nextCount === 0) { delete next[emoji]; }
      copy[idx] = { ...copy[idx], reactions: next };
      return { ...old, [kk]: copy };
    });
    if (mine) socket.emit("reaction:remove", { messageId: m.id, emoji });
    else socket.emit("reaction:add", { messageId: m.id, emoji });
  }
  function switchVoid(id: string) {
    if (id === currentVoidId) return;
    if (voiceJoined) leaveVoice();
    setCurrentVoidId(id);
    socket.emit("void:switch", { voidId: id });
    socket.emit("channel:list", { voidId: id });
    // load members list for presence sidebar
    (async () => {
      try {
        const tok = localStorage.getItem('token') || '';
        const res = await api.getAuth(`/spaces/members?spaceId=${encodeURIComponent(id)}`, tok);
        setMembers(res.members || []);
      } catch {}
    })();
    if (String(id).startsWith('dm_')) {
      // Ensure DM icon is visible in spaces when opened
      setHiddenDms(prev => prev.filter(x => x !== id));
      // Clear unread + notification for this DM when opened via icon
      const cid = `${id}:chat`;
      setUnread(prev => ({ ...prev, [cid]: 0 }));
      setNotified(prev => { const n = { ...prev }; delete n[cid]; return n; });
      setCurrentChannelId('chat');
      socket.emit("channel:switch", { voidId: id, channelId: `${id}:chat` });
    } else {
      const v = voids.find(vv => vv.id === id) as any;
      const home = v?.homeChannelId as string | undefined;
      const short = home && home.includes(':') ? home.split(':')[1] : (home || 'general');
      setCurrentChannelId(short);
      socket.emit("channel:switch", { voidId: id, channelId: fq(id, short) });
    }
    setTypers({}); setRoomUserIds([]);
  }
  function switchChannel(id: string) {
    if (id === currentChannelId) return;
    if (voiceJoined) leaveVoice();
    setCurrentChannelId(id);
    const fqid = fq(currentVoidId, id);
    socket.emit("channel:switch", { voidId: currentVoidId, channelId: fqid });
    setTypers({});
    // clear unread + notified once user opens
    const cid = fq(currentVoidId, id);
    setUnread(prev => ({ ...prev, [cid]: 0 }));
    setNotified(prev => { const n = { ...prev }; delete n[cid]; return n; });
    const meta = channels.find(c => c.id === id);
    if (meta && meta.type === 'kanban') { loadKanbanIfNeeded(fqid); }
    if (meta && meta.type === 'form') { loadFormIfNeeded(fqid); }
    if (meta && meta.type === 'habit') { loadHabitIfNeeded(fqid); }
  }

  // --- Minimal UI ---
  return (
    <div className="h-app w-full flex brand-app-bg text-neutral-100 overflow-hidden">
      <ToastHost />
      <ConfirmHost />
      {/* Left columns: Space icons + Channels */}
      {/* Space icons column */}
      <div className="hidden md:flex w-16 border-r border-neutral-800/60 bg-transparent flex-col py-3 min-h-0">
        {/* Profile button at top (now navigates to landing) */}
        <div className="px-1 flex items-center justify-center">
          <button
            className="h-10 w-10 rounded-full overflow-hidden border border-neutral-700 bg-neutral-900 flex items-center justify-center hover:border-emerald-600"
            title="Profile"
            onClick={() => { setVoidSheetOpen(false); setChanSheetOpen(false); setUsersSheetOpen(false); if (voiceJoined) leaveVoice(); setCurrentVoidId(""); setCurrentChannelId("general"); }}
          >
            {me?.avatarUrl ? (
              <img src={me.avatarUrl} alt="me" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[10px] text-neutral-400">{(me?.name?.[0] || user?.username?.[0] || '?').toUpperCase()}</span>
            )}
          </button>
        </div>
        {/* Scrollable spaces (DMs included with a close control; hidden DMs reappear on unread) */}
        <div className="mt-3 flex-1 overflow-auto flex flex-col items-center gap-3">
        {/* Draggable spaces */}
        {(() => {
          const isDm = (id:string) => String(id).startsWith('dm_');
          const nonDm = voids.filter(v => !isDm(v.id));
          const dms = voids.filter(v => {
            if (!isDm(v.id)) return false;
            const unreadCount = unread[`${v.id}:chat`] || 0;
            // If DM is hidden, only show when it has unread and is not muted
            if (hiddenDms.includes(v.id)) return (unreadCount > 0) && !mutedSpaces[v.id];
            return true;
          });
          const ordered = [...nonDm].sort((a,b) => {
            const ia = spaceOrder.indexOf(a.id); const ib = spaceOrder.indexOf(b.id);
            return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
          });
          const dmOrdered = [...dms].sort((a,b) => (a.name||'').localeCompare(b.name||''));
          return ordered.concat(dmOrdered).map(v => {
          const hasUnread = Object.keys(unread).some(k => k.startsWith(`${v.id}:`) && (unread[k]||0) > 0);
          const dmCount = String(v.id).startsWith('dm_') ? (unread[`${v.id}:chat`] || 0) : 0;
          return (
            <div key={v.id} className="relative">
              <button onClick={() => switchVoid(v.id)} title={v.name}
                className={`relative h-10 w-10 rounded-full overflow-hidden border ${v.id===currentVoidId?'border-emerald-600 shadow-[0_0_0_2px_rgba(16,185,129,0.35)]':'border-neutral-800'} bg-neutral-900 flex items-center justify-center`}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', v.id); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const src = e.dataTransfer.getData('text/plain'); if (!src || src===v.id) return; setSpaceOrder((prev)=>{ const a=[...prev]; const si=a.indexOf(src); const ti=a.indexOf(v.id); if(si===-1||ti===-1){ return a;} a.splice(si,1); a.splice(ti,0,src); return a; }); }}
            >
              {v.avatarUrl ? (
                <img src={v.avatarUrl} alt={v.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-[10px] text-neutral-400">{(v.name?.[0]||'?').toUpperCase()}</span>
              )}
            </button>
            {/* Unread badges outside the cropped circle */}
            {dmCount > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-emerald-700 text-emerald-50 border border-neutral-900 text-[10px] flex items-center justify-center">
                {dmCount > 99 ? '99+' : dmCount}
              </span>
            ) : hasUnread ? (
              <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border border-neutral-900"></span>
            ) : null}
              {/* Close control only for DM spaces */}
              {String(v.id).startsWith('dm_') && (
                <button
                  className="absolute -top-1 -left-1 h-4 w-4 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 flex items-center justify-center text-[10px]"
                  title="Hide DM from spaces"
                  onClick={(e)=>{ e.stopPropagation(); setHiddenDms(prev => prev.includes(v.id) ? prev : prev.concat(v.id)); }}
                  aria-label="Hide DM"
                >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                </button>
              )}
              {/* Mute toggle moved to settings */}
            </div>
          );
        }); })()}
        </div>
        {/* Bottom actions: New space and Settings gear */}
        <div className="mt-3 px-1 flex flex-col items-center gap-3">
          <button
            className="h-10 w-10 rounded-full border border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-emerald-600"
            title="New Space"
            onClick={createSpace}
          >
            +
          </button>
          <button
            className="h-10 w-10 rounded-full border border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-emerald-600 flex items-center justify-center"
            title="Space Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 20.17a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 15.4 1.65 1.65 0 0 0 1.5 14H1.41a2 2 0 1 1 0-4H1.5A1.65 1.65 0 0 0 3 8.6 1.65 1.65 0 0 0 2.17 6.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.83 1.65 1.65 0 0 0 9.5 2.5V2.41a2 2 0 1 1 4 0V2.5A1.65 1.65 0 0 0 15.4 3a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21 8.6c.36.5.57 1.11.5 1.77H21.5a2 2 0 1 1 0 4H21.5A1.65 1.65 0 0 0 19.4 15z"/>
            </svg>
          </button>
        </div>
      </div>
      {/* Resizer before people column (disabled while People column hidden) */}
      {showPeople && (
        <div
          className="hidden md:block w-1 cursor-col-resize bg-transparent hover:bg-neutral-700/40 order-last"
          onMouseDown={(e) => startDrag('people', e.clientX)}
          role="separator"
          aria-label="Resize people column"
        />
      )}

      {/* People column (click to open profile/actions) */}
      {showPeople && (
      <div className="hidden md:flex border-l border-neutral-800/60 bg-neutral-900/30 flex-col min-h-0 order-last" style={{ width: `${peopleW}px` }}>
        <div className="h-12 flex items-center px-3 border-b border-neutral-800/60 font-semibold text-teal-300">People</div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {members.map(m => {
            const online = globalUserIds.includes(m.id) || spaceUserIds.includes(m.id) || roomUserIds.includes(m.id);
            const onMobile = globalMobileIds.includes(m.id) || spaceMobileIds.includes(m.id) || roomMobileIds.includes(m.id);
            const st = String(m.status || '').toLowerCase();
            let label = 'Offline';
            if (st === 'dnd') { label = 'Do Not Disturb'; }
            else if (st === 'idle') { label = 'Idle'; }
            else if (st === 'invisible') { label = 'Offline'; }
            else if (online) { label = 'Online'; }
            return (
              <div key={m.id} className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-neutral-800/40">
                <button className="flex-1 text-left flex items-center gap-2" onClick={()=>{ if (m.id !== me.userId) setViewUserId(m.id); }}>
                <div className="relative h-8 w-8">
                  {(() => { const ring = (st === 'dnd') ? '#ef4444' : (st === 'idle') ? '#f59e0b' : ((online && onMobile) ? '#14b8a6' : (online ? '#10b981' : null)); return ring ? (<span className="pointer-events-none absolute -inset-0.5 rounded-full" style={{ border: `2px solid ${ring}`, boxShadow: `0 0 10px ${ring}` }}></span>) : null; })()}
                  <div className="h-8 w-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                    {m.avatarUrl ? <img src={m.avatarUrl} alt="avatar" className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(m.name?.[0]||'?').toUpperCase()}</span>}
                  </div>
                  {/* Status dot replaced by ring */}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-neutral-200 text-sm" style={m.nameColor ? { color: String(m.nameColor) } : undefined}>{m.name || m.username}</div>
                  <div className="text-[10px] text-neutral-400">{label}{m.role ? ` - ${m.role}` : ''}</div>
                </div>
                </button>
              </div>
            );
          })}
          {members.length === 0 && <div className="text-neutral-500 text-sm px-2">No members</div>}
        </div>
      </div>
      )}

      {/* Channels column (resizable) - hidden on landing (no current space) */}
      {currentVoidId && (
      <div className="hidden md:flex border-r border-neutral-800/60 bg-neutral-900/40 flex-col min-h-0" style={{ width: `${chanW}px` }}>
        <div className="h-12 flex items-center px-3 border-b border-neutral-800/60 font-semibold text-emerald-300 truncate" title={voids.find(v=>v.id===currentVoidId)?.name || currentVoidId}>
          {voids.find(v=>v.id===currentVoidId)?.name || currentVoidId}
        </div>
        <div className="p-2 border-b border-neutral-800/60 text-neutral-400 text-sm">{String(currentVoidId).startsWith('dm_') ? 'Direct Message' : 'Channels'}</div>
        <div className="flex-1 overflow-auto">
          {String(currentVoidId).startsWith('dm_') ? (
            <ul className="p-2 space-y-1">
              <li className="relative group">
                <button className={`w-full text-left px-3 py-2 rounded-md transition-colors hover:bg-neutral-800/70 ${currentChannelId==='chat'?'bg-emerald-900/30 text-emerald-200 border border-emerald-800/40':''}`}
                        onClick={() => { const cid=fq(currentVoidId,'chat'); setUnread(u=>({ ...u, [cid]: 0 })); setNotified(n=>{ const x={...n}; delete x[cid]; return x; }); switchChannel('chat'); }}>
                  <span className="opacity-70 mr-1">#</span>Direct Message
                </button>
                <button className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-xs p-1 rounded hover:bg-neutral-800"
                        title="Favorite"
                        onClick={(e)=>{ e.stopPropagation(); toggleFav(currentVoidId, 'chat'); }}>
                  {isFav(currentVoidId,'chat') ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-amber-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-neutral-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                  )}
                </button>
              </li>
            </ul>
          ) : (
            <>
              {channels.length === 0 ? (
                <div className="p-3 text-neutral-500">No channels</div>
              ) : (
                <ul className="p-2 space-y-1">
                  {(() => {
                    const order = chanOrder[currentVoidId] || [];
                    const ordered = [...channels].sort((a,b)=>{
                      const ia = order.indexOf(a.id); const ib = order.indexOf(b.id);
                      return (ia===-1?1e9:ia) - (ib===-1?1e9:ib);
                    });
                    return ordered.map(ch => {
                      const cid = fq(currentVoidId, ch.id);
                      const count = unread[cid] || 0;
                      return (
                      <li key={ch.id} className="relative group" draggable onDragStart={(e)=>{ e.dataTransfer.setData('text/plain', ch.id); }} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); const src=e.dataTransfer.getData('text/plain'); if(!src||src===ch.id) return; setChanOrder(prev=>{ const cur=[...(prev[currentVoidId]||[])]; const si=cur.indexOf(src); const ti=cur.indexOf(ch.id); if(si===-1||ti===-1) return prev; cur.splice(si,1); cur.splice(ti,0,src); return { ...prev, [currentVoidId]: cur }; }); }} >
                        <button
                          className={`w-full text-left px-3 py-2 rounded-md transition-colors hover:bg-neutral-800/70 ${ch.id===currentChannelId?'bg-emerald-900/30 text-emerald-200 border border-emerald-800/40':''}`}
                          onClick={() => { setUnread(u=>({ ...u, [cid]: 0 })); setNotified(n=>{ const x={...n}; delete x[cid]; return x; }); switchChannel(ch.id); }}
                        >
                          <span className="opacity-70 mr-1 inline-block align-middle">
                            {ch.type==='voice' ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M11 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>
                            ) : ch.type==='announcement' ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 11v2"/><path d="M7 11v2"/><path d="M21 8a8.1 8.1 0 0 1-3.6 6.7L12 18v-6l5.4-2.7A8.1 8.1 0 0 0 21 8Z"/><path d="M12 18H7a3 3 0 0 1-3-3"/></svg>
                            ) : ch.type==='kanban' ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="4" width="6" height="16" rx="1"/><rect x="15" y="4" width="6" height="10" rx="1"/></svg>
                            ) : ch.type==='form' ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>
                            ) : ch.type==='habit' ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M9 14l2 2 4-4"/></svg>
                            ) : (
                              <span>#</span>
                            )}
                          </span>
                          {ch.name}
                          {count > 0 && <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-700 text-emerald-50 text-[11px]">{count}</span>}
                        </button>
                        <button className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-xs p-1 rounded hover:bg-neutral-800"
                                title="Favorite" onClick={(e)=>{ e.stopPropagation(); toggleFav(currentVoidId, ch.id); }}>
                          {isFav(currentVoidId, ch.id) ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-amber-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-neutral-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                          )}
                        </button>
                      </li>
                      );
                    }); })()}
                </ul>
              )}
              {/* End channel list for non-DM spaces */}
            </>
          )}
        </div>
        <div className="p-2 border-t border-neutral-800/60">
          <div className="h-px w-full bg-neutral-800/60 mb-2" />
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <span className={`inline-block h-2 w-2 rounded-full ${status==='connected' ? 'bg-emerald-500' : status==='connecting' ? 'bg-amber-500' : 'bg-red-500'}`}></span>
            <span>Status: {status}</span>
          </div>
        </div>
      </div>
      )}

      {/* Resizer between channels and main (hidden on landing) */}
      {currentVoidId && (
        <div
          className="hidden md:block w-1 cursor-col-resize bg-transparent hover:bg-neutral-700/40"
          onMouseDown={(e) => startDrag('chan', e.clientX)}
          role="separator"
          aria-label="Resize channels column"
        />
      )}

      {/* Main column */}
      <div className="flex-1 grid grid-rows-[auto,1fr,auto,auto] min-h-0 pb-4">
        {/* Header */}
        <div className="h-12 w-full max-w-full flex items-center justify-between px-4 border-b border-emerald-900/40 bg-gradient-to-r from-emerald-950/60 via-teal-950/40 to-emerald-950/60 overflow-hidden md:static fixed inset-x-0 top-0 z-20 safe-top">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile toggles */}
            <button className="md:hidden h-9 w-9 rounded border border-neutral-700 bg-neutral-900 text-neutral-300 flex items-center justify-center"
                    title="Spaces" onClick={()=>setVoidSheetOpen(true)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <circle cx="5" cy="12" r="2"/>
                <circle cx="12" cy="12" r="2"/>
                <circle cx="19" cy="12" r="2"/>
              </svg>
            </button>
            {/* Mobile: use edge-swipe gestures for Channels and People; hide extra buttons to declutter */}
            {currentVoidId ? (
              <div className="font-semibold text-emerald-300 truncate max-w-[40vw] sm:max-w-[45vw]">#{currentChannel?.name ?? currentChannelId}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-300 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                {me?.avatarUrl ? (
                  <img src={me.avatarUrl} alt="avatar" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-neutral-400">
                    {(me?.name?.[0] || user?.username?.[0] || '?').toUpperCase()}
                  </span>
                )}
              </div>
              {(() => {
                let color: string | undefined;
                try {
                  const raw = localStorage.getItem('user');
                  const u = raw ? JSON.parse(raw) : null;
                  if (u && u.nameColor) color = String(u.nameColor);
                  else {
                    const alt = localStorage.getItem('nameColor');
                    if (alt) color = String(alt);
                  }
                } catch {}
                return <span className="truncate max-w-[32vw] sm:max-w-xs" style={color ? { color } : undefined}>{me?.name || user?.username}</span>;
              })()}
            </div>
            {/* Friends and Logout moved into modals */}
            <button className="h-9 w-9 rounded border border-neutral-700 bg-neutral-900 text-neutral-300 flex items-center justify-center"
                    title="Friends" onClick={()=>setFriendsOpen(true)}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Removed top channel bar; channels now in left column */}

        {/* Messages, Kanban, or landing */}
        <div ref={listRef} className="overflow-auto p-4 space-y-2 bg-transparent pt-16 pb-44 md:pt-0 md:pb-8">
          {currentVoidId && currentChannel?.type === 'voice' && voiceJoined && (
            <div className="max-w-5xl mx-auto py-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
                {(() => {
                  const list: { id: string; name: string }[] = [];
                  list.push({ id: 'self', name: me?.name || user?.username || 'You' });
                  for (const [pid, info] of Object.entries(voicePeers)) {
                    list.push({ id: pid, name: info?.name || 'User' });
                  }
                  return list.map(p => {
                    const lvl = Math.min(1, Math.max(0, voiceLevels[p.id] || 0));
                    const deg = Math.max(12, Math.round(lvl * 360));
                    const speaking = lvl > 0.2;
                    const mem = p.id==='self' ? { avatarUrl: me?.avatarUrl || null } : members.find(mm => mm.id === (voicePeers[p.id]?.userId || '')) || {} as any;
                    const avatar = mem?.avatarUrl || null;
                    const initial = (p.id==='self' ? (me?.name || user?.username || 'You') : p.name || 'U').trim()[0]?.toUpperCase() || 'U';
                    const vol = voiceVolumes[p.id] ?? 1;
                    const mutedLocal = p.id==='self' ? voiceMuted : !!voiceSilenced[p.id];
                    return (
                      <div key={p.id} className={`rounded-xl border border-neutral-800 bg-neutral-950/50 p-4 flex flex-col items-center min-h-[360px] ${speaking ? 'shadow-[0_0_0_2px_rgba(16,185,129,0.15)]' : ''}`}>
                        <div className="relative">
                          <div className="h-16 w-16 rounded-full p-[2px]" style={{ background: `conic-gradient(rgb(16 185 129) ${deg}deg, rgb(38 38 38) 0deg)` }}>
                            <div className={`h-full w-full rounded-full overflow-hidden ${speaking ? 'bg-neutral-900/80' : 'bg-neutral-900/60'}`}>
                              {avatar ? (
                                <img src={avatar} alt={p.name || 'avatar'} className="h-full w-full object-cover" />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-base">
                                  <span className="text-neutral-200">{p.id==='self' ? (voiceMuted ? '??' : initial) : initial}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          {p.id==='self' && voiceMuted && (
                            <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-neutral-900 border border-neutral-700 text-red-400 flex items-center justify-center" title="Muted"> 
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M13.5 14.5V9.4a3.4 3.4 0 0 0-5.7-2.4L5 9H2v6h3l2.8 2.8a3.4 3.4 0 0 0 5.7-2.4Z"/><path d="m14 9 7-7"/></svg>
                            </span>
                          )}
                        </div>
                        <div className="mt-2 text-neutral-200 text-sm truncate max-w-[14ch]">{p.id==='self' ? (voiceMuted ? 'You (muted)' : 'You') : p.name}</div>
                        <div className="mt-3 flex flex-col items-center gap-3 w-full">
                          <div className="relative h-[240px] flex items-center justify-center w-full">
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={vol}
                              onChange={(e)=>{
                                const v = Number(e.target.value);
                                setVoiceVolumes(prev => ({ ...prev, [p.id]: v }));
                                const el = audioElsRef.current.get(p.id);
                                if (el) el.volume = v;
                              }}
                              className="accent-emerald-500"
                              style={{ transform: 'rotate(-90deg)', width: '220px', height: '28px', transformOrigin: 'center' }}
                              aria-label={`Volume for ${p.name||'user'}`}
                            />
                          </div>
                          <button
                            className={`px-2 py-1 rounded border text-xs inline-flex items-center justify-center ${mutedLocal ? 'border-red-700 bg-red-900/40 text-red-200' : 'border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'}`}
                            onClick={() => {
                              if (p.id==='self') { toggleMute(); }
                              else {
                                setVoiceSilenced(prev => {
                                  const val = !prev[p.id];
                                  const next = { ...prev, [p.id]: val };
                                  const el = audioElsRef.current.get(p.id);
                                  if (el) el.muted = val;
                                  return next;
                                });
                              }
                            }}
                            title={mutedLocal ? 'Unmute' : 'Mute'}
                            aria-label={mutedLocal ? 'Unmute' : 'Mute'}
                          >
                            {mutedLocal ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-400">
                                <path d="M13.5 14.5V9.4a3.4 3.4 0 0 0-5.7-2.4L5 9H2v6h3l2.8 2.8a3.4 3.4 0 0 0 5.7-2.4Z"/>
                                <path d="m14 9 7-7"/>
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                <path d="M11 5 6 9H2v6h4l5 4V5Z"/>
                                <path d="M19 12a4 4 0 0 0-4-4"/>
                                <path d="M19 12a4 4 0 0 1-4 4"/>
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
          {!currentVoidId ? (
            <div className="h-full w-full flex items-center justify-center">
              <div className="relative w-full max-w-3xl mx-auto">
                <div className="relative z-10 rounded-2xl border border-neutral-800 bg-neutral-900/80 p-6 md:p-8 shadow-2xl text-center">
                  <div className="flex items-center justify-center mb-3">
                    <img src="/brand/echo_plant_name.png" alt="Echo" className="h-24 md:h-28 w-auto object-contain opacity-95" />
                  </div>
                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button onClick={createSpace} className="group text-left rounded-xl border border-neutral-800 bg-neutral-950/50 hover:border-emerald-700 hover:bg-emerald-900/10 transition-colors p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12 5v14M5 12h14"/></svg>
                        </div>
                        <div>
                          <div className="text-neutral-100 font-medium">New Space</div>
                          <div className="text-neutral-400 text-xs">Create a place for your team</div>
                        </div>
                      </div>
                    </button>
                    <button onClick={acceptInvite} className="group text-left rounded-xl border border-neutral-800 bg-neutral-950/50 hover:border-emerald-700 hover:bg-emerald-900/10 transition-colors p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                        </div>
                        <div>
                          <div className="text-neutral-100 font-medium">Join a Space</div>
                          <div className="text-neutral-400 text-xs">Use an invite to join a space</div>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
                {voids && voids.length>0 && (
            <div className="relative z-10 mt-6 max-w-5xl mx-auto">
              <div className="mb-2 text-neutral-300 font-medium text-center">Your Spaces</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 justify-center mx-auto">
                {voids.filter(v=>!String(v.id).startsWith('dm_')).map(v => {
                  const total = Object.keys(unread).reduce((a,k)=> k.startsWith(v.id+':') ? a + (unread[k]||0) : a, 0);
                  const badge = total>99 ? '99+' : (total||'');
                  return (
                  <button key={v.id} onClick={()=>switchVoid(v.id)} className="relative group text-left rounded-xl border border-neutral-800 bg-neutral-900/60 hover:border-emerald-700 p-3 flex items-center gap-3 w-full">
                    <div className="relative h-10 w-10 rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                      {v.avatarUrl ? (
                        <img src={v.avatarUrl} alt={v.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-neutral-400 text-sm">{(v.name?.[0]||'?').toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-neutral-200">{v.name}</div>
                      <div className="text-xs text-neutral-500 group-hover:text-neutral-400">Open space</div>
                    </div>
                    {total>0 && (
                      <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-700 text-emerald-50 text-[11px]">{badge}</span>
                    )}
                  </button>
                  );
                })}
              </div>
              {/* Favorites Dashboard */}
              {favorites.length > 0 && (
                <div className="relative z-10 mt-8 max-w-6xl mx-auto">
                  <div className="mb-2 text-neutral-300 font-medium text-center">Favorites Dashboard</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {favorites.slice(0, 4).map(fid => {
                      if (fid.startsWith('klist:')) {
                        const parsed = parseListFav(fid);
                        if (!parsed) return null as any;
                        const { vId, cIdRaw, fqid, listId } = parsed;
                        const cId = cIdRaw.includes(':') ? cIdRaw.split(':')[1] : cIdRaw;
                        const v = voids.find(vv => vv.id === vId);
                        const vName = v?.name || vId;
                        const lists = kanbanByChan[fqid];
                        const list = lists?.find(l => l.id === listId);
                        const cMeta = vId === currentVoidId ? channels.find(c=>c.id===cId) : null;
                        const cName = cMeta?.name || (cId === 'chat' && vId.startsWith('dm_') ? 'Direct Message' : cId);
                        const incomplete = list ? list.items.filter(it => !it.done).slice(0, 10) : [];
                        return (
                          <div key={fid} className="relative rounded-xl border border-neutral-800 bg-neutral-900/70 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="min-w-0">
                                <div className="truncate text-neutral-200 text-sm">{vName} <span className="opacity-50">/</span> <span className="text-emerald-300">#{cName}</span> <span className="opacity-50">/</span> <span className="text-neutral-200">{list?.name || 'List'}</span></div>
                                {list && <div className="text-[11px] text-neutral-400">{incomplete.length} incomplete</div>}
                              </div>
                              <div className="flex items-center gap-2">
                                <button className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60"
                                        onClick={()=>{ switchVoid(vId); const shortId = cId.includes(':') ? cId.split(':')[1] : cId; switchChannel(shortId); }}
                                >Open</button>
                                <button className="text-xs p-1 rounded hover:bg-neutral-800" title="Remove favorite" onClick={()=>setFavorites(prev=>prev.filter(x=>x!==fid))}>
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-neutral-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                                </button>
                              </div>
                            </div>
                            <div ref={(el)=>{ favScrollRefs.current[fid] = el; }} className="min-h-[72px] max-h-48 overflow-auto space-y-2 text-[12px]">
                              {lists === undefined ? (
                                <div className="text-neutral-500">Loading lists...</div>
                              ) : (!list && (lists?.length || 0) === 0) ? (
                                <div className="text-neutral-500 flex items-center justify-between gap-2">
                                  <span>Open this kanban once to load lists.</span>
                                  <button className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60" onClick={()=>{ kanbanReloadedRef.current.delete(fqid); reloadKanban(fqid); }}>Retry</button>
                                </div>
                              ) : !list ? (
                                <div className="text-neutral-500">List not found or removed</div>
                              ) : (
                                incomplete.length === 0 ? (
                                  <div className="text-neutral-500">No incomplete tasks</div>
                                ) : (
                                  incomplete.map(it => (
                                    <div key={it.id} className="px-2 py-1 rounded border border-neutral-800 bg-neutral-950/50 flex items-start gap-2">
                                      <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={false} onChange={async(e)=>{
                                        try { const tok=localStorage.getItem('token')||''; await api.patchAuth('/kanban/items',{ itemId: it.id, done: e.target.checked }, tok); } catch {}
                                        setKanbanByChan(old => {
                                          const all = (old[fqid]||[]).map(l=>({ ...l, items: [...l.items] }));
                                          const L = all.find(l=>l.id===listId); if(!L) return old;
                                          const idx = L.items.findIndex(x=>x.id===it.id); if(idx!==-1){ L.items[idx] = { ...L.items[idx], done: true }; }
                                          return { ...old, [fqid]: all };
                                        });
                                      }} />
                                      <div className="flex-1 min-w-0 text-neutral-200 whitespace-pre-wrap break-words">{it.content}</div>
                                    </div>
                                  ))
                                )
                              )}
                            </div>
                          </div>
                        );
                      } else {
                        const [vId, cId] = fid.split(":");
                        const v = voids.find(vv => vv.id === vId);
                        const vName = v?.name || vId.replace(/^dm_/, 'DM ');
                        const cMeta = vId === currentVoidId ? channels.find(c=>c.id===cId) : null;
                        const cName = cMeta?.name || (cId === 'chat' && vId.startsWith('dm_') ? 'Direct Message' : cId);
                        const kk = k(vId, cId);
                        const mbase = (msgsByKey[kk] || []).map(m => ({ id: m.id, content: m.content, authorName: m.authorName, createdAt: m.createdAt || '', attachments: (m.attachments || []) as any }));
                        const pbase = (previewsByChan[`${vId}:${cId}`] || []).map(x => ({ id: x.id, content: x.content, authorName: x.authorName, createdAt: x.createdAt || '', attachments: (x.attachments || []) as any }));
                        const seen: Record<string, boolean> = {};
                        const merged = ([] as { id:string; content:string; authorName?:string; createdAt?:string; attachments?: any[] }[])
                          .concat(mbase, pbase)
                          .filter(it => { if (!it.id || seen[it.id]) return false; seen[it.id] = true; return true; })
                          .sort((a,b) => (new Date(a.createdAt||0).getTime()) - (new Date(b.createdAt||0).getTime()));
                        const mergedAll = merged;
                        const items = mergedAll.slice(-5);
                        const unreadCount = unread[`${vId}:${cId}`] || 0;
                        const fqid = fq(vId, cId);
                        const ctype = (vId === currentVoidId ? channels.find(c=>c.id===cId)?.type : undefined);
                        const hideComposer = ctype === 'kanban' || ctype === 'form' || ctype === 'habit' || !!kanbanByChan[fqid];
                        const looksLikeGallery = mergedAll.some(it => (it.attachments||[]).some((a:any)=>{ const t=String(a?.contentType||'').toLowerCase(); const u=String(a?.url||'').toLowerCase(); return t.startsWith('image/') || /\.(png|jpe?g|webp)(\?.*)?$/.test(u); }));
                        if (ctype === 'gallery' || looksLikeGallery) {
                          // Photo frame view for gallery favorites: show latest image only
                          let frame: any = null;
                          for (let i = mergedAll.length - 1; i >= 0; i--) {
                            const atts = mergedAll[i].attachments || [];
                            const img = atts.find((a:any)=>{ const t=String(a?.contentType||'').toLowerCase(); const u=String(a?.url||'').toLowerCase(); return t.startsWith('image/') || /\.(png|jpe?g|webp)(\?.*)?$/.test(u); });
                            if (img) { frame = { url: img.url, name: img.name }; break; }
                          }
                          return (
                            <button key={fid} className="relative rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden group"
                                    onClick={()=>{ switchVoid(vId); const shortId = cId.includes(':') ? cId.split(':')[1] : cId; switchChannel(shortId); }}
                                    title={`${vName} / #${cName}`}>
                              <div className="relative w-full pt-[66%]">
                                {frame ? (
                                  <img src={frame.url} alt={frame.name||'image'} className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                                ) : (
                                  <div className="absolute inset-0 flex items-center justify-center text-neutral-500">No images yet</div>
                                )}
                              </div>
                            </button>
                          );
                        }
                        return (
                          <div key={fid} className="relative rounded-xl border border-neutral-800 bg-neutral-900/70 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="min-w-0">
                                <div className="truncate text-neutral-200 text-sm">{vName} <span className="opacity-50">/</span> <span className="text-emerald-300">#{cName}</span></div>
                                {unreadCount>0 && <div className="text-[11px] text-emerald-400">{unreadCount} unread</div>}
                              </div>
                              <div className="flex items-center gap-2">
                                <button className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60"
                                        onClick={()=>{ switchVoid(vId); const shortId = cId.includes(':') ? cId.split(':')[1] : cId; switchChannel(shortId); }}
                                >Open</button>
                                <button className="text-xs p-1 rounded hover:bg-neutral-800" title="Remove favorite" onClick={()=>setFavorites(prev=>prev.filter(x=>x!==fid))}>
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-neutral-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                                </button>
                              </div>
                            </div>
                            <div ref={(el)=>{ favScrollRefs.current[fid] = el; }} className="min-h-[88px] max-h-48 overflow-auto text-[12px]">
                              {ctype === 'gallery' ? (
                                (() => {
                                  // Find the most recent image attachment
                                  for (let i = items.length - 1; i >= 0; i--) {
                                    const atts = items[i].attachments || [];
                                    const img = atts.find((a:any)=>{ const t=String(a?.contentType||'').toLowerCase(); const u=String(a?.url||'').toLowerCase(); return t.startsWith('image/') || /\.(png|jpe?g|webp)(\?.*)?$/.test(u); });
                                    if (img) {
                                      return (
                                        <div key={items[i].id} className="relative w-full pt-[56%] rounded overflow-hidden border border-neutral-800 bg-neutral-950">
                                          <img src={img.url} alt={img.name||'image'} className="absolute inset-0 w-full h-full object-cover" />
                                        </div>
                                      );
                                    }
                                  }
                                  return <div className="text-neutral-500">No images yet</div>;
                                })()
                              ) : (
                                <div className="space-y-1">
                                  {items.length === 0 ? (
                                    <div className="text-neutral-500">Loading recent messages...</div>
                                  ) : (
                                    items.map(it => (
                                      <div key={it.id} className="px-2 py-1 rounded border border-neutral-800 bg-neutral-950/50">
                                        <div className="text-[11px] text-neutral-400">{it.authorName || 'User'}</div>
                                        <div className="text-neutral-200 truncate">{it.content}</div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Quick composer (hidden for special channels: kanban/form/habit) */}
                            {!hideComposer && (
                              <div className="mt-3 pt-3 border-t border-neutral-800 flex items-center gap-2">
                                <input
                                  className="min-w-0 flex-1 px-3 py-2 rounded bg-neutral-900 text-neutral-100 placeholder-neutral-500 outline-none focus:ring-2 focus:ring-emerald-600/60 border border-neutral-800/60 text-sm"
                                  placeholder={`Message #${cName}`}
                                  value={quickTextByFav[fid] || ''}
                                  onChange={(e) => setQuick(fid, (e.target as HTMLInputElement).value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); quickSend(fid); } }}
                                  autoComplete="off"
                                  autoCorrect="on"
                                  autoCapitalize="sentences"
                                  spellCheck={true}
                                  inputMode="text"
                                  name="chat-message"
                                  data-lpignore="true"
                                  data-1p-ignore
                                  data-bw-ignore
                                />
                                <button
                                  className="shrink-0 px-2 md:px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 hover:bg-emerald-700/70 text-emerald-50 flex items-center justify-center text-sm"
                                  onClick={() => quickSend(fid)}
                                  title="Send"
                                >
                                  <span className="md:hidden">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                      <path d="M22 2L11 13"/>
                                      <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                                    </svg>
                                  </span>
                                  <span className="hidden md:inline">Send</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      }
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
              </div>
            </div>
          ) : currentChannel?.type === 'habit' ? (
            <div className="min-h-full">
              {(() => {
                const fid = fq(currentVoidId, currentChannelId);
                const st = habitByChan[fid];
                const defs = st?.defs || [];
                const mine = st?.my || {};
                // Day window selector: 7, 14, 30 (default 14)
                const range = Math.max(7, Math.min(30, habitRangeByChan[fid] || 14));
                const today = new Date();
                const days: string[] = [];
                const fmt = (d: Date) => {
                  const y = d.getFullYear();
                  const m = String(d.getMonth()+1).padStart(2,'0');
                  const dd = String(d.getDate()).padStart(2,'0');
                  return `${y}-${m}-${dd}`; // local date (YYYY-MM-DD)
                };
                for (let i=(range||14)-1; i>=0; i--) { const d=new Date(); d.setDate(today.getDate()-i); days.push(fmt(d)); }
                return (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-emerald-300 font-semibold">Daily Tracker</div>
                      <div className="flex items-center gap-2 text-xs text-neutral-400">
                        <span>Range</span>
                        <select className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200" value={range}
                                onChange={(e)=>{ try { const v=parseInt((e.target as HTMLSelectElement).value,10); setHabitRangeByChan(prev=>({ ...prev, [fid]: (v===7||v===14||v===30)?v:14 })); } catch{} }}>
                          <option value="7">7 days</option>
                          <option value="14">14 days</option>
                          <option value="30">30 days</option>
                        </select>
                      </div>
                      <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={async()=>{
                        const nm = await askInput({ title:'New Task', label:'Task name', placeholder:'Drink water' });
                        if (!nm) return; try{ const tok=localStorage.getItem('token')||''; await api.postAuth('/habits/defs',{ channelId: fid, name: nm }, tok);}catch(e:any){ toast(e?.message||'Failed to add','error'); }
                      }}>+ Add Task</button>
                    </div>
                    <div className="rounded border border-neutral-800 bg-neutral-900/50 p-2">
                      <div className="text-sm text-neutral-300 mb-1">Leaderboard (last 7 days)</div>
                      <div className="flex flex-wrap gap-2 text-sm">
                        {(st?.leaderboard||[]).map((r,i)=>(<span key={r.userId} className="px-2 py-1 rounded border border-neutral-700 bg-neutral-800/40">{i+1}. {r.name}: {r.count}</span>))}
                        {(st?.leaderboard||[]).length===0 && <span className="text-neutral-500 text-sm">No data yet</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {defs.map(d => {
                        const opted = !!mine[d.id];
                        const pub = opted ? !!mine[d.id].public : true;
                        return (
                          <div key={d.id} className="px-2 py-1 rounded border border-neutral-700 bg-neutral-900/40 flex items-center gap-2">
                            <label className="flex items-center gap-1">
                              <input type="checkbox" checked={opted} onChange={async(e)=>{ try{ const tok=localStorage.getItem('token')||''; if(e.target.checked) await api.postAuth('/habits/opt',{ habitId:d.id, isPublic: pub }, tok); else await api.deleteAuth('/habits/opt',{ habitId:d.id }, tok);}catch{}}} />
                              <span className="text-neutral-200 text-sm">{d.name}</span>
                            </label>
                            {opted && (
                              <label className="flex items-center gap-1 text-xs text-neutral-400">
                                <input type="checkbox" checked={pub} onChange={async(e)=>{ try{ const tok=localStorage.getItem('token')||''; await api.postAuth('/habits/opt',{ habitId:d.id, isPublic: e.target.checked }, tok);}catch{}}} /> Public
                              </label>
                            )}
                            {/* Remove task (available to space owners; currently always visible) */}
                            <button className="ml-1 px-2 py-0.5 rounded border border-red-800 text-red-300 hover:bg-red-900/30 text-xs" title="Remove task" onClick={async()=>{
                              const ok = await askConfirm({ title:'Remove Task', message:`Remove task "${d.name}" for this channel?`, confirmText:'Remove' });
                              if (!ok) return;
                              try {
                                const tok = localStorage.getItem('token') || '';
                                await api.deleteAuth('/habits/defs', { habitId: d.id }, tok);
                              } catch (e) { toast((e as any)?.message || 'Failed to remove', 'error'); }
                            }}>
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                      {defs.length===0 && <div className="text-neutral-500 text-sm">No habits yet</div>}
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-[640px] w-full text-sm border-separate border-spacing-y-1">
                        <thead>
                          <tr>
                            <th className="text-left text-neutral-300 px-2">Habit</th>
                            {days.map(d => (<th key={d} className="text-[11px] text-neutral-400 px-2">{d.slice(5)}</th>))}
                          </tr>
                        </thead>
                        <tbody>
                          {defs.filter(d=>!!mine[d.id]).map(d => (
                            <tr key={d.id} className="bg-neutral-900/50">
                              <td className="px-2 py-1 text-neutral-200">
                                {d.name}
                                {(() => {
                                  try {
                                    const set = new Set((mine[d.id]?.days||[]));
                                    let streak = 0; const cur = new Date();
                                    for (;;) { const key = fmt(cur); if (set.has(key)) { streak++; cur.setDate(cur.getDate()-1); } else break; }
                                    return streak > 0 ? <span className="ml-2 text-[11px] text-emerald-400">Streak: {streak}</span> : null;
                                  } catch { return null; }
                                })()}
                              </td>
                              {days.map(dy => {
                                const done = !!mine[d.id].days?.includes(dy);
                                return (
                                  <td key={dy} className="px-2 py-1 text-center">
                                    <input type="checkbox" className="accent-emerald-500" checked={done} onChange={async(e)=>{ try{ const tok=localStorage.getItem('token')||''; const tid = habitByChan[fid]?.my?.[d.id]?.trackerId || ''; await api.postAuth('/habits/entry',{ trackerId: tid, defId: d.id, day: dy, done: e.target.checked }, tok); // optimistic update
                                      setHabitByChan(old=>{ const st=old[fid]; if(!st) return old; const my={ ...(st.my||{}) }; const cur={ trackerId: tid || my[d.id]?.trackerId, public: !!(my[d.id]?.public), days: [ ...(my[d.id]?.days||[]) ] }; const idx=cur.days.indexOf(dy); if(e.target.checked){ if(idx===-1) cur.days.push(dy);} else { if(idx!==-1) cur.days.splice(idx,1);} my[d.id]=cur; return { ...old, [fid]: { ...st, my } }; });
                                    }catch{}}} />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : currentChannel?.type === 'kanban' ? (
            <div className="min-h-full">
              <div className="mb-3 flex items-center gap-2">
                <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={async()=>{
                  const nm = await askInput({ title:'New List', label:'List name', placeholder:'To do' }); if(!nm) return; try{ const tok=localStorage.getItem('token')||''; await api.postAuth('/kanban/lists',{ channelId: fq(currentVoidId, currentChannelId), name: nm }, tok);}catch(e:any){ toast(e?.message||'Failed to create list','error'); }
                }}>+ Add List</button>
              </div>
              <div className="flex gap-3 overflow-auto pb-2">
                {(kanbanByChan[fq(currentVoidId, currentChannelId)]||[]).map(list => (
                  <div key={list.id} className="relative min-w-[240px] max-w-[280px] bg-neutral-900/60 border border-neutral-800 rounded p-2"
                       draggable
                       onDragStart={(e)=>{ e.dataTransfer.setData('text/kan-list', list.id); setListDrag({ dragId: list.id, overId: list.id, pos: 'before' }); }}
                       onDragEnd={()=> setListDrag({})}
                       onDragOver={(e)=>{ e.preventDefault(); }}
                       onDrop={async (e)=>{
                         const fid = fq(currentVoidId, currentChannelId);
                         const dragListId = e.dataTransfer.getData('text/kan-list');
                         if (dragListId) {
                           const all = kanbanByChan[fid] || [];
                           const order = all.map(l=>l.id).filter(id=>id!==dragListId);
                           const targetIdx = order.indexOf(list.id);
                           const insertIndex = (listDrag.overId===list.id && listDrag.pos==='after') ? targetIdx+1 : targetIdx;
                           order.splice(insertIndex,0,dragListId);
                           setKanbanByChan(old=>{
                             const arr = old[fid] || [];
                             const map = new Map(arr.map(l=>[l.id,l] as const));
                             const next = order.map(id=>map.get(id)!).filter(Boolean) as any;
                             return { ...old, [fid]: next };
                           });
                           try { const tok=localStorage.getItem('token')||''; await api.postAuth('/kanban/lists/reorder',{ channelId: fid, listIds: order }, tok); } catch {}
                           return;
                         }
                         const itemId = e.dataTransfer.getData('text/kan-item');
                         if (!itemId) return;
                         // find and remove from any list
                         setKanbanByChan(old => {
                           const lists = (old[fid]||[]).map(l=>({ ...l, items: [...l.items] }));
                           let moving:any=null; let fromListId:string|null=null;
                           for (const l of lists){ const idx=l.items.findIndex(it=>it.id===itemId); if(idx!==-1){ moving=l.items.splice(idx,1)[0]; fromListId=l.id; break; }}
                           if(!moving) return old;
                           const tgt = lists.find(l=>l.id===list.id); if(!tgt) return old;
                           tgt.items.push(moving);
                           // fire API reorders for source and target
                           (async()=>{
                             try{
                               const tok=localStorage.getItem('token')||'';
                               if(fromListId && fromListId!==list.id){
                                 const src = lists.find(l=>l.id===fromListId);
                                 await api.postAuth('/kanban/items/reorder',{ listId: fromListId, itemIds: (src?.items||[]).map(x=>x.id) }, tok);
                               }
                               await api.postAuth('/kanban/items/reorder',{ listId: list.id, itemIds: tgt.items.map(x=>x.id) }, tok);
                             }catch{}
                           })();
                           return { ...old, [fid]: lists };
                         });
                       }}
                  onDragOverCapture={(e)=>{
                    // show blue indicator before/after based on cursor
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const before = e.clientX < rect.left + rect.width/2;
                    setListDrag(prev => ({ ...prev, overId: list.id, pos: before ? 'before' : 'after' }));
                  }}
                  >
                    {listDrag.dragId && listDrag.overId === list.id && (
                      <div className="absolute top-0 bottom-0 w-1 bg-sky-500" style={{ pointerEvents: 'none', left: listDrag.pos==='before'? -6 : undefined, right: listDrag.pos==='after'? -6 : undefined }} />
                    )}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-semibold text-neutral-200 truncate" title={list.name}>{list.name}</div>
                        <button className="text-xs p-1 rounded hover:bg-neutral-800"
                                title="Favorite list"
                                onClick={() => toggleListFav(currentVoidId, currentChannelId, list.id)}>
                          {isListFav(currentVoidId, currentChannelId, list.id) ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-amber-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-neutral-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                          )}
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className="text-xs text-neutral-300 hover:text-emerald-300" title="Add Card" onClick={async()=>{ const txt=await askInput({ title:'New Card', label:'Text', placeholder:'Do the thing...' }); if(!txt) return; try{ const tok=localStorage.getItem('token')||''; await api.postAuth('/kanban/items',{ listId:list.id, content: txt }, tok);}catch(e:any){ toast(e?.message||'Failed to add','error'); } }}>+ Add</button>
                        <button className="text-xs text-neutral-400 hover:text-neutral-200" title="Rename" onClick={async()=>{ const nm=await askInput({ title:'Rename List', initialValue:list.name, label:'List name' }); if(!nm||nm===list.name) return; try{ const tok=localStorage.getItem('token')||''; await api.patchAuth('/kanban/lists',{ listId:list.id, name:nm }, tok);}catch(e:any){ toast(e?.message||'Failed to rename','error'); } }}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                        </button>
                         
                        <button className="text-xs text-red-400 hover:text-red-300" title="Delete" onClick={async()=>{ const ok=await askConfirm({ title:'Delete List', message:'Delete this list?', confirmText:'Delete' }); if(!ok) return; try{ const tok=localStorage.getItem('token')||''; await api.deleteAuth('/kanban/lists',{ listId:list.id }, tok);}catch(e:any){ toast(e?.message||'Failed to delete','error'); } }}>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {(() => {
                        const actives = list.items.filter(it => !it.done);
                        const dones = list.items.filter(it => !!it.done);
                        return (
                          <>
                            {actives.map((it) => (
                              <div key={it.id} className="relative p-2 rounded border border-neutral-800 bg-neutral-950/70" draggable onDragStart={(e)=>{ e.dataTransfer.setData('text/kan-item', it.id); setItemDrag({ dragId: it.id, overId: it.id, pos: 'before', listId: list.id }); }}
                                   onDragEnd={()=> setItemDrag({})}
                                   onDragOver={(e)=>{ e.preventDefault(); }}
                                   onDragOverCapture={(e)=>{ const rect=(e.currentTarget as HTMLDivElement).getBoundingClientRect(); const before = e.clientY < rect.top + rect.height/2; setItemDrag(prev=>({ ...prev, overId: it.id, pos: before? 'before':'after', listId: list.id })); }}
                                   onDrop={async (e)=>{
                                     const itemId = e.dataTransfer.getData('text/kan-item'); if(!itemId || itemId===it.id) return;
                                     const fid = fq(currentVoidId, currentChannelId);
                                     setKanbanByChan(old => {
                                       const lists = (old[fid]||[]).map(l=>({ ...l, items: [...l.items] }));
                                       let moving:any=null; let fromListId:string|null=null;
                                       for (const l of lists){ const i=l.items.findIndex(x=>x.id===itemId); if(i!==-1){ moving=l.items.splice(i,1)[0]; fromListId=l.id; break; }}
                                       if(!moving) return old;
                                       const tgt = lists.find(l=>l.id===list.id); if(!tgt) return old;
                                       let insert = tgt.items.findIndex(x=>x.id===it.id);
                                       if (itemDrag.overId===it.id && itemDrag.pos==='after') insert = insert + 1;
                                       tgt.items.splice(insert,0,moving);
                                       (async()=>{
                                         try{
                                           const tok=localStorage.getItem('token')||'';
                                           if(fromListId && fromListId!==list.id){
                                             const src = lists.find(l=>l.id===fromListId);
                                             await api.postAuth('/kanban/items/reorder',{ listId: fromListId, itemIds: (src?.items||[]).map(x=>x.id) }, tok);
                                           }
                                           await api.postAuth('/kanban/items/reorder',{ listId: list.id, itemIds: tgt.items.map(x=>x.id) }, tok);
                                         }catch{}
                                       })();
                                       return { ...old, [fid]: lists };
                                     });
                                   }}
                              >
                                {itemDrag.dragId && itemDrag.overId === it.id && (
                                  <div className="absolute left-1 right-1 h-1 bg-sky-500" style={{ pointerEvents:'none', top: itemDrag.pos==='before'? -4 : undefined, bottom: itemDrag.pos==='after'? -4 : undefined }} />
                                )}
                                <div className="flex items-start gap-2">
                                  <input type="checkbox" className="accent-emerald-500" checked={!!it.done} onChange={async(e)=>{ try{ const tok=localStorage.getItem('token')||''; await api.patchAuth('/kanban/items',{ itemId: it.id, done: e.target.checked }, tok);}catch{}}} />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm text-neutral-200 whitespace-pre-wrap break-words">{it.content}</div>
                                  </div>
                                  <button className="text-xs text-neutral-400 hover:text-neutral-200" title="Edit" onClick={async()=>{ const nv=await askInput({ title:'Edit Card', initialValue: it.content, label:'Text' }); if(!nv||nv===it.content) return; try{ const tok=localStorage.getItem('token')||''; await api.patchAuth('/kanban/items',{ itemId: it.id, content: nv }, tok);}catch{}}}>
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                                  </button>
                                  <button className="text-xs text-red-400 hover:text-red-300" title="Delete" onClick={async()=>{ const ok=await askConfirm({ title:'Delete Card', message:'Delete this card?', confirmText:'Delete' }); if(!ok) return; try{ const tok=localStorage.getItem('token')||''; await api.deleteAuth('/kanban/items',{ itemId: it.id }, tok);}catch{}}}>
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                                  </button>
                                </div>
                              </div>
                            ))}
                            {dones.length > 0 && (
                              <div className="mt-3 pt-2 border-t border-neutral-800">
                                <div className="text-xs text-neutral-500 mb-1">Completed</div>
                                <div className="space-y-2">
                                  {(showAllCompleted[list.id] ? dones : dones.slice(0,3)).map((it) => (
                                    <div key={it.id} className="p-2 rounded border border-neutral-800 bg-neutral-950/40">
                                      <div className="flex items-start gap-2">
                                        <input type="checkbox" className="accent-emerald-500" checked={true} onChange={async(e)=>{ try{ const tok=localStorage.getItem('token')||''; await api.patchAuth('/kanban/items',{ itemId: it.id, done: e.target.checked }, tok);}catch{}}} />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm text-neutral-400 line-through whitespace-pre-wrap break-words">{it.content}</div>
                                        </div>
                                        <button className="text-xs text-neutral-400 hover:text-neutral-200" title="Edit" onClick={async()=>{ const nv=await askInput({ title:'Edit Card', initialValue: it.content, label:'Text' }); if(!nv||nv===it.content) return; try{ const tok=localStorage.getItem('token')||''; await api.patchAuth('/kanban/items',{ itemId: it.id, content: nv }, tok);}catch{}}}>
                                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                                        </button>
                                        <button className="text-xs text-red-400 hover:text-red-300" title="Delete" onClick={async()=>{ const ok=await askConfirm({ title:'Delete Card', message:'Delete this card?', confirmText:'Delete' }); if(!ok) return; try{ const tok=localStorage.getItem('token')||''; await api.deleteAuth('/kanban/items',{ itemId: it.id }, tok);}catch{}}}>
                                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  {dones.length > 3 && (
                                    <button className="mt-2 w-full text-xs text-neutral-400 hover:text-neutral-200" onClick={() => setShowAllCompleted(prev => ({ ...prev, [list.id]: !prev[list.id] }))}>
                                      {showAllCompleted[list.id] ? 'Show less' : `View more (${dones.length - 3} more)`}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      <button className="w-full text-left px-2 py-1 rounded border border-neutral-800 text-neutral-300 hover:bg-neutral-800/60" onClick={async()=>{ const txt=await askInput({ title:'New Card', label:'Text', placeholder:'Do the thing...' }); if(!txt) return; try{ const tok=localStorage.getItem('token')||''; await api.postAuth('/kanban/items',{ listId:list.id, content: txt }, tok);}catch(e:any){ toast(e?.message||'Failed to add','error'); } }}>+ Add card</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : currentChannel?.type === 'form' ? (
            <div className="min-h-full">
              <div className="mb-3 flex items-center gap-2">
                <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={async()=>{
                  const pr = await askInput({ title:'New Question', label:'Prompt', placeholder:'What did you ship today?' }); if(!pr) return; try { const tok=localStorage.getItem('token')||''; await api.postAuth('/forms/questions',{ channelId: fq(currentVoidId, currentChannelId), prompt: pr, kind: 'text' }, tok);} catch(e:any){ toast(e?.message||'Failed to add question','error'); }
                }}>+ Add Question</button>
              </div>
              <div className="space-y-3">
                {(() => {
                  const fid = fq(currentVoidId, currentChannelId);
                  const state = formByChan[fid] || { questions: [], answers: {}, answersByUser: {} };
                  const saveAnswer = debounce(async (qid: string, val: string) => {
                    try { const tok=localStorage.getItem('token')||''; await api.patchAuth('/forms/answers',{ questionId: qid, answer: val }, tok); } catch {}
                  }, 300);
                  return state.questions.map(q => (
                    <div key={q.id} className="p-2 rounded border border-neutral-800 bg-neutral-900/50">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-neutral-200 mb-2">{q.prompt}</div>
                          <div className="space-y-1">
                            {members.map(m => {
                              const isMe = m.id === me.userId;
                              const val = isMe ? (state.answers[q.id] ?? '') : (state.answersByUser?.[m.id]?.[q.id] ?? '');
                              return (
                                <div key={m.id} className="flex items-center gap-2">
                                  <div className="w-28 shrink-0 truncate text-xs text-neutral-400">{isMe ? 'You' : (m.name || m.username)}</div>
                                  {isMe ? (
                                    <input
                                      className="flex-1 p-2 rounded bg-neutral-950 text-neutral-100 border border-neutral-800"
                                      value={val}
                                      onChange={(e)=>{ const v=e.target.value; setFormByChan(old=>({ ...old, [fid]: { questions: state.questions, answers: { ...state.answers, [q.id]: v }, answersByUser: state.answersByUser } })); saveAnswer(q.id, v); }}
                                      placeholder="Your answer"
                                    />
                                  ) : (
                                    <div className="flex-1 p-2 rounded bg-neutral-950/40 text-neutral-200 border border-neutral-800/50 min-h-[36px]">
                                      {val || <span className="text-neutral-500">No answer yet</span>}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button className="text-xs text-neutral-400 hover:text-neutral-200" title="Rename" onClick={async()=>{ const nv=await askInput({ title:'Edit Question', initialValue:q.prompt, label:'Prompt' }); if(!nv||nv===q.prompt) return; try { const tok=localStorage.getItem('token')||''; await api.patchAuth('/forms/questions',{ questionId: q.id, prompt: nv }, tok);} catch(e:any){ toast(e?.message||'Failed to rename','error'); } }}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                          </button>
                          <button className="text-xs text-red-400 hover:text-red-300" title="Delete" onClick={async()=>{ const ok=await askConfirm({ title:'Delete Question', message:'Delete this question?', confirmText:'Delete' }); if(!ok) return; try{ const tok=localStorage.getItem('token')||''; await api.deleteAuth('/forms/questions',{ questionId: q.id }, tok);} catch(e:any){ toast(e?.message||'Failed to delete','error'); } }}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          ) : (
          (() => {
            if (currentChannel?.type === 'gallery') {
              const images: { url: string; name?: string; mid: string; spoiler?: boolean }[] = [];
              for (const m of msgs) {
                for (const a of (m.attachments||[])) {
                  const t = String(a.contentType||'').toLowerCase();
                  const u = String(a.url||'').toLowerCase();
                  const n = String(a.name||'').toLowerCase();
                  const isImg = t.startsWith('image/') || /(\.png|\.jpe?g)(\?.*)?$/.test(u) || /(\.png|\.jpe?g)(\?.*)?$/.test(n);
                  const isGif = t.includes('gif') || /(\.gif)(\?.*)?$/.test(u) || /(\.gif)(\?.*)?$/.test(n);
                  if (isImg && !isGif) images.push({ url: a.url, name: a.name, mid: m.id, spoiler: !!(m as any).spoiler });
                }
              }
              // Newest-first at top of page
              images.reverse();
              // Selection state for bulk delete
              const [selMode, setSelMode] = (function(){ try { return (window as any)._galSelMode ??= [false, (v:boolean)=>{ (window as any)._galSelMode[0]=v; }]; } catch { return [false, (_:boolean)=>{}] as any; } })();
              const [selected, setSelected] = (function(){ try { return (window as any)._galSelected ??= [{}, (up:any)=>{ (window as any)._galSelected[0]=typeof up==='function'? up((window as any)._galSelected[0]): up; }]; } catch { return [{} as Record<string, boolean>, (_:any)=>{}] as any; } })();
              function keyOf(im: {mid:string; url:string}){ return `${im.mid}__${encodeURIComponent(im.url)}`; }
              const selCount = Object.values(selected as any).filter(Boolean).length;
              return (
                <div className="min-h-full">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="text-neutral-300 text-sm">Link to chat:</div>
                    <select className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200" value={(function(){ const gid=fq(currentVoidId,currentChannelId); const c=channels.find(x=>x.linkedGalleryId===gid); return c? (xId=> (xId.includes(':')?xId.split(':')[1]:xId))(c.id):''; })()} onChange={async(e)=>{
                      const val = (e.target as HTMLSelectElement).value;
                      if (!val) return;
                      try {
                        const tok=localStorage.getItem('token')||'';
                        const chatCid = `${currentVoidId}:${val}`;
                        const galCid = fq(currentVoidId, currentChannelId);
                        await api.postAuth('/channels/gallery-link', { spaceId: currentVoidId, chatChannelId: chatCid, galleryChannelId: galCid }, tok);
                        // Update local channels state so the selection persists immediately
                        setChannels(prev => prev.map(c => (c.id===chatCid || fq(currentVoidId, c.id)===chatCid) ? { ...c, linkedGalleryId: galCid } : c));
                        toast('Linked to chat','success');
                      } catch(e:any) { toast(e?.message||'Failed to link','error'); }
                    }}>
                      <option value="">Select channel...</option>
                      {channels.filter(c => c.type !== 'gallery').map(c => (
                        <option key={c.id} value={(c.id.includes(':')?c.id.split(':')[1]:c.id)}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <input ref={galleryFileRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={(e)=> addGalleryFiles((e.target as HTMLInputElement).files)} />
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-2 overflow-visible"
                    onDragOver={(e)=>{ e.preventDefault(); }}
                    onDrop={(e)=>{ e.preventDefault(); const files = e.dataTransfer?.files; if (files && files.length>0) addGalleryFiles(files); }}
                  >
                    {/* Always show an add tile */}
                    <button
                      type="button"
                      className="relative block w-full pt-[125%] overflow-hidden rounded border border-neutral-800 bg-neutral-950 hover:bg-neutral-900/70 text-neutral-300"
                      onClick={() => galleryFileRef.current?.click()}
                      title="Add photos"
                      aria-label="Add photos"
                    >
                      <span className="absolute inset-0 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
                          <path d="M12 5v14M5 12h14"/>
                        </svg>
                      </span>
                    </button>
                    {/* Existing images */}
                    {(() => {
                      const imagesOrdered = images.slice().reverse();
                      return imagesOrdered.map((im, i) => {
                      const hidden = !!im.spoiler && !revealedSpoilers[im.mid];
                      return (
                      <div key={i} className="relative group overflow-visible">
                        <div className={`block w-full pt-[125%] overflow-hidden rounded-xl border ${ (selected as any)[keyOf(im)] ? 'border-emerald-600 ring-1 ring-emerald-700' : 'border-neutral-800/80'} bg-neutral-950 shadow-md hover:shadow-lg transition-shadow` }>
                          <a href={(selMode || hidden) ? undefined : im.url} target={(selMode || hidden) ? undefined : "_blank"} rel={(selMode || hidden) ? undefined : "noreferrer"} className="absolute inset-0">
                            <img src={im.url} alt={im.name||'photo'} className={`w-full h-full object-cover transition-transform duration-300 ${hidden ? 'blur-sm brightness-50' : 'group-hover:scale-[1.03]'}`} />
                          </a>
                        {hidden && (
                          <button className="absolute inset-0 flex items-center justify-center bg-neutral-950/50 text-neutral-200 text-sm font-medium" onClick={()=> setRevealedSpoilers(prev => ({ ...prev, [im.mid]: true }))}>Spoiler � tap to reveal</button>
                        )}
                        {!selMode && (
                          <button
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded-md bg-neutral-900/85 border border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-600 backdrop-blur-sm"
                            title="Delete photo"
                            aria-label="Delete photo"
                            onClick={async (e)=>{
                              e.preventDefault();
                              const ok = await askConfirm({ title: 'Delete Photo', message: 'Remove this photo from gallery?', confirmText: 'Delete', cancelText: 'Cancel' });
                              if (!ok) return;
                              try {
                                const tok = localStorage.getItem('token')||'';
                                await api.postAuth('/channels/gallery-attachment-delete', { messageId: im.mid, url: im.url }, tok);
                              } catch (e:any) {
                                toast(e?.message||'Failed to delete','error');
                              }
                            }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        )}
                        {selMode && (
                          <button
                            className={`absolute top-2 left-2 px-2 py-0.5 rounded-full border text-xs ${ (selected as any)[keyOf(im)] ? 'bg-emerald-700/70 border-emerald-600 text-emerald-50' : 'bg-neutral-900/70 border-neutral-700 text-neutral-300'}`}
                            onClick={(e)=>{ e.preventDefault(); (setSelected as any)((prev:Record<string,boolean>)=>({ ...prev, [keyOf(im)]: !prev[keyOf(im)] })); }}
                            title={(selected as any)[keyOf(im)] ? 'Deselect' : 'Select'}
                          >
                            {(selected as any)[keyOf(im)] ? 'Selected' : 'Select'}
                          </button>
                        )}
                        </div>
                        {/* Hover pop-out preview (disabled for spoilers or selection mode) */}
                        {(!selMode && !hidden) && (
                          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-transform transition-opacity duration-700 ease-out">
                            <img src={im.url} alt={im.name||'photo'} className="max-h-[85vh] max-w-[90vw] rounded-2xl shadow-2xl object-contain" />
                          </div>
                        )}
                      </div>
                    )}); })()}
                    {/* If few images, pad with add placeholders to make it feel populated */}
                    {Array.from({ length: Math.max(0, 4 - Math.min(images.length, 4)) }).map((_, idx) => (
                      <button
                        key={`ph-${idx}`}
                        type="button"
                        className="relative block w-full pt-[125%] overflow-hidden rounded border border-neutral-800 bg-neutral-950/60 hover:bg-neutral-900/60 text-neutral-400"
                        onClick={() => galleryFileRef.current?.click()}
                        title="Add photos"
                        aria-label="Add photos"
                      >
                        <span className="absolute inset-0 flex items-center justify-center">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                            <path d="M12 5v14M5 12h14"/>
                          </svg>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {!selMode ? (
                      <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>{ (setSelMode as any)(true); (setSelected as any)({}); }}>Select</button>
                    ) : (
                      <>
                        <button className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>{ (setSelMode as any)(false); (setSelected as any)({}); }}>Cancel</button>
                        <button disabled={selCount===0} className="px-2 py-1 rounded border border-red-800 text-red-300 hover:bg-red-900/30 disabled:opacity-50" onClick={async()=>{
                          const items = Object.entries(selected as any).filter(([k,v])=>v).map(([k])=>{ const [mid, urlEnc]=k.split('__'); return { messageId: mid, url: decodeURIComponent(urlEnc) }; });
                          if (items.length===0) return;
                          const ok = await askConfirm({ title: 'Delete Photos', message: `Delete ${items.length} selected photo(s)?`, confirmText: 'Delete', cancelText: 'Cancel' }); if (!ok) return;
                          try { const tok=localStorage.getItem('token')||''; await api.postAuth('/channels/gallery-attachments-delete',{ items }, tok); (setSelected as any)({}); (setSelMode as any)(false); } catch(e:any){ toast(e?.message||'Failed to delete','error'); }
                        }}>Delete Selected ({selCount})</button>
                      </>
                    )}
                  </div>
                </div>
              );
            }
            if (currentChannel?.type === 'notes') {
              // Build simple note cards from messages (title = first line)
              const notesRaw = msgs.map(m => {
                const text = String(m.content || '');
                const [first, ...rest] = text.split(/\r?\n/);
                const title = (first || '').trim() || 'Untitled';
                const body = rest.join('\n').trim();
                const tags = Array.from(new Set((text.match(/#([\w-]{1,30})/g) || []).map(s => s.slice(1).toLowerCase())));
                return { id: m.id, title, body, createdAt: m.createdAt || '', tags };
              }).reverse(); // newest first on grid
              const allTags = Array.from(new Set(notesRaw.flatMap(n => n.tags))).slice(0, 20);
              const q = (noteSearch || '').toLowerCase();
              const notes = notesRaw.filter(n => {
                const hitQ = !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.some(t => t.includes(q));
                const hitTag = !noteTag || n.tags.includes(noteTag.toLowerCase());
                return hitQ && hitTag;
              });
              return (
                <div className="min-h-full">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input
                      value={noteSearch}
                      onChange={e=>setNoteSearch(e.target.value)}
                      placeholder="Search notes�"
                      className="px-3 py-1.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-100"
                    />
                    <div className="flex items-center gap-1 overflow-x-auto">
                      {allTags.map(t => (
                        <button key={t} className={`px-2 py-1 rounded-full border text-xs ${noteTag===t?'border-emerald-600 bg-emerald-900/40 text-emerald-200':'border-neutral-700 text-neutral-300 hover:bg-neutral-800/60'}`} onClick={()=> setNoteTag(prev => prev===t ? null : t)}>#{t}</button>
                      ))}
                      {noteTag && (
                        <button className="ml-2 px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800/60 text-xs" onClick={()=> setNoteTag(null)}>Clear tag</button>
                      )}
                    </div>
                    <button
                      className="px-2 py-1 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60"
                      onClick={async()=>{
                        const t = await askInput({ title:'New Note', label:'Title', placeholder:'My note' });
                        if (!t) return;
                        const b = await askInput({ title:'New Note', label:'Content (optional)' });
                        const content = b ? `${t}\n\n${b}` : t;
                        const tempId = crypto.randomUUID();
                        const fid = fq(currentVoidId, currentChannelId);
                        setMsgsByKey(old => ({ ...old, [fid]: [...(old[fid]||[]), { id: tempId, content, optimistic: true }] }));
                        socket.emit('message:send', { voidId: currentVoidId, channelId: fid, content, tempId, attachments: [] });
                      }}
                    >+ Add Note</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {notes.length === 0 ? (
                      <div className="text-neutral-500 text-sm col-span-full">No notes yet</div>
                    ) : notes.map(n => (
                      <button key={n.id} onClick={()=>{ setNoteModalId(n.id); setNoteEditTitle(n.title); setNoteEditBody(n.body); }} className="text-left p-3 rounded-lg border border-neutral-800 bg-neutral-900/60 hover:bg-neutral-900/80 transition-colors shadow-sm">
                        <div className="font-semibold text-neutral-100 truncate mb-1" title={n.title}>{n.title}</div>
                        <div className="text-sm text-neutral-400 line-clamp-3 whitespace-pre-wrap">{n.body || '�'}</div>
                        {n.tags.length>0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {n.tags.map(t => (<span key={t} className="px-1.5 py-0.5 rounded-full border border-neutral-700 text-[10px] text-neutral-300">#{t}</span>))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                  {noteModalId && (()=>{
                    const sel = msgs.find(m => m.id === noteModalId);
                    const canSave = (noteEditTitle.trim().length>0);
                    return (
                      <div className="fixed inset-0 z-40 flex items-center justify-center">
                        <div className="absolute inset-0 bg-black/50" onClick={()=> setNoteModalId(null)} />
                        <div className="relative w-[90vw] max-w-xl rounded-lg border border-neutral-800 bg-neutral-900 p-4 shadow-2xl">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-emerald-300 font-semibold">Edit Note</div>
                            <button className="px-2 py-1 text-neutral-400 hover:text-neutral-200" onClick={()=> setNoteModalId(null)} aria-label="Close">?</button>
                          </div>
                          <input className="w-full mb-2 px-3 py-2 rounded bg-neutral-950 border border-neutral-800 text-neutral-100" value={noteEditTitle} onChange={e=>setNoteEditTitle(e.target.value)} placeholder="Title" />
                          <textarea className="w-full h-40 px-3 py-2 rounded bg-neutral-950 border border-neutral-800 text-neutral-100" value={noteEditBody} onChange={e=>setNoteEditBody(e.target.value)} placeholder="Body (supports #tags)" spellCheck={true} autoCorrect="on" autoCapitalize="sentences" />
                          <div className="mt-3 flex items-center gap-2">
                            <button disabled={!canSave} className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70 disabled:opacity-50" onClick={()=>{
                              if (!sel) return; const content = noteEditBody.trim()? `${noteEditTitle.trim()}\n\n${noteEditBody}` : noteEditTitle.trim();
                              socket.emit('message:edit', { messageId: sel.id, content });
                              const fid = fq(currentVoidId, currentChannelId);
                              setMsgsByKey(old => { const list = old[fid]??[]; const idx=list.findIndex(m=>m.id===sel.id); if(idx===-1) return old; const copy=[...list]; copy[idx] = { ...copy[idx], content, optimistic: true }; return { ...old, [fid]: copy }; });
                              setNoteModalId(null);
                            }}>Save</button>
                            <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=> setNoteModalId(null)}>Cancel</button>
                            <button className="ml-auto px-3 py-2 rounded border border-red-800 text-red-300 hover:bg-red-900/30" onClick={async()=>{ if(!sel) return; const ok = await askConfirm({ title:'Delete Note', message:'Delete this note?', confirmText:'Delete' }); if(!ok) return; socket.emit('message:delete', { messageId: sel.id }); setNoteModalId(null); }}>Delete</button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            }
            const lastIdx = msgs.length - 1;
            const cid = fq(currentVoidId, currentChannelId);
            const markId = unreadMarkerByChan[cid] || null;
            return msgs.flatMap((m, idx) => {
              const byIds = Array.isArray(m.seenByIds) ? m.seenByIds : [];
              const showSeen = idx === lastIdx && byIds.length > 0;
              const parts: any[] = [];
              if (markId && m.id === markId) {
                parts.push(
                  <div key={`divider-${m.id}`} className="sticky top-0 z-10 my-2 flex items-center gap-2 text-[11px] text-emerald-300">
                    <div className="flex-1 h-px bg-emerald-800/60" />
                    <span>New</span>
                    <div className="flex-1 h-px bg-emerald-800/60" />
                  </div>
                );
              }
              parts.push((
            <div key={m.id} className={`group relative px-3 py-2 rounded border ${m.optimistic ? 'border-emerald-800/60' : 'border-neutral-800/60'} bg-neutral-900/70`}>
              {editingId !== m.id && (
              <div className="pointer-events-auto hidden group-hover:flex group-focus-within:flex items-center gap-1 absolute top-1 right-1 z-40 rounded-full border border-neutral-800 bg-neutral-900/95 px-1.5 py-1 shadow-lg">
                {getQuickEmojis().map(e => (
                  <button key={e} className="px-1.5 py-0.5 rounded hover:bg-neutral-800 text-base" onClick={() => toggleReaction(m, e)} title={`React ${e}`}>{e}</button>
                ))}
                <button
                  ref={pickerFor === m.id ? reactionBtnRef : undefined}
                  className="px-1.5 py-0.5 rounded hover:bg-neutral-800 text-neutral-300"
                  onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                  aria-label="More reactions" title="More reactions"
                >...</button>
                <button className="p-1 rounded hover:bg-neutral-800 text-neutral-300" onClick={() => setReplyTo(m)} aria-label="Reply" title="Reply">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10 19l-7-7 7-7"/><path d="M3 12h12a 6 6 0 0 1 6 6v3"/></svg>
                </button>
                {m.authorId === me.userId && (
                  <button className="p-1 rounded hover:bg-neutral-800 text-neutral-300" onClick={() => startEdit(m)} aria-label="Edit" title="Edit">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>
                  </button>
                )}
                {m.authorId === me.userId && (
                  <button className="p-1 rounded hover:bg-neutral-800 text-red-300" onClick={async()=>{ const ok = await askConfirm({ title:'Delete Message', message:'Delete this message?', confirmText:'Delete', cancelText:'Cancel' }); if (!ok) return; socket.emit('message:delete', { messageId: m.id }); }} aria-label="Delete" title="Delete">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
              )}
              {editingId !== m.id && pickerFor === m.id && (
                <div ref={reactionMenuRef} className="absolute top-8 right-1 z-50 p-2 rounded-md border border-neutral-700 bg-neutral-900 shadow-lg flex flex-wrap gap-1">
                  {REACTION_EMOJIS.map(e => (
                    <button
                      key={e}
                      className="px-2 py-1 rounded hover:bg-neutral-800"
                      onClick={() => { toggleReaction(m, e); setPickerFor(null); }}
                    >{e}</button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <div>
                  {(() => {
                    const isMineMsg = isMine(m);
                    let color: string | undefined;
                    if (isMineMsg) {
                      try {
                        const raw = localStorage.getItem('user');
                        const u = raw ? JSON.parse(raw) : null;
                        if (u && u.nameColor) color = String(u.nameColor);
                        else {
                          const alt = localStorage.getItem('nameColor');
                          if (alt) color = String(alt);
                        }
                      } catch {}
                    } else if (m.authorColor) {
                      color = String(m.authorColor);
                    }
                    const label = isMineMsg ? 'You' : (m.authorName || 'User');
                    return <span style={color ? { color } : undefined}>{label}</span>;
                  })()}
                </div>
                {isMine(m) && (
                  <div className="flex gap-2">
                    {editingId === m.id ? (
                      <>
                        <button className="underline" onClick={saveEdit}>Save</button>
                        <button className="underline" onClick={cancelEdit}>Cancel</button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
              {m.attachments && m.attachments.length > 0 && (() => {
                const hidden = !!m.spoiler && !revealedSpoilers[m.id];
                return (
                  <div className="mt-2 relative">
                    <div className="flex flex-wrap gap-2 select-none">
                      {m.attachments.map((a, i) => (
                        <div key={i} className="relative border border-neutral-800 rounded overflow-hidden bg-neutral-950 max-w-full">
                          {a.contentType?.startsWith('image/') ? (
                            <a href={hidden ? undefined : a.url} target={hidden ? undefined : "_blank"} rel={hidden ? undefined : "noreferrer"} className="block max-w-full">
                              <img src={a.url} alt={a.name || 'image'} className={`max-h-32 max-w-full object-cover ${hidden ? 'blur-sm brightness-50' : ''}`} />
                            </a>
                          ) : (
                            <a href={hidden ? undefined : a.url} target={hidden ? undefined : "_blank"} rel={hidden ? undefined : "noreferrer"} className="px-2 py-1 inline-flex items-center gap-2 text-sm text-emerald-300 hover:underline">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M21.44 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 1 1-2.83-2.83l8.49-8.49"/></svg>
                              <span>{a.name || 'file'}</span>
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                    {hidden && (
                      <button className="absolute inset-0 flex items-center justify-center bg-neutral-950/70 text-neutral-200 text-sm font-medium" onClick={() => setRevealedSpoilers(prev => ({ ...prev, [m.id]: true }))}>
                        Spoiler � tap to reveal
                      </button>
                    )}
                  </div>
                );
              })()}
              {m.replyTo && (
                <div className="mt-2 text-xs text-neutral-300 border border-neutral-800 bg-neutral-900/60 rounded p-2">
                  <div className="text-neutral-400 mb-1">Replying to <span className="text-emerald-300">{m.replyTo.authorName || 'User'}</span></div>
                  <div className="line-clamp-3 text-neutral-200">{m.replyTo.content || ''}</div>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words text-neutral-100 mt-1">
                {editingId === m.id ? (
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} className="w-full p-2 rounded bg-neutral-950 border border-neutral-800" rows={2} spellCheck={true} autoCorrect="on" autoCapitalize="sentences" />
                ) : (
                  (() => {
                    const hidden = !!m.spoiler && !revealedSpoilers[m.id];
                    if (hidden) {
                      return (
                        <button className="w-full text-left px-2 py-2 rounded border border-neutral-800 bg-neutral-950/70 text-neutral-300" onClick={() => setRevealedSpoilers(prev => ({ ...prev, [m.id]: true }))}>
                          Spoiler � click to reveal
                        </button>
                      );
                    }
                    return (
                      <>
                        {renderWithItalics(m.content)}
                        {m.optimistic ? ' ...' : ''}
                      </>
                    );
                  })()
                )}
              </div>
              <div className="mt-1 text-[10px] text-neutral-500 flex items-center justify-between">
                <span>{formatTime(m.createdAt)}</span>
                {m.updatedAt && <span className="italic">edited</span>}
              </div>
              {/* reactions */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(m.reactions || {}).map(([emoji, v]) => (
                    <div key={emoji} className="relative inline-block">
                      <button
                        onClick={() => toggleReaction(m, emoji)}
                        onMouseEnter={() => { setHoverReaction({ messageId: m.id, emoji }); loadReactionsFor(m.id); }}
                        onMouseLeave={() => { setHoverReaction(hr => (hr && hr.messageId === m.id && hr.emoji === emoji ? null : hr)); }}
                        className={`px-2 py-0.5 rounded-full border text-sm ${v.mine ? 'bg-emerald-800/50 border-emerald-700' : 'bg-neutral-800/60 border-neutral-700'}`}
                      >
                        <span className="mr-1">{emoji}</span>{v.count}
                      </button>
                      {hoverReaction && hoverReaction.messageId === m.id && hoverReaction.emoji === emoji && (
                        <div className="fixed z-[10000] pointer-events-none mt-0 w-44 max-w-[11rem] rounded-md border border-neutral-700 bg-neutral-900 text-neutral-200 text-xs shadow-xl p-2">
                          {(() => {
                            const info = reactionInfoByMsg[m.id]?.[emoji]?.users || [];
                            if (info.length === 0) return <div className="text-neutral-500">No details</div>;
                            return (
                              <div className="space-y-1 max-h-60 overflow-auto">
                                {info.map((it, i) => (
                                  <div key={i} className="flex items-center justify-between gap-2">
                                    <span className="truncate max-w-[12ch]">{it.name}</span>
                                    <span className="text-neutral-400">{timeAgo(it.createdAt)}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* Actions removed: reply/react/delete toolbar and buttons for a cleaner UI */}
              </div>
              {showSeen && (
                <div className="mt-1 flex justify-end">
                  <div className="group relative flex gap-1">
                    {(() => {
                      const ids = byIds.slice(-8); // show last 8 viewers inline
                      return ids.map(uid => {
                        const mem = members.find(mm => mm.id === uid);
                        const src = mem?.avatarUrl || '';
                        const title = mem?.name || mem?.username || 'User';
                        return (
                          <div key={uid} className="h-4 w-4 rounded-full overflow-hidden border border-neutral-800 -mr-1" title={`Seen by ${title}`}>
                            {src ? <img src={src} alt={title} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-neutral-700 text-[8px] flex items-center justify-center text-neutral-200">{(title[0]||'?').toUpperCase()}</div>}
                          </div>
                        );
                      });
                    })()}
                    {/* Hover panel with full list */}
                    <div className="absolute top-full right-0 mt-2 hidden group-hover:block z-10">
                      <div className="pointer-events-auto min-w-[180px] max-w-[260px] max-h-48 overflow-auto rounded-md border border-neutral-800 bg-neutral-900/95 shadow-lg p-2">
                        <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">Seen by</div>
                        <ul className="text-sm space-y-1">
                          {byIds.map(uid => {
                            const mem = members.find(mm => mm.id === uid);
                            const name = mem?.name || mem?.username || uid.slice(0,8);
                            const src = mem?.avatarUrl || '';
                            return (
                              <li key={uid} className="flex items-center gap-2">
                                <div className="h-5 w-5 rounded-full overflow-hidden border border-neutral-800">
                                  {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-neutral-700 text-[9px] flex items-center justify-center text-neutral-200">{(name[0]||'?').toUpperCase()}</div>}
                                </div>
                                <span className="truncate text-neutral-200">{name}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ));
              return parts;
            });
          })()
          )}
          {currentVoidId && currentChannel?.type !== 'kanban' && currentChannel?.type !== 'form' && currentChannel?.type !== 'habit' && currentChannel?.type !== 'voice' && msgs.length === 0 && (
            <div className="text-neutral-500 text-sm">No messages yet</div>
          )}
        </div>

        {/* Typing + presence (sticky above composer on mobile) */}
        <div className="px-4 text-xs text-teal-300 md:mb-2">
          <div className="sticky bottom-16 md:static py-1 h-6">
            {(() => {
              if (!currentVoidId) return null;
              // Use last non-empty text so we can fade it out smoothly
              const names = Object.values(typers);
              const hasNames = names.length > 0;
              const base = hasNames
                ? (names.length === 1
                    ? `${names[0]} is typing`
                    : `${names.slice(0,2).join(', ')}${names.length>2 ? ' +' + (names.length-2) : ''} are typing`)
                : '';
              if (hasNames) lastTypingTextRef.current = base;
              const text = hasNames ? base : lastTypingTextRef.current;
              return (
                <span
                  className={`inline-flex items-center gap-2 transition-opacity duration-200 ease-out ${hasNames ? 'opacity-100' : 'opacity-0'}`}
                  aria-live="polite" aria-atomic="true"
                >
                  <span>{text}</span>
                  <span className="typing-dots" aria-hidden="true">
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                  </span>
                </span>
              );
            })()}
          </div>
        </div>

        {/* Voice room or Input (hidden for Kanban/Form/Habit) */}
        {currentChannel?.type !== 'kanban' && currentChannel?.type !== 'form' && currentChannel?.type !== 'habit' && currentChannel?.type !== 'gallery' && currentChannel?.type !== 'notes' && (
          <div className="p-3 border-t border-neutral-800/60 bg-neutral-900/40 safe-bottom md:static fixed inset-x-0 bottom-4 z-20 md:mb-4 shadow-[0_-8px_16px_rgba(0,0,0,0.35)]">
          {!currentVoidId ? (
            <div className="text-center text-sm text-neutral-400">Create or join a space to start chatting.</div>
          ) : currentChannel?.type === 'voice' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M11 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>
                  <span>Voice</span>
                </div>
                <div className="text-xs text-neutral-300 inline-flex items-center gap-1 rounded-full border border-neutral-800/80 bg-neutral-900/60 px-2 py-0.5">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  <span>{voiceJoined ? (Object.keys(voicePeers).length + 1) : 0} listening</span>
                </div>
              </div>
              {!voiceJoined ? (
                <div className="flex items-center gap-2">
                  <button className="px-4 py-2 rounded-lg border border-emerald-700 bg-gradient-to-r from-emerald-800/70 to-teal-800/70 hover:from-emerald-700/70 hover:to-teal-700/70 text-emerald-50 shadow-sm inline-flex items-center gap-2" onClick={joinVoice}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12 5v14M5 12h14"/></svg>
                    <span>Join Voice</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap rounded-lg border border-neutral-800/70 bg-neutral-900/40 backdrop-blur px-2 py-2">
                  <button className="px-3 py-2 rounded-md border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60 inline-flex items-center gap-1" onClick={toggleMute} title={voiceMuted ? 'Unmute' : 'Mute'}>
                    {voiceMuted ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-400"><path d="M13.5 14.5V9.4a3.4 3.4 0 0 0-5.7-2.4L5 9H2v6h3l2.8 2.8a3.4 3.4 0 0 0 5.7-2.4Z"/><path d="m14 9 7-7"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 3v10"/><path d="M8 7h8"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><path d="M12 19v3"/></svg>
                    )}
                    <span className="hidden sm:inline">{voiceMuted ? 'Unmute' : 'Mute'}</span>
                  </button>
                  <button className="px-3 py-2 rounded-md border border-red-800 text-red-300 hover:bg-red-900/30 inline-flex items-center gap-1" onClick={leaveVoice} title="Leave">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10 3H3v18h7"/><path d="M21 12H7"/><path d="m14 7 5 5-5 5"/></svg>
                    <span className="hidden sm:inline">Leave</span>
                  </button>
                  <button className="px-3 py-2 rounded-md border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60 inline-flex items-center gap-1" onClick={()=>{ setDevicesOpen(v=>!v); if (!devicesOpen) refreshDevices(); }} title="Devices">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9 2.09V2a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 22 12a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
                    <span className="hidden sm:inline">Devices</span>
                  </button>
                  {needsAudioUnlock && (
                    <button className="px-3 py-2 rounded-md border border-amber-800 text-amber-200 hover:bg-amber-900/30 inline-flex items-center gap-1" onClick={async()=>{
                      try { await audioCtxRef.current?.resume(); } catch {}
                      try {
                        let ok = true;
                        for (const el of audioElsRef.current.values()) {
                          try { const p = el.play(); if (p && typeof (p as any).then === 'function') { await p; } } catch { ok = false; }
                        }
                        if (ok) setNeedsAudioUnlock(false);
                      } catch {}
                    }} title="Enable Audio">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M11 5v14l-7-4V9z"/><path d="M19 5v14"/></svg>
                      <span className="hidden sm:inline">Enable Audio</span>
                    </button>
                  )}
                  <div className="ml-auto hidden md:flex items-center gap-2 text-xs text-neutral-400">
                    <span>Peers:</span>
                    <span className="truncate max-w-[50vw]">{Object.values(voicePeers).map(p => p.name || 'User').join(', ') || 'None'}</span>
                  </div>
                </div>
              )}
              {voiceJoined && devicesOpen && (
                <div className="flex items-center gap-3 flex-wrap text-sm text-neutral-300">
                  <label className="flex items-center gap-1">Mic:
                    <select className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
                      value={selectedInputId ?? ''}
                      onChange={async (e)=>{ const id=e.target.value; setSelectedInputId(id); await switchMicrophone(id); }}>
                      {inputs.length===0 ? <option value="">Default</option> : inputs.map(d=> (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0,6)}`}</option>
                      ))}
                    </select>
                  </label>
                  {(() => { const hasSink = typeof (HTMLMediaElement.prototype as any).setSinkId === 'function'; return hasSink ? (
                    <label className="flex items-center gap-1">Output:
                      <select className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-neutral-200"
                        value={selectedOutputId ?? ''}
                        onChange={async (e)=>{ const id=e.target.value; setSelectedOutputId(id); await applyOutputDevice(id); }}>
                        {outputs.length===0 ? <option value="">Default</option> : outputs.map(d=> (
                          <option key={d.deviceId} value={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0,6)}`}</option>
                        ))}
                      </select>
                    </label>
                  ) : null; })()}
                </div>
              )}
              {/* Participant tiles moved to main body */}
              {/* Remote audio sinks (hidden) */}
              <div className="sr-only">
                {Array.from(remoteStreamsRef.current.entries()).map(([pid, ms]) => (
                  <audio
                    key={pid}
                    autoPlay
                    playsInline
                    ref={(el) => {
                      if (el) {
                        (el as any).srcObject = ms;
                        audioElsRef.current.set(pid, el);
                        try {
                          if (selectedOutputId && typeof (el as any).setSinkId === 'function') {
                            (el as any).setSinkId(selectedOutputId).catch(()=>{});
                          }
                        } catch {}
                        try { el.volume = (voiceVolumes[pid] ?? 1); } catch {}
                        try { el.muted = !!voiceSilenced[pid]; } catch {}
                        try { const p = el.play(); if (p && typeof (p as any).then === 'function') { (p as any).catch(()=> setNeedsAudioUnlock(true)); } }
                        catch { setNeedsAudioUnlock(true); }
                      } else {
                        audioElsRef.current.delete(pid);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (currentChannel?.type === 'form' || currentChannel?.type === 'gallery') ? null : (
            <>
      {pendingUploads.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingUploads.map((a, i) => {
            const isImg = (() => {
              if (a.contentType && a.contentType.startsWith('image/')) return true;
              const u = (a.url || '').toLowerCase();
              const n = (a.name || '').toLowerCase();
              return /(\.png|\.jpe?g|\.gif|\.webp|\.svg)(\?.*)?$/.test(u) || /(\.png|\.jpe?g|\.gif|\.webp|\.svg)(\?.*)?$/.test(n);
            })();
            return (
              <div key={i} className="flex items-center gap-2 border border-neutral-800 rounded px-2 py-1 bg-neutral-950">
                {isImg ? (
                  <img src={a.url} alt={a.name || ''} className="h-10 w-10 object-cover rounded" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M21.44 11.05l-8.49 8.49a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 1 1-2.83-2.83l8.49-8.49"/></svg>
                )}
                <span className="text-sm text-neutral-300">{a.name}</span>
                <button aria-label="Remove attachment" className="ml-1 px-1.5 py-0.5 rounded bg-neutral-900/70 border border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-500" onClick={() => setPendingUploads(prev => prev.filter((_, idx) => idx !== i))}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
              <div className="flex items-center gap-1 md:gap-2 w-full max-w-full overflow-visible relative">
                <button
                  ref={addBtnRef}
                  type="button"
                  className="shrink-0 px-3 py-2 rounded border border-neutral-800 text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800/60"
                  title="Add"
                  aria-label="Add"
                  onClick={() => {
                    // Ignore the synthetic click that follows a touch to avoid double-toggle
                    if (Date.now() - (lastTouchAtRef.current || 0) < 500) return;
                    setAddOpen(v => !v);
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    lastTouchAtRef.current = Date.now();
                    setAddOpen(v => !v);
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12 5v14M5 12h14"/></svg>
                </button>
                {addOpen && (
                  <div ref={addMenuRef} className="absolute bottom-full mb-2 left-0 z-40 rounded-md border border-neutral-800 bg-neutral-900 shadow-xl p-1 flex gap-1">
                    <button
                      className={`px-2 py-1 rounded ${spoiler ? 'bg-amber-800/40 text-amber-100' : 'hover:bg-neutral-800 text-neutral-200'}`}
                      onClick={()=>{ setSpoiler(v=>!v); }}
                      title="Toggle spoiler"
                      aria-pressed={spoiler}
                      aria-label="Toggle spoiler"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    </button>
                    <button className="px-2 py-1 rounded hover:bg-neutral-800 text-neutral-200" onClick={()=>{ setComposerPickerOpen(true); setAddOpen(false); }} title="Emoji" aria-label="Emoji picker">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                        <circle cx="12" cy="12" r="9"/>
                        <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                        <path d="M9 9h.01M15 9h.01"/>
                      </svg>
                    </button>
                    <button className="px-2 py-1 rounded hover:bg-neutral-800 text-neutral-200" onClick={()=>{ setGifOpen(true); setAddOpen(false); }} title="GIF">GIF</button>
                    <label className="px-2 py-1 rounded hover:bg-neutral-800 text-neutral-200 cursor-pointer" title="File">
                      <input type="file" multiple className="hidden" onChange={(e)=>{ onFilesSelected(e.target.files); setAddOpen(false); }} />
                      File
                    </label>
                    <label className="px-2 py-1 rounded hover:bg-neutral-800 text-neutral-200 cursor-pointer" title="Camera">
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e)=>{ onFilesSelected(e.target.files); setAddOpen(false); }} />
                      Camera
                    </label>
                  </div>
                )}
                {replyTo && (
                  <div className="absolute -top-9 left-0 right-0 mb-1 text-xs text-neutral-300 flex items-center justify-between bg-neutral-900/70 border border-neutral-800 rounded px-2 py-1">
                    <div className="truncate">
                      Replying to <span style={{ color: (replyTo as any)?.authorColor || '#34d399' }}>{replyTo.authorName || 'User'}</span>: <span className="text-neutral-400">{(replyTo.content || '').slice(0, 80)}</span>
                    </div>
                    <button className="ml-2 text-neutral-400 hover:text-neutral-200" onClick={()=>setReplyTo(null)} aria-label="Cancel reply" title="Cancel reply">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  rows={1}
                  className="min-w-0 flex-1 px-3 py-3 text-base rounded bg-neutral-900 text-neutral-100 placeholder-neutral-500 outline-none focus:ring-2 focus:ring-emerald-600/60 border border-neutral-800/60 resize-none"
                  placeholder={`Message #${currentChannel?.name ?? 'general'}`}
                  value={text}
                  onChange={(e) => onInputChange(e.target.value)}
                  onPaste={onComposerPaste}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  autoComplete="off"
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  spellCheck={true}
                  name="chat-message"
                  data-lpignore="true"
                  data-1p-ignore
                  data-bw-ignore
                  data-form-type="other"
                />
                <button
                  className="shrink-0 px-2 md:px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 hover:bg-emerald-700/70 text-emerald-50 flex items-center justify-center"
                  onClick={send}
                >
                  <span className="md:hidden">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d="M22 2L11 13"/>
                      <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                    </svg>
                  </span>
                  <span className="hidden md:inline">Send</span>
                </button>
              </div>
              {composerPickerOpen && (
                <Suspense>
                  <EmojiPanel
                    onClose={() => setComposerPickerOpen(false)}
                    onSelect={(native: string) => { addRecentEmoji(native); insertEmojiAtCaret(native); }}
                  />
                </Suspense>
              )}
            </>
          )}
        </div>
      )}

      {/* Close main content column */}
      </div>

      <FriendsModal
        token={localStorage.getItem('token') || ''}
        open={friendsOpen}
        onlineIds={globalUserIds}
        onClose={()=>setFriendsOpen(false)}
        onStartDm={async (uid) => {
          try {
            const tok = localStorage.getItem('token') || '';
            const res = await api.postAuth('/dms/start', { userId: uid }, tok);
            const sid = String(res.spaceId);
            const cid = String(res.channelId);
            // ensure lists and switch
            socket.emit('void:list');
            socket.emit('channel:list', { voidId: sid });
            // Switch local state and socket room
            switchVoid(sid);
            const shortId = cid.includes(':') ? cid.split(':')[1] : cid;
            switchChannel(shortId);
            setFriendsOpen(false);
          } catch (e: any) {
            toast(e?.message || 'Failed to start DM', 'error');
          }
        }}
      />

      <MemberProfileModal
        token={localStorage.getItem('token') || ''}
        userId={viewUserId || ''}
        open={!!viewUserId}
        onClose={()=>setViewUserId(null)}
        onStartDm={async (uid) => {
          try {
            const tok = localStorage.getItem('token') || '';
            const res = await api.postAuth('/dms/start', { userId: uid }, tok);
            const sid = String(res.spaceId);
            const cid = String(res.channelId);
            socket.emit('void:list');
            socket.emit('channel:list', { voidId: sid });
            switchVoid(sid);
            const shortId = cid.includes(':') ? cid.split(':')[1] : cid;
            switchChannel(shortId);
            setViewUserId(null);
          } catch (e: any) { toast(e?.message || 'Failed to start DM', 'error'); }
        }}
      />

      <UnifiedSettingsModal
        token={localStorage.getItem('token') || ''}
        spaceId={currentVoidId}
        spaceName={voids.find(v=>v.id===currentVoidId)?.name}
        spaceAvatarUrl={voids.find(v=>v.id===currentVoidId)?.avatarUrl || null}
        spaceHomeChannelId={(voids.find(v=>v.id===currentVoidId) as any)?.homeChannelId || null}
        channels={channels}
        open={settingsOpen}
        onClose={()=>setSettingsOpen(false)}
        onRefreshSpaces={()=>socket.emit('void:list')}
        onRefreshChannels={(sid)=>socket.emit('channel:list', { voidId: sid })}
        onSwitchToChannel={(cid)=>{
          setCurrentChannelId(cid.includes(':') ? cid.split(':')[1] : cid);
          socket.emit('channel:switch', { voidId: currentVoidId, channelId: cid });
        }}
        onUserSaved={(u:any)=>{
          const nextMe = { userId: me.userId, name: u?.name || me.name, avatarUrl: (u?.avatarUrl ?? null) };
          setMe(nextMe);
          // reflect changes in people list immediately
          setMembers(prev => prev.map(m => m.id === me.userId ? { ...m, name: u?.name ?? m.name, avatarUrl: u?.avatarUrl ?? m.avatarUrl, status: u?.status ?? m.status, nameColor: u?.nameColor ?? m.nameColor } : m));
          setLocalUser(nextMe);
          try {
            const raw = localStorage.getItem('user');
            const prev = raw ? JSON.parse(raw) : {};
            localStorage.setItem('user', JSON.stringify({ ...prev, name: u?.name, avatarUrl: u?.avatarUrl ?? null, toneUrl: u?.toneUrl ?? prev?.toneUrl, status: u?.status || prev?.status, nameColor: u?.nameColor ?? null }));
            if (u?.nameColor) localStorage.setItem('nameColor', u.nameColor); else localStorage.removeItem('nameColor');
            if (u?.toneUrl) localStorage.setItem('toneUrl', u.toneUrl); else localStorage.removeItem('toneUrl');
          } catch {}
        }}
        onSpaceDeleted={()=>{
          const fallback = 'home';
          setCurrentVoidId(fallback);
          setCurrentChannelId('general');
          socket.emit('void:switch', { voidId: fallback });
          socket.emit('channel:list', { voidId: fallback });
          socket.emit('channel:switch', { voidId: fallback, channelId: `${fallback}:general` });
        }}
        onJoinSpace={(sid)=>{
          setCurrentVoidId(sid);
          setCurrentChannelId('general');
          socket.emit('void:switch', { voidId: sid });
          socket.emit('channel:list', { voidId: sid });
          socket.emit('channel:switch', { voidId: sid, channelId: `${sid}:general` });
        }}
      />

  <InputModal
        open={inputOpen}
        title={inputCfg.title}
        label={inputCfg.label}
        placeholder={inputCfg.placeholder}
        initialValue={inputCfg.initialValue}
        textarea={inputCfg.textarea}
        okText={inputCfg.okText}
        onSubmit={(v)=> closeInput(v || '')}
        onCancel={()=> closeInput(null)}
  />
  {showJump && (
    <button
      aria-label="Jump to present"
      className="md:hidden fixed bottom-20 right-4 z-40 px-3 py-2 rounded-full bg-emerald-700 text-white shadow-lg border border-emerald-600"
      onClick={() => {
        const el = listRef.current; if (!el) return; el.scrollTop = el.scrollHeight; setShowJump(false);
        const cid = fq(currentVoidId, currentChannelId); setUnreadMarkerByChan(prev => ({ ...prev, [cid]: null }));
      }}
    >
      Jump to present
    </button>
  )}
      <Suspense>
        <GifPicker
          open={gifOpen}
          onClose={() => setGifOpen(false)}
          onPick={async (g) => {
            // Import GIF into our storage to avoid external CSP/CORS issues
            await addRemoteAsUpload(g.url, 'gif.gif');
          }}
        />
      </Suspense>

      {/* BottomNav removed per request */}

      {/* Mobile: Spaces sheet */}
      {voidSheetOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={()=>setVoidSheetOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-4/5 max-w-xs bg-neutral-950 border-r border-neutral-800 shadow-xl flex flex-col py-3">
            <div className="px-3 flex items-center justify-between mb-2">
              <div className="text-neutral-300 font-semibold">Spaces</div>
              <button className="text-neutral-400 hover:text-neutral-200" onClick={()=>setVoidSheetOpen(false)} aria-label="Close" title="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="px-3">
              <button
                className="h-10 w-10 rounded-full overflow-hidden border border-neutral-700 bg-neutral-900 flex items-center justify-center hover:border-emerald-600"
                title="Profile"
                onClick={() => { setVoidSheetOpen(false); setChanSheetOpen(false); setUsersSheetOpen(false); if (voiceJoined) leaveVoice(); setCurrentVoidId(""); setCurrentChannelId("general"); }}
              >
                {me?.avatarUrl ? (
                  <img src={me.avatarUrl} alt="me" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-neutral-400">{(me?.name?.[0] || user?.username?.[0] || '?').toUpperCase()}</span>
                )}
              </button>
            </div>
            <div className="mt-3 flex-1 overflow-auto px-2 space-y-2">
              {voids.filter(v=>!String(v.id).startsWith('dm_')).map(v => (
                <div key={v.id} className="flex items-center justify-between gap-2">
                  <button onClick={() => { switchVoid(v.id); setVoidSheetOpen(false); }}
                          className={`flex-1 px-3 py-2 rounded-md text-left border ${v.id===currentVoidId?'border-emerald-700 bg-emerald-900/30 text-emerald-200':'border-neutral-800 bg-neutral-900 text-neutral-300'}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full overflow-hidden border border-neutral-700 bg-neutral-900 flex items-center justify-center">
                        {v.avatarUrl ? <img src={v.avatarUrl} className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(v.name?.[0]||'?').toUpperCase()}</span>}
                      </div>
                      <div className="truncate">{v.name}</div>
                    </div>
                  </button>
                  {v.id === currentVoidId && (
                    <button
                      className="shrink-0 h-10 w-10 rounded-full border border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-emerald-600 flex items-center justify-center"
                      title="Space Settings"
                      onClick={()=>{ setSettingsOpen(true); setVoidSheetOpen(false); }}
                      aria-label="Space settings"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 20.17a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 15.4 1.65 1.65 0 0 0 1.5 14H1.41a2 2 0 1 1 0-4H1.5A1.65 1.65 0 0 0 3 8.6 1.65 1.65 0 0 0 2.17 6.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.83 1.65 1.65 0 0 0 9.5 2.5V2.41a2 2 0 1 1 4 0V2.5A1.65 1.65 0 0 0 15.4 3a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21 8.6c.36.5.57 1.11.5 1.77H21.5a2 2 0 1 1 0 4H21.5A1.65 1.65 0 0 0 19.4 15z"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="px-2 mt-2 flex items-center gap-2">
              <button className="flex-1 px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60" onClick={()=>{ createSpace(); setVoidSheetOpen(false); }}>New Space</button>
              <button
                className="h-10 w-10 rounded-full border border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-emerald-600 flex items-center justify-center"
                title="Space Settings"
                onClick={()=>{ setSettingsOpen(true); setVoidSheetOpen(false); }}
                aria-label="Space settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 20.17a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3 15.4 1.65 1.65 0 0 0 1.5 14H1.41a2 2 0 1 1 0-4H1.5A1.65 1.65 0 0 0 3 8.6 1.65 1.65 0 0 0 2.17 6.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.83 1.65 1.65 0 0 0 9.5 2.5V2.41a2 2 0 1 1 4 0V2.5A1.65 1.65 0 0 0 15.4 3a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21 8.6c.36.5.57 1.11.5 1.77H21.5a2 2 0 1 1 0 4H21.5A1.65 1.65 0 0 0 19.4 15z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile: Channels sheet (gesture-aware) */}
      { (chanSheetOpen || swipePanel==='chan') && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black"
            style={{
              opacity: ((swipePanel==='chan') ? (swipeMode==='close' ? (1 - swipeProgress) : swipeProgress) : (chanSheetOpen ? 1 : 0)) * 0.5,
              transition: swipePanel==='chan' ? 'none' : 'opacity 200ms ease-out',
              pointerEvents: (((swipePanel==='chan') ? (swipeMode==='close' ? (1 - swipeProgress) : swipeProgress) : (chanSheetOpen ? 1 : 0)) > 0.01) ? 'auto' : 'none'
            }}
            onClick={()=>setChanSheetOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 w-4/5 max-w-sm bg-neutral-900 border-r border-neutral-800 shadow-xl flex flex-col"
            style={{
              transform: `translateX(-${(1 - ((swipePanel==='chan') ? (swipeMode==='close' ? (1 - swipeProgress) : swipeProgress) : (chanSheetOpen ? 1 : 0))) * 100}%)`,
              transition: swipePanel==='chan' ? 'none' : 'transform 200ms ease-out',
              willChange: 'transform'
            }}
          >
            <div className="h-12 flex items-center justify-between px-3 border-b border-neutral-800">
              <div className="font-semibold text-emerald-300">Channels</div>
              <button className="text-neutral-400 hover:text-neutral-200" onClick={()=>setChanSheetOpen(false)} aria-label="Close" title="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-2">
              {!String(currentVoidId).startsWith('dm_') && (
                <button className="w-full px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/60 mb-2" onClick={()=>{ createChannel(); setChanSheetOpen(false); }}>+ Channel</button>
              )}
              <ul className="space-y-1">
                {(!String(currentVoidId).startsWith('dm_') ? channels : channels.filter(ch=>ch.id==='chat')).map(ch => (
                  <li key={ch.id}>
                    <button className={`w-full text-left px-3 py-2 rounded-md transition-colors hover:bg-neutral-800/70 ${ch.id===currentChannelId?'bg-emerald-900/30 text-emerald-200 border border-emerald-800/40':''}`}
                            onClick={() => { switchChannel(ch.id); setChanSheetOpen(false); }}
                    >#{ch.name}</button>
                  </li>
                ))}
              </ul>
              {/* DMs with close control */}
              <div className="mt-3 px-1 text-neutral-400 text-xs">Direct Messages</div>
              <ul className="mt-1 space-y-1">
                {(() => {
                  const dmList = voids.filter(v => {
                    if (!String(v.id).startsWith('dm_')) return false;
                    const count = unread[`${v.id}:chat`] || 0;
                    // If hidden, only show when there are unread messages
                    if (hiddenDms.includes(v.id)) return (count > 0) && !mutedSpaces[v.id];
                    return true;
                  });
                  return dmList.map(v => {
                  const count = unread[`${v.id}:chat`] || 0;
                  const active = currentVoidId === v.id;
                  return (
                    <li key={v.id} className="flex items-center gap-2">
                      <button className={`flex-1 text-left px-3 py-2 rounded-md transition-colors ${active?'bg-emerald-900/30 text-emerald-200 border border-emerald-800/40':'hover:bg-neutral-800/70 text-neutral-300'}`} onClick={()=>{ switchVoid(v.id); switchChannel('chat'); setChanSheetOpen(false); }}>
                        {v.name || 'DM'}
                      </button>
                      {count>0 && <span className="min-w-5 h-5 px-1 rounded-full bg-emerald-600 text-white text-[10px] flex items-center justify-center">{count>99?'99+':count}</span>}
                      {/* Mute moved to settings */}
                      <button title="Close DM" aria-label="Close DM" className="px-2 py-1 rounded text-neutral-400 hover:text-red-300 hover:bg-red-900/20" onClick={(e)=>{ e.stopPropagation(); setHiddenDms(prev => prev.includes(v.id) ? prev : [...prev, v.id]); }}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </li>
                  );
                  });
                })()}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Mobile: People sheet (gesture-aware) */}
      { showPeople && (usersSheetOpen || swipePanel==='users') && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black"
            style={{
              opacity: ((swipePanel==='users') ? (swipeMode==='close' ? (1 - swipeProgress) : swipeProgress) : (usersSheetOpen ? 1 : 0)) * 0.5,
              transition: swipePanel==='users' ? 'none' : 'opacity 200ms ease-out',
              pointerEvents: (((swipePanel==='users') ? (swipeMode==='close' ? (1 - swipeProgress) : swipeProgress) : (usersSheetOpen ? 1 : 0)) > 0.01) ? 'auto' : 'none'
            }}
            onClick={()=>setUsersSheetOpen(false)}
          />
          <div
            className="absolute inset-y-0 right-0 w-4/5 max-w-sm bg-neutral-900 border-l border-neutral-800 shadow-xl flex flex-col"
            style={{
              transform: `translateX(${(1 - ((swipePanel==='users') ? (swipeMode==='close' ? (1 - swipeProgress) : swipeProgress) : (usersSheetOpen ? 1 : 0))) * 100}%)`,
              transition: swipePanel==='users' ? 'none' : 'transform 200ms ease-out',
              willChange: 'transform'
            }}
          >
            <div className="h-12 flex items-center justify-between px-3 border-b border-neutral-800">
              <div className="font-semibold text-emerald-300">People</div>
              <button className="text-neutral-400 hover:text-neutral-200" onClick={()=>setUsersSheetOpen(false)} aria-label="Close" title="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-2 space-y-1 overflow-auto">
              {members.map(m => {
                const online = globalUserIds.includes(m.id) || spaceUserIds.includes(m.id) || roomUserIds.includes(m.id);
                const onMobile = globalMobileIds.includes(m.id) || spaceMobileIds.includes(m.id) || roomMobileIds.includes(m.id);
                const st = String(m.status || '').toLowerCase();
                let label = 'Offline';
                if (st === 'dnd') { label = 'Do Not Disturb'; }
                else if (st === 'idle') { label = 'Idle'; }
                else if (st === 'invisible') { label = 'Offline'; }
                else if (online) { label = 'Online'; }
                return (
                  <div key={m.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-neutral-800/40">
                    <div className="relative h-8 w-8">
                      {(() => { const ring = (st === 'dnd') ? '#ef4444' : (st === 'idle') ? '#f59e0b' : ((online && onMobile) ? '#14b8a6' : (online ? '#10b981' : null)); return ring ? (<span className="pointer-events-none absolute -inset-0.5 rounded-full" style={{ border: `2px solid ${ring}`, boxShadow: `0 0 10px ${ring}` }}></span>) : null; })()}
                      <div className="h-8 w-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                        {m.avatarUrl ? <img src={m.avatarUrl} alt="avatar" className="h-full w-full object-cover"/> : <span className="text-[10px] text-neutral-400">{(m.name?.[0]||'?').toUpperCase()}</span>}
                      </div>
                      {/* Status dot replaced by ring */}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-neutral-200 text-sm">{m.name || m.username}</div>
                      <div className="text-[10px] text-neutral-400">{label}</div>
                    </div>
                  </div>
                );
              })}
              {members.length === 0 && <div className="text-neutral-500 text-sm px-2">No members</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}










