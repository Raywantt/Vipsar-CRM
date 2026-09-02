import { createClient } from '@supabase/supabase-js'
import { createSupabaseFetch } from './supabaseFetch'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// `global.fetch` is handed to both the PostgREST and the Auth client inside
// createClient, so this one line is what puts every query, write and token
// refresh in the app behind the retry/timeout wrapper. See supabaseFetch.js
// for the iOS-PWA connection drop it exists to survive — the short version is
// that postgrest-js retries reads and never retries writes, so a dropped
// connection was invisible on a page load and fatal on a Save.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createSupabaseFetch() },
})
