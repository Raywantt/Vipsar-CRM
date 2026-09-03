import { stageChipClass } from './statusColors'
import { stageLabel } from './leadStageOptions'
import { formatCurrencyCompact } from './format'
import { getInitials } from './initials'
import { dealValueFor } from './pipelineValue'
import { todayISO } from './followupDates'
import { daysSince } from './dateMath'

const CLOSED_STAGES = ['won', 'lost']

// How many days of inaction before a lead lands in each bucket. Named here
// so they're easy to retune without hunting through the compute logic below.
//
// STALE_DAYS and ATTENTION_DAYS are two different questions, settled with the
// owner 2026-08-10 — they used to be one constant doing both jobs, which is
// why a lead went into the Needs Attention queue on the same day it first got
// called stale:
//
//   STALE_DAYS (7)     — when a lead starts *reading* as neglected. Drives
//                        labels and colour only: LeadsListCard's "Nd silent",
//                        Lead Profile's health pill.
//   ATTENTION_DAYS (14) — when a lead actually *enters the queue*. Drives the
//                        Needs Attention bucket, and therefore the KPI row's
//                        "Stale leads" tile, Today's work queue, My Team's
//                        "Needs attn." count and EmployeeProfile's stale stat,
//                        all of which read computeAttentionBuckets.
//
// A week without contact is worth showing on the lead; it isn't yet worth
// putting on someone's to-do list. Raising the queue threshold to 14 is a
// deliberate reduction in what Needs Attention reports — the counts on every
// surface listed above drop accordingly, and that is the intended effect, not
// a regression. Phase 8's coordinator red flags use ATTENTION_DAYS too, which
// is what retired the separate 10-day figure that spec asked for.
export const STALE_DAYS = 7
export const ATTENTION_DAYS = 14
export const SILENT_QUOTE_DAYS = 5
export const PENDING_RFQ_DAYS = 3

// ---------------------------------------------------------------------------
// The date the legacy sheets were imported. For AN IMPORTED LEAD ONLY (see
// isImportedLead below — this is scoped by provenance, not applied globally),
// nothing dated before it counts as evidence of neglect.
//
// Set 2026-09-03, at the owner's direction, to reset every queue to a blank
// slate after the three legacy imports (431 leads) landed.
//
// THE PROBLEM IT SOLVES. Below, a lead with no logged activity falls back to
// `created_at` as its last-touch proxy. That was harmless while every lead
// was created here. It stopped being harmless once 431 leads arrived from
// sheets carrying real dates back to 2023: the fallback then answers "when
// did our records start?" and reports it as "when was this last touched?".
// Those are different questions, and 306 of those leads have no activity
// history at all — not because nobody worked them, but because the work
// predates this CRM. A blank record is not evidence of neglect.
//
// Measured live 2026-09-03, once created_at was backfilled to the real legacy
// dates (Schema/migration_backfill_legacy_created_at.sql): Needs Attention
// would have gone 165 -> 396 rows overnight, 334 of them stale. Not a queue
// anyone works; a queue people learn to ignore.
//
// WHAT THE RULE IS. One sentence: **on an imported lead, a signal dated
// before HISTORY_STARTS_AT is treated as though it arrived on
// HISTORY_STARTS_AT.** An app-created lead is never touched. Every bucket's own
// threshold then does its normal job from that floor, so all five clear today
// and refill on their own schedule as the floor ages:
//
//     pending RFQ    PENDING_RFQ_DAYS (3)   -> from ~5 Sept
//     silent quotes  SILENT_QUOTE_DAYS (5)  -> from ~7 Sept
//     stale          ATTENTION_DAYS (14)    -> from ~16 Sept
//     slipped / overdue follow-ups          -> see inheritedGraceIsOver()
//
// WHY A CLAMP AND NOT A DELETE. The owner asked to "remove all leads from
// needs attention and start again". Nothing is removed, because there is
// nothing to remove — these buckets are derived on every render, not stored.
// Suppressing the legacy leads permanently, or stamping a fake touch onto
// them, would both have thrown away real signal: 33 quotes genuinely sent
// with no reply since, and 21 RFQs genuinely raised with no quote, are among
// the most actionable leads in the system and could not have been
// reconstructed. Clamping gives the same empty screen today and hands every
// one of them back within days, with its true age intact.
//
// NOTE the ages below are NOT clamped for display — only the threshold test
// is. A lead silent since 2023 still reports "847d silent" when it surfaces
// on 16 Sept; it simply could not surface before then. Clamping the displayed
// age too would have made a two-year-cold lead read as a fortnight old, which
// is the same kind of lie the fallback was already telling.
//
// THIS SELF-EXPIRES. Once every lead has real history recorded here, the
// floor is older than everything and the clamp stops doing anything at all.
// It is safe to leave in place; deleting it later restores the flood.
export const HISTORY_STARTS_AT = '2026-09-02'

const HISTORY_FLOOR_MS = new Date(`${HISTORY_STARTS_AT}T00:00:00`).getTime()

// ---------------------------------------------------------------------------
// THE CLAMP APPLIES ONLY TO IMPORTED LEADS. This is load-bearing and was a
// real bug in the first cut of this rule, caught live before it shipped.
//
// 2026-09-02 is when the legacy sheets were IMPORTED — it is not when this
// CRM started. The app's own 292 leads have genuine history stretching back
// well before it. Applying the floor globally therefore suppressed a real
// signal: lead #320 (MADANLAL LAKHANI, Vishal Kumar) is an app-created lead
// whose follow-up was set for 22 Aug and had genuinely gone overdue, and the
// global floor hid it for a fortnight purely because its date fell before the
// import. That is the precise failure the whole clamp exists to avoid, so it
// is now scoped by provenance rather than by date alone.
//
// `external_reference_id` is the only honest marker of provenance we have:
// Schema/import_{vipul,harish,manohar}_legacy.sql stamp every imported row
// 'legacy-<sheet row>', and nothing in the app ever writes it. It is selected
// by fetchLeadsForBreakdown for this. A lead reaching here without the field
// is treated as app-created — the safe default, since it means "show it".
function isImportedLead(lead) {
  return typeof lead?.external_reference_id === 'string' && lead.external_reference_id.startsWith('legacy-')
}

// The later of `dateLike` and the history floor, in ms. Null in, null out —
// callers already treat an unknown date as "don't judge this lead".
function notBefore(dateLike) {
  if (!dateLike) return null
  const t = new Date(dateLike).getTime()
  if (Number.isNaN(t)) return null
  return t < HISTORY_FLOOR_MS ? HISTORY_FLOOR_MS : t
}

// Age in days used ONLY to decide whether a lead crosses a threshold. Pair it
// with a real, unclamped `daysSince(...)` for anything shown on screen.
// An app-created lead is never clamped — its own dates are the truth.
export function queueAge(dateLike, imported) {
  if (!imported) return daysSince(dateLike)
  const t = notBefore(dateLike)
  return t == null ? null : daysSince(t)
}

// `slipped` and `followupsOverdue` have no day threshold — they fire the
// moment a promised date is in the past — so the clamp above cannot clear
// them (a date re-floored to yesterday is still "before today"). An inherited
// promise instead gets one standard ATTENTION_DAYS runway to be re-confirmed
// before it counts against anyone. Dates set inside this CRM are unaffected
// and still fire immediately, which is the behaviour reps already expect.
function inheritedGraceIsOver() {
  const floorAge = daysSince(HISTORY_FLOOR_MS)
  return floorAge != null && floorAge >= ATTENTION_DAYS
}

function inheritedDatePasses(dateStr, imported) {
  if (!imported) return true
  return dateStr >= HISTORY_STARTS_AT || inheritedGraceIsOver()
}

// The staleness age every *label* surface should gate on — All Leads'
// "Nd silent", EmployeeProfile's touchColor, Lead Profile's health pill.
// They must use the same floor as the queue: a screen shouting "847d silent"
// in red while Needs Attention reports nothing to do is the exact
// contradiction the STALE_DAYS/ATTENTION_DAYS split was made to end.
// `lead` is needed for provenance — see isImportedLead. Callers that hold a
// lead object should pass it; passing nothing means "app-created", i.e. no
// clamp, which is the behaviour every screen had before this rule existed.
export function staleGateDays(lastActivityAt, createdAt, lead = null) {
  return queueAge(lastActivityAt ?? createdAt ?? null, isImportedLead(lead))
}

function isOpen(lead) {
  return !CLOSED_STAGES.includes(lead.current_stage ?? 'calling')
}

function leadValue(lead) {
  return dealValueFor(lead)
}

function partyLabel(lead) {
  return lead.parties?.name ?? lead.sites?.nickname ?? lead.sites?.locality ?? '(no party)'
}

// Shared row shape every bucket below produces — matches what
// DrilldownPanel's `ageing` kind (and NeedsAttentionCard's compact list)
// render, so there's exactly one place that decides what an "attention row"
// looks like.
function toRow(lead, age, lastDescription) {
  return {
    leadId: lead.id,
    party: partyLabel(lead),
    stage: stageLabel(lead.current_stage ?? 'calling'),
    chipClass: stageChipClass(lead.current_stage ?? 'calling'),
    last: lastDescription,
    age,
    value: leadValue(lead),
    ownerId: lead.owner_employee_id ?? null,
    owner: lead.employees?.name ?? 'Unassigned',
  }
}

function sortByAgeDesc(rows) {
  return [...rows].sort((a, b) => (b.age ?? 0) - (a.age ?? 0))
}

// Every field below is a straight read/derivation from `leads` columns
// already on `breakdownLeads` (see fetchLeadsForBreakdown) plus
// `lastActivityByLead` (see fetchLastActivityPerLead) — no inferred/narrative
// content, just the filters the CRM already tracks made visible in one place.
export function computeAttentionBuckets(breakdownLeads, lastActivityByLead) {
  const openLeads = breakdownLeads.filter(isOpen)
  // Today as a plain local YYYY-MM-DD, NOT an instant.
  //
  // next_followup_date and estimated_close_date are DATE columns, and the
  // question they answer is "is this date before today" — a calendar question,
  // not a moment-in-time one. The previous code asked
  // `new Date(lead.next_followup_date).getTime() < Date.now()`, which parses a
  // date-only string as UTC midnight (05:30 IST) and compares it to a real
  // instant. From 05:30 IST onwards that made a follow-up due TODAY test as
  // overdue — so roughly eighteen hours of every working day, the queue told a
  // rep that work due right now was already late. Comparing YYYY-MM-DD strings
  // is chronological, timezone-correct, and cannot drift with the clock.
  // (Phase 9 finding F-P7-1.)
  const today = todayISO()

  const stale = []
  const silentQuotes = []
  const followupsOverdue = []
  const slipped = []
  const pendingRfq = []

  openLeads.forEach((lead) => {
    // Each bucket below gates on a floored age (queueAge) but reports the
    // real one — see HISTORY_STARTS_AT for why the two differ.
    const imported = isImportedLead(lead)
    const lastActivityAt = lastActivityByLead.get(lead.id) ?? null
    const sinceTouch = lastActivityAt ?? lead.created_at
    const touchAge = daysSince(sinceTouch)
    const touchGate = queueAge(sinceTouch, imported)
    if (touchGate != null && touchGate >= ATTENTION_DAYS) {
      stale.push(
        toRow(lead, touchAge, lastActivityAt ? `Last activity ${touchAge}d ago` : `No activity since created, ${touchAge}d ago`)
      )
    }

    if (lead.quote_sent && lead.quote_sent_at) {
      const quoteAge = daysSince(lead.quote_sent_at)
      const quoteGate = queueAge(lead.quote_sent_at, imported)
      const touchedSinceQuote = lastActivityAt && new Date(lastActivityAt) > new Date(lead.quote_sent_at)
      if (quoteGate != null && quoteGate >= SILENT_QUOTE_DAYS && !touchedSinceQuote) {
        silentQuotes.push(toRow(lead, quoteAge, `Quote sent ${quoteAge}d ago, nothing since`))
      }
    }

    if (lead.next_followup_date && lead.next_followup_date < today && inheritedDatePasses(lead.next_followup_date, imported)) {
      const overdueAge = daysSince(lead.next_followup_date)
      followupsOverdue.push(toRow(lead, overdueAge, `Follow-up was due ${overdueAge}d ago`))
    }

    // Same calendar comparison as above. This one was latent rather than
    // visible — the defect is identical, there simply happened to be no lead
    // whose estimated close date was today when it was found.
    if (lead.estimated_close_date && lead.estimated_close_date < today && inheritedDatePasses(lead.estimated_close_date, imported)) {
      const slipAge = daysSince(lead.estimated_close_date)
      slipped.push(toRow(lead, slipAge, `Est. close was ${slipAge}d ago`))
    }

    if (lead.rfq_raised && !lead.quote_sent && lead.rfq_raised_at) {
      const rfqAge = daysSince(lead.rfq_raised_at)
      const rfqGate = queueAge(lead.rfq_raised_at, imported)
      if (rfqGate != null && rfqGate >= PENDING_RFQ_DAYS) {
        pendingRfq.push(toRow(lead, rfqAge, `RFQ raised ${rfqAge}d ago, no quote yet`))
      }
    }
  })

  const totalValue = (rows) => rows.reduce((s, r) => s + r.value, 0)
  const uniqueOwners = (rows) => new Set(rows.map((r) => r.ownerId)).size
  const avgAge = (rows) => (rows.length ? rows.reduce((s, r) => s + (r.age ?? 0), 0) / rows.length : 0)

  return [
    {
      key: 'stale',
      // Templated off the constant. It was hardcoded '7+ days' while the
      // filter read STALE_DAYS, so retuning the threshold would have left the
      // card confidently stating the old number.
      title: `No activity in ${ATTENTION_DAYS}+ days`,
      sub: `${formatCurrencyCompact(totalValue(stale))} at risk`,
      count: stale.length,
      color: '#b4232a',
      note: `A lead reads as stale after ${STALE_DAYS} days without activity, and lands here once it reaches ${ATTENTION_DAYS}+ days.`,
      listTitle: 'Oldest first',
      listHint: 'no recent activity',
      rows: sortByAgeDesc(stale),
    },
    {
      key: 'silent_quotes',
      title: 'Quotes sent, no response',
      sub: silentQuotes.length ? `Oldest ${Math.max(...silentQuotes.map((r) => r.age))}d` : 'None right now',
      count: silentQuotes.length,
      color: '#7a6413',
      note: 'Quote issued, no activity logged against the lead since.',
      listTitle: 'By days since quote',
      listHint: 'quote sent, nothing since',
      rows: sortByAgeDesc(silentQuotes),
    },
    {
      key: 'followups_overdue',
      title: 'Follow-ups overdue',
      sub: `Across ${uniqueOwners(followupsOverdue)} exec${uniqueOwners(followupsOverdue) === 1 ? '' : 's'}`,
      count: followupsOverdue.length,
      color: '#b4232a',
      note: 'A follow-up date was set on the lead and has passed with nothing logged.',
      listTitle: 'Most overdue first',
      listHint: 'follow-up date passed',
      rows: sortByAgeDesc(followupsOverdue),
    },
    {
      key: 'slipped',
      title: 'Close date slipped',
      sub: `${formatCurrencyCompact(totalValue(slipped))} mis-forecast`,
      count: slipped.length,
      color: '#5a4287',
      note: 'Expected close date has passed without the lead being marked won or lost.',
      listTitle: 'By days past close date',
      listHint: 'estimated close date passed',
      rows: sortByAgeDesc(slipped),
    },
    {
      key: 'pending_rfq',
      title: 'RFQs pending a quote',
      sub: pendingRfq.length ? `Avg wait ${avgAge(pendingRfq).toFixed(1)}d` : 'None right now',
      count: pendingRfq.length,
      color: '#2f5878',
      note: 'RFQ raised on the lead but no quote sent yet.',
      listTitle: 'Longest wait first',
      listHint: 'RFQ raised, no quote yet',
      rows: sortByAgeDesc(pendingRfq),
    },
  ]
}

// A lead can land in more than one bucket at once (stale AND overdue AND
// slipped, say) — summing bucket.count for a total therefore over-counts.
// This dedupes by leadId for any badge that claims to show "how many leads
// need attention", while each bucket's own `count` (rows genuinely specific
// to that reason) stays correct as-is.
export function countDistinctLeads(buckets) {
  return new Set(buckets.flatMap((b) => b.rows.map((r) => r.leadId))).size
}

// Shared "ageing" drill-down shape — used for each Needs Attention bucket
// above and reused as-is by the KPI row's "Stale leads" tile (same bucket,
// same builder, matching how the two surfaces show the same underlying
// data), and by Today's work queue (src/pages/Home.jsx) with `bucket`
// already pre-filtered to just that employee's own leads. No verdict/
// narrative field — just the owner rollup and the row list the compact card
// already summarized. `scopeLabel` names whose leads `bucket` covers in the
// eyebrow — 'Company' (Dashboard's company-wide buckets, the default) vs
// 'You' (Today's personal queue, design_handoff_vipsar_mobile screen 9).
// `viewerEmployeeId` is only used (and only needed) for the 'You' case — it
// becomes the `employee_id` on a "Log call" swipe action's activities
// insert. `queueActions` gates whether AgeingBody renders the swipe
// actions/bulk footer button at all, since bulk-editing leads that aren't
// the viewer's own isn't offered on Dashboard's buckets even when they're
// labeled with the viewer's own name rather than 'Company' (a sales exec's
// Dashboard buckets are already scoped to their own leads by RLS — see
// Dashboard.jsx's `scopeLabel` — but that's a label fix, not a request to
// turn on Home's swipe-action queue there too). Defaults to the old
// `scopeLabel !== 'Company'` rule so Home's own call (scopeLabel: 'You')
// is unaffected; Dashboard passes `queueActions: false` explicitly.
//
// `allowLogCall` splits the two row actions apart, and defaults to
// `queueActions` so every existing caller behaves exactly as before. It
// exists because "Log call" and "Set date" are not the same kind of action:
// Set date creates a real follow_up ASSIGNED TO THE LEAD'S OWNER (see
// DrilldownPanel's handleSaveDate), which is a supervisor nudging their rep,
// while Log call inserts an `activities` row crediting whoever clicked. On a
// sales manager's TEAM queue the first is exactly right and the second would
// credit the manager with a call their rep made — the one thing the owner
// ruled out for that role (2026-09-03: a manager logs only their own work).
export function buildAgeingPanel(
  bucket,
  scopeLabel = 'Company',
  viewerEmployeeId = null,
  queueActions = scopeLabel !== 'Company',
  allowLogCall = queueActions
) {
  const owners = new Map()
  bucket.rows.forEach((row) => {
    const key = row.ownerId ?? 'unassigned'
    if (!owners.has(key)) owners.set(key, { name: row.owner, count: 0, value: 0 })
    const entry = owners.get(key)
    entry.count += 1
    entry.value += row.value
  })
  const ownerRows = [...owners.values()].sort((a, b) => b.count - a.count)
  const maxOwnerCount = Math.max(1, ...ownerRows.map((o) => o.count))
  const ages = bucket.rows.map((r) => r.age ?? 0).sort((a, b) => a - b)
  const totalValue = bucket.rows.reduce((s, r) => s + r.value, 0)

  return {
    kind: 'ageing',
    eyebrow: `${scopeLabel} · ${bucket.title.toLowerCase()}`,
    title: bucket.title,
    value: String(bucket.count),
    note: bucket.note,
    queueActions,
    allowLogCall,
    viewerEmployeeId,
    stats: [
      { label: 'Value involved', value: formatCurrencyCompact(totalValue), sub: `across ${bucket.count} lead${bucket.count === 1 ? '' : 's'}`, color: '#b4232a' },
      { label: 'Oldest', value: ages.length ? `${ages[ages.length - 1]}d` : '—', sub: 'longest waiting', color: '#b4232a' },
      { label: 'Median age', value: ages.length ? `${ages[Math.floor(ages.length / 2)]}d` : '—', sub: 'typical wait', color: '#7a6413' },
      { label: 'Owners involved', value: String(ownerRows.length), sub: 'sales execs', color: '#101617' },
    ],
    ownerTitle: 'Whose leads these are',
    ownerRows: ownerRows.map((o) => ({
      initials: getInitials(o.name),
      name: o.name,
      count: o.count,
      value: formatCurrencyCompact(o.value),
      pct: `${Math.round((o.count / maxOwnerCount) * 100)}%`,
      color: o.count >= 3 ? '#b4232a' : o.count >= 2 ? '#7a6413' : '#9aa5a6',
    })),
    listTitle: bucket.listTitle,
    listHint: bucket.listHint,
    ageRows: bucket.rows.map((r) => ({
      leadId: r.leadId,
      party: r.party,
      stage: r.stage,
      chipClass: r.chipClass,
      last: r.last,
      age: `${r.age}d`,
      value: formatCurrencyCompact(r.value),
      initials: getInitials(r.owner),
      // Dropped here previously even though toRow() computes it — silently
      // starved two consumers: the owner name in this row could never be a
      // real /employees/:id link, and DrilldownPanel's handleSaveDate fell
      // back to `assignee` (the viewer) for every "Set date"/bulk follow-up
      // action, so a follow-up created from this queue was assigned to
      // whoever was looking at the dashboard instead of the lead's actual
      // owner.
      ownerId: r.ownerId,
      owner: r.owner,
    })),
  }
}
