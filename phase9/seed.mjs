#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 9 — PHASE 2: THE SEEDER
//
// Reads simulation_plan.json and writes every row into the live Supabase
// database THROUGH THE REAL RLS PATH: it signs in as each of the nine
// identities (owner + 2 coordinators + 6 execs) with the anon key and issues
// ordinary PostgREST requests, exactly as the app does. service_role is used
// for ONE thing only — creating the eight auth.users logins, which has no
// anon-key equivalent.
//
// WHY THAT MATTERS (see PHASE9_LOG.md Phase 1, "Deliberate design decisions"):
// `authored_by` on every plan row is load-bearing, not metadata. Three
// triggers derive their output from WHO writes the row:
//   stamp_entered_by_role()  -> leads/activities.entered_by_role (the SC lock)
//   stamp_lead_creator()     -> leads.created_by_employee_id
//   stamp_activity_logger()  -> activities.logged_by_employee_id
// Seeding as the wrong identity produces different data with NO error.
//
// ---------------------------------------------------------------------------
// TWO SEEDER DECISIONS THAT ARE NOT IN THE PLAN FILE. Both are recorded in
// PHASE9_LOG.md; read them before changing anything here.
//
// 1. LEADS WITH A quote_value / order_value CORRECTION ARE WRITTEN IN TWO
//    STEPS. log_lead_changes() only writes a 'created' row on INSERT; the
//    'quote_value' and 'order_value' rows exist only on UPDATE. The plan's
//    post_seed_corrections list enumerates 150 created + 54 quote_value +
//    21 order_value = 225 rows, so those 75 value events must actually
//    happen as updates or the corrections would target rows that never
//    exist. So: a lead whose ref+field appears in the corrections list is
//    inserted with that column NULL and updated to its planned value
//    immediately afterwards. Result: exactly 225 change-log rows, one per
//    correction. (Three anomaly leads carry order_value while still open
//    and have NO order_value correction — those are inserted inline, so
//    they produce no spurious change row.)
//
//    The author of a value update is chosen so the SC edit lock lands where
//    the plan says it should:
//      - exec-authored lead      -> the exec (already entered_by_role=exec)
//      - SC-authored lead        -> that SC, so entered_by_role stays NULL
//        for the five SC-entered leads the plan requires to remain unlocked
//        (an exec update would flip the lock and silently break exception 7)
//
// 2. employees.created_at IS BACKDATED to the plan's window_start. The plan
//    does not specify it, but the default (today) would render "with VIPSAR
//    since 12 Aug 2026" on a Sales Exec Profile for someone carrying six
//    months of leads — a fake defect Phase 7 would then have to chase. No
//    ledger metric reads this column.
// ---------------------------------------------------------------------------
//
// USAGE
//   node phase9/seed.mjs --dry-run              validate + report, zero network
//   node phase9/seed.mjs --steps=auth,employees run only those steps
//   node phase9/seed.mjs                        run every step, resuming
//   node phase9/seed.mjs --emit-sql             (re)write the post-seed SQL
//
// Resume is manifest-driven: any ref already recorded in seed_manifest.json
// is skipped, so a failed run can be restarted without duplicating rows.
// ===========================================================================

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const PLAN_PATH = join(ROOT, 'simulation_plan.json')
const MANIFEST_PATH = join(ROOT, 'seed_manifest.json')
const SQL_CHANGELOG_PATH = join(ROOT, 'phase9', 'post_seed_lead_change_log.sql')
const SQL_DATESHIFT_PATH = join(ROOT, 'phase9', 'demo_date_shift.sql')

// --------------------------------------------------------------------------
// args
// --------------------------------------------------------------------------
const ARGS = process.argv.slice(2)
const DRY_RUN = ARGS.includes('--dry-run')
const EMIT_ONLY = ARGS.includes('--emit-sql')
const stepArg = ARGS.find((a) => a.startsWith('--steps='))
const ONLY_STEPS = stepArg ? new Set(stepArg.slice('--steps='.length).split(',')) : null

const ALL_STEPS = [
  'auth',
  'employees',
  'master',
  'parties',
  'sites',
  'site_contacts',
  'leads',
  'values',
  'locks',
  'activities',
  'follow_ups',
  'stage_history',
  'loss_reasons',
  'targets',
  'reassign',
  'verify',
]
if (ONLY_STEPS) {
  const unknown = [...ONLY_STEPS].filter((s) => !ALL_STEPS.includes(s))
  if (unknown.length) {
    console.error(`unknown step(s): ${unknown.join(', ')}\nvalid steps: ${ALL_STEPS.join(', ')}`)
    process.exit(2)
  }
}
const wants = (step) => !ONLY_STEPS || ONLY_STEPS.has(step)

// --------------------------------------------------------------------------
// env
// --------------------------------------------------------------------------
function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...readEnvFile(join(ROOT, '.env')), ...readEnvFile(join(ROOT, '.env.phase9')) }

const SUPABASE_URL = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const OWNER_EMAIL = env.OWNER_EMAIL
const OWNER_PASSWORD = env.OWNER_PASSWORD

// SEED_USER_PASSWORD is optional and ships blank — .env.phase9 says to
// generate one. It is persisted back into that file (git-ignored) rather than
// into seed_manifest.json, which is a plain repo file: Phase 9 evidence is
// likely to be committed and a shared login for eight accounts should not ride
// along with it. Phase 3 reads it from .env.phase9 like everything else.
function resolveSeedPassword() {
  if (env.SEED_USER_PASSWORD) return env.SEED_USER_PASSWORD
  if (DRY_RUN || EMIT_ONLY) return null
  const pw = `Vipsar9-${randomBytes(12).toString('base64url')}`
  appendFileSync(
    join(ROOT, '.env.phase9'),
    `\n# Generated by phase9/seed.mjs on ${new Date().toISOString().slice(0, 10)} —\n` +
      `# the shared login for all 8 seeded accounts. Phase 3 needs it. Not stored\n` +
      `# in seed_manifest.json on purpose (that file is not git-ignored).\nSEED_USER_PASSWORD=${pw}\n`
  )
  console.log('  generated SEED_USER_PASSWORD and appended it to .env.phase9')
  return pw
}
const SEED_PASSWORD = resolveSeedPassword()

// --------------------------------------------------------------------------
// plan + manifest
// --------------------------------------------------------------------------
const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'))
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

manifest.rows_created ||= {}
manifest.auth_users_created ||= []
manifest.operations_applied ||= []
manifest.seeder_decisions ||= [
  'Leads carrying a lead_change_log quote_value/order_value correction were inserted with that column NULL and updated immediately afterwards, so the AFTER-UPDATE trigger writes the change row the correction is meant to backdate. Insert-only would have left 75 corrections with no target row.',
  'The author of each value update is the lead author (exec for exec-authored leads, the coordinator for SC-authored ones) so the five SC-entered leads that must remain unlocked keep entered_by_role = NULL.',
  'employees.created_at was backdated to the plan window_start (2026-02-12); the plan does not specify it and the default (today) would misrender "with VIPSAR since" on every Sales Exec Profile.',
]

const saveManifest = () => {
  manifest.phase = 2
  manifest.last_written_at = new Date().toISOString()
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
}

// ref -> real id, rebuilt from the manifest on every start (that is what makes
// the run resumable).
const ids = {}
for (const rows of Object.values(manifest.rows_created)) {
  for (const r of rows) ids[r.ref] = r.id
}
ids[plan.owner.ref] = plan.owner.id

const authUuidByRef = {}
for (const u of manifest.auth_users_created) authUuidByRef[u.employee_ref] = u.uuid

const appliedOps = new Set(manifest.operations_applied)

function recordRows(table, pairs) {
  manifest.rows_created[table] ||= []
  for (const { ref, id } of pairs) {
    manifest.rows_created[table].push({ ref, id })
    ids[ref] = id
  }
  saveManifest()
}

function recordOp(ref) {
  appliedOps.add(ref)
  manifest.operations_applied.push(ref)
}

// id resolution — a missing ref is a hard stop, never a silent null
function idOf(ref, what) {
  if (ref === null || ref === undefined) return null
  const id = ids[ref]
  if (id === undefined) throw new Error(`unresolved ref "${ref}" (needed for ${what})`)
  return id
}

// --------------------------------------------------------------------------
// sessions — one per identity, with refresh
// --------------------------------------------------------------------------
const sessions = new Map()

async function authFetch(path, init = {}, key = ANON_KEY) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: key, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { ok: res.ok, status: res.status, body }
}

async function signIn(ref, email, password) {
  const r = await authFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error(`sign-in failed for ${ref} <${email}>: ${r.status} ${JSON.stringify(r.body)}`)
  const s = {
    ref,
    email,
    password,
    access_token: r.body.access_token,
    refresh_token: r.body.refresh_token,
    expires_at: Date.now() + (r.body.expires_in ?? 3600) * 1000,
  }
  sessions.set(ref, s)
  return s
}

async function sessionFor(ref) {
  let s = sessions.get(ref)
  if (!s) throw new Error(`no session established for "${ref}"`)
  // refresh a few minutes early rather than discovering expiry mid-batch
  if (Date.now() > s.expires_at - 120_000) {
    const r = await authFetch('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    })
    if (r.ok) {
      s.access_token = r.body.access_token
      s.refresh_token = r.body.refresh_token
      s.expires_at = Date.now() + (r.body.expires_in ?? 3600) * 1000
    } else {
      s = await signIn(ref, s.email, s.password)
    }
  }
  return s
}

// --------------------------------------------------------------------------
// PostgREST
// --------------------------------------------------------------------------
async function rest(ref, method, path, { body, prefer, headers } = {}) {
  const s = await sessionFor(ref)
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${s.access_token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...(headers || {}),
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
  return { ok: res.ok, status: res.status, body: parsed, contentRange: res.headers.get('content-range') }
}

/**
 * Insert rows as `ref`, chunked, returning representation so we can capture
 * the generated ids. Rows come back in insertion order (Postgres INSERT ...
 * RETURNING preserves it) — the count is asserted per chunk so a silent
 * RLS-swallowed row can never shift the ref->id mapping.
 */
async function insertRows(authorRef, table, rows, toPayload, { chunk = 200 } = {}) {
  const out = []
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const payload = slice.map(toPayload)
    const r = await rest(authorRef, 'POST', `/${table}`, {
      body: payload,
      prefer: 'return=representation',
    })
    if (!r.ok) {
      throw new Error(
        `INSERT ${table} as ${authorRef} failed (${r.status}): ${JSON.stringify(r.body)}\n` +
          `first payload row: ${JSON.stringify(payload[0])}`
      )
    }
    if (!Array.isArray(r.body) || r.body.length !== slice.length) {
      throw new Error(
        `INSERT ${table} as ${authorRef} returned ${Array.isArray(r.body) ? r.body.length : 'non-array'} ` +
          `rows for ${slice.length} sent — the ref->id mapping cannot be trusted. ` +
          `Most likely the SELECT policy hid a row that was written. Stopping.`
      )
    }
    for (let j = 0; j < slice.length; j++) out.push({ ref: slice[j].ref, id: r.body[j].id })
    recordRows(table, out.splice(0, out.length))
    process.stdout.write(`    ${table} as ${authorRef}: ${Math.min(i + chunk, rows.length)}/${rows.length}\r`)
  }
}

async function patchRow(authorRef, table, id, patch) {
  const r = await rest(authorRef, 'PATCH', `/${table}?id=eq.${id}`, {
    body: patch,
    prefer: 'return=representation',
  })
  if (!r.ok) {
    throw new Error(`UPDATE ${table}#${id} as ${authorRef} failed (${r.status}): ${JSON.stringify(r.body)}`)
  }
  // An RLS-rejected UPDATE with no matching row returns 200 with [] and no
  // error (Phase 0 finding). Treat that as failure, never as success.
  if (!Array.isArray(r.body) || r.body.length !== 1) {
    throw new Error(
      `UPDATE ${table}#${id} as ${authorRef} matched ${Array.isArray(r.body) ? r.body.length : '?'} rows — ` +
        `RLS silently rejected it (no error is returned for a 0-row update). Stopping.`
    )
  }
  return r.body[0]
}

// --------------------------------------------------------------------------
// grouping helper — rows must be inserted by their own author
// --------------------------------------------------------------------------
function groupByAuthor(rows) {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.authored_by)) m.set(r.authored_by, [])
    m.get(r.authored_by).push(r)
  }
  return m
}

const notDone = (table, rows) => {
  const done = new Set((manifest.rows_created[table] || []).map((r) => r.ref))
  return rows.filter((r) => !done.has(r.ref))
}

// --------------------------------------------------------------------------
// value-update planning (seeder decision 1, see header)
// --------------------------------------------------------------------------
const correctionKeys = new Set(
  plan.post_seed_corrections.lead_change_log
    .filter((c) => c.field !== 'created')
    .map((c) => `${c.lead_ref}:${c.field}`)
)
const withholdsQuote = (lead) => correctionKeys.has(`${lead.ref}:quote_value`)
const withholdsOrder = (lead) => correctionKeys.has(`${lead.ref}:order_value`)

// --------------------------------------------------------------------------
// steps
// --------------------------------------------------------------------------
const log = (...a) => console.log(...a)

async function stepAuth() {
  log('\n[1/16] auth.users — 8 seeded logins (service_role Admin API)')
  const existing = new Map()
  {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!res.ok) throw new Error(`admin list users failed: ${res.status} ${await res.text()}`)
    const body = await res.json()
    for (const u of body.users || []) existing.set((u.email || '').toLowerCase(), u.id)
  }

  for (const emp of plan.employees) {
    if (authUuidByRef[emp.ref]) {
      log(`    ${emp.ref.padEnd(11)} already recorded`)
      continue
    }
    const email = emp.email.toLowerCase()
    let uuid = existing.get(email)
    if (uuid) {
      log(`    ${emp.ref.padEnd(11)} auth user already existed`)
    } else {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password: SEED_PASSWORD, email_confirm: true }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(`admin create user ${email} failed: ${res.status} ${JSON.stringify(body)}`)
      uuid = body.id
      log(`    ${emp.ref.padEnd(11)} created`)
    }
    authUuidByRef[emp.ref] = uuid
    manifest.auth_users_created.push({ employee_ref: emp.ref, email, uuid, name: emp.name })
    saveManifest()
  }
}

async function establishSessions() {
  log('\n  signing in as all 9 identities')
  await signIn(plan.owner.ref, OWNER_EMAIL, OWNER_PASSWORD)
  for (const emp of plan.employees) await signIn(emp.ref, emp.email.toLowerCase(), SEED_PASSWORD)
  log(`    ${sessions.size} sessions held`)
}

async function stepEmployees() {
  log('\n[2/16] employees — coordinators first, then execs with coordinator_id')
  const todo = notDone('employees', plan.employees)
  if (!todo.length) return log('    already seeded')

  const createdAt = `${plan.meta.window_start}T00:00:00` // seeder decision 2

  const coordinators = todo.filter((e) => e.role === 'sales_coordinator')
  const execs = todo.filter((e) => e.role !== 'sales_coordinator')

  // validate_employee_role_assignment() rejects a coordinator_id pointing at a
  // non-coordinator, so this ordering is a hard requirement, not tidiness.
  for (const group of [coordinators, execs]) {
    if (!group.length) continue
    await insertRows(plan.owner.ref, 'employees', group, (e) => ({
      auth_user_id: authUuidByRef[e.ref],
      name: e.name,
      mobile: e.mobile,
      office_location: e.office_location,
      role: e.role,
      coordinator_id: e.coordinator_ref ? idOf(e.coordinator_ref, `${e.ref}.coordinator_id`) : null,
      is_active: e.is_active,
      created_at: createdAt,
    }))
  }
  log(`\n    ${todo.length} employees inserted`)
}

async function stepMaster() {
  log('\n[3/16] areas + products (as owner)')
  const areas = notDone('areas', plan.areas)
  if (areas.length) {
    await insertRows(plan.owner.ref, 'areas', areas, (a) => ({ area_name: a.area_name, city: a.city }))
  }
  const products = notDone('products', plan.products)
  if (products.length) {
    await insertRows(plan.owner.ref, 'products', products, (p) => ({ name: p.name, category: p.category }))
  }
  log(`\n    areas ${areas.length}, products ${products.length}`)
}

async function stepParties() {
  log('\n[4/16] parties (as each author — created_by must be the exec, not the seeder)')
  const todo = notDone('parties', plan.parties)
  if (!todo.length) return log('    already seeded')
  for (const [author, rows] of groupByAuthor(todo)) {
    await insertRows(author, 'parties', rows, (p) => ({
      party_type: p.party_type,
      name: p.name,
      mobile: p.mobile,
      address: p.address,
      city: p.city,
      area_id: idOf(p.area_ref, `${p.ref}.area_id`),
      firm_name: p.firm_name,
      relationship_status: p.relationship_status,
      verification_status: p.verification_status,
      notes: p.notes,
      created_by: idOf(p.created_by_ref, `${p.ref}.created_by`),
      created_at: p.created_at,
    }))
  }
  log(`\n    ${todo.length} parties inserted`)
}

async function stepSites() {
  log('\n[5/16] sites (as each author — discovered_by must be the exec)')
  const todo = notDone('sites', plan.sites)
  if (!todo.length) return log('    already seeded')
  for (const [author, rows] of groupByAuthor(todo)) {
    await insertRows(author, 'sites', rows, (s) => ({
      area_id: idOf(s.area_ref, `${s.ref}.area_id`),
      house_no: s.house_no,
      locality: s.locality,
      pincode: s.pincode,
      nickname: s.nickname,
      plot_area_sqyds: s.plot_area_sqyds,
      site_stage: s.site_stage,
      primary_contact_party_id: idOf(s.primary_contact_party_ref, `${s.ref}.primary_contact_party_id`),
      discovered_via: s.discovered_via,
      discovered_by: idOf(s.discovered_by_ref, `${s.ref}.discovered_by`),
      created_at: s.created_at,
    }))
  }
  log(`\n    ${todo.length} sites inserted`)
}

async function stepSiteContacts() {
  log('\n[6/16] site_contacts')
  const todo = notDone('site_contacts', plan.site_contacts)
  if (!todo.length) return log('    already seeded')
  for (const [author, rows] of groupByAuthor(todo)) {
    await insertRows(author, 'site_contacts', rows, (c) => ({
      site_id: idOf(c.site_ref, `${c.ref}.site_id`),
      party_id: idOf(c.party_ref, `${c.ref}.party_id`),
      role: c.role,
      discovered_at: c.discovered_at,
    }))
  }
  log(`\n    ${todo.length} site_contacts inserted`)
}

async function stepLeads() {
  log('\n[7/16] leads — inserted at FINAL current_stage, as each author')
  log('       (quote_value / order_value withheld where a change-log correction exists)')
  const todo = notDone('leads', plan.leads)
  if (!todo.length) return log('    already seeded')
  for (const [author, rows] of groupByAuthor(todo)) {
    await insertRows(author, 'leads', rows, (l) => ({
      site_id: idOf(l.site_ref, `${l.ref}.site_id`),
      party_id: idOf(l.party_ref, `${l.ref}.party_id`),
      product_id: idOf(l.product_ref, `${l.ref}.product_id`),
      // The two cross-team leads are inserted as their ORIGINAL owner: an exec
      // can only insert a lead they own. Step 15 reassigns them as the owner.
      owner_employee_id: idOf(
        l.original_owner_employee_ref || l.owner_employee_ref,
        `${l.ref}.owner_employee_id`
      ),
      source_type: l.source_type,
      referred_by_party_id: idOf(l.referred_by_party_ref, `${l.ref}.referred_by_party_id`),
      other_party_id: idOf(l.other_party_ref, `${l.ref}.other_party_id`),
      external_reference_id: l.external_reference_id,
      lead_generated_at: l.lead_generated_at,
      current_stage: l.current_stage,
      rfq_raised: l.rfq_raised,
      rfq_raised_at: l.rfq_raised_at,
      quote_sent: l.quote_sent,
      quote_sent_at: l.quote_sent_at,
      quote_value: withholdsQuote(l) ? null : l.quote_value,
      order_value: withholdsOrder(l) ? null : l.order_value,
      closure_probability: l.closure_probability,
      estimated_close_date: l.estimated_close_date,
      next_followup_date: l.next_followup_date,
      created_at: l.created_at,
      // entered_by_role and created_by_employee_id are deliberately NOT sent —
      // the triggers derive them from the authoring session. That is the point.
    }))
  }
  log(`\n    ${todo.length} leads inserted`)
}

async function stepValues() {
  log('\n[8/16] quote_value / order_value updates — these generate the real')
  log('       lead_change_log rows the post-seed corrections backdate')
  let n = 0
  for (const l of plan.leads) {
    const patch = {}
    if (withholdsQuote(l)) patch.quote_value = l.quote_value
    if (withholdsOrder(l)) patch.order_value = l.order_value
    if (!Object.keys(patch).length) continue
    const opRef = `value:${l.ref}`
    if (appliedOps.has(opRef)) continue
    // Author = the lead's own author. For SC-authored leads that must stay
    // unlocked, an exec-authored update here would flip entered_by_role and
    // silently destroy exception 7.
    await patchRow(l.authored_by, 'leads', idOf(l.ref, 'value update'), patch)
    recordOp(opRef)
    n++
    if (n % 20 === 0) {
      saveManifest()
      process.stdout.write(`    value updates: ${n}\r`)
    }
  }
  saveManifest()
  log(`\n    ${n} value updates applied`)
}

async function stepLocks() {
  log('\n[9/16] exec_touches + sc_edits — the SC edit lock, from both sides')
  for (const t of plan.exec_touches) {
    if (appliedOps.has(t.ref)) continue
    const row = await patchRow(t.authored_by, 'leads', idOf(t.lead_ref, t.ref), t.patch)
    if (row.entered_by_role !== t.expected_after.entered_by_role) {
      throw new Error(
        `${t.ref}: expected entered_by_role=${t.expected_after.entered_by_role}, got ${row.entered_by_role}`
      )
    }
    recordOp(t.ref)
    log(`    ${t.ref} ${t.lead_ref} -> entered_by_role=${row.entered_by_role}`)
  }
  for (const t of plan.sc_edits) {
    if (appliedOps.has(t.ref)) continue
    const row = await patchRow(t.authored_by, 'leads', idOf(t.lead_ref, t.ref), t.patch)
    if ((row.entered_by_role ?? null) !== (t.expected_after.entered_by_role ?? null)) {
      throw new Error(
        `${t.ref}: expected entered_by_role=${t.expected_after.entered_by_role}, got ${row.entered_by_role}`
      )
    }
    recordOp(t.ref)
    log(`    ${t.ref} ${t.lead_ref} -> entered_by_role=${row.entered_by_role ?? 'null'}`)
  }
  saveManifest()
}

async function stepActivities() {
  log('\n[10/16] activities (as each author — logged_by_employee_id follows)')
  const todo = notDone('activities', plan.activities)
  if (!todo.length) return log('    already seeded')
  for (const [author, rows] of groupByAuthor(todo)) {
    await insertRows(author, 'activities', rows, (a) => ({
      employee_id: idOf(a.employee_ref, `${a.ref}.employee_id`),
      party_id: idOf(a.party_ref, `${a.ref}.party_id`),
      lead_id: idOf(a.lead_ref, `${a.ref}.lead_id`),
      activity_type: a.activity_type,
      accompanied_by: idOf(a.accompanied_by_ref, `${a.ref}.accompanied_by`),
      notes: a.notes,
      leads_generated: a.leads_generated,
      created_at: a.created_at,
    }))
  }
  log(`\n    ${todo.length} activities inserted`)
}

async function stepFollowUps() {
  log('\n[11/16] follow_ups (as created_by)')
  const todo = notDone('follow_ups', plan.follow_ups)
  if (!todo.length) return log('    already seeded')
  for (const [author, rows] of groupByAuthor(todo)) {
    await insertRows(author, 'follow_ups', rows, (f) => ({
      assigned_to: idOf(f.assigned_to_ref, `${f.ref}.assigned_to`),
      created_by: idOf(f.created_by_ref, `${f.ref}.created_by`),
      party_id: idOf(f.party_ref, `${f.ref}.party_id`),
      lead_id: idOf(f.lead_ref, `${f.ref}.lead_id`),
      activity_type: f.activity_type,
      title: f.title,
      notes: f.notes,
      due_date: f.due_date,
      due_time: f.due_time,
      is_done: f.is_done,
      done_at: f.done_at,
      notified_at: f.notified_at,
      created_at: f.created_at,
    }))
  }
  log(`\n    ${todo.length} follow_ups inserted`)
}

async function stepStageHistory() {
  log('\n[12/16] stage_history (owner or the lead owner’s coordinator ONLY —')
  log('        an exec is rejected by both the trigger and the INSERT policy)')
  const todo = notDone('stage_history', plan.stage_history)
  if (!todo.length) return log('    already seeded')
  for (const [author, rows] of groupByAuthor(todo)) {
    await insertRows(author, 'stage_history', rows, (s) => ({
      lead_id: idOf(s.lead_ref, `${s.ref}.lead_id`),
      stage: s.stage,
      changed_by: idOf(s.changed_by_ref, `${s.ref}.changed_by`),
      changed_at: s.changed_at,
    }))
  }
  log(`\n    ${todo.length} stage_history rows inserted`)
}

// loss_reasons is the ONE table that cannot use `Prefer: return=representation`.
// Its INSERT policy is `current_employee_role() IS NOT NULL` (any active
// employee) but its SELECT policy is owner-only — and Postgres applies the
// SELECT policy to an INSERT's RETURNING clause. So asking for the row back as
// a coordinator fails with 42501 even though the insert itself is permitted.
//
// This is a SEEDER artifact, not an app bug: LeadStageSection.jsx:167 inserts
// with no `.select()`, so the app never emits a RETURNING clause here. Phase 5
// should still note the shape — any future code that adds `.select()` to a
// loss_reasons insert breaks for every non-owner, and fails loudly rather than
// silently, unlike the 0-row UPDATE case.
//
// Ids are read back afterwards as the owner, keyed on lead_id (the plan has
// exactly one loss reason per lead, asserted below).
async function stepLossReasons() {
  log('\n[13/16] loss_reasons (insert as author, read ids back as owner — see note)')
  const todo = notDone('loss_reasons', plan.loss_reasons)
  if (!todo.length) return log('    already seeded')

  const perLead = new Map()
  for (const l of todo) {
    if (perLead.has(l.lead_ref)) {
      throw new Error(`two loss_reasons for ${l.lead_ref} — lead_id is no longer a safe key for reading ids back`)
    }
    perLead.set(l.lead_ref, l.ref)
  }

  for (const [author, rows] of groupByAuthor(todo)) {
    const r = await rest(author, 'POST', '/loss_reasons', {
      body: rows.map((l) => ({
        lead_id: idOf(l.lead_ref, `${l.ref}.lead_id`),
        reason: l.reason,
        competitor_name: l.competitor_name,
        lost_at: l.lost_at,
      })),
      prefer: 'return=minimal',
    })
    if (!r.ok) throw new Error(`INSERT loss_reasons as ${author} failed (${r.status}): ${JSON.stringify(r.body)}`)
    log(`    ${rows.length} inserted as ${author}`)
  }

  const leadIds = todo.map((l) => idOf(l.lead_ref, l.ref))
  const back = await rest(plan.owner.ref, 'GET', `/loss_reasons?select=id,lead_id&lead_id=in.(${leadIds.join(',')})`)
  if (!back.ok) throw new Error(`reading loss_reasons ids back failed: ${JSON.stringify(back.body)}`)
  const idByLead = new Map(back.body.map((row) => [row.lead_id, row.id]))
  const pairs = todo.map((l) => {
    const id = idByLead.get(idOf(l.lead_ref, l.ref))
    if (id === undefined) throw new Error(`loss_reason for ${l.lead_ref} was not found after insert`)
    return { ref: l.ref, id }
  })
  recordRows('loss_reasons', pairs)
  log(`    ${todo.length} loss_reasons inserted, ids recovered as owner`)
}

async function stepTargets() {
  log('\n[14/16] targets (as owner)')
  const todo = notDone('targets', plan.targets)
  if (!todo.length) return log('    already seeded')
  await insertRows(plan.owner.ref, 'targets', todo, (t) => ({
    employee_id: idOf(t.employee_ref, `${t.ref}.employee_id`),
    period_type: t.period_type,
    period_value: t.period_value,
    metric_name: t.metric_name,
    target_value: t.target_value,
  }))
  log(`\n    ${todo.length} targets inserted`)
}

async function stepReassign() {
  log('\n[15/16] cross-team lead reassignment + lead_owner_history (as owner)')
  const todo = notDone('lead_owner_history', plan.lead_owner_history)
  for (const h of plan.lead_owner_history) {
    const opRef = `reassign:${h.ref}`
    if (appliedOps.has(opRef)) continue
    // The leads UPDATE first: an exec can only insert a lead they own, so the
    // row still carries the ORIGINAL owner until this runs.
    const row = await patchRow(plan.owner.ref, 'leads', idOf(h.lead_ref, h.ref), {
      owner_employee_id: idOf(h.new_owner_ref, `${h.ref}.new_owner_id`),
    })
    if (row.owner_employee_id !== idOf(h.new_owner_ref, h.ref)) {
      throw new Error(`${h.ref}: reassignment did not take effect`)
    }
    recordOp(opRef)
    log(`    ${h.lead_ref}: ${h.old_owner_ref} -> ${h.new_owner_ref}`)
  }
  if (todo.length) {
    await insertRows(plan.owner.ref, 'lead_owner_history', todo, (h) => ({
      lead_id: idOf(h.lead_ref, `${h.ref}.lead_id`),
      old_owner_id: idOf(h.old_owner_ref, `${h.ref}.old_owner_id`),
      new_owner_id: idOf(h.new_owner_ref, `${h.ref}.new_owner_id`),
      changed_by: idOf(h.changed_by_ref, `${h.ref}.changed_by`),
      changed_at: h.changed_at,
    }))
  }
  saveManifest()
  log(`\n    ${plan.lead_owner_history.length} reassignments complete`)
}

// --------------------------------------------------------------------------
// verification
// --------------------------------------------------------------------------
async function countOf(table) {
  const r = await rest(plan.owner.ref, 'GET', `/${table}?select=id&limit=1`, {
    prefer: 'count=exact',
  })
  if (!r.ok) return `ERROR ${r.status} ${JSON.stringify(r.body)}`
  const m = /\/(\d+)$/.exec(r.contentRange || '')
  return m ? Number(m[1]) : '?'
}

async function stepVerify() {
  log('\n[16/16] verification (as owner)')

  const expected = {
    employees: plan.employees.length + 1,
    areas: plan.areas.length,
    products: plan.products.length,
    parties: plan.parties.length,
    sites: plan.sites.length,
    site_contacts: plan.site_contacts.length,
    leads: plan.leads.length,
    activities: plan.activities.length,
    follow_ups: plan.follow_ups.length,
    stage_history: plan.stage_history.length,
    loss_reasons: plan.loss_reasons.length,
    targets: plan.targets.length,
    lead_owner_history: plan.lead_owner_history.length,
    lead_change_log: plan.post_seed_corrections.lead_change_log.length,
    plans: 0,
    push_subscriptions: 0,
  }

  const results = []
  let failures = 0
  for (const [table, exp] of Object.entries(expected)) {
    const actual = await countOf(table)
    const ok = actual === exp
    if (!ok) failures++
    results.push({ table, expected: exp, actual, ok })
    log(`    ${ok ? 'OK  ' : 'FAIL'} ${table.padEnd(20)} expected ${String(exp).padStart(5)}  actual ${String(actual).padStart(5)}`)
  }

  // Trigger outcomes — the whole reason seeding runs through real sessions.
  log('\n    trigger outcomes:')
  const checks = []

  // leads.entered_by_role and created_by_employee_id
  {
    const r = await rest(plan.owner.ref, 'GET', '/leads?select=id,entered_by_role,created_by_employee_id&limit=1000')
    const byId = new Map((r.body || []).map((x) => [x.id, x]))
    let ebrBad = 0
    let cbeBad = 0
    for (const l of plan.leads) {
      const row = byId.get(ids[l.ref])
      if (!row) continue
      if ((row.entered_by_role ?? null) !== (l.expected_entered_by_role ?? null)) ebrBad++
      const expCreator = ids[l.expected_created_by_employee_ref]
      if (expCreator && row.created_by_employee_id !== expCreator) cbeBad++
    }
    checks.push({ name: 'leads.entered_by_role matches plan', bad: ebrBad })
    checks.push({ name: 'leads.created_by_employee_id matches plan', bad: cbeBad })
  }

  // activities.logged_by_employee_id + entered_by_role
  {
    const rows = []
    for (let off = 0; off < plan.activities.length; off += 1000) {
      const r = await rest(
        plan.owner.ref,
        'GET',
        `/activities?select=id,logged_by_employee_id,entered_by_role&order=id.asc&limit=1000&offset=${off}`
      )
      rows.push(...(r.body || []))
    }
    const byId = new Map(rows.map((x) => [x.id, x]))
    let lbeBad = 0
    let ebrBad = 0
    for (const a of plan.activities) {
      const row = byId.get(ids[a.ref])
      if (!row) continue
      const expLogger = ids[a.expected_logged_by_employee_ref]
      if (expLogger && row.logged_by_employee_id !== expLogger) lbeBad++
      if ((row.entered_by_role ?? null) !== (a.expected_entered_by_role ?? null)) ebrBad++
    }
    checks.push({ name: 'activities.logged_by_employee_id matches plan', bad: lbeBad })
    checks.push({ name: 'activities.entered_by_role matches plan', bad: ebrBad })
  }

  for (const c of checks) {
    if (c.bad) failures++
    log(`    ${c.bad ? 'FAIL' : 'OK  '} ${c.name}${c.bad ? ` — ${c.bad} mismatches` : ''}`)
  }

  manifest.verification = { at: new Date().toISOString(), counts: results, trigger_checks: checks }
  saveManifest()

  log(failures ? `\n    ${failures} verification failure(s)` : '\n    all verification checks passed')
  return failures
}

// --------------------------------------------------------------------------
// post-seed SQL emitters
// --------------------------------------------------------------------------
function emitSql() {
  const corrections = plan.post_seed_corrections.lead_change_log
  const resolvable = corrections.filter((c) => ids[c.lead_ref] !== undefined)

  const values = resolvable
    .map((c) => `  (${ids[c.lead_ref]}, '${c.field}', TIMESTAMPTZ '${c.intended_changed_at}+00')`)
    .join(',\n')

  const sql = `-- ===========================================================================
-- PHASE 9 / PHASE 2 — POST-SEED CORRECTION: lead_change_log.changed_at
--
-- Run this in the Supabase SQL Editor AFTER the seeder completes.
-- NOT a migration. Safe to re-run (it sets absolute values, not deltas).
--
-- WHY THIS EXISTS: log_lead_changes() is an AFTER trigger and lead_change_log
-- .changed_at is DEFAULT now() — the application has no way to supply it. So
-- every seeded lead INSERT and every seeded quote/order UPDATE lands stamped
-- with the moment of seeding, no matter how far back the lead itself is
-- backdated. Without this correction every historical Day Review shows an
-- empty "changes" block and today shows ${resolvable.length} of them at once.
--
-- The timestamps below are the plan's naive UTC wall-clock values with an
-- explicit +00 offset attached, because changed_at is TIMESTAMPTZ (the one
-- column in this schema that is) while every other *_at in the plan is a
-- naive TIMESTAMP. Rendering in IST therefore matches the rest of the data.
--
-- Rows: ${resolvable.length} of ${corrections.length} corrections resolved to a real lead id.
-- Generated by phase9/seed.mjs on ${new Date().toISOString().slice(0, 10)}.
-- ===========================================================================

BEGIN;

CREATE TEMP TABLE _lcl_fix (lead_id integer, field text, intended timestamptz) ON COMMIT DROP;

INSERT INTO _lcl_fix (lead_id, field, intended) VALUES
${values};

-- One change-log row per (lead, field) is expected: 'created' fires once at
-- INSERT, and each value column was written exactly once by the seeder. If a
-- lead somehow has two rows for the same field, both get the same corrected
-- timestamp — flagged by the verification query below rather than guessed at.
UPDATE lead_change_log l
   SET changed_at = f.intended
  FROM _lcl_fix f
 WHERE l.lead_id = f.lead_id
   AND l.field   = f.field;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY — expect: total ${corrections.length}, uncorrected 0, duplicates 0
-- ---------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM lead_change_log)                                          AS total_rows,
  (SELECT count(*) FROM lead_change_log WHERE changed_at::date = CURRENT_DATE)    AS still_stamped_today,
  (SELECT count(*) FROM (
      SELECT lead_id, field FROM lead_change_log GROUP BY 1,2 HAVING count(*) > 1
   ) d)                                                                           AS duplicate_lead_field_pairs,
  (SELECT min(changed_at) FROM lead_change_log)                                   AS earliest,
  (SELECT max(changed_at) FROM lead_change_log)                                   AS latest;

-- Per-field breakdown — expect created ${corrections.filter((c) => c.field === 'created').length}, quote_value ${corrections.filter((c) => c.field === 'quote_value').length}, order_value ${corrections.filter((c) => c.field === 'order_value').length}
SELECT field, count(*) FROM lead_change_log GROUP BY field ORDER BY field;
`
  writeFileSync(SQL_CHANGELOG_PATH, sql)

  const shift = `-- ===========================================================================
-- PHASE 9 — DEMO DATE SHIFT (optional, run only if the demo slips)
--
-- NOT a migration and NOT part of the seed. The plan pins a handful of rows to
-- REFERENCE_DATE ${plan.meta.reference_date}: follow-ups categorised due_today /
-- due_tomorrow, and the nearest leads.next_followup_date values. Everything
-- else was seeded with margin around its threshold and does not need touching.
--
-- Runs in the Supabase SQL Editor as-is: the shift is computed from the
-- database's own CURRENT_DATE against the reference date, so there is nothing
-- to edit and no psql meta-command (\\set) — the SQL Editor does not support
-- those. Running it on ${plan.meta.reference_date} itself is a no-op.
--
-- ⚠️ RUN THIS ONCE. It is NOT idempotent — it applies a delta, so running it
-- twice on the same day shifts everything twice. There is no marker column to
-- detect a previous run from. Preview first with the SELECT immediately below;
-- if the "would move to" dates already look right, do not run the UPDATEs.
--
-- Shifting only the near-future rows keeps the historical record intact —
-- it never touches created_at, changed_at, or any completed follow-up.
-- ===========================================================================

-- PREVIEW (safe, read-only) — run this on its own first.
SELECT
  CURRENT_DATE - DATE '${plan.meta.reference_date}'                   AS shift_days,
  count(*) FILTER (WHERE is_done = false
                     AND due_date >= DATE '${plan.meta.reference_date}') AS open_follow_ups_affected,
  min(due_date) FILTER (WHERE is_done = false
                     AND due_date >= DATE '${plan.meta.reference_date}') AS earliest_now,
  min(due_date) FILTER (WHERE is_done = false
                     AND due_date >= DATE '${plan.meta.reference_date}')
    + (CURRENT_DATE - DATE '${plan.meta.reference_date}')             AS earliest_would_move_to
FROM follow_ups;

BEGIN;

-- Open follow-ups only. A done follow-up is history and must not move.
UPDATE follow_ups
   SET due_date = due_date + (CURRENT_DATE - DATE '${plan.meta.reference_date}')
 WHERE is_done = false
   AND due_date >= DATE '${plan.meta.reference_date}';

-- Future follow-up dates on leads. Anything already in the past is a real
-- overdue signal the dashboards are meant to show — leave it alone.
UPDATE leads
   SET next_followup_date = next_followup_date + (CURRENT_DATE - DATE '${plan.meta.reference_date}')
 WHERE next_followup_date >= DATE '${plan.meta.reference_date}';

COMMIT;

SELECT 'follow_ups open, due today' AS what, count(*) FROM follow_ups WHERE is_done = false AND due_date = CURRENT_DATE
UNION ALL
SELECT 'follow_ups open, overdue',            count(*) FROM follow_ups WHERE is_done = false AND due_date < CURRENT_DATE
UNION ALL
SELECT 'leads with follow-up due today',      count(*) FROM leads WHERE next_followup_date = CURRENT_DATE
UNION ALL
SELECT 'leads with follow-up overdue',        count(*) FROM leads WHERE next_followup_date < CURRENT_DATE;
`
  writeFileSync(SQL_DATESHIFT_PATH, shift)

  log(`\n  wrote ${SQL_CHANGELOG_PATH.replace(ROOT + '\\', '').replace(ROOT + '/', '')} (${resolvable.length} corrections)`)
  log(`  wrote ${SQL_DATESHIFT_PATH.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`)
}

// --------------------------------------------------------------------------
// dry run
// --------------------------------------------------------------------------
function dryRun() {
  log('DRY RUN — no network calls, no writes.\n')

  const missing = []
  for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) if (!env[k]) missing.push(k)
  for (const k of ['SUPABASE_SERVICE_ROLE_KEY', 'OWNER_EMAIL', 'OWNER_PASSWORD']) if (!env[k]) missing.push(k)
  log(missing.length ? `  MISSING ENV: ${missing.join(', ')}` : '  env: all required variables present')
  if (!env.SEED_USER_PASSWORD)
    log('  SEED_USER_PASSWORD blank — one will be generated and appended to .env.phase9 (optional by design)')

  // pretend-resolve every ref so an unresolved link is caught before any write
  const fake = { ...ids }
  const claim = (rows) => rows.forEach((r) => (fake[r.ref] = fake[r.ref] ?? -1))
  const need = []
  const check = (ref, what) => {
    if (ref != null && fake[ref] === undefined) need.push(`${what} -> ${ref}`)
  }

  claim(plan.employees)
  claim(plan.areas)
  claim(plan.products)
  claim(plan.parties)
  claim(plan.sites)
  claim(plan.site_contacts)
  claim(plan.leads)
  claim(plan.activities)
  claim(plan.follow_ups)
  claim(plan.stage_history)
  claim(plan.loss_reasons)
  claim(plan.targets)
  claim(plan.lead_owner_history)

  plan.employees.forEach((e) => check(e.coordinator_ref, `${e.ref}.coordinator_id`))
  plan.parties.forEach((p) => {
    check(p.area_ref, `${p.ref}.area_id`)
    check(p.created_by_ref, `${p.ref}.created_by`)
  })
  plan.sites.forEach((s) => {
    check(s.area_ref, `${s.ref}.area_id`)
    check(s.primary_contact_party_ref, `${s.ref}.primary_contact_party_id`)
    check(s.discovered_by_ref, `${s.ref}.discovered_by`)
  })
  plan.site_contacts.forEach((c) => {
    check(c.site_ref, `${c.ref}.site_id`)
    check(c.party_ref, `${c.ref}.party_id`)
  })
  plan.leads.forEach((l) => {
    check(l.site_ref, `${l.ref}.site_id`)
    check(l.party_ref, `${l.ref}.party_id`)
    check(l.product_ref, `${l.ref}.product_id`)
    check(l.owner_employee_ref, `${l.ref}.owner_employee_id`)
    check(l.referred_by_party_ref, `${l.ref}.referred_by_party_id`)
    check(l.other_party_ref, `${l.ref}.other_party_id`)
  })
  plan.activities.forEach((a) => {
    check(a.employee_ref, `${a.ref}.employee_id`)
    check(a.lead_ref, `${a.ref}.lead_id`)
    check(a.party_ref, `${a.ref}.party_id`)
    check(a.accompanied_by_ref, `${a.ref}.accompanied_by`)
  })
  plan.follow_ups.forEach((f) => {
    check(f.assigned_to_ref, `${f.ref}.assigned_to`)
    check(f.created_by_ref, `${f.ref}.created_by`)
    check(f.lead_ref, `${f.ref}.lead_id`)
    check(f.party_ref, `${f.ref}.party_id`)
  })
  plan.stage_history.forEach((s) => {
    check(s.lead_ref, `${s.ref}.lead_id`)
    check(s.changed_by_ref, `${s.ref}.changed_by`)
  })
  plan.loss_reasons.forEach((l) => check(l.lead_ref, `${l.ref}.lead_id`))
  plan.targets.forEach((t) => check(t.employee_ref, `${t.ref}.employee_id`))
  plan.lead_owner_history.forEach((h) => {
    check(h.lead_ref, `${h.ref}.lead_id`)
    check(h.old_owner_ref, `${h.ref}.old_owner_id`)
    check(h.new_owner_ref, `${h.ref}.new_owner_id`)
  })

  log(need.length ? `  UNRESOLVED REFS (${need.length}):\n    ${need.slice(0, 20).join('\n    ')}` : '  refs: every cross-row link resolves')

  // author legality — the rules the database will enforce
  const roleOf = {}
  plan.employees.forEach((e) => (roleOf[e.ref] = e.role))
  roleOf[plan.owner.ref] = 'owner'
  const illegal = []
  plan.stage_history.forEach((s) => {
    if (roleOf[s.authored_by] === 'sales_executive')
      illegal.push(`${s.ref}: stage_history authored by an exec (${s.authored_by}) — INSERT policy rejects it`)
  })
  plan.leads.forEach((l) => {
    const insertOwner = l.original_owner_employee_ref || l.owner_employee_ref
    if (roleOf[l.authored_by] === 'sales_executive' && l.authored_by !== insertOwner)
      illegal.push(`${l.ref}: exec ${l.authored_by} inserting a lead owned by ${insertOwner}`)
  })
  plan.activities.forEach((a) => {
    if (roleOf[a.authored_by] === 'sales_executive' && a.authored_by !== a.employee_ref)
      illegal.push(`${a.ref}: exec ${a.authored_by} inserting an activity for ${a.employee_ref}`)
  })
  log(illegal.length ? `  ILLEGAL AUTHORS (${illegal.length}):\n    ${illegal.slice(0, 10).join('\n    ')}` : '  authors: every row is written by an identity RLS permits')

  // value-update plan
  const q = plan.leads.filter(withholdsQuote)
  const o = plan.leads.filter(withholdsOrder)
  const inline = plan.leads.filter((l) => l.order_value != null && !withholdsOrder(l))
  log(`\n  value updates: ${q.length} quote_value + ${o.length} order_value across ${new Set([...q, ...o].map((l) => l.ref)).size} leads`)
  log(`  order_value written inline (no change-log row, matches the corrections list): ${inline.length} leads`)
  log(`  expected lead_change_log rows: ${plan.leads.length} created + ${q.length} + ${o.length} = ${plan.leads.length + q.length + o.length}`)
  log(`  corrections in the plan:        ${plan.post_seed_corrections.lead_change_log.length}`)

  log('\n  rows to write:')
  for (const [t, n] of Object.entries({
    'auth.users': plan.employees.length,
    employees: plan.employees.length,
    areas: plan.areas.length,
    products: plan.products.length,
    parties: plan.parties.length,
    sites: plan.sites.length,
    site_contacts: plan.site_contacts.length,
    leads: plan.leads.length,
    activities: plan.activities.length,
    follow_ups: plan.follow_ups.length,
    stage_history: plan.stage_history.length,
    loss_reasons: plan.loss_reasons.length,
    targets: plan.targets.length,
    lead_owner_history: plan.lead_owner_history.length,
  })) {
    log(`    ${t.padEnd(20)} ${String(n).padStart(5)}`)
  }
  log(`    ${'UPDATEs'.padEnd(20)} ${String(q.length + o.length + plan.exec_touches.length + plan.sc_edits.length + plan.lead_owner_history.length).padStart(5)}`)

  return need.length + illegal.length + missing.length
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------
async function main() {
  log('='.repeat(74))
  log('PHASE 9 / PHASE 2 — SEEDER')
  log(`plan ${PLAN_PATH.split(/[\\/]/).pop()}  seed ${plan.meta.prng_seed}  reference ${plan.meta.reference_date}`)
  log('='.repeat(74))

  if (DRY_RUN) {
    const problems = dryRun()
    log(problems ? `\nDRY RUN FOUND ${problems} PROBLEM(S) — do not seed.` : '\nDRY RUN CLEAN.')
    process.exit(problems ? 1 : 0)
  }

  if (EMIT_ONLY) {
    emitSql()
    return
  }

  for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OWNER_EMAIL', 'OWNER_PASSWORD']) {
    if (!env[k]) throw new Error(`missing required env var ${k}`)
  }
  if (!SEED_PASSWORD) throw new Error('SEED_USER_PASSWORD could not be resolved or generated')
  manifest.seed_account_password_location =
    '.env.phase9 -> SEED_USER_PASSWORD (git-ignored). Deliberately NOT stored here: seed_manifest.json is not git-ignored.'

  const t0 = Date.now()

  if (wants('auth')) await stepAuth()
  await establishSessions()

  if (wants('employees')) await stepEmployees()
  if (wants('master')) await stepMaster()
  if (wants('parties')) await stepParties()
  if (wants('sites')) await stepSites()
  if (wants('site_contacts')) await stepSiteContacts()
  if (wants('leads')) await stepLeads()
  if (wants('values')) await stepValues()
  if (wants('locks')) await stepLocks()
  if (wants('activities')) await stepActivities()
  if (wants('follow_ups')) await stepFollowUps()
  if (wants('stage_history')) await stepStageHistory()
  if (wants('loss_reasons')) await stepLossReasons()
  if (wants('targets')) await stepTargets()
  if (wants('reassign')) await stepReassign()

  emitSql()

  let failures = 0
  if (wants('verify')) failures = await stepVerify()

  log(`\ndone in ${Math.round((Date.now() - t0) / 1000)}s`)
  log('\nNEXT: run phase9/post_seed_lead_change_log.sql in the Supabase SQL Editor.')
  log('The change log is stamped with the seeding time until you do.')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error('\nSEEDER FAILED:', e.message)
  console.error('\nThe manifest holds everything written so far — re-run to resume.')
  saveManifest()
  process.exit(1)
})
