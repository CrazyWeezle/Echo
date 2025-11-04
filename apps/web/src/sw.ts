/* eslint-disable no-restricted-globals */
import { precacheAndRoute } from 'workbox-precaching';

// self.__WB_MANIFEST is injected at build time
declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };
// @ts-ignore
precacheAndRoute(self.__WB_MANIFEST || []);

self.addEventListener('push', (event: any) => {
  try {
    const data = event.data ? JSON.parse(event.data.text()) : {};
    const title = data.title || 'ECHO';
    const body = data.body || '';
    const tag = data.channelId || 'echo';
    const options: NotificationOptions = {
      body,
      icon: '/brand/ECHO_logo.png',
      badge: '/brand/ECHO_logo.png',
      tag,
      data,
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {}
});

self.addEventListener('notificationclick', (event: any) => {
  event.notification.close();
  const data = event.notification?.data || {};
  const url = self.registration.scope || '/';
  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsArr) {
        if ('focus' in client) { (client as any).focus(); (client as any).postMessage({ type: 'OPEN_CHANNEL', data }); return; }
      }
      await self.clients.openWindow(url);
    })()
  );
});

