/* eslint-disable no-restricted-globals */
import { precacheAndRoute } from 'workbox-precaching';

// self.__WB_MANIFEST is injected at build time
declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };
// @ts-ignore
precacheAndRoute(self.__WB_MANIFEST || []);

// Ensure the new service worker activates immediately and takes control,
// reducing the chance of mixed old/new bundles after a deploy
self.addEventListener('install', (event: any) => {
  try { self.skipWaiting(); } catch {}
});
self.addEventListener('activate', (event: any) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch {}
  })());
});

self.addEventListener('push', (event: any) => {
  try {
    const data = event.data ? JSON.parse(event.data.text()) : {};
    const title = data.title || 'ECHO';
    const body = data.body || '';
    const tag = data.tag || data.channelId || 'echo';
    const chan: string = String(data.channelId || '');
    const spaceId = chan.includes(':') ? chan.split(':')[0] : '';
    event.waitUntil((async () => {
      // Read muted spaces from in-memory and cache storage
      let muted: Record<string, boolean> = (self as any).__mutedSpaces || {};
      try {
        const cache = await caches.open('echo-prefs');
        const res = await cache.match('/__echo_muted__');
        if (res) { const js = await res.json(); muted = js || muted; }
      } catch {}
      // Suppress notification when space/DM is muted
      if (spaceId && muted && muted[spaceId]) return;
      const options: NotificationOptions = {
        body,
        icon: data.icon || '/brand/ECHO_logo.png',
        badge: data.badge || '/brand/ECHO_logo.png',
        image: data.image,
        tag,
        renotify: !!data.renotify,
        requireInteraction: !!data.requireInteraction,
        timestamp: data.timestamp || Date.now(),
        data,
        actions: Array.isArray(data.actions) ? data.actions.slice(0,2).map((a:any)=>({ action: String(a.action||''), title: String(a.title||''), icon: a.icon })) : undefined,
      } as NotificationOptions;
      await self.registration.showNotification(title, options);
    })());
  } catch {}
});

self.addEventListener('notificationclick', (event: any) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const url = self.registration.scope || '/';
  const action = event.action || '';
  event.waitUntil((async () => {
    const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const postTo = async (msg:any) => { for (const client of clientsArr) { try { (client as any).postMessage(msg); } catch {} } };
    if (action === 'mute' && data && data.channelId) {
      // Ask the app to mute this space/channel
      await postTo({ type: 'MUTE_CHANNEL', data });
    }
    for (const client of clientsArr) {
      if ('focus' in client) { (client as any).focus(); await postTo({ type: 'OPEN_CHANNEL', data }); return; }
    }
    await self.clients.openWindow(url);
  })());
});

// Accept muted spaces updates from the app
self.addEventListener('message', (event: any) => {
  try {
    const { type, data } = event.data || {};
    if (type === 'SET_MUTED_SPACES') {
      (self as any).__mutedSpaces = data || {};
      caches.open('echo-prefs').then(cache => cache.put('/__echo_muted__', new Response(JSON.stringify((self as any).__mutedSpaces))))
        .catch(()=>{});
    }
  } catch {}
});
