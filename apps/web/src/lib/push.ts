// Minimal Capacitor Push registration that no-ops on web builds.
// On Android (Capacitor runtime), uses the global Plugins registry if available.

import { api } from './api';

function getPushPlugin(): any | null {
  try {
    const w: any = window as any;
    // Capacitor v3+ exposes plugins under Capacitor.Plugins
    return w?.Capacitor?.Plugins?.PushNotifications || w?.PushNotifications || null;
  } catch {
    return null;
  }
}

export async function initPush(accessToken: string) {
  try {
    const Push = getPushPlugin();
    if (!Push) return; // not running in Capacitor/Android
    const perm = await Push.checkPermissions();
    if (perm?.receive !== 'granted') {
      const req = await Push.requestPermissions();
      if (req?.receive !== 'granted') return;
    }
    await Push.register();
    Push.addListener('registration', async (token: { value: string }) => {
      try {
        await api.postAuth('/push/register', { token: token.value, platform: 'android' }, accessToken);
        localStorage.setItem('pushToken', token.value);
      } catch {}
    });
    Push.addListener('registrationError', (err: any) => {
      try { console.warn('Push registration error', err); } catch {}
    });
  } catch {}
}

export async function unregisterPush(accessToken: string) {
  try {
    const tok = localStorage.getItem('pushToken');
    if (!tok) return;
    await api.postAuth('/push/unregister', { token: tok }, accessToken);
  } catch {}
}
