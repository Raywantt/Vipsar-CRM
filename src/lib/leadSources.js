// The data behind the "New leads by source" popup (buildSourcePanel in
// drilldownBuilders.js → SourcesBody in DrilldownPanel.jsx). Pure: nothing here
// fetches, and nothing here is React — it shapes `breakdownLeads`, already on
// the Dashboard, into one record per lead and then into the views the popup's
// filters ask for.
//
// MEMBERSHIP of a period is EXACTLY the card's own rule: a lead created inside
// the range (`created_at`, parsed with parseTimestamp because the column is a
// naive UTC TIMESTAMP — fetchNewLeadsBySource compares it to the range's UTC
// instants server-side), pool leads left out, and only the sources the card
// itself shows (an exec sees Scanning and Walk-in; see SALES_EXEC_SOURCES). So
// the popup's total cannot disagree with the card that opened it — a test pins
// that. The previous period is the same rule over the previous range, read from
// the same array, so the popup needs no fetch of its own.
//
// WHAT BECAME OF A LEAD is its CURRENT status, not a history: the cohort that
// arrived in this period, and where each of them stands today. A lead that
// arrived yesterday has had no time to be won, so a win rate over a fresh cohort
// reads low for arithmetic alone — which is why the all-time win rate (the figure
// the old popup showed) stays beside it as the steadier comparison, and why the
// "Won so far" tile carries no ▲/▼ against a previous cohort that has simply had
// longer to convert.
//
// IMPORT DATES. 843 of the 964 spreadsheet-imported leads carry the sheet's own
// arrival date, stored at 00:00:00 — those are real. The other 121 were stamped
// with the moment the sheet was loaded (3 Sep, 18 Sep…), so a month's "new
// leads" reads as two giant spikes that say when a file was imported, not when
// leads arrived. They still COUNT — the card counts them, and this popup must
// total to the same figure — but each is tagged, a footnote says how many, and a
// switch (filters.noImports) leaves them out. Whether to exclude them from the
// figure itself is the owner's decision, not this file's.
import { leadDisplayName } from './leadName'
import { parseTimestamp } from './dbTime'
import { getInitials } from './initials'
import { isImportedLead } from './attention'
import { SOURCE_TYPE_LABELS } from './sourceTypeOptions'
import { TERRITORY_OPTIONS, territoryLabel } from './territoryOptions'
import { stageLabel } from './leadStageOptions'
import { stageChipClass } from './statusColors'
import { formatCurrencyCompact } from './format'
import { changeVs } from './periodChange'
import { dealValueFor, dealValueOrNull } from './pipelineValue'
import { leadProductIds, productsById } from './productShares'
import { NONE } from './bookedOrders'

const money = (n) => formatCurrencyCompact(Math.round(n))
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
const barWidth = (value, max) => `${max > 0 ? Math.round((value / max) * 100) : 0}%`

// ---------- colours ----------
// One hue per source, by SOURCE (never by its row in whatever list is on screen),
// so Scanning is the same colour on the card's donut, the chart, the legend and
// every row, whether or not a filter or a role hides the others. The five are the
// first five slots of the data-viz palette, validated for adjacent colour-blind
// separation in both themes — the old teal/slate/purple/olive/grey set failed it
// (two adjacent pairs under ΔE 8). Defined once as --vip-src-1…5 in the theme,
// which flips them for dark mode.
export const SOURCE_COLORS = {
  scanning: 'var(--vip-src-1)',
  lixil: 'var(--vip-src-2)',
  referral_other: 'var(--vip-src-3)',
  referral_architect: 'var(--vip-src-4)',
  showroom_walkin: 'var(--vip-src-5)',
}
export const sourceColor = (value) => SOURCE_COLORS[value] ?? 'var(--vip-status-neutral)'

// ---------- status: where a lead stands now ----------
// Five buckets that partition every lead. "Quoted" is an OPEN lead the client has
// been (or is being) quoted: a quote marked sent, or the two stages that mean one
// (Quote Submission, Negotiation). On hold is paused, not closed, so it is its
// own bucket rather than hidden inside Open.
export const STATUSES = [
  { key: 'open', label: 'Open', color: 'var(--vip-navy)' },
  { key: 'quoted', label: 'Quoted', color: 'var(--vip-status-warn)' },
  { key: 'won', label: 'Won', color: 'var(--vip-won)' },
  { key: 'lost', label: 'Lost', color: 'var(--vip-lost)' },
  { key: 'hold', label: 'On hold', color: 'var(--vip-status-neutral)' },
]
const QUOTED_STAGES = ['quote_submission', 'negotiation']

export function leadStatus(lead) {
  const stage = lead.current_stage ?? 'calling'
  if (stage === 'won') return 'won'
  if (stage === 'lost') return 'lost'
  if (stage === 'on_hold') return 'hold'
  return lead.quote_sent === true || QUOTED_STAGES.includes(stage) ? 'quoted' : 'open'
}

// Stamped at 00:00:00 = the imported sheet's own date; anything else on an
// imported lead is the moment the sheet was loaded. Read off the raw string,
// before any timezone parse can move it.
const MIDNIGHT = /T00:00:00(?:\.0+)?(?:Z|\+00:00)?$/
export function hasImportDate(lead) {
  return isImportedLead(lead) && !MIDNIGHT.test(String(lead.created_at ?? ''))
}

// ---------- records ----------

// One record per lead the card could count: a created_at, and a source the viewer
// is shown. `employees` and `products` are lookups for names only.
export function leadRecords({ breakdownLeads, sourceOptions, employees = [], products = [] }) {
  const allowed = new Set(sourceOptions.map((o) => o.value))
  const productById = productsById(products)
  const employeeById = new Map(employees.map((e) => [e.id, e]))

  return breakdownLeads
    .filter((l) => l.created_at && allowed.has(l.source_type))
    .map((l) => {
      const ownerId = l.owner_employee_id ?? null
      const stage = l.current_stage ?? 'calling'
      const status = leadStatus(l)
      const worth = dealValueOrNull(l)
      return {
        leadId: l.id,
        at: parseTimestamp(l.created_at),
        source: l.source_type,
        status,
        stage,
        ownerId,
        ownerName: l.employees?.name ?? employeeById.get(ownerId)?.name ?? 'Unassigned',
        name: leadDisplayName(l),
        territory: l.office_territory ?? null,
        // Names, not ids — what a chip, a row and a filter all read.
        products: leadProductIds(l).map((id) => productById.get(Number(id))?.name ?? productById.get(id)?.name ?? `Product #${id}`),
        bdmId: l.bdm_employee_id ?? null,
        importDate: hasImportDate(l),
        value: worth,
        // For sums: an open lead is worth its quote, a won one its order.
        worth: dealValueFor(l),
        orderValue: status === 'won' ? Number(l.order_value ?? 0) : 0,
      }
    })
}

export function leadsIn(records, range) {
  return records.filter((r) => r.at >= range.start && r.at <= range.end)
}

// ---------- filters ----------

// Every value a string, so a <select> (which only ever returns strings) and a chip
// compare the same way — numeric owner ids silently matched nothing on the
// pipeline popup until a live run caught it.
const DIMENSIONS = {
  owner: (r) => String(r.ownerId),
  source: (r) => r.source,
  office: (r) => r.territory ?? NONE,
  status: (r) => r.status,
  // Several per lead: a lead matches the Product filter if it holds that product.
  product: (r) => (r.products.length ? r.products : [NONE]),
}

// `skip` lets a breakdown ignore its OWN dimension (or several), so picking
// Scanning doesn't collapse "By source" to one bar and picking an exec doesn't
// collapse "By exec" to one row — the section that was meant to compare would
// stop comparing. 'imports' skips the leave-them-out switch.
export function matches(record, filters, skip = []) {
  const skipped = Array.isArray(skip) ? skip : [skip]
  if (filters.noImports && record.importDate && !skipped.includes('imports')) return false
  return Object.keys(DIMENSIONS).every((k) => {
    if (skipped.includes(k) || !filters[k]) return true
    const got = DIMENSIONS[k](record)
    return Array.isArray(got) ? got.includes(filters[k]) : got === filters[k]
  })
}

// What the popup offers to filter by. Options come from the UNFILTERED leads of
// the period, so choosing one never shrinks the others; a facet with a single
// choice comes back empty, because a one-option control asks the reader to make a
// decision that isn't one. `roster` lets an exec with no new leads still be
// picked.
export function leadFacets(leads, { sourceOptions, roster = [] }) {
  const owners = new Map()
  roster.forEach((e) => owners.set(String(e.id), { key: String(e.id), id: e.id, name: e.name, count: 0 }))
  leads.forEach((r) => {
    const key = String(r.ownerId)
    if (!owners.has(key)) owners.set(key, { key, id: r.ownerId, name: r.ownerName, count: 0 })
    owners.get(key).count += 1
  })

  const sources = sourceOptions.filter((s) => leads.some((r) => r.source === s.value)).map((s) => ({ key: s.value, label: s.label }))

  const offices = TERRITORY_OPTIONS.filter((t) => leads.some((r) => r.territory === t.value)).map((t) => ({ key: t.value, label: t.label }))
  if (leads.some((r) => r.territory == null)) offices.push({ key: NONE, label: 'Not set' })

  const statuses = STATUSES.filter((s) => leads.some((r) => r.status === s.key)).map((s) => ({ key: s.key, label: s.label }))

  const productCounts = new Map()
  leads.forEach((r) => (r.products.length ? r.products : [NONE]).forEach((k) => productCounts.set(k, (productCounts.get(k) ?? 0) + 1)))
  const products = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([key]) => ({ key, label: key === NONE ? 'Not specified' : key }))

  const ownerList = [...owners.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return {
    owners: ownerList.length > 1 ? ownerList : [],
    sources: sources.length > 1 ? sources : [],
    offices: offices.length > 1 ? offices : [],
    statuses: statuses.length > 1 ? statuses : [],
    products: products.length > 1 ? products : [],
    total: leads.length,
    // Whether the leave-them-out switch has anything to offer for this period.
    imported: leads.filter((r) => r.importDate).length,
  }
}

// ---------- time buckets ----------

const DAY_MS = 86400000
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const mondayFirstIndex = (d) => (d.getDay() + 6) % 7

// A day per bar up to a month, a week per bar to ~6 months, a month per bar past
// that — so a quarter reads as 13 bars rather than 92 slivers.
function bucketUnit(range) {
  const days = Math.round((startOfDay(range.end) - startOfDay(range.start)) / DAY_MS) + 1
  return days <= 31 ? 'day' : days <= 190 ? 'week' : 'month'
}

function bucketStart(date, unit) {
  const day = startOfDay(date)
  if (unit === 'day') return day
  if (unit === 'week') return new Date(day.getFullYear(), day.getMonth(), day.getDate() - mondayFirstIndex(day))
  return new Date(day.getFullYear(), day.getMonth(), 1)
}

function nextBucket(start, unit) {
  if (unit === 'day') return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
  if (unit === 'week') return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
  return new Date(start.getFullYear(), start.getMonth() + 1, 1)
}

const fmtDay = (d, opts) => d.toLocaleDateString('en-IN', opts)

function bucketLabels(start, unit) {
  if (unit === 'day') {
    return { tip: fmtDay(start, { weekday: 'short', day: 'numeric', month: 'short' }), edge: fmtDay(start, { day: 'numeric', month: 'short' }) }
  }
  if (unit === 'week') {
    const edge = fmtDay(start, { day: 'numeric', month: 'short' })
    return { tip: `Week of ${edge}`, edge }
  }
  return { tip: fmtDay(start, { month: 'long', year: 'numeric' }), edge: fmtDay(start, { month: 'short', year: '2-digit' }) }
}

// ---------- the view ----------

// Rows of one breakdown: bucket, order by count, a bar against the biggest bucket
// and a share of the scope. `universe` is every bucket the period has, so one the
// current filters empty still shows — at zero — rather than the list reshuffling
// under the reader.
function countRows({ scope, universe, keyOf, labelOf, activeKey, subOf, changeOf, colorOf }) {
  const buckets = new Map(universe.map((k) => [k, { key: k, label: labelOf(k), items: [] }]))
  scope.forEach((r) => {
    const k = keyOf(r)
    if (!buckets.has(k)) buckets.set(k, { key: k, label: labelOf(k), items: [] })
    buckets.get(k).items.push(r)
  })
  const rows = [...buckets.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label))
  const max = Math.max(0, ...rows.map((r) => r.items.length))
  const total = scope.length
  return rows.map((b) => ({
    key: b.key,
    label: b.label,
    value: String(b.items.length),
    count: b.items.length,
    pct: barWidth(b.items.length, max),
    sub: b.items.length ? subOf(b.items, total) : 'none',
    change: changeOf ? changeOf(b.key, b.items.length) : null,
    color: colorOf ? colorOf(b.key) : null,
    active: b.key === activeKey,
  }))
}

const sub = (parts) => parts.filter(Boolean).join(' · ')
const wonOf = (items) => items.filter((r) => r.status === 'won').length

// `leads` the period's records, `previousLeads` the previous period's (null =
// not comparable), `allTime` every record (for the all-time win rate).
export function computeSourceView({ leads, previousLeads, allTime, sourceOptions, roster = [], filters, sort = 'latest', range, previousLabel }) {
  const selected = leads.filter((r) => matches(r, filters))
  const prevSelected = previousLeads ? previousLeads.filter((r) => matches(r, filters)) : null
  const note = (current, previous) => changeVs(current, previous, previousLabel)?.text

  // ---- the days ----
  const unit = bucketUnit(range)
  const now = new Date()
  const first = bucketStart(range.start, unit)
  const byBucket = new Map()
  selected.forEach((r) => {
    const k = bucketStart(r.at, unit).getTime()
    if (!byBucket.has(k)) byBucket.set(k, [])
    byBucket.get(k).push(r)
  })
  const buckets = []
  for (let s = first; s <= range.end && s <= now; s = nextBucket(s, unit)) {
    const items = byBucket.get(s.getTime()) ?? []
    const labels = bucketLabels(s, unit)
    buckets.push({ key: s.getTime(), start: s, items, ...labels })
  }
  const peak = Math.max(0, ...buckets.map((b) => b.items.length))
  const bars = buckets.map((b) => {
    const parts = sourceOptions
      .map((o) => ({ source: o.value, label: o.label, color: sourceColor(o.value), count: b.items.filter((r) => r.source === o.value).length }))
      .filter((p) => p.count > 0)
    const imported = b.items.filter((r) => r.importDate).length
    return {
      key: b.key,
      total: b.items.length,
      height: barWidth(b.items.length, peak),
      parts,
      imported,
      tip: `${b.tip} · ${b.items.length ? `${b.items.length} new` : 'none'}`,
      label: b.tip,
    }
  })
  const activeBuckets = buckets.filter((b) => b.items.length > 0).length
  const busiest = buckets.reduce((top, b) => (b.items.length > (top?.items.length ?? 0) ? b : top), null)
  const unitWord = unit === 'day' ? 'day' : unit === 'week' ? 'week' : 'month'

  // ---- the strip ----
  const bySourceCount = sourceOptions
    .map((o) => ({ ...o, count: selected.filter((r) => r.source === o.value).length }))
    .sort((a, b) => b.count - a.count)
  const top = bySourceCount[0]?.count > 0 ? bySourceCount[0] : null
  const won = selected.filter((r) => r.status === 'won')
  const wonValue = won.reduce((s, r) => s + r.orderValue, 0)
  const busiestImports = busiest ? busiest.items.filter((r) => r.importDate).length : 0

  const stats = [
    { label: 'New leads', value: String(selected.length), sub: note(selected.length, prevSelected ? prevSelected.length : null) ?? 'this period' },
    { label: 'Top source', value: top ? `${pct(top.count, selected.length)}%` : '—', sub: top ? `${top.label} · ${top.count}` : 'none yet' },
    {
      label: unit === 'day' ? 'Busiest day' : unit === 'week' ? 'Busiest week' : 'Busiest month',
      value: busiest ? String(busiest.items.length) : '—',
      sub: busiest ? `${busiest.edge}${busiestImports * 2 >= busiest.items.length ? ' · mostly imports' : ''}` : 'none yet',
    },
    {
      label: 'Won so far',
      value: String(won.length),
      sub: won.length ? `${money(wonValue)} order value` : 'none won yet',
    },
  ]

  // ---- by source: follows every filter except the source one ----
  const sourceScope = leads.filter((r) => matches(r, filters, 'source'))
  const prevSourceScope = previousLeads ? previousLeads.filter((r) => matches(r, filters, 'source')) : null
  // All-time win rate (won ÷ every lead of that source — the figure the old popup
  // showed). It follows who/where/what is chosen, but not the status filter (it
  // would read 100% under Won), the source one, or the date switch (it has no dates).
  const allTimeScope = allTime.filter((r) => matches(r, filters, ['source', 'status', 'imports']))
  const bySource = countRows({
    scope: sourceScope,
    universe: sourceOptions.map((o) => o.value),
    keyOf: (r) => r.source,
    labelOf: (k) => SOURCE_TYPE_LABELS[k] ?? k,
    activeKey: filters.source,
    colorOf: sourceColor,
    subOf: (items, total) => {
      const every = allTimeScope.filter((r) => r.source === items[0].source)
      return sub([`${pct(items.length, total)}% of new leads`, every.length ? `${pct(wonOf(every), every.length)}% all-time win rate` : null])
    },
    changeOf: (key, count) => (prevSourceScope ? changeVs(count, prevSourceScope.filter((r) => r.source === key).length, previousLabel) : null),
  })

  // ---- what became of them: the cohort, by source, where each stands now ----
  // Ignores the source filter (it is a by-source section) and the status filter
  // (status is what it draws).
  const outcomeScope = leads.filter((r) => matches(r, filters, ['source', 'status']))
  const outcomes = sourceOptions
    .map((o) => {
      const items = outcomeScope.filter((r) => r.source === o.value)
      const counts = Object.fromEntries(STATUSES.map((s) => [s.key, items.filter((r) => r.status === s.key).length]))
      const segments = STATUSES.filter((s) => counts[s.key] > 0).map((s) => ({ key: s.key, label: s.label, color: s.color, count: counts[s.key] }))
      const text = segments.map((x) => `${x.count} ${x.label.toLowerCase()}`).join(' · ')
      const wonSum = items.reduce((s, r) => s + r.orderValue, 0)
      const openSum = items.filter((r) => r.status === 'open' || r.status === 'quoted').reduce((s, r) => s + r.worth, 0)
      return {
        key: o.value,
        label: o.label,
        color: sourceColor(o.value),
        total: items.length,
        segments,
        text: text || 'none',
        aria: `${o.label}: ${text || 'no leads'}`,
        values: sub([wonSum > 0 ? `won ${money(wonSum)}` : null, openSum > 0 ? `open quotes ${money(openSum)}` : null]),
        active: o.value === filters.source,
      }
    })
    .sort((a, b) => b.total - a.total)
  const outcomeTotals = STATUSES.map((s) => ({ key: s.key, label: s.label, color: s.color, count: outcomeScope.filter((r) => r.status === s.key).length }))

  // ---- by exec: follows every filter except the owner one ----
  const execScope = leads.filter((r) => matches(r, filters, 'owner'))
  const prevExecScope = previousLeads ? previousLeads.filter((r) => matches(r, filters, 'owner')) : null
  const execs = new Map(roster.map((e) => [String(e.id), { key: String(e.id), id: e.id, name: e.name, items: [] }]))
  execScope.forEach((r) => {
    const key = String(r.ownerId)
    if (!execs.has(key)) execs.set(key, { key, id: r.ownerId, name: r.ownerName, items: [] })
    execs.get(key).items.push(r)
  })
  const maxExec = Math.max(0, ...[...execs.values()].map((e) => e.items.length))
  // An exec with no new leads is a finding, not noise — they stay, at the bottom.
  const byExec = [...execs.values()]
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name))
    .map((e) => {
      const mix = sourceOptions
        .map((o) => ({ label: o.label, count: e.items.filter((r) => r.source === o.value).length }))
        .filter((m) => m.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 2)
        .map((m) => `${m.count} ${m.label}`)
        .join(' · ')
      const wonCount = wonOf(e.items)
      return {
        key: e.key,
        id: e.id,
        name: e.name,
        initials: getInitials(e.name),
        value: String(e.items.length),
        pct: barWidth(e.items.length, maxExec),
        sub: e.items.length ? sub([mix, wonCount ? `${wonCount} won` : null]) : 'no new leads',
        change: prevExecScope ? changeVs(e.items.length, prevExecScope.filter((r) => String(r.ownerId) === e.key).length, previousLabel) : null,
        selected: e.key === filters.owner,
      }
    })

  // ---- by office ----
  const officeOrder = TERRITORY_OPTIONS.map((t) => t.value)
  const officeUniverse = [...new Set(leads.map((r) => r.territory ?? NONE))].sort(
    (a, b) => (officeOrder.indexOf(a) + 1 || 99) - (officeOrder.indexOf(b) + 1 || 99)
  )
  const byOffice = countRows({
    scope: leads.filter((r) => matches(r, filters, 'office')),
    universe: officeUniverse,
    keyOf: (r) => r.territory ?? NONE,
    labelOf: (k) => (k === NONE ? 'Not set' : territoryLabel(k)),
    activeKey: filters.office,
    subOf: (items, total) => sub([`${pct(items.length, total)}% of new leads`, wonOf(items) ? `${wonOf(items)} won` : null]),
  })

  // ---- by product: a lead counts under EACH of its products ----
  const explode = (list) => list.flatMap((r) => (r.products.length ? r.products : [NONE]).map((p) => ({ ...r, productKey: p })))
  const productScope = leads.filter((r) => matches(r, filters, 'product'))
  const exploded = explode(productScope)
  const productUniverse = [...new Set(explode(leads).map((r) => r.productKey))]
  const byProduct =
    productUniverse.length > 1
      ? countRows({
          scope: exploded,
          universe: productUniverse,
          keyOf: (r) => r.productKey,
          labelOf: (k) => (k === NONE ? 'Not specified' : k),
          activeKey: filters.product,
          subOf: (items) => sub([`${pct(items.length, productScope.length)}% of new leads`, wonOf(items) ? `${wonOf(items)} won` : null]),
        })
      : []
  const multiProduct = productScope.some((r) => r.products.length > 1)

  const viaBdm = selected.filter((r) => r.bdmId != null)

  // ---- the leads themselves ----
  const rows = [...selected]
    .sort((a, b) =>
      sort === 'biggest' ? (b.value ?? -1) - (a.value ?? -1) || b.at - a.at : b.at - a.at || b.leadId - a.leadId
    )
    .map((r) => {
      const sameYear = r.at.getFullYear() === now.getFullYear()
      return {
        leadId: r.leadId,
        name: r.name,
        date: fmtDay(r.at, { day: '2-digit', month: 'short', ...(sameYear ? {} : { year: '2-digit' }) }),
        stage: stageLabel(r.stage),
        chipClass: stageChipClass(r.stage),
        sourceLabel: SOURCE_TYPE_LABELS[r.source] ?? r.source,
        sourceColor: sourceColor(r.source),
        office: r.territory ? territoryLabel(r.territory) : null,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        bdmId: r.bdmId,
        importDate: r.importDate,
        value: r.value != null ? money(r.value) : '—',
        hasValue: r.value != null,
      }
    })

  return {
    total: selected.length,
    stats,
    chart: {
      unit: unitWord,
      bars,
      peak,
      from: buckets[0]?.edge ?? '',
      to: buckets[buckets.length - 1]?.edge ?? '',
      hint: activeBuckets ? `${(selected.length / activeBuckets).toFixed(1)} per active ${unitWord}` : '',
      coverage: buckets.length ? `${activeBuckets} of ${buckets.length} ${unitWord}s had a lead` : '',
      legend: sourceOptions.filter((o) => selected.some((r) => r.source === o.value)).map((o) => ({ key: o.value, label: o.label, color: sourceColor(o.value) })),
    },
    bySource,
    outcomes,
    outcomeTotals,
    byExec,
    byOffice,
    byProduct,
    multiProduct,
    viaBdm: viaBdm.length ? { count: viaBdm.length, share: pct(viaBdm.length, selected.length) } : null,
    rows,
    // Import-dated leads among those the OTHER filters pick — what the switch
    // would drop (or has dropped).
    imported: leads.filter((r) => matches(r, filters, 'imports') && r.importDate).length,
    // The same in the period being compared with — a month set against one that
    // holds a spreadsheet import reads "▼ 82%" for arithmetic alone.
    importedPrevious: previousLeads ? previousLeads.filter((r) => matches(r, filters, 'imports') && r.importDate).length : 0,
  }
}
