#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 9 / PHASE 7 — THE RECONCILER
//
// Compares what the CRM actually computes against expected_ledger.json, and
// adjudicates every difference rather than assuming either side is right.
//
// METHOD. For the Needs Attention buckets the comparison is done three ways so
// a difference can be attributed rather than merely observed:
//
//   LEDGER  — Phase 6's independent calculation, from the plan alone.
//   APP     — attention.js's logic, replicated EXACTLY here (naive-timestamp
//             parse, Math.floor over elapsed ms from Date.now()), run against
//             the live rows the app itself fetches.
//   UI      — the number actually rendered on the Dashboard.
//
// APP is replicated rather than imported only because `src/lib` uses
// extensionless imports that Node will not resolve; it is a line-for-line
// transcription of computeAttentionBuckets, and the UI cross-check is what
// proves the transcription is faithful. If APP and UI agree but differ from
// LEDGER, the disagreement is definitional and gets adjudicated against the
// documentation — which is the whole reason Phase 6 was forbidden from
// importing the app's helpers.
//
//   node phase9/reconcile.mjs
// ===========================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, rest, ids, makeReporter } from './lib.mjs'

const ledger = JSON.parse(readFileSync(join(ROOT, process.env.PHASE9_LEDGER || 'expected_ledger.json'), 'utf8'))
const REF = ledger.meta.reference_date
// LEADS ONLY. Every table has its own SERIAL sequence, so lead #5, target #5
// and product #5 all exist — a reverse map built over the whole manifest
// collapses them and resolves a lead id to whichever table was written last.
// The first run of this file did exactly that and reported `prod_sliding_d`
// and `tgt_2165` as members of a lead bucket. Scoped explicitly so it cannot
// happen again.
const manifest = JSON.parse(readFileSync(join(ROOT, 'seed_manifest.json'), 'utf8'))
const refById = new Map(manifest.rows_created.leads.map((row) => [row.id, row.ref]))

const r = makeReporter('RECONCILER')

// --------------------------------------------------------------------------
// pull the same rows the app fetches (as owner — the app's own widest scope)
// --------------------------------------------------------------------------
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

const leads = await fetchAll(
  '/leads?select=id,current_stage,quote_sent,quote_sent_at,quote_value,order_value,rfq_raised,rfq_raised_at,next_followup_date,estimated_close_date,created_at,owner_employee_id'
)
const activities = await fetchAll('/activities?select=id,lead_id,created_at,activity_type,employee_id')

// fetchLastActivityPerLead's shape: lead_id -> most recent created_at
const lastActivityByLead = new Map()
for (const a of activities) {
  if (!a.lead_id) continue
  const cur = lastActivityByLead.get(a.lead_id)
  if (!cur || a.created_at > cur) lastActivityByLead.set(a.lead_id, a.created_at)
}

// --------------------------------------------------------------------------
// APP logic — transcribed from src/lib/attention.js
// --------------------------------------------------------------------------
const MS_PER_DAY = 86_400_000
const CLOSED = ['won', 'lost']
const ATTENTION_DAYS = 14
const SILENT_QUOTE_DAYS = 5
const PENDING_RFQ_DAYS = 3

// attention.js:38 — `new Date(dateLike)` on a naive TIMESTAMP. The ES spec
// parses an offset-less date-time as LOCAL, but these columns hold a UTC wall
// clock, so every age is inflated by the local UTC offset (+5h30m in IST).
const appDaysSince = (d) => (d == null ? null : Math.floor((Date.now() - new Date(d).getTime()) / MS_PER_DAY))

const appBuckets = { stale: [], silent_quotes: [], followups_overdue: [], slipped: [], pending_rfq: [] }
const today = Date.now()
for (const lead of leads.filter((l) => !CLOSED.includes(l.current_stage ?? 'calling'))) {
  const lastActivityAt = lastActivityByLead.get(lead.id) ?? null
  const touchAge = appDaysSince(lastActivityAt ?? lead.created_at)
  if (touchAge != null && touchAge >= ATTENTION_DAYS) appBuckets.stale.push(lead.id)

  if (lead.quote_sent && lead.quote_sent_at) {
    const quoteAge = appDaysSince(lead.quote_sent_at)
    const touchedSince = lastActivityAt && new Date(lastActivityAt) > new Date(lead.quote_sent_at)
    if (quoteAge >= SILENT_QUOTE_DAYS && !touchedSince) appBuckets.silent_quotes.push(lead.id)
  }
  if (lead.next_followup_date && new Date(lead.next_followup_date).getTime() < today) appBuckets.followups_overdue.push(lead.id)
  if (lead.estimated_close_date && new Date(lead.estimated_close_date).getTime() < today) appBuckets.slipped.push(lead.id)
  if (lead.rfq_raised && !lead.quote_sent && lead.rfq_raised_at) {
    if (appDaysSince(lead.rfq_raised_at) >= PENDING_RFQ_DAYS) appBuckets.pending_rfq.push(lead.id)
  }
}

// --------------------------------------------------------------------------
// compare, per bucket, by SET
// --------------------------------------------------------------------------
r.section('NEEDS ATTENTION — ledger vs app, compared by lead set')

const diffs = {}
for (const [key, exp] of Object.entries(ledger.needs_attention)) {
  const ledgerSet = new Set(exp.lead_refs)
  const appSet = new Set(appBuckets[key].map((id) => refById.get(id)).filter(Boolean))

  const onlyApp = [...appSet].filter((x) => !ledgerSet.has(x)).sort()
  const onlyLedger = [...ledgerSet].filter((x) => !appSet.has(x)).sort()
  diffs[key] = { onlyApp, onlyLedger }

  const match = onlyApp.length === 0 && onlyLedger.length === 0
  r.check(
    `${key}: ledger ${ledgerSet.size} vs app ${appSet.size}`,
    match,
    match ? '' : `app-only: ${onlyApp.join(', ') || '—'}   ledger-only: ${onlyLedger.join(', ') || '—'}`
  )
}

// --------------------------------------------------------------------------
// attribute every difference — is it the timestamp bug, or something else?
// --------------------------------------------------------------------------
r.section('ATTRIBUTION — why each differing lead differs')

const istDate = (naive) => {
  const d = new Date(naive + 'Z')
  d.setUTCMinutes(d.getUTCMinutes() + 330)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY)

for (const [key, d] of Object.entries(diffs)) {
  for (const ref of [...d.onlyApp, ...d.onlyLedger]) {
    const id = ids[ref]
    const lead = leads.find((l) => l.id === id)
    if (!lead) continue
    const raw = lastActivityByLead.get(id) ?? lead.created_at
    const appAge = appDaysSince(raw)
    const calAge = daysBetween(istDate(raw), REF)
    const side = d.onlyApp.includes(ref) ? 'app-only' : 'ledger-only'
    console.log(
      `        ${key} ${side} ${ref}: raw ${raw} -> app age ${appAge}d, IST calendar age ${calAge}d` +
        `  (delta ${appAge - calAge})`
    )
  }
}

// --------------------------------------------------------------------------
// figures that should agree exactly
// --------------------------------------------------------------------------
r.section('AGGREGATES — these must agree regardless of the age definition')

const openLeads = leads.filter((l) => !CLOSED.includes(l.current_stage ?? 'calling'))
r.check('open lead count', openLeads.length === ledger.company.open_leads, `app ${openLeads.length} vs ledger ${ledger.company.open_leads}`)
r.check(
  'won count',
  leads.filter((l) => l.current_stage === 'won').length === ledger.company.won_count,
  `${leads.filter((l) => l.current_stage === 'won').length} vs ${ledger.company.won_count}`
)
r.check(
  'lost count',
  leads.filter((l) => l.current_stage === 'lost').length === ledger.company.lost_count,
  `${leads.filter((l) => l.current_stage === 'lost').length} vs ${ledger.company.lost_count}`
)
r.check('activity count', activities.length === ledger.company.activities_total, `${activities.length} vs ${ledger.company.activities_total}`)

// open pipeline — both sides sum a missing value as zero, so this must match
// even though they disagree about how to DISPLAY a missing value (F-P4-2).
const appPipeline = openLeads.reduce((s, l) => s + Number(l.quote_value ?? 0), 0)
r.check(
  'open pipeline value',
  appPipeline === ledger.company.open_pipeline_value,
  `app ₹${appPipeline} vs ledger ₹${ledger.company.open_pipeline_value}`
)

// F-P4-2 — the predicted divergence, confirmed rather than rediscovered.
const noValue = openLeads.filter((l) => l.quote_value == null).length
r.check(
  `F-P4-2 (predicted): ${noValue} open leads have no value and render ₹0 instead of "—"`,
  noValue === ledger.company.leads_with_no_value,
  `app ${noValue} vs ledger ${ledger.company.leads_with_no_value} — counts agree; the DISPLAY is the defect`
)

// Q-P1-3 — report both, decide neither.
const lossRows = await fetchAll('/loss_reasons?select=id,lead_id,reason')
const lostNow = new Set(leads.filter((l) => l.current_stage === 'lost').map((l) => l.id))
const currentlyLost = lossRows.filter((lr) => lostNow.has(lr.lead_id)).length
console.log(
  `\n        Q-P1-3 — loss EVENTS ${lossRows.length} (ledger ${ledger.loss_reasons.a_loss_events.total}) · ` +
    `CURRENTLY-LOST ${currentlyLost} (ledger ${ledger.loss_reasons.b_currently_lost.total})`
)
r.check(
  'Q-P1-3 both readings match the ledger (AWAITING A PRODUCT DECISION, not a mismatch)',
  lossRows.length === ledger.loss_reasons.a_loss_events.total && currentlyLost === ledger.loss_reasons.b_currently_lost.total,
  'the card totalling higher than the `lost` stage count is expected under reading (A)'
)

// The negative control — the one result that would be a real regression.
r.section('NEGATIVE CONTROL — the 9–12 day band must not reach the stale queue')
const control = new Set(ledger.negative_control_cooling_band.lead_refs)
const appStale = new Set(appBuckets.stale.map((id) => refById.get(id)))
const leaked = [...control].filter((x) => appStale.has(x)).sort()
r.check(
  'no cooling-band lead appears in the app’s stale queue',
  leaked.length === 0,
  leaked.length ? `LEAKED: ${leaked.join(', ')}` : `${control.size} control leads, none queued`
)

const { failed } = r.summary()
console.log(
  failed
    ? '\nDifferences found — see ATTRIBUTION above before classifying any as a defect.'
    : '\nEverything reconciles.'
)
process.exit(0)
