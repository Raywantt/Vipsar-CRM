// Reads and actions for the RFQ desk (RFQ-DESK.md §5). Nobody writes `rfqs`
// directly — there is no INSERT/UPDATE/DELETE grant on it. A desk RFQ is
// created by a trigger when an RFQ Raised activity is logged, and every later
// move goes through one of the SECURITY DEFINER action functions in
// Schema/migration_rfq_desk.sql, each of which re-checks role, test scope and
// starting status itself. This module only reads, and calls those functions.
import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'
import { todayISO } from './followupDates'

// Everything Lead Detail's RFQ card shows. Each actor is its own aliased
// embed, hinted by the FK column — rfqs has six FKs to employees, so a bare
// embed would be ambiguous. RLS decides which rows come back: the desk reads
// every RFQ of its own test kind, everyone else the RFQs on leads they can
// already see.
export const RFQ_SELECT =
  'id, lead_id, activity_id, kind, revision, status, is_test, window_count, segments, product_ids, quote_lines, raised_at, ' +
  'raised_by_employee_id, logged_by_employee_id, approved_at, approved_by, sent_back_at, sent_back_from, ' +
  'send_back_note, lixil_raised_at, quote_received_at, quote_date, quote_ref, quote_value, withdrawn_at, ' +
  'raised_by:employees!raised_by_employee_id(name), logged_by:employees!logged_by_employee_id(name), ' +
  'approver:employees!approved_by(name), sender:employees!sent_back_by(name), withdrawer:employees!withdrawn_by(name)'

export function fetchRfqsForLead(leadId) {
  return fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select(RFQ_SELECT, { count: 'exact' })
      .eq('lead_id', leadId)
      .order('raised_at', { ascending: false }),
    { ascending: false }
  )
}

// The launch switch (rfq_desk_settings, one row). Readable by every active
// employee. Log Activity asks it whether an RFQ Raised now goes to the desk
// (and so stops moving the lead itself) — see isDeskLive in rfqDesk.js.
export function fetchRfqDeskSettings() {
  return supabase.from('rfq_desk_settings').select('live_from').maybeSingle()
}

// rfq_withdraw(): the credited exec, whoever logged it, or the owner, while
// the RFQ is with the technical check or estimation. The function refuses
// anyone else with a readable message (42501), which errorMessage passes on.
export function withdrawRfq(rfqId) {
  return supabase.rpc('rfq_withdraw', { p_rfq_id: rfqId })
}

// ---- The technical check (RFQ-DESK.md Step 4) ----

// rfq_approve(): Production Executive or owner, from with_technical. The
// trigger behind it does the rest — rfq_raised on the lead, the move to RFQ
// Raised on a lead still before it, and the alert to estimation.
export function approveRfq(rfqId) {
  return supabase.rpc('rfq_approve', { p_rfq_id: rfqId })
}

// rfq_send_back(): back to the exec with an optional note (RFQ-DESK.md §3 —
// no reason list in v1). A blank note is sent as null, which the function
// also does itself.
export function sendBackRfq(rfqId, note) {
  return supabase.rpc('rfq_send_back', { p_rfq_id: rfqId, p_note: note?.trim() || null })
}

// The queue a row needs: the RFQ (RFQ_SELECT) plus enough of its lead to name
// it (leadName.js's three tiers) and say which office it belongs to — the
// desk's sheets were split by office (LDH / JLD), so it's the first thing
// they look for after the name.
const QUEUE_SELECT =
  RFQ_SELECT + ', leads(id, current_stage, office_territory, parties!party_id(name), sites(nickname, locality, house_no))'

// A queue row plus who did each step — what the RFQ popups
// (rfqDeskPanels.js) and the desk's month strips count by. For the desk, the
// `leads` embed comes back null on a lead that has left their process (they
// read only their own — migration_rfq_desk_in_process.sql); the popup then
// names it "Lead #id" without a link.
const DECISION_SELECT = QUEUE_SELECT + ', sent_back_by, lixil_raised_by, quote_received_by'

// Every RFQ waiting at the technical check. RLS scopes it: the desk reads
// only RFQs of its own test kind, so the test Production Executive never sees
// a real one and the real one never a test one. Oldest first, as the queue
// shows them.
export function fetchTechnicalQueue() {
  return fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select(QUEUE_SELECT, { count: 'exact' })
      .eq('status', 'with_technical')
      .order('raised_at', { ascending: true })
  )
}

// What the Production Executive decided since `sinceISO` — for their Today
// strip (technicalMonthStats in rfqDesk.js does the counting): RFQs they
// approved or sent back in the period, and RFQs they approved that estimation
// sent back in it (approved earlier, bounced now). The timestamp is quoted:
// PostgREST reserves '.', ':' and ',' inside a logic-tree value.
export function fetchMyTechnicalDecisions(employeeId, sinceISO) {
  const since = `"${sinceISO}"`
  return fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select(DECISION_SELECT, { count: 'exact' })
      .or(
        `and(approved_by.eq.${employeeId},approved_at.gte.${since}),` +
          `and(sent_back_by.eq.${employeeId},sent_back_at.gte.${since}),` +
          `and(approved_by.eq.${employeeId},sent_back_at.gte.${since})`
      )
  )
}

// ---- Estimation and Lixil (RFQ-DESK.md Step 5) ----

// rfq_raise_with_lixil(): Estimation Executive or owner, from with_estimation.
// One tap (RFQ-DESK.md §3) — the step exists to split Lixil's time from the
// desk's.
export function raiseRfqWithLixil(rfqId) {
  return supabase.rpc('rfq_raise_with_lixil', { p_rfq_id: rfqId })
}

// rfq_record_quote(): from with_lixil. The value is WITHOUT GST and becomes the
// lead's quote_value (rfqs_after_write); the exec and whoever logged the RFQ
// are told. quoteProblem() in rfqDesk.js says the function's own refusals
// before the round trip.
export function recordRfqQuote(rfqId, { ref, value, date }) {
  return supabase.rpc('rfq_record_quote', {
    p_rfq_id: rfqId,
    p_quote_ref: ref.trim(),
    p_quote_value: Number(value),
    p_quote_date: date || null,
  })
}

// rfq_record_quote_lines(): the quote PER PRODUCT (owner's ruling, 2026-10-06 —
// Schema/migration_lead_products.sql). `lines` is [{ product_id, value }], one
// per product on the RFQ (product_id null for an RFQ with none); the RFQ's
// quote value is their sum and the split goes onto the RFQ and the lead
// (quote_lines). Every other rule is rfq_record_quote's, which it calls.
export function recordRfqQuoteLines(rfqId, { ref, lines, date }) {
  return supabase.rpc('rfq_record_quote_lines', {
    p_rfq_id: rfqId,
    p_quote_ref: ref.trim(),
    p_lines: lines.map((l) => ({ product_id: l.product_id, value: Number(l.value) })),
    p_quote_date: date || null,
  })
}

// rfq_start_price_revision(): a new RFQ on a quoted lead, straight to
// estimation (no technical check), credited to the lead's owner.
export function startPriceRevision(leadId) {
  return supabase.rpc('rfq_start_price_revision', { p_lead_id: leadId })
}

// Both of the Estimation Executive's lists in one read — waiting for
// estimation and with Lixil — since an RFQ moves from one to the other with a
// tap and the screen keeps them as one set of rows. RLS scopes it to the
// desk's own test kind, as for the technical queue.
export function fetchEstimationQueue() {
  return fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select(QUEUE_SELECT, { count: 'exact' })
      .in('status', ['with_estimation', 'with_lixil'])
      .order('raised_at', { ascending: true })
  )
}

// What the Estimation Executive did since `sinceISO`, for their Today strip
// (estimationMonthStats in rfqDesk.js): raised with Lixil, quotes recorded,
// sent back from estimation. Quoted timestamp — see fetchMyTechnicalDecisions.
export function fetchMyEstimationDecisions(employeeId, sinceISO) {
  const since = `"${sinceISO}"`
  return fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select(DECISION_SELECT, { count: 'exact' })
      .or(
        `and(lixil_raised_by.eq.${employeeId},lixil_raised_at.gte.${since}),` +
          `and(quote_received_by.eq.${employeeId},quote_received_at.gte.${since}),` +
          `and(sent_back_by.eq.${employeeId},sent_back_at.gte.${since})`
      )
  )
}

// "Mark quote sent to client" (owner's ruling, 2026-10-06 — RFQ-DESK.md Q9):
// the same two columns Sales progress's Quote sent checkbox writes, stamped
// today. A quote received FROM Lixil is not a quote sent TO the client
// (RFQ-DESK.md §3), so this stays the exec's tap rather than a side effect of
// the desk recording the quote. .select() so an RLS-refused update can't pass
// for a success (CLAUDE.md, "An RLS-rejected UPDATE with no .select() fails
// SILENTLY").
export function markQuoteSentToClient(leadId) {
  return supabase
    .from('leads')
    .update({ quote_sent: true, quote_sent_at: todayISO() })
    .eq('id', leadId)
    .select()
    .single()
}

// ---- Reporting (RFQ-DESK.md Step 6) ----

// The RFQs that count toward the RFQ Raised target, approved inside `range` —
// the database decides which (rfqs.counts_toward_target, set at approval:
// once per lead, Schema/migration_rfq_desk_reporting.sql). Credited to
// raised_by_employee_id and dated by approved_at. RLS: the RFQs on leads the
// viewer can see, plus the ones they (or their team) raised — so an exec's
// own count survives a lead being handed on, as their activities do.
export function fetchCountedRfqs(range) {
  return fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select('id, lead_id, raised_by_employee_id, approved_at', { count: 'exact' })
      .eq('counts_toward_target', true)
      .gte('approved_at', range.start.toISOString())
      .lte('approved_at', range.end.toISOString())
  )
}

// What Needs Attention's client-side path needs to decide "RFQs back with the
// exec" (attention.js; rfqDesk.js's latestDeskRfqByLead picks each lead's
// newest): every desk RFQ the viewer can see that wasn't withdrawn. Only read
// where the leads_needing_attention() RPC isn't used (a manager's Team view,
// My Team's cards, an RPC failure).
export function fetchDeskRfqsForAttention() {
  return fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select('id, lead_id, status, raised_at, sent_back_at, quote_received_at', { count: 'exact' })
      .neq('status', 'withdrawn')
  )
}

// ---- Today's RFQ line ----

// The alerts this line lists. Two reach the people who raise RFQs: sent back
// (by either desk step) and quote ready — each to the exec the RFQ is
// credited to AND whoever logged it, if different (a coordinator). The third,
// rfq_bounced, reaches whoever APPROVED an RFQ that estimation then sent back
// (the Production Executive, or the owner covering) — RFQ-DESK.md §7's "line
// listing RFQs bounced at estimation after Harjot approved them" (Step 4).
// rfqs_after_write() in SQL decides who gets which. rfq_new / rfq_approved are
// not listed: the desk's own queue IS that signal.
export const RFQ_UPDATE_KINDS = ['rfq_sent_back', 'rfq_quote_ready', 'rfq_bounced']

// How many the Today line lists at once, like ASSIGNED_CARD_LIMIT.
export const RFQ_UPDATES_LIMIT = 20

// Own rows only under RLS. The rfqs embed carries the note / quote the line
// shows; it comes back null if the viewer can no longer see the lead (handed
// on since), and the line then names it without detail rather than dropping a
// real alert.
export async function fetchUnseenRfqUpdates(employeeId) {
  if (!employeeId) return { data: [], error: null }
  return supabase
    .from('notifications')
    .select(
      'id, kind, lead_id, rfq_id, created_at, actor:employees!actor_employee_id(name), ' +
        'rfqs(id, kind, revision, status, sent_back_from, send_back_note, quote_value, quote_ref, quote_date), ' +
        'leads(id, current_stage, parties!party_id(name), sites(nickname, locality, house_no))'
    )
    .in('kind', RFQ_UPDATE_KINDS)
    .is('seen_at', null)
    .order('created_at', { ascending: false })
    .limit(RFQ_UPDATES_LIMIT)
}

// ---- The owner's RFQ Desk (RFQ-DESK.md Step 7) ----

// The live half: every RFQ waiting at a desk step, plus every sent-back one
// (rfqDeskReport.js's waitingOnExec picks those still unanswered). A sent-back
// RFQ is answered once its lead has a newer, non-withdrawn RFQ, which may by
// now be quoted and so not in this read — `later` fetches the other RFQs on
// those leads (id, lead, status, raised_at only), in 300-id chunks. Owner
// only; RLS hands them every RFQ on a lead they can see.
export async function fetchRfqDeskLive() {
  const main = await fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select(QUEUE_SELECT, { count: 'exact' })
      .in('status', ['with_technical', 'with_estimation', 'with_lixil', 'sent_back'])
      .order('raised_at', { ascending: true })
  )
  if (main.error) return { data: null, error: main.error }
  const rows = main.data ?? []
  const leadIds = [...new Set(rows.filter((r) => r.status === 'sent_back').map((r) => r.lead_id))]
  const later = []
  for (let i = 0; i < leadIds.length; i += 300) {
    const ids = leadIds.slice(i, i + 300)
    const res = await fetchAllRows(() =>
      supabase
        .from('rfqs')
        .select('id, lead_id, status, raised_at', { count: 'exact' })
        .in('lead_id', ids)
        .neq('status', 'withdrawn')
    )
    if (res.error) return { data: null, error: res.error }
    later.push(...(res.data ?? []))
  }
  return { data: { rows, later }, error: null }
}

// The figures half: every RFQ with a step that happened inside `range` —
// raised, approved, sent back, raised with Lixil or quoted — which is every row
// any figure on the page counts (rfqDeskReport.js). Timestamps quoted, as in
// fetchMyTechnicalDecisions.
export function fetchRfqDeskPeriod(range) {
  const from = `"${range.start.toISOString()}"`
  const to = `"${range.end.toISOString()}"`
  const clause = (col) => `and(${col}.gte.${from},${col}.lte.${to})`
  return fetchAllRows(() =>
    supabase
      .from('rfqs')
      .select(DECISION_SELECT, { count: 'exact' })
      .or(['raised_at', 'approved_at', 'sent_back_at', 'lixil_raised_at', 'quote_received_at'].map(clause).join(','))
  )
}
