import { precacheAndRoute } from 'workbox-precaching'

// injectManifest strategy — this file (not vite-plugin-pwa's generated
// service worker) owns the precache + push handling. self.__WB_MANIFEST is
// replaced at build time with the file list from injectManifest.globPatterns
// in vite.config.js.
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Follow-up reminder', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data?.url ?? '/'))
})
