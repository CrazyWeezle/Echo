type TokenListener = (token: string | null) => void;

const listeners = new Set<TokenListener>();
let initialized = false;
let currentToken: string | null = null;

function readToken(): string | null {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

export function getAuthToken(): string | null {
  if (!initialized) {
    currentToken = readToken();
    initialized = true;
  }
  return currentToken;
}

export function setAuthToken(token: string | null) {
  if (!initialized) {
    currentToken = readToken();
    initialized = true;
  }
  const next = token ?? null;
  currentToken = next;
  try {
    if (next) localStorage.setItem("token", next);
    else localStorage.removeItem("token");
  } catch {}
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {}
  }
}

export function subscribeAuthToken(listener: TokenListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
