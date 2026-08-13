#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 9 / PHASE 2 — SEED VERIFICATION
//
// Compares the LIVE database, row by row and field by field, against
// simulation_plan.json. Read-only.
//
// The seeder's own [16/16] step checks row counts and the four trigger-derived
// columns. That proves the right NUMBER of rows exist and that the triggers
// fired — it does not prove each row carries the values the plan specified.
// This does, and it matters for Phase 7: a mismatch found there must be
// attributable to the CRM, not to a seeding artefact, and the only way to say
// that with confidence is to have checked the seed itself.
//
// Reads as the OWNER throughout — the owner is the one identity that sees every
// row, so any gap here is a real data difference rather than an RLS scope.
// RLS scoping is verified separately (Phase 5).
//
//   node phase9/verify_seed.mjs
// ===========================================================================

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
const manifest = JSON.parse(readFileSync(join(ROOT, 'seed_manifest.json'), 'utf8'))

const ids = { [plan.owner.ref]: plan.owner.id }
for (const rows of Object.values(manifest.rows_created)) for (const r of rows) ids[r.ref] = r.id
const idOf = (ref) => (ref == null ? null : (ids[ref] ?? null))

const auth = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD }),
})
if (!auth.ok) throw new Error(`owner sign-in failed: ${auth.status}`)
const { access_token } = await auth.json()

async function fetchAll(table, select) {
  const out = []
  for (let off = 0; ; off += 1000) {
    const res = await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=${select}&order=id.asc&limit=1000&offset=${off}`,
      {
        headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}` },
      }
    )
    if (!res.ok) throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`)
    const rows = await res.json()
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return new Map(out.map((r) => [r.id, r]))
}

// Postgres returns DECIMAL as a string and DATE/TIMESTAMP with its own
// formatting; compare by meaning, not by literal text.
const num = (v) => (v == null || v === '' ? null : Number(v))
const date = (v) => (v == null ? null : String(v).slice(0, 10))
const ts = (v) => (v == null ? null : String(v).replace(' ', 'T').slice(0, 19))
const str = (v) => (v == null || v === '' ? null : String(v))
const bool = (v) => (v == null ? null : Boolean(v))
const time = (v) => (v == null ? null : String(v).slice(0, 8))

let failures = 0
const report = []

function compare(label, planRows, live, fields) {
  let missing = 0
  const bad = new Map()
  for (const p of planRows) {
    const id = idOf(p.ref)
    const row = id == null ? null : live.get(id)
    if (!row) {
      missing++
      continue
    }
    for (const [col, get] of Object.entries(fields)) {
      const expected = get.expected(p)
      const actual = get.actual(row)
      if (expected !== actual) {
        if (!bad.has(col)) bad.set(col, [])
        bad.get(col).push(`${p.ref}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
      }
    }
  }
  const nbad = [...bad.values()].reduce((a, b) => a + b.length, 0)
  const ok = missing === 0 && nbad === 0
  if (!ok) failures++
  report.push({ label, rows: planRows.length, missing, mismatches: nbad, ok })
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(20)} ${String(planRows.length).padStart(5)} rows` +
      (ok ? '' : `  — ${missing} missing, ${nbad} field mismatches`)
  )
  for (const [col, examples] of bad) {
    console.log(`         ${col}: ${examples.length}`)
    for (const e of examples.slice(0, 3)) console.log(`           ${e}`)
  }
}

const f = (expected, actual) => ({ expected, actual })

console.log('PHASE 2 SEED VERIFICATION — live database vs simulation_plan.json')
console.log(`reference ${plan.meta.reference_date}, prng seed ${plan.meta.prng_seed}\n`)

// --- employees -------------------------------------------------------------
compare('employees', plan.employees, await fetchAll('employees', 'id,name,mobile,role,coordinator_id,is_active,office_location'), {
  name: f((p) => p.name, (r) => r.name),
  mobile: f((p) => str(p.mobile), (r) => str(r.mobile)),
  role: f((p) => p.role, (r) => r.role),
  coordinator_id: f((p) => idOf(p.coordinator_ref), (r) => r.coordinator_id),
  is_active: f((p) => p.is_active, (r) => r.is_active),
  office_location: f((p) => str(p.office_location), (r) => str(r.office_location)),
})

// --- areas / products ------------------------------------------------------
compare('areas', plan.areas, await fetchAll('areas', 'id,area_name,city'), {
  area_name: f((p) => p.area_name, (r) => r.area_name),
  city: f((p) => str(p.city), (r) => str(r.city)),
})
compare('products', plan.products, await fetchAll('products', 'id,name,category'), {
  name: f((p) => p.name, (r) => r.name),
  category: f((p) => str(p.category), (r) => str(r.category)),
})

// --- parties ---------------------------------------------------------------
compare('parties', plan.parties, await fetchAll('parties', 'id,party_type,name,mobile,city,area_id,firm_name,relationship_status,verification_status,created_by,created_at'), {
  party_type: f((p) => p.party_type, (r) => r.party_type),
  name: f((p) => p.name, (r) => r.name),
  mobile: f((p) => str(p.mobile), (r) => str(r.mobile)),
  area_id: f((p) => idOf(p.area_ref), (r) => r.area_id),
  firm_name: f((p) => str(p.firm_name), (r) => str(r.firm_name)),
  verification_status: f((p) => p.verification_status, (r) => r.verification_status),
  created_by: f((p) => idOf(p.created_by_ref), (r) => r.created_by),
  created_at: f((p) => ts(p.created_at), (r) => ts(r.created_at)),
})

// --- sites -----------------------------------------------------------------
compare('sites', plan.sites, await fetchAll('sites', 'id,area_id,house_no,locality,pincode,nickname,plot_area_sqyds,site_stage,primary_contact_party_id,discovered_via,discovered_by,created_at'), {
  area_id: f((p) => idOf(p.area_ref), (r) => r.area_id),
  house_no: f((p) => str(p.house_no), (r) => str(r.house_no)),
  locality: f((p) => str(p.locality), (r) => str(r.locality)),
  nickname: f((p) => str(p.nickname), (r) => str(r.nickname)),
  plot_area_sqyds: f((p) => num(p.plot_area_sqyds), (r) => num(r.plot_area_sqyds)),
  site_stage: f((p) => str(p.site_stage), (r) => str(r.site_stage)),
  primary_contact_party_id: f((p) => idOf(p.primary_contact_party_ref), (r) => r.primary_contact_party_id),
  discovered_via: f((p) => str(p.discovered_via), (r) => str(r.discovered_via)),
  discovered_by: f((p) => idOf(p.discovered_by_ref), (r) => r.discovered_by),
  created_at: f((p) => ts(p.created_at), (r) => ts(r.created_at)),
})

// --- site_contacts ---------------------------------------------------------
compare('site_contacts', plan.site_contacts, await fetchAll('site_contacts', 'id,site_id,party_id,role,discovered_at'), {
  site_id: f((p) => idOf(p.site_ref), (r) => r.site_id),
  party_id: f((p) => idOf(p.party_ref), (r) => r.party_id),
  role: f((p) => p.role, (r) => r.role),
  discovered_at: f((p) => ts(p.discovered_at), (r) => ts(r.discovered_at)),
})

// --- leads -----------------------------------------------------------------
// owner_employee_id is checked against the FINAL owner, so the two cross-team
// reassignments are only correct here if step 15 actually ran.
// closure_probability / next_followup_date are checked against the plan value
// UNLESS an exec_touch or sc_edit deliberately overwrote them — those patches
// are the last write and are therefore the expected final state.
const patched = new Map()
for (const t of [...plan.exec_touches, ...plan.sc_edits]) {
  patched.set(t.lead_ref, { ...(patched.get(t.lead_ref) || {}), ...t.patch })
}
const leadExp = (p, col) => (patched.get(p.ref)?.[col] !== undefined ? patched.get(p.ref)[col] : p[col])

compare('leads', plan.leads, await fetchAll('leads', 'id,site_id,party_id,product_id,owner_employee_id,source_type,referred_by_party_id,other_party_id,external_reference_id,lead_generated_at,current_stage,entered_by_role,rfq_raised,rfq_raised_at,quote_sent,quote_sent_at,quote_value,order_value,closure_probability,estimated_close_date,next_followup_date,created_at,created_by_employee_id'), {
  site_id: f((p) => idOf(p.site_ref), (r) => r.site_id),
  party_id: f((p) => idOf(p.party_ref), (r) => r.party_id),
  product_id: f((p) => idOf(p.product_ref), (r) => r.product_id),
  owner_employee_id: f((p) => idOf(p.owner_employee_ref), (r) => r.owner_employee_id),
  created_by_employee_id: f((p) => idOf(p.expected_created_by_employee_ref), (r) => r.created_by_employee_id),
  source_type: f((p) => p.source_type, (r) => r.source_type),
  referred_by_party_id: f((p) => idOf(p.referred_by_party_ref), (r) => r.referred_by_party_id),
  other_party_id: f((p) => idOf(p.other_party_ref), (r) => r.other_party_id),
  external_reference_id: f((p) => str(p.external_reference_id), (r) => str(r.external_reference_id)),
  lead_generated_at: f((p) => date(p.lead_generated_at), (r) => date(r.lead_generated_at)),
  current_stage: f((p) => p.current_stage, (r) => r.current_stage),
  entered_by_role: f((p) => p.expected_entered_by_role ?? null, (r) => r.entered_by_role ?? null),
  rfq_raised: f((p) => bool(p.rfq_raised), (r) => bool(r.rfq_raised)),
  rfq_raised_at: f((p) => date(p.rfq_raised_at), (r) => date(r.rfq_raised_at)),
  quote_sent: f((p) => bool(p.quote_sent), (r) => bool(r.quote_sent)),
  quote_sent_at: f((p) => date(p.quote_sent_at), (r) => date(r.quote_sent_at)),
  quote_value: f((p) => num(p.quote_value), (r) => num(r.quote_value)),
  order_value: f((p) => num(p.order_value), (r) => num(r.order_value)),
  closure_probability: f((p) => leadExp(p, 'closure_probability') ?? null, (r) => r.closure_probability ?? null),
  estimated_close_date: f((p) => date(p.estimated_close_date), (r) => date(r.estimated_close_date)),
  next_followup_date: f((p) => date(leadExp(p, 'next_followup_date')), (r) => date(r.next_followup_date)),
  created_at: f((p) => ts(p.created_at), (r) => ts(r.created_at)),
})

// --- activities ------------------------------------------------------------
compare('activities', plan.activities, await fetchAll('activities', 'id,employee_id,party_id,lead_id,activity_type,accompanied_by,notes,leads_generated,entered_by_role,logged_by_employee_id,created_at'), {
  employee_id: f((p) => idOf(p.employee_ref), (r) => r.employee_id),
  party_id: f((p) => idOf(p.party_ref), (r) => r.party_id),
  lead_id: f((p) => idOf(p.lead_ref), (r) => r.lead_id),
  activity_type: f((p) => p.activity_type, (r) => r.activity_type),
  accompanied_by: f((p) => idOf(p.accompanied_by_ref), (r) => r.accompanied_by),
  notes: f((p) => str(p.notes), (r) => str(r.notes)),
  leads_generated: f((p) => (p.leads_generated ?? null), (r) => r.leads_generated ?? null),
  entered_by_role: f((p) => p.expected_entered_by_role ?? null, (r) => r.entered_by_role ?? null),
  logged_by_employee_id: f((p) => idOf(p.expected_logged_by_employee_ref), (r) => r.logged_by_employee_id),
  created_at: f((p) => ts(p.created_at), (r) => ts(r.created_at)),
})

// --- follow_ups ------------------------------------------------------------
compare('follow_ups', plan.follow_ups, await fetchAll('follow_ups', 'id,assigned_to,created_by,party_id,lead_id,activity_type,title,notes,due_date,due_time,is_done,done_at,notified_at,created_at'), {
  assigned_to: f((p) => idOf(p.assigned_to_ref), (r) => r.assigned_to),
  created_by: f((p) => idOf(p.created_by_ref), (r) => r.created_by),
  party_id: f((p) => idOf(p.party_ref), (r) => r.party_id),
  lead_id: f((p) => idOf(p.lead_ref), (r) => r.lead_id),
  activity_type: f((p) => str(p.activity_type), (r) => str(r.activity_type)),
  title: f((p) => p.title, (r) => r.title),
  due_date: f((p) => date(p.due_date), (r) => date(r.due_date)),
  due_time: f((p) => time(p.due_time), (r) => time(r.due_time)),
  is_done: f((p) => bool(p.is_done), (r) => bool(r.is_done)),
  done_at: f((p) => ts(p.done_at), (r) => ts(r.done_at)),
  created_at: f((p) => ts(p.created_at), (r) => ts(r.created_at)),
})

// --- stage_history ---------------------------------------------------------
compare('stage_history', plan.stage_history, await fetchAll('stage_history', 'id,lead_id,stage,changed_by,changed_at'), {
  lead_id: f((p) => idOf(p.lead_ref), (r) => r.lead_id),
  stage: f((p) => p.stage, (r) => r.stage),
  changed_by: f((p) => idOf(p.changed_by_ref), (r) => r.changed_by),
  changed_at: f((p) => ts(p.changed_at), (r) => ts(r.changed_at)),
})

// --- loss_reasons ----------------------------------------------------------
compare('loss_reasons', plan.loss_reasons, await fetchAll('loss_reasons', 'id,lead_id,reason,competitor_name,lost_at'), {
  lead_id: f((p) => idOf(p.lead_ref), (r) => r.lead_id),
  reason: f((p) => str(p.reason), (r) => str(r.reason)),
  competitor_name: f((p) => str(p.competitor_name), (r) => str(r.competitor_name)),
  lost_at: f((p) => date(p.lost_at), (r) => date(r.lost_at)),
})

// --- targets ---------------------------------------------------------------
compare('targets', plan.targets, await fetchAll('targets', 'id,employee_id,period_type,period_value,metric_name,target_value'), {
  employee_id: f((p) => idOf(p.employee_ref), (r) => r.employee_id),
  period_type: f((p) => p.period_type, (r) => r.period_type),
  period_value: f((p) => p.period_value, (r) => r.period_value),
  metric_name: f((p) => p.metric_name, (r) => r.metric_name),
  target_value: f((p) => num(p.target_value), (r) => num(r.target_value)),
})

// --- lead_owner_history ----------------------------------------------------
compare('lead_owner_history', plan.lead_owner_history, await fetchAll('lead_owner_history', 'id,lead_id,old_owner_id,new_owner_id,changed_by,changed_at'), {
  lead_id: f((p) => idOf(p.lead_ref), (r) => r.lead_id),
  old_owner_id: f((p) => idOf(p.old_owner_ref), (r) => r.old_owner_id),
  new_owner_id: f((p) => idOf(p.new_owner_ref), (r) => r.new_owner_id),
  changed_by: f((p) => idOf(p.changed_by_ref), (r) => r.changed_by),
  changed_at: f((p) => ts(p.changed_at), (r) => ts(r.changed_at)),
})

// --- lead_change_log: the one table the app cannot backdate -----------------
console.log('\nlead_change_log (trigger-written — timestamps need the post-seed SQL):')
{
  const rows = await fetchAll('lead_change_log', 'id,lead_id,field,changed_at,changed_by')
  const corrections = plan.post_seed_corrections.lead_change_log
  const wantByKey = new Map(corrections.map((c) => [`${idOf(c.lead_ref)}:${c.field}`, c.intended_changed_at]))
  let matched = 0
  let stampedToday = 0
  let unexpected = 0
  const todayPrefix = new Date().toISOString().slice(0, 10)
  for (const r of rows.values()) {
    const key = `${r.lead_id}:${r.field}`
    if (!wantByKey.has(key)) {
      unexpected++
      continue
    }
    const want = wantByKey.get(key)
    // changed_at is TIMESTAMPTZ; the plan value is naive UTC.
    if (new Date(r.changed_at).getTime() === new Date(want + 'Z').getTime()) matched++
    else if (String(r.changed_at).startsWith(todayPrefix)) stampedToday++
  }
  console.log(`  ${rows.size} rows, ${corrections.length} corrections expected`)
  console.log(`  ${matched} already carry the intended timestamp`)
  console.log(`  ${stampedToday} still stamped at seeding time  ${stampedToday ? '<-- run phase9/post_seed_lead_change_log.sql' : ''}`)
  console.log(`  ${unexpected} rows with no matching correction  ${unexpected ? '<-- UNEXPECTED' : ''}`)
  if (unexpected) failures++
}

console.log('')
console.log(failures ? `${failures} TABLE(S) FAILED VERIFICATION` : 'ALL TABLES VERIFIED FIELD BY FIELD')
process.exit(failures ? 1 : 0)
