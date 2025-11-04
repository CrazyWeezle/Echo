import { api } from './api';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function registerWebPush(accessToken: string) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    const pub = (import.meta as any).env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    if (!pub) return;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pub) });
    await api.postAuth('/push/subscribe', { subscription: sub }, accessToken);
    localStorage.setItem('webpushEndpoint', sub.endpoint || '');
  } catch {}
}

export async function unregisterWebPush(accessToken: string) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const endpoint = sub?.endpoint || localStorage.getItem('webpushEndpoint') || '';
    if (sub) await sub.unsubscribe();
    if (endpoint) await api.postAuth('/push/unsubscribe', { endpoint }, accessToken);
  } catch {}
}

