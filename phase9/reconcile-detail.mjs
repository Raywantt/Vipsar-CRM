#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 7 (extension) — the ledger sections the first pass did not reach:
// per-employee figures, the Day Review, and the sales funnel's reach counts.
//
// Same firewall as before: expected values come from expected_ledger.json,
// which was computed from the plan alone. Actuals are computed here from the
// live rows the app fetches, applying the app's own documented definitions.
//
// Date sensitivity is handled explicitly. Per-employee totals (leads owned,
// pipeline, won, activity mix) are NOT date-dependent, so the canonical ledger
// is the right comparison. The Day Review is bounded to one specific calendar
// day, so it is compared for the ledger's own reference date rather than
// "today" — which is what makes it still valid after the clock moved on.
//
//   node phase9/reconcile-detail.mjs
// ===========================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, rest, ids, plan, makeReporter } from './lib.mjs'

const ledger = JSON.parse(readFileSync(join(ROOT, 'expected_ledger.json'), 'utf8'))
const REF = ledger.meta.reference_date
const r = makeReporter('RECONCILER — DETAIL')

const empId = (ref) => ids[ref]
const CLOSED = ['won', 'lost']
const OPEN = (l) => !CLOSED.includes(l.current_stage ?? 'calling')

async function fetchAll(path) {
  const out = []
  for (let off = 0; ; off += 1000) {
    const res = await rest('emp_owner', 'GET', `${path}&order=id.asc&limit=1000&offset=${off}`)
    if (!res.ok) throw new Error(`${path}: ${JSON.stringify(res.body)}`)
    out.push(...res.body)
    if (res.body.length < 1000) break
  }
  return out
}

const leads = await fetchAll('/leads?select=id,current_stage,quote_value,order_value,owner_employee_id,created_by_employee_id,created_at,quote_sent_at')
const activities = await fetchAll('/activities?select=id,lead_id,employee_id,activity_type,created_at')
const followUps = await fetchAll('/follow_ups?select=id,assigned_to,due_date,is_done')
const stageHistory = await fetchAll('/stage_history?select=id,lead_id,stage,changed_at')

// dealValueFor's documented rule (sum form — 0 for unknown).
const dealValue = (l) => Number((OPEN(l) ? l.quote_value : (l.order_value ?? l.quote_value)) ?? 0)

// IST calendar day from a naive-UTC timestamp.
const istDate = (naive) => {
  const d = new Date(naive + 'Z')
  d.setUTCMinutes(d.getUTCMinutes() + 330)
  return d.toISOString().slice(0, 10)
}

// ===========================================================================
r.section('PER-EMPLOYEE — every exec, against the ledger')
// ===========================================================================
for (const [ref, exp] of Object.entries(ledger.per_employee)) {
  const id = empId(ref)
  const owned = leads.filter((l) => l.owner_employee_id === id)
  const open = owned.filter(OPEN)
  const won = owned.filter((l) => l.current_stage === 'won')
  const lost = owned.filter((l) => l.current_stage === 'lost')
  const acts = activities.filter((a) => a.employee_id === id)
  const created = leads.filter((l) => l.created_by_employee_id === id)
  const fus = followUps.filter((f) => f.assigned_to === id)

  const got = {
    leads_owned: owned.length,
    open_leads: open.length,
    open_pipeline_value: open.reduce((s, l) => s + dealValue(l), 0),
    won_count: won.length,
    lost_count: lost.length,
    leads_created: created.length,
    activities_total: acts.length,
    follow_ups_assigned: fus.length,
    follow_ups_done: fus.filter((f) => f.is_done).length,
  }

  const bad = Object.entries(got).filter(([k, v]) => exp[k] !== v)
  r.check(
    `${ref}: ${Object.keys(got).length} figures`,
    bad.length === 0,
    bad.map(([k, v]) => `${k} app ${v} vs ledger ${exp[k]}`).join('; ')
  )

  // activity mix, per type
  const mixBad = Object.entries(exp.activities_by_type).filter(
    ([type, n]) => acts.filter((a) => a.activity_type === type).length !== n
  )
  r.check(
    `${ref}: activity mix by type`,
    mixBad.length === 0,
    mixBad.map(([t, n]) => `${t} app ${acts.filter((a) => a.activity_type === t).length} vs ledger ${n}`).join('; ')
  )
}

// ===========================================================================
r.section(`DAY REVIEW — ${REF}, per exec, all ten columns`)
// ===========================================================================
{
  const tomorrow = new Date(Date.parse(REF) + 86400000).toISOString().slice(0, 10)
  for (const [ref, exp] of Object.entries(ledger.day_review[REF])) {
    const id = empId(ref)
    const acts = activities.filter((a) => a.employee_id === id && istDate(a.created_at) === REF)
    const due = followUps.filter((f) => f.assigned_to === id && f.due_date === REF)

    const got = {
      activities: acts.length,
      calls: acts.filter((a) => a.activity_type === 'call').length,
      visits: acts.filter((a) => a.activity_type === 'site_visit').length,
      leads_touched: new Set(acts.map((a) => a.lead_id).filter(Boolean)).size,
      leads_created: leads.filter((l) => l.created_by_employee_id === id && istDate(l.created_at) === REF).length,
      quotes_sent: leads.filter((l) => l.owner_employee_id === id && l.quote_sent_at === REF).length,
      followups_due: due.length,
      followups_done: due.filter((f) => f.is_done).length,
      followups_tomorrow: followUps.filter((f) => f.assigned_to === id && f.due_date === tomorrow).length,
    }

    const bad = Object.entries(got).filter(([k, v]) => exp[k] !== v)
    r.check(
      `${ref} on ${REF}`,
      bad.length === 0,
      bad.map(([k, v]) => `${k} app ${v} vs ledger ${exp[k]}`).join('; ')
    )
  }
}

// ===========================================================================
r.section('SALES FUNNEL — reach count per stage')
//
// The documented workaround matters here: stage_history only logs the
// DESTINATION of an explicit change, so a lead that went straight to 'lost'
// has no 'calling' row even though it passed through. SalesFunnelCard therefore
// seeds every lead's reached-set with 'calling' (true for all, by schema
// default) AND its own current_stage, then widens with stage_history. This
// reimplements that rule rather than importing it.
// ===========================================================================
{
  const reached = new Map() // stage -> Set(leadId)
  const add = (stage, leadId) => {
    if (!reached.has(stage)) reached.set(stage, new Set())
    reached.get(stage).add(leadId)
  }
  for (const l of leads) {
    add('calling', l.id)
    add(l.current_stage ?? 'calling', l.id)
  }
  for (const s of stageHistory) add(s.stage, s.lead_id)

  // Expected: derived from the plan the same way.
  const planReached = new Map()
  const addP = (stage, ref) => {
    if (!planReached.has(stage)) planReached.set(stage, new Set())
    planReached.get(stage).add(ref)
  }
  const patched = new Map()
  for (const t of [...plan.exec_touches, ...plan.sc_edits]) {
    patched.set(t.lead_ref, { ...(patched.get(t.lead_ref) ?? {}), ...t.patch })
  }
  for (const l of plan.leads) {
    const stage = patched.get(l.ref)?.current_stage ?? l.current_stage
    addP('calling', l.ref)
    addP(stage, l.ref)
  }
  for (const s of plan.stage_history) addP(s.stage, s.lead_ref)

  const stages = [...new Set([...reached.keys(), ...planReached.keys()])].sort()
  const bad = []
  for (const st of stages) {
    const a = reached.get(st)?.size ?? 0
    const b = planReached.get(st)?.size ?? 0
    if (a !== b) bad.push(`${st}: app ${a} vs plan ${b}`)
  }
  r.check(`funnel reach across ${stages.length} stages`, bad.length === 0, bad.join('; '))
}

const { failed } = r.summary()
process.exit(failed ? 1 : 0)
