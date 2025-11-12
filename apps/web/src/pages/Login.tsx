import { useState } from 'react';
import { api } from '../lib/api';
import type { AuthUser } from '../types/auth';

export default function Login({ onAuth }: { onAuth: (token: string, user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      if (mode === 'signup') {
        await api.post(`/auth/signup`, { username, password });
        setMsg('Please continue to login');
        setMode('login');
      } else {
        const res = await api.post(`/auth/login`, { username, password });
        onAuth(res.token, res.user as AuthUser);
      }
    } catch (err: any) {
      setErr(err.message || 'Auth failed');
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-neutral-100 brand-login-bg p-6">
      <div className="mb-4 flex flex-col items-center gap-2 select-none">
        <img src="/brand/Echo_logo_plant.png" alt="Echo" className="h-14 w-auto object-contain" />
        <div className="text-lg tracking-wide font-semibold text-emerald-300">Echo</div>
      </div>
            <form onSubmit={submit} className="bg-neutral-900/60 border border-emerald-900/40 backdrop-blur-sm p-6 rounded-2xl w-full max-w-xs space-y-4 shadow-xl shadow-emerald-950/20">
              <h1 className="text-xl font-semibold bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent text-center">
                {mode === 'login' ? 'Welcome back' : 'Create your account'}
              </h1>
              {err && <div className="text-red-400 text-sm">{err}</div>}
              {msg && <div className="text-emerald-400 text-sm">{msg}</div>}
              <input
                className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60"
                placeholder="Username"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
              
              <input
                className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60"
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
        <button
          type="submit"
          className="w-full py-2.5 rounded-md text-emerald-50 border border-emerald-700 bg-gradient-to-r from-brand-emerald to-brand-teal hover:brightness-110 transition-colors"
        >
          {mode === 'login' ? 'Login' : 'Sign Up'}
        </button>
        <div className="text-sm text-neutral-400 text-center">
          {mode === 'login' ? (
            <>Don't have an account? <button type="button" onClick={() => setMode('signup')} className="underline text-emerald-300 hover:text-emerald-200">Sign up</button></>
          ) : (
            <>Already have an account? <button type="button" onClick={() => setMode('login')} className="underline text-emerald-300 hover:text-emerald-200">Login</button></>
          )}
        </div>
      </form>
    </div>
  );
}
