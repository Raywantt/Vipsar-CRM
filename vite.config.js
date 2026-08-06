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
        // App shell only: built JS/CSS/HTML + icons + self-hosted fonts. No
        // runtimeCaching rules are added for the Supabase API, so those
        // requests always hit the network and are never served (or
        // silently failed) from cache.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
      },
    }),
  ],
})
