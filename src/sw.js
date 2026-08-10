import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

// injectManifest strategy — this file (not vite-plugin-pwa's generated
// service worker) owns the precache + push handling. self.__WB_MANIFEST is
// replaced at build time with the file list from injectManifest.globPatterns
// in vite.config.js.

// ---------------------------------------------------------------------------
// TAKE OVER IMMEDIATELY. Without these two the installed PWA silently runs an
// old build forever, while the same app in a browser tab updates normally —
// which is exactly the "the app and the website look different" bug reported
// on 2026-08-10.
//
// WHY IT HAPPENED: vite.config.js sets registerType: 'autoUpdate', which with
// the DEFAULT generateSW strategy makes the plugin inject skipWaiting() and
// clientsClaim() for you. This project uses strategies: 'injectManifest'
// instead (so the push handlers below can exist at all), and under
// injectManifest the plugin does not touch this file beyond swapping in
// __WB_MANIFEST. So the config read as "auto update" while the generated
// dist/sw.js contained neither call — verified, both greps returned 0.
//
// A new service worker with no skipWaiting() installs and then sits in the
// WAITING state until every client for the scope is closed. A browser tab gets
// closed all the time, so the website picked up new builds. An installed PWA
// is backgrounded rather than closed, so its old worker kept control and kept
// serving the old precached index.html and old hashed JS/CSS.
//
// This is self-healing from here: the browser's own update check fetches this
// file, and THIS version skips waiting on its own, so it activates without
// needing anything closed. The already-installed old worker can't be fixed
// retroactively, but it doesn't need to be.
//
// Deliberately NOT auto-reloading open pages on activation. clientsClaim()
// means the next navigation serves the new build, which is enough. Forcing a
// reload of a live page would discard whatever a rep had typed into a lead or
// activity form mid-edit — a worse bug than being one launch behind.
// ---------------------------------------------------------------------------
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Drops precaches left behind by previous versions. Without it every deploy
// adds another full copy of the app shell to storage and none are ever freed.
cleanupOutdatedCaches()

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
