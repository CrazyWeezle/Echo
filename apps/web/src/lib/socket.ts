import { io, Socket } from "socket.io-client";

// Same-origin: let the browser hit the current host (http://localhost:3000)
const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? "").trim();
// If SERVER_URL is empty, pass undefined so socket.io uses window.location.origin
const base: string | undefined = SERVER_URL === "" ? undefined : SERVER_URL;

// Try to load any saved user and token from localStorage
function loadAuth() {
    const token = localStorage.getItem("token");
    const userRaw = localStorage.getItem("user");
    let user: any = null;
    try { if (userRaw) user = JSON.parse(userRaw); } catch {}
    return { token, user };
}
const { token } = loadAuth();

export const socket: Socket = io(base, {
    autoConnect: false,
    // Allow websocket with HTTP polling fallback for tunnel/proxy quirks
    transports: ["websocket", "polling"],
    path: "/socket.io",
    withCredentials: true,
    auth: { token: localStorage.getItem('token') || undefined },
    // Make reconnection more resilient over tunnels
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 20000,
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
