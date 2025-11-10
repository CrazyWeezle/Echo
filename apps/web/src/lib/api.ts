import { setAuthToken } from "./auth";

export const API_URL =
    import.meta.env.VITE_API_URL ??
    import.meta.env.VITE_API_HTTP_URL ?? // backward compat
    '/api';

async function refreshToken(): Promise<string | null> {
    try {
        const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST' });
        if (!res.ok) return null;
        const data = await res.json();
        const t = (data as any)?.token as string | undefined;
        if (t) {
            setAuthToken(t);
            return t;
        }
        return null;
    } catch {
        return null;
    }
}

export const api = {
    async post(path: string, body: any) {
        const res = await fetch(`${API_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            let msg = 'Request failed';
            try { msg = (await res.json())?.message ?? msg; } catch {}
            throw new Error(msg);
        }
        return res.json();
    },
    async deleteAuth(path: string, body: any, token: string) {
        let res = await fetch(`${API_URL}${path}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (res.status === 401) {
            const nt = await refreshToken();
            if (nt) {
                res = await fetch(`${API_URL}${path}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nt}` }, body: JSON.stringify(body) });
            }
        }
        if (!res.ok) {
            let msg = 'Request failed';
            try { msg = (await res.json())?.message ?? msg; } catch {}
            throw new Error(msg);
        }
        // Some endpoints return 204 No Content; avoid JSON.parse on empty body
        if (res.status === 204) return {} as any;
        try { return await res.json(); } catch { return {} as any; }
    },
    async postAuth(path: string, body: any, token: string) {
        let res = await fetch(`${API_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (res.status === 401) {
            const nt = await refreshToken();
            if (nt) {
                res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nt}` }, body: JSON.stringify(body) });
            }
        }
        if (!res.ok) {
            let msg = 'Request failed';
            try { msg = (await res.json())?.message ?? msg; } catch {}
            throw new Error(msg);
        }
        return res.json();
    },
    async getAuth(path: string, token: string) {
        let res = await fetch(`${API_URL}${path}`, { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401) {
            const nt = await refreshToken();
            if (nt) {
                res = await fetch(`${API_URL}${path}`, { method: 'GET', headers: { 'Authorization': `Bearer ${nt}` } });
            }
        }
        if (!res.ok) {
            let msg = 'Request failed';
            try { msg = (await res.json())?.message ?? msg; } catch {}
            throw new Error(msg);
        }
        return res.json();
    },
    async patchAuth(path: string, body: any, token: string) {
        let res = await fetch(`${API_URL}${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(body) });
        if (res.status === 401) {
            const nt = await refreshToken();
            if (nt) {
                res = await fetch(`${API_URL}${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nt}` }, body: JSON.stringify(body) });
            }
        }
        if (!res.ok) {
            let msg = 'Request failed';
            try { msg = (await res.json())?.message ?? msg; } catch {}
            throw new Error(msg);
        }
        return res.json();
    },
};

export async function signUpload(params: { filename: string; contentType: string; size: number }, token: string) {
    let res = await fetch(`${API_URL}/files/sign`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(params),
    });
    if (res.status === 401) {
        const nt = await refreshToken();
        if (nt) {
            res = await fetch(`${API_URL}/files/sign`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${nt}`,
                },
                body: JSON.stringify(params),
            });
        }
    }
    if (!res.ok) {
        let msg = 'Sign failed';
        try { msg = (await res.json())?.message ?? msg; } catch {}
        throw new Error(msg);
    }
    const data = await res.json();
    // Defensive normalization: ensure publicUrl is an absolute/same-origin path
    try {
        let pub = data?.publicUrl as string | undefined;
        const key = (data?.key as string | undefined) || '';
        const hasProtoOrRoot = typeof pub === 'string' && /^(https?:)?\//.test(pub);
        if (!hasProtoOrRoot) {
            const cleanKey = String(key || pub || '').replace(/^\/+/, '');
            pub = `/files/echo-app/${cleanKey}`;
        }
        return { ...data, publicUrl: pub };
    } catch {
        return data;
    }
}

// Convenience helpers for push device registration
export async function pushRegister(body: { token: string; platform: string }, token: string) {
    return api.postAuth('/push/register', body, token);
}
export async function pushUnregister(body: { token: string }, token: string) {
    return api.postAuth('/push/unregister', body, token);
}
