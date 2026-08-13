#!/usr/bin/env node
/* eslint-disable no-console */
// Read-only probe against the live database as a chosen identity.
// Phase 9 tooling — NOT part of the app, never writes.
//
//   node phase9/probe.mjs <identity> "<postgrest path>"
//
// <identity> is a plan ref: emp_owner, sc_north, ex_rohit, ... — the point of
// naming an identity rather than always using the owner is that RLS answers
// differently per role, which is what Phases 5 and 7 are actually testing.
//
//   node phase9/probe.mjs emp_owner "/employees?select=id,name,role,coordinator_id&order=id"
//   node phase9/probe.mjs ex_karan  "/leads?select=id&limit=1"   (count only)

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...readEnvFile(join(ROOT, '.env')), ...readEnvFile(join(ROOT, '.env.phase9')) }
const plan = JSON.parse(readFileSync(join(ROOT, 'simulation_plan.json'), 'utf8'))

const [identity, path] = process.argv.slice(2)
if (!identity || !path) {
  console.error('usage: node phase9/probe.mjs <identity-ref> "<postgrest path>"')
  process.exit(2)
}

const creds =
  identity === plan.owner.ref
    ? { email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD }
    : (() => {
        const e = plan.employees.find((x) => x.ref === identity)
        if (!e) throw new Error(`unknown identity "${identity}"`)
        return { email: e.email.toLowerCase(), password: env.SEED_USER_PASSWORD }
      })()

const auth = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(creds),
})
if (!auth.ok) throw new Error(`sign-in failed for ${identity}: ${auth.status} ${await auth.text()}`)
const { access_token } = await auth.json()

const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1${path}`, {
  headers: {
    apikey: env.VITE_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${access_token}`,
    Prefer: 'count=exact',
  },
})
const text = await res.text()
console.log(`as ${identity} — HTTP ${res.status}  count-range: ${res.headers.get('content-range')}`)
try {
  console.log(JSON.stringify(JSON.parse(text), null, 1))
} catch {
  console.log(text)
}
