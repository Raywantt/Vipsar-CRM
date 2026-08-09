import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    // Some pure-logic modules under test transitively import
    // src/lib/supabaseClient.js (e.g. drilldownBuilders.js -> TargetsVsActualsCard.jsx
    // -> SetTargetForm.jsx -> targetQueries.js), which calls createClient() at module
    // load time. createClient() throws synchronously if the URL/key are missing, so
    // tests must not depend on a developer's local .env existing (it's git-ignored,
    // and CI won't have one) — these dummy values just need to be well-formed enough
    // for createClient() to succeed; no network call is ever made in these tests.
    env: {
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
