/* eslint-disable no-console */
// ===========================================================================
// PHASE 9 — shared tooling helpers
//
// Env loading, plan/manifest access, per-identity sign-in and a PostgREST
// wrapper. Used by probes.mjs, verify_seed.mjs and the e2e suite so there is
// one definition of "sign in as this employee" rather than a copy per script.
//
// Everything here goes through the ANON key + a real user session — the same
// path the app uses. Nothing here uses service_role. That is deliberate: the
// SQL Editor and service_role both bypass RLS, so neither can answer "what
// does this role actually see", which is the only question these tools exist
// to ask.
// ===========================================================================

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

export const env = { ...readEnvFile(join(ROOT, '.env')), ...readEnvFile(join(ROOT, '.env.phase9')) }
export const plan = JSON.parse(readFileSync(join(ROOT, 'simulation_plan.json'), 'utf8'))
export const manifest = JSON.parse(readFileSync(join(ROOT, 'seed_manifest.json'), 'utf8'))

/** ref -> real database id, for every row the seeder created. */
export const ids = { [plan.owner.ref]: plan.owner.id }
for (const rows of Object.values(manifest.rows_created || {})) for (const r of rows) ids[r.ref] = r.id

/** real id -> ref, for turning a database row back into a plan row. */
export const refById = new Map()
for (const [ref, id] of Object.entries(ids)) refById.set(id, ref)

export const leadByRef = new Map(plan.leads.map((l) => [l.ref, l]))
export const empByRef = new Map([
  ...plan.employees.map((e) => [e.ref, e]),
  [plan.owner.ref, { ref: plan.owner.ref, name: plan.owner.name, role: 'owner' }],
])

export function credentialsFor(ref) {
  if (ref === plan.owner.ref) return { email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD }
  const e = plan.employees.find((x) => x.ref === ref)
  if (!e) throw new Error(`unknown identity "${ref}"`)
  return { email: e.email.toLowerCase(), password: env.SEED_USER_PASSWORD }
}

const tokens = new Map()

export async function tokenFor(ref) {
  if (tokens.has(ref)) return tokens.get(ref)
  const { email, password } = credentialsFor(ref)
  const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`sign-in failed for ${ref}: ${res.status} ${await res.text()}`)
  const { access_token } = await res.json()
  tokens.set(ref, access_token)
  return access_token
}

/**
 * A PostgREST call as `ref`. Returns { ok, status, code, body, count }.
 * `code` is the Postgres SQLSTATE when one is present — that is what
 * distinguishes "the trigger refused this" (23514 check_violation) from
 * "RLS refused this" (42501) from "it silently matched nothing".
 */
export async function rest(ref, method, path, { body, prefer } = {}) {
  const token = await tokenFor(ref)
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: prefer ?? 'count=exact',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  const range = res.headers.get('content-range')
  const m = range ? /\/(\d+|\*)$/.exec(range) : null
  return {
    ok: res.ok,
    status: res.status,
    code: parsed && !Array.isArray(parsed) ? (parsed.code ?? null) : null,
    message: parsed && !Array.isArray(parsed) ? (parsed.message ?? null) : null,
    body: parsed,
    count: m && m[1] !== '*' ? Number(m[1]) : null,
  }
}

/** Read one row as `ref`, or null if RLS hides it. */
export async function readRow(ref, table, id, select = '*') {
  const r = await rest(ref, 'GET', `/${table}?select=${select}&id=eq.${id}`)
  if (!r.ok) return { hidden: true, error: r, row: null }
  return { hidden: false, error: null, row: Array.isArray(r.body) && r.body.length ? r.body[0] : null }
}

// --- tiny assertion reporter ----------------------------------------------
export function makeReporter(title) {
  const results = []
  let failed = 0
  return {
    check(name, pass, detail = '') {
      results.push({ name, pass, detail })
      if (!pass) failed++
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`)
      return pass
    },
    note(text) {
      console.log(`        ${text}`)
    },
    section(text) {
      console.log(`\n${text}`)
    },
    summary() {
      console.log(`\n${title}: ${results.length - failed}/${results.length} passed`)
      return { results, failed }
    },
  }
}
