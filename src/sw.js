// The service worker exists for ONE reason now: push notifications for
// follow-up reminders. It deliberately caches nothing.
//
// ---------------------------------------------------------------------------
// WHY THE OFFLINE COPY WAS REMOVED (2026-09-07, owner's decision)
//
// This file used to call precacheAndRoute(self.__WB_MANIFEST), which stored a
// complete copy of the app shell on every employee's device and served the
// page from that copy instead of the network. Two things made that a bad deal
// for this app:
//
//   1. IT WAS THE STALE-APP BUG. A precached index.html points at one exact
//      hashed bundle, so a refresh returned the OLD build — measured on a live
//      tab as workerStart 1006ms with transferSize 0, i.e. the refresh never
//      reached the network at all. That is why employees were being told to
//      clear their site data after every deploy, and why a plain refresh
//      looked like it did nothing.
//   2. IT BOUGHT ALMOST NOTHING. The app is not usable offline regardless:
//      there is no runtimeCaching rule for Supabase (deliberately — see the
//      PWA section in CLAUDE.md), so with no signal a rep got the shell and no
//      data. And the hashed assets are already served `immutable` by
//      vercel.json, so the browser's own HTTP cache keeps the JS/CSS without
//      any help from here. The precache was duplicating the browser's cache
//      while adding a staleness trap the browser's cache does not have.
//
// NOT a performance fix, and it must not be described as one: the CRM's slow
// page loads were measured (PERFORMANCE.md) as database request contention —
// 32 concurrent queries starving each other, a `leads` query going 868ms alone
// to 5,143ms during a real load. This file was never part of that.
// ---------------------------------------------------------------------------

// TAKE OVER IMMEDIATELY. Kept from the 2026-08-10 fix, and still load-bearing:
// without skipWaiting() a new worker sits in the WAITING state until every
// client for the scope closes, which an installed PWA (backgrounded, never
// closed) may never do. That is what made the app serve a stale build forever.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Actively delete the app-shell copies previous versions of this worker
      // left on the device. cleanupOutdatedCaches() cannot do this job any
      // more — it only knows how to prune workbox's OWN precaches relative to
      // a current one, and there is no current one. Deleting every cache for
      // this origin is correct here because this app has never used the Cache
      // API for anything except that precache.
      //
      // Without this, an employee's device keeps ~1MB of a build nothing will
      // ever read again, and (worse) the door stays open for some future code
      // path to serve from it.
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.clients.claim()
    })()
  )
})

// A no-op fetch handler, on purpose. It calls neither respondWith() nor
// anything else, so every request falls through to the network exactly as if
// no service worker were installed — that is the entire intent.
//
// It exists because Chrome's install criteria require a service worker with a
// fetch handler before it will offer "Add to Home Screen". Delete this and
// reps can no longer install the CRM on their phones. It is not caching, and
// must never quietly grow into caching.
self.addEventListener('fetch', () => {})

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Follow-up reminder', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Both optional and both sent only by the lead-assignment payload
      // (send-followup-reminders/index.ts). `tag` collapses repeats about the
      // same lead into one banner instead of stacking; `requireInteraction`
      // keeps that banner on screen until the rep actually deals with it,
      // rather than auto-dismissing into the notification shade while the
      // phone is in a pocket — which is what "a very clear notification"
      // needs on Android. iOS ignores requireInteraction, which is why the
      // in-app AssignedLeadsCard exists as well.
      //
      // Undefined for a follow-up reminder, and an undefined option is the
      // same as not passing it — so reminders behave exactly as before.
      tag: data.tag,
      requireInteraction: data.requireInteraction === true,
      // A phone in a pocket is the whole point; a silent banner is not a
      // notification. Ignored where the platform does not support it.
      vibrate: [120, 60, 120],
      data: { url: data.url ?? '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data?.url ?? '/'))
})
