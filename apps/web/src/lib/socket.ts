import { io, Socket } from "socket.io-client";
import { getAuthToken, subscribeAuthToken } from "./auth";

// Same-origin: let the browser hit the current host (http://localhost:3000)
const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? "").trim();
// If SERVER_URL is empty, pass undefined so socket.io uses window.location.origin
const base: string | undefined = SERVER_URL === "" ? undefined : SERVER_URL;

// Try to load any saved user and token from localStorage
function loadAuth() {
    const token = getAuthToken();
    const userRaw = localStorage.getItem("user");
    let user: any = null;
    try { if (userRaw) user = JSON.parse(userRaw); } catch {}
    return { token, user };
}
const { token } = loadAuth();

// Detect simple platform hint for presence (mobile vs web)
const PLATFORM = (() => {
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    const isCap = typeof (window as any).Capacitor !== 'undefined';
    const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua) || isCap;
    return isMobile ? 'mobile' : 'web';
  } catch { return 'web'; }
})();

export const socket: Socket = io(base, {
    autoConnect: false,
    // Prefer pure WebSocket for lowest latency; skip HTTP polling upgrade
    transports: ["websocket"],
    upgrade: false,
    path: "/socket.io",
    withCredentials: true,
    auth: { token: token || undefined, platform: PLATFORM },
    // Make reconnection more resilient
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 300,
    reconnectionDelayMax: 2000,
    timeout: 15000,
});

subscribeAuthToken((nextToken) => {
    (socket as any).auth = { ...(socket as any).auth, token: nextToken || undefined };
});

// ---- lifecycle helpers ----
export function connectSocket() {
    if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
    if (socket.connected) socket.disconnect();
}

// ---- local user utils ----
export function getLocalUser() {
    const raw = localStorage.getItem("me");
    try {
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function setLocalUser(u: any) {
    localStorage.setItem("me", JSON.stringify(u));
}
