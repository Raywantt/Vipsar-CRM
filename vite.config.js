import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      // injectManifest (not the default generateSW) so src/sw.js can add its
      // own push/notificationclick handlers — generateSW only lets you tweak
      // caching behavior, not add custom event listeners. src/sw.js does its
      // own precacheAndRoute(self.__WB_MANIFEST) using the same file list
      // that used to live under workbox.globPatterns below.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      manifest: {
        name: 'VIPSAR CRM',
        short_name: 'VIPSAR CRM',
        description: 'CRM for managing Tostem window & door dealership sales, quotes, and installs.',
        theme_color: '#1b2124',
        background_color: '#f2f5f5',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // NOTHING IS PRECACHED ANY MORE (2026-09-07). injectionPoint:
        // undefined tells workbox not to look for self.__WB_MANIFEST in
        // src/sw.js at all — without it the build FAILS, because the default
        // injection point is mandatory and src/sw.js no longer references it.
        //
        // This used to carry globPatterns for the whole app shell. It was
        // removed because that precache was the cause of the stale-app bug
        // (a refresh was answered from the stored copy and never reached the
        // network) while buying nothing: Supabase calls were never cached, so
        // the app was not usable offline regardless, and vercel.json already
        // serves /assets/* as immutable so the browser's own cache keeps the
        // JS/CSS. See src/sw.js's header for the full reasoning.
        //
        // The service worker is still built and deployed — it carries the
        // push-notification handlers for follow-up reminders.
        injectionPoint: undefined,
      },
    }),
  ],
})
