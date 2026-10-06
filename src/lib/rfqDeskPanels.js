// The RFQ popups (owner's ruling, 2026-10-06): every figure on the owner's RFQ
// Desk and on the two desk Todays opens a breakdown of the RFQs behind it —
// its own figures, "By exec" / "By office" / "Where they are now" and the
// list — with Exec, Office, Kind and Step filters. Pure: shapes rows the page
// already fetched into a DrilldownPanel `rfqBreakdown` panel and makes no
// network calls, like drilldownBuilders.js.
//
// One builder, many FOCI: a focus says which RFQs a figure counts (`base`),
// which moment dates them, what its figures are and which breakdowns it shows.
// Every focus counts EXACTLY the rows its figure on the page counts — the base
// rules are rfqDeskReport.js's own (inRange, stepSpan) and the Today strips'
// (technicalMonthStats / estimationMonthStats), so a popup can't total
// differently from the tile that opened it.
//
// Two conventions from the Dashboard's popups:
//   * a breakdown never filters by its own dimension (By exec ignores the
//     Exec filter, By office the Office one, Where they are now the Step one);
//   * the figures at the top ignore the Step filter — it narrows the list. A
//     "Sent back" tile opens on Step = Sent back, and its share is still a
//     share of every RFQ raised, not 100%.
import { parseTimestamp } from './dbTime'
import { formatCurrencyCompact } from './format'
import { territoryLabel } from './territoryOptions'
import { getInitials } from './initials'
import { RFQ_STATUS, quoteSummary, revisionLabel, rfqLeadName, rfqProductsLabel, rfqStatusLabel } from './rfqDesk'
import { inRange, median, shareLabel, slowestTenth, stepSpan, turnaroundLabel, workingMs } from './rfqDeskReport'

const isPriceRevision = (r) => r?.kind === 'price_revision'

export const RFQ_KIND_LABELS = { fresh: 'Fresh', revised: 'Revision', price_revision: 'Price revision' }

// Every status, in the order an RFQ passes them — the Step facet's order.
const STEP_ORDER = [
  RFQ_STATUS.WITH_TECHNICAL,
  RFQ_STATUS.WITH_ESTIMATION,
  RFQ_STATUS.WITH_LIXIL,
  RFQ_STATUS.QUOTED,
  RFQ_STATUS.SENT_BACK,
  RFQ_STATUS.WITHDRAWN,
]

function time(value) {
  const d = parseTimestamp(value)
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : null
}

// "6 Oct" — the day a row is dated by.
function dayLabel(value) {
  const t = time(value)
  return t == null ? '' : new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function firstName(embed) {
  return embed?.name?.trim().split(/\s+/)[0] ?? null
}

// Where an RFQ is now, in words — a sent-back one says by which step.
export function statusWords(r) {
  if (r.status === RFQ_STATUS.SENT_BACK) {
    return r.sent_back_from === 'estimation' ? 'Sent back by estimation' : 'Sent back by the technical check'
  }
  return rfqStatusLabel(r.status)
}

const execKey = (r) => (r.raised_by_employee_id == null ? '' : String(r.raised_by_employee_id))
const officeKey = (r) => r.leads?.office_territory ?? ''
const approverKey = (r) => (r.approved_by == null ? '' : String(r.approved_by))

// ---- The figures each focus can show ---------------------------------------

function technicalDecisionMs(r) {
  const span = stepSpan(r, 'technical')
  return span ? workingMs(span[0], span[1]) : null
}

function lixilMs(r) {
  const span = stepSpan(r, 'lixil')
  return span ? workingMs(span[0], span[1]) : null
}

function timesOf(rows, fn) {
  return rows.map(fn).filter((v) => v != null)
}

function countWhere(rows, pred) {
  return rows.filter(pred).length
}

const isSentBack = (r) => r.status === RFQ_STATUS.SENT_BACK

function statsRaised(rows) {
  const sent = countWhere(rows, isSentBack)
  return [
    { label: 'RFQs', value: String(rows.length), sub: 'raised' },
    {
      label: 'Fresh · revisions',
      value: `${countWhere(rows, (r) => r.kind !== 'revised')} · ${countWhere(rows, (r) => r.kind === 'revised')}`,
      sub: 'by kind',
    },
    { label: 'Sent back', value: String(sent), sub: `${shareLabel(sent, rows.length)} of these` },
    { label: 'Quoted', value: String(countWhere(rows, (r) => r.status === RFQ_STATUS.QUOTED)), sub: 'so far' },
  ]
}

function statsQuotes(rows) {
  const value = rows.reduce((s, r) => s + (Number(r.quote_value) || 0), 0)
  const e2e = timesOf(rows.filter((r) => !isPriceRevision(r)), (r) => {
    const span = stepSpan(r, 'endToEnd')
    return span ? workingMs(span[0], span[1]) : null
  })
  return [
    { label: 'Quotes', value: String(rows.length), sub: 'recorded' },
    { label: 'Quoted value', value: value ? formatCurrencyCompact(value) : '—', sub: 'without GST' },
    { label: 'Typical', value: turnaroundLabel(median(e2e)), sub: 'raised → quote' },
    { label: 'Slowest 1 in 10', value: turnaroundLabel(slowestTenth(e2e)), sub: 'raised → quote' },
  ]
}

function statsPriceRevisions(rows) {
  return [
    { label: 'Started', value: String(rows.length), sub: 'price revisions' },
    { label: 'Quoted', value: String(countWhere(rows, (r) => r.status === RFQ_STATUS.QUOTED)), sub: 'so far' },
    {
      label: 'Still open',
      value: String(countWhere(rows, (r) => r.status === RFQ_STATUS.WITH_ESTIMATION || r.status === RFQ_STATUS.WITH_LIXIL)),
      sub: 'with the desk or Lixil',
    },
    { label: 'Withdrawn', value: String(countWhere(rows, (r) => r.status === RFQ_STATUS.WITHDRAWN)), sub: 'earlier quote stands' },
  ]
}

function statsTimes(rows, msOf, span) {
  const times = timesOf(rows, msOf)
  return [
    { label: 'Typical', value: turnaroundLabel(median(times)), sub: span },
    { label: 'Slowest 1 in 10', value: turnaroundLabel(slowestTenth(times)), sub: span },
    { label: 'Fastest', value: turnaroundLabel(times.length ? Math.min(...times) : null), sub: span },
    { label: 'RFQs', value: String(times.length), sub: 'timed' },
  ]
}

function statsBounced(rows, ctx) {
  return [
    { label: 'Sent back', value: String(rows.length), sub: 'after approval' },
    { label: 'Approved', value: String(ctx.approvedCount ?? 0), sub: 'in the period, all execs' },
    { label: 'Share', value: shareLabel(rows.length, ctx.approvedCount ?? 0), sub: 'of approvals' },
    { label: 'With a note', value: String(countWhere(rows, (r) => r.send_back_note?.trim())), sub: 'saying why' },
  ]
}

function statsDecided(rows) {
  const bounced = countWhere(rows, (r) => r.status === RFQ_STATUS.SENT_BACK && r.sent_back_from === 'estimation')
  return [
    { label: 'Approved', value: String(rows.length), sub: 'by you' },
    { label: 'Sent back later', value: String(bounced), sub: 'by estimation' },
    { label: 'Typical check', value: turnaroundLabel(median(timesOf(rows, technicalDecisionMs))), sub: 'raised → approved' },
    { label: 'Quoted', value: String(countWhere(rows, (r) => r.status === RFQ_STATUS.QUOTED)), sub: 'so far' },
  ]
}

function statsSentBackByMe(rows, msOf, span, by = 'by you') {
  return [
    { label: 'Sent back', value: String(rows.length), sub: by },
    { label: 'With a note', value: String(countWhere(rows, (r) => r.send_back_note?.trim())), sub: 'saying why' },
    { label: 'Typical', value: turnaroundLabel(median(timesOf(rows, msOf))), sub: span },
    { label: 'Fresh · revisions', value: `${countWhere(rows, (r) => r.kind !== 'revised')} · ${countWhere(rows, (r) => r.kind === 'revised')}`, sub: 'by kind' },
  ]
}

function statsLixilRaised(rows) {
  return [
    { label: 'Raised with Lixil', value: String(rows.length), sub: 'by you' },
    { label: 'Quoted', value: String(countWhere(rows, (r) => r.status === RFQ_STATUS.QUOTED)), sub: 'so far' },
    { label: 'Still with Lixil', value: String(countWhere(rows, (r) => r.status === RFQ_STATUS.WITH_LIXIL)), sub: 'waiting' },
    { label: 'Typical Lixil time', value: turnaroundLabel(median(timesOf(rows, lixilMs))), sub: 'of those quoted' },
  ]
}

function estimationDecisionMs(r) {
  const span = stepSpan(r, 'estimation')
  return span ? workingMs(span[0], span[1]) : null
}

// ---- The foci --------------------------------------------------------------

// A turnaround row: the RFQs whose step ended in the period, slowest first.
function turnaroundFocus(key, title, span) {
  const msOf = (r) => {
    const s = stepSpan(r, key)
    return s ? workingMs(s[0], s[1]) : null
  }
  return {
    title,
    base: (rows, ctx) => rows.filter((r) => {
      const s = stepSpan(r, key)
      return s && inRange(s[1], ctx.range)
    }),
    date: (r) => stepSpan(r, key)?.[1],
    msOf,
    stats: (rows) => statsTimes(rows, msOf, span),
    sections: ['exec', 'office', 'kind'],
    sorts: ['slowest', 'latest'],
    meta: (r) => `took ${turnaroundLabel(msOf(r))}`,
    note: `Working time — Sundays don't count; under a day reads in hours. ${span}.`,
  }
}

const FOCI = {
  raised: {
    title: 'RFQs raised',
    base: (rows, ctx) => rows.filter((r) => !isPriceRevision(r) && inRange(r.raised_at, ctx.range)),
    date: (r) => r.raised_at,
    stats: statsRaised,
    sections: ['status', 'exec', 'office'],
    note: 'Every RFQ an exec raised in the period, and where each one is now.',
  },
  quotes: {
    title: 'Quotes received',
    base: (rows, ctx) => rows.filter((r) => inRange(r.quote_received_at, ctx.range)),
    date: (r) => r.quote_received_at,
    stats: statsQuotes,
    sections: ['exec', 'office', 'kind'],
    meta: (r) => quoteSummary({ ...r, status: RFQ_STATUS.QUOTED }) ?? '',
    note: "Lixil's quotes recorded in the period — values without GST.",
  },
  priceRevisions: {
    title: 'Price revisions',
    base: (rows, ctx) => rows.filter((r) => isPriceRevision(r) && inRange(r.raised_at, ctx.range)),
    date: (r) => r.raised_at,
    stats: statsPriceRevisions,
    sections: ['status', 'exec', 'office'],
    note: 'Re-quotes started when Lixil changed its prices. "Exec" is the lead\'s owner.',
  },
  'turnaround:technical': turnaroundFocus('technical', 'Turnaround — technical check', 'raised → approved or sent back'),
  'turnaround:estimation': turnaroundFocus('estimation', 'Turnaround — estimation', 'approved → raised with Lixil or sent back'),
  'turnaround:lixil': turnaroundFocus('lixil', 'Turnaround — with Lixil', 'raised with Lixil → quote recorded'),
  'turnaround:endToEnd': turnaroundFocus('endToEnd', 'Turnaround — end to end', 'RFQ raised → quote recorded'),
  bounced: {
    title: 'Sent back after approval',
    base: (rows, ctx) =>
      rows.filter((r) => r.sent_back_from === 'estimation' && r.approved_at && inRange(r.sent_back_at, ctx.range)),
    date: (r) => r.sent_back_at,
    stats: statsBounced,
    sections: ['approver', 'exec', 'office'],
    note: 'Approved at the technical check, then sent back by estimation.',
  },

  // ---- The Production Executive's own month (their Today strip) ----
  myApproved: {
    title: 'You approved',
    base: (rows, ctx) => rows.filter((r) => r.approved_by === ctx.employeeId && inRange(r.approved_at, ctx.range)),
    date: (r) => r.approved_at,
    stats: statsDecided,
    sections: ['status', 'exec', 'office'],
    note: 'RFQs you approved this month, and where each one is now.',
  },
  mySentBack: {
    title: 'You sent back',
    base: (rows, ctx) =>
      rows.filter((r) => r.sent_back_by === ctx.employeeId && r.sent_back_from === 'technical' && inRange(r.sent_back_at, ctx.range)),
    date: (r) => r.sent_back_at,
    stats: (rows) => statsSentBackByMe(rows, technicalDecisionMs, 'raised → sent back'),
    sections: ['exec', 'office', 'kind'],
    note: 'RFQs you sent back to the exec this month.',
  },
  myBounced: {
    title: 'Sent back later, by estimation',
    base: (rows, ctx) =>
      rows.filter((r) => r.approved_by === ctx.employeeId && r.sent_back_from === 'estimation' && inRange(r.sent_back_at, ctx.range)),
    date: (r) => r.sent_back_at,
    stats: (rows) => statsSentBackByMe(rows, estimationDecisionMs, 'approved → sent back', 'by estimation'),
    sections: ['exec', 'office', 'kind'],
    note: 'RFQs you approved that estimation then sent back, this month.',
  },
  myCheck: {
    ...turnaroundFocus('technical', 'Your technical checks', 'raised → your decision'),
    base: (rows, ctx) =>
      rows.filter((r) => {
        const decided =
          r.approved_by === ctx.employeeId ? r.approved_at : r.sent_back_by === ctx.employeeId && r.sent_back_from === 'technical' ? r.sent_back_at : null
        return decided && inRange(decided, ctx.range)
      }),
  },

  // ---- The Estimation Executive's own month ----
  myLixilRaised: {
    title: 'You raised with Lixil',
    base: (rows, ctx) => rows.filter((r) => r.lixil_raised_by === ctx.employeeId && inRange(r.lixil_raised_at, ctx.range)),
    date: (r) => r.lixil_raised_at,
    stats: statsLixilRaised,
    sections: ['status', 'exec', 'office'],
    note: 'RFQs you raised with Lixil this month, and where each one is now.',
  },
  myQuotes: {
    title: 'Quotes you recorded',
    base: (rows, ctx) => rows.filter((r) => r.quote_received_by === ctx.employeeId && inRange(r.quote_received_at, ctx.range)),
    date: (r) => r.quote_received_at,
    stats: statsQuotes,
    sections: ['exec', 'office', 'kind'],
    meta: (r) => quoteSummary({ ...r, status: RFQ_STATUS.QUOTED }) ?? '',
    note: "Lixil's quotes you recorded this month — values without GST.",
  },
  myEstSentBack: {
    title: 'You sent back',
    base: (rows, ctx) =>
      rows.filter((r) => r.sent_back_by === ctx.employeeId && r.sent_back_from === 'estimation' && inRange(r.sent_back_at, ctx.range)),
    date: (r) => r.sent_back_at,
    stats: (rows) => statsSentBackByMe(rows, estimationDecisionMs, 'approved → sent back'),
    sections: ['exec', 'office', 'kind'],
    note: 'RFQs you sent back to the exec this month.',
  },
  myLixilTime: {
    ...turnaroundFocus('lixil', "Lixil's time on your quotes", 'raised with Lixil → quote recorded'),
    base: (rows, ctx) => rows.filter((r) => r.quote_received_by === ctx.employeeId && inRange(r.quote_received_at, ctx.range)),
  },
}

// The strip's "Sent back" and the send-back table: the RFQs raised in the
// period, opened on Step = Sent back by the caller — so the figures still give
// the share of every RFQ raised.
FOCI.sentBack = {
  ...FOCI.raised,
  title: 'Sent back',
  // The headline is the tile's figure (sent back), not the RFQs behind it.
  headline: (base) => String(base.filter(isSentBack).length),
  note: 'The RFQs raised in the period — the list opens on the ones sent back; the figures count them all.',
}

export const RFQ_FOCUS_KEYS = Object.keys(FOCI)

// ---- Facets and breakdowns -------------------------------------------------

function facetOptions(rows, keyOf, labelOf, order = null) {
  const counts = new Map()
  for (const r of rows) {
    const k = keyOf(r)
    if (!k) continue
    if (!counts.has(k)) counts.set(k, { key: k, label: labelOf(r, k), count: 0 })
    counts.get(k).count++
  }
  const list = [...counts.values()]
  if (order) return list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

const execName = (r) => r.raised_by?.name?.trim() || 'Unknown'
const officeName = (r, k) => territoryLabel(k)
const kindName = (r, k) => RFQ_KIND_LABELS[k] ?? k
const stepName = (r, k) => rfqStatusLabel(k)
const approverName = (r) => r.approver?.name?.trim() || 'Unknown'

const SECTION_DEFS = {
  exec: { title: 'By exec', keyOf: execKey, labelOf: execName, ignores: 'exec', person: true },
  office: { title: 'By office', keyOf: officeKey, labelOf: officeName, ignores: 'office' },
  kind: { title: 'By kind', keyOf: (r) => r.kind, labelOf: kindName, ignores: 'kind' },
  status: { title: 'Where they are now', keyOf: (r) => r.status, labelOf: stepName, ignores: 'step', order: STEP_ORDER },
  approver: { title: 'Approved by', keyOf: approverKey, labelOf: approverName, ignores: null, person: true },
}

function matches(r, filters, skip) {
  if (skip !== 'exec' && filters.exec && execKey(r) !== filters.exec) return false
  if (skip !== 'office' && filters.office && officeKey(r) !== filters.office) return false
  if (skip !== 'kind' && filters.kind && r.kind !== filters.kind) return false
  if (skip !== 'step' && filters.step && r.status !== filters.step) return false
  return true
}

function breakdown(def, rows, filters, msOf) {
  const scoped = rows.filter((r) => matches(r, filters, def.ignores))
  const groups = facetOptions(scoped, def.keyOf, def.labelOf, def.order)
  if (groups.length < 2) return null
  const max = Math.max(...groups.map((g) => g.count))
  const active = def.ignores ? filters[def.ignores] : ''
  return {
    key: def.title,
    title: def.title,
    rows: groups.map((g) => {
      const members = scoped.filter((r) => def.keyOf(r) === g.key)
      const sub = msOf
        ? `typical ${turnaroundLabel(median(timesOf(members, msOf)))}`
        : `${shareLabel(g.count, scoped.length)} of ${scoped.length}`
      return {
        key: g.key,
        label: g.label,
        initials: def.person ? getInitials(g.label) : null,
        id: def.person ? Number(g.key) || null : null,
        value: String(g.count),
        sub,
        pct: `${Math.round((g.count / max) * 100)}%`,
        active: Boolean(active) && active === g.key,
      }
    }),
  }
}

// ---- The panel -------------------------------------------------------------

const SORT_LABELS = { latest: 'Latest', oldest: 'Oldest', slowest: 'Slowest' }

// `focus` — a key of FOCI. `rows` — every RFQ the page holds for the period
// (fetchRfqDeskPeriod, or the desk's own decisions read). `ctx` — { range,
// rangeLabel, employeeId, approvedCount, productMap — useProductMap's, which
// names the RFQ's products }. `initial` — filters to open on
// ({ exec, office, kind, step }, string keys). `eyebrow` — what the page calls
// the period ("October 2026", "This month").
export function buildRfqPanel({ focus, rows, ctx, initial = {}, eyebrow }) {
  const f = FOCI[focus]
  if (!f) return null
  const base = f.base(rows ?? [], ctx)
  const sorts = f.sorts ?? ['latest', 'oldest']
  const filters = {
    execs: facetOptions(base, execKey, execName).map((o) => ({ ...o, name: o.label })),
    offices: facetOptions(base, officeKey, officeName),
    kinds: facetOptions(base, (r) => r.kind, kindName, ['fresh', 'revised', 'price_revision']),
    steps: facetOptions(base, (r) => r.status, stepName, STEP_ORDER),
    total: base.length,
  }
  const headerValue = f.headline
    ? f.headline(base)
    : f.msOf
      ? turnaroundLabel(median(timesOf(base, f.msOf)))
      : String(base.length)

  function viewFor(chosen, sort) {
    const filtersNow = { exec: chosen.exec ?? '', office: chosen.office ?? '', kind: chosen.kind ?? '', step: chosen.step ?? '' }
    const statRows = base.filter((r) => matches(r, filtersNow, 'step'))
    const listRows = base.filter((r) => matches(r, filtersNow, null))
    const ordered = [...listRows].sort((a, b) => {
      if (sort === 'slowest' && f.msOf) return (f.msOf(b) ?? 0) - (f.msOf(a) ?? 0)
      // Ties (RFQs logged in one go share a timestamp) by id, so the order
      // never shuffles between renders.
      const d = (time(f.date(b)) ?? 0) - (time(f.date(a)) ?? 0) || b.id - a.id
      return sort === 'oldest' ? -d : d
    })
    return {
      total: listRows.length,
      stats: f.stats(statRows, ctx),
      sections: f.sections.map((k) => breakdown(SECTION_DEFS[k], base, filtersNow, f.msOf)).filter(Boolean),
      rows: ordered.map((r) => ({
        id: r.id,
        leadId: r.lead_id,
        // The desk reads only the leads in its own process: a lead it can't
        // read comes back without its embed, and is named, not linked.
        linkable: Boolean(r.leads),
        name: rfqLeadName(r),
        rev: revisionLabel(r),
        execId: r.raised_by_employee_id,
        execName: r.raised_by?.name ?? null,
        office: r.leads?.office_territory ? territoryLabel(r.leads.office_territory) : null,
        when: dayLabel(f.date(r)),
        status: statusWords(r),
        meta: f.meta
          ? f.meta(r)
          : [r.window_count ? `${r.window_count} windows` : null, rfqProductsLabel(r, ctx.productMap)].filter(Boolean).join(' · '),
        approver: focus === 'bounced' ? firstName(r.approver) : null,
        note: r.status === RFQ_STATUS.SENT_BACK ? r.send_back_note?.trim() || null : null,
      })),
    }
  }

  return {
    kind: 'rfqBreakdown',
    eyebrow,
    title: f.title,
    value: headerValue,
    note: `${ctx.rangeLabel ? `${ctx.rangeLabel[0].toUpperCase()}${ctx.rangeLabel.slice(1)}. ` : ''}${f.note}`,
    filters,
    initial: { exec: initial.exec ?? '', office: initial.office ?? '', kind: initial.kind ?? '', step: initial.step ?? '' },
    sorts: sorts.map((k) => ({ key: k, label: SORT_LABELS[k] })),
    viewFor,
  }
}
