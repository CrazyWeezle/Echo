import { useEffect, useState } from 'react';
import { api, signUpload } from '../lib/api';
import CloseButton from './CloseButton';

export default function ProfileModal({ token, open, onClose, onSaved, onOpenSettings }: { token: string; open: boolean; onClose: () => void; onSaved: (u: any) => void; onOpenSettings?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('online');
  const [nameColor, setNameColor] = useState<string>('');
  const [friendRingColor, setFriendRingColor] = useState<string>('');
  const [pronouns, setPronouns] = useState<string>('');
  const [website, setWebsite] = useState<string>('');
  // Notification settings moved to Settings modal
  const [friendRingEnabled, setFriendRingEnabled] = useState<boolean>(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setErr('');
    api.getAuth('/users/me', token)
      .then(u => { setName(u.name || ''); setBio(u.bio || ''); setAvatarUrl(u.avatarUrl || null); setStatus(u.status || 'online'); setNameColor(u.nameColor || ''); setFriendRingColor(u.friendRingColor || ''); setFriendRingEnabled(typeof u.friendRingEnabled === 'boolean' ? !!u.friendRingEnabled : true); setPronouns(u.pronouns || ''); setWebsite(u.website || ''); })
      .catch((e: any) => setErr(e.message || 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [open, token]);

  async function onAvatarPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    try {
      const { url, headers, publicUrl } = await signUpload({ filename: f.name, contentType: f.type || 'application/octet-stream', size: f.size }, token);
      await fetch(url, { method: 'PUT', headers, body: f });
      setAvatarUrl(publicUrl);
    } catch (e) {
      console.error(e);
      setErr('Upload failed');
    }
  }

  async function save() {
    setLoading(true); setErr('');
    try {
      const payload: any = { name, bio, avatarUrl, status, pronouns, website };
      const c = String(nameColor || '').trim();
      payload.nameColor = c ? c : null;
      const fr = String(friendRingColor || '').trim();
      payload.friendRingColor = fr ? fr : null;
      payload.friendRingEnabled = !!friendRingEnabled;
      const u = await api.patchAuth('/users/me', payload, token);
      onSaved(u);
      onClose();
    } catch (e: any) {
      setErr(e.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-[calc(100%-1rem)] sm:w-full max-w-md max-h-[88vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-emerald-300">Your Profile</h2>
          <CloseButton onClick={onClose} />
        </div>
        {err && <div className="mb-2 text-sm text-red-400">{err}</div>}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-14 w-14 rounded-full border border-neutral-700 bg-neutral-800 overflow-hidden flex items-center justify-center">
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="text-neutral-500">No avatar</span>
            )}
          </div>
          <label className="px-2 py-1 rounded border border-neutral-800 text-neutral-300 hover:bg-neutral-800/60 cursor-pointer text-sm">
            <input type="file" accept="image/*" className="hidden" onChange={e => onAvatarPick(e.target.files)} />
            Change avatar
          </label>
          {avatarUrl && (
            <button className="text-xs text-neutral-400 hover:text-neutral-200" onClick={() => setAvatarUrl(null)}>Remove</button>
          )}
        </div>
        <div className="mb-4">
          <label className="block text-xs text-neutral-500 mb-1">Or paste image URL</label>
          <input
            className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60"
            placeholder="https://example.com/avatar.png"
            value={avatarUrl || ''}
            onChange={e => setAvatarUrl(e.target.value.trim() || null)}
          />
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Display name</label>
            <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Pronouns</label>
            <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="they/them" value={pronouns} onChange={e => setPronouns(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Website</label>
            <input className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" placeholder="https://example.com" value={website} onChange={e => setWebsite(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Display name color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={(() => { const c = String(nameColor || '').trim(); return /^#([0-9a-fA-F]{6})$/.test(c) ? c : '#ffffff'; })()}
                onChange={(e) => setNameColor(e.target.value)}
                className="h-9 w-12 bg-neutral-900 border border-neutral-800 rounded cursor-pointer"
                title="Pick a color"
              />
              <input
                className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60"
                placeholder="#34d399 or 'teal'"
                value={nameColor}
                onChange={(e) => setNameColor(e.target.value)}
              />
              <div className="text-sm" style={nameColor ? { color: nameColor } : undefined}>{name || 'Preview'}</div>
            </div>
            <p className="mt-1 text-xs text-neutral-500">Use a hex color like #34d399 or leave blank to use default.</p>
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Friend indicator color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={(() => { const c = String(friendRingColor || '').trim(); return /^#([0-9a-fA-F]{6})$/.test(c) ? c : '#34d399'; })()}
                onChange={(e) => setFriendRingColor(e.target.value)}
                className="h-9 w-12 bg-neutral-900 border border-neutral-800 rounded cursor-pointer"
                title="Pick a color"
              />
              <input
                className="flex-1 p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60"
                placeholder="#34d399 or 'teal'"
                value={friendRingColor}
                onChange={(e) => setFriendRingColor(e.target.value)}
              />
              <div className="text-sm flex items-center gap-2">
                <span className="inline-block h-6 w-6 rounded-full relative">
                  <span className="absolute -inset-0.5 rounded-full" style={{ border: `2px solid ${friendRingColor || '#34d399'}`, boxShadow: `0 0 8px ${friendRingColor || '#34d399'}` }}></span>
                  <span className="absolute inset-0 rounded-full bg-neutral-800 border border-neutral-700"></span>
                </span>
                Preview
              </div>
            </div>
            <p className="mt-1 text-xs text-neutral-500">Used to highlight friends in People lists.</p>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-neutral-400">Show friend indicator ring</label>
            <input type="checkbox" checked={friendRingEnabled} onChange={(e)=>setFriendRingEnabled(e.target.checked)} />
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Bio</label>
            <textarea rows={4} className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 placeholder-neutral-500 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60" value={bio} onChange={e => setBio(e.target.value)} spellCheck={true} autoCorrect="on" autoCapitalize="sentences" />
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Status</label>
            <select
              className="w-full p-2.5 rounded-md bg-neutral-900 text-neutral-100 border border-neutral-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/60"
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              <option value="online">Online</option>
              <option value="idle">Idle</option>
              <option value="dnd">Do Not Disturb</option>
              <option value="invisible">Invisible</option>
            </select>
            <p className="mt-1 text-xs text-neutral-500">Invisible appears offline to others.</p>
          </div>
          <div className="pt-2 border-t border-neutral-800" />
          <div className="flex items-center justify-end">
            <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70" onClick={() => { onOpenSettings?.(); onClose(); }}>Open Settings</button>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-2 rounded border border-neutral-700 text-neutral-200 hover:bg-neutral-800/70" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="px-3 py-2 rounded border border-emerald-700 bg-emerald-800/70 text-emerald-50 hover:bg-emerald-700/70" onClick={save} disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

