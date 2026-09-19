// The data behind the "Orders booked" popup (buildBookedPanel in
// drilldownBuilders.js → BookedBody in DrilldownPanel.jsx). Pure: nothing here
// fetches, and nothing here is React — it shapes `wonStageHistory` and
// `breakdownLeads`, both already on the Dashboard, into closed deals and then
// into the views the popup's filters ask for.
//
// A "deal" is a lead's most recent 'won' stage_history row, joined to that
// lead's own row for the facts stage_history does not carry (its name, source,
// office, product). Membership of a period uses EXACTLY the rule
// computeOrderValueActuals uses — latest won row per lead, `new Date(changed_at)`
// inside the range — so the popup's total cannot disagree with the KPI tile or
// the heatmap cell that opened it. Two figures on one screen that differ is the
// most valuable bug signal there is; don't give it the chance.
//
// WHO CLOSED is the lead's CURRENT owner, the same attribution every other
// booked figure here uses. It is not "whoever pressed Won": an owner or a
// manager can mark a rep's lead won, and crediting them would put this popup
// out of step with the target it is meant to explain.
import { leadDisplayName } from './leadName'
import { parseTimestamp } from './dbTime'
import { getInitials } from './initials'
import { isImportedLead } from './attention'
import { SOURCE_TYPE_OPTIONS, SOURCE_TYPE_LABELS } from './sourceTypeOptions'
import { TERRITORY_OPTIONS, territoryLabel } from './territoryOptions'
import { formatCurrencyCompact } from './format'
import { changeVs } from './periodChange'

const LAKH = 100000

// formatCurrencyCompact prints anything under ₹1L as the raw number, so an average
// of ₹69,934.667 reaches the screen with its decimals. Every figure here goes
// through this instead.
const money = (n) => formatCurrencyCompact(Math.round(n))

// The facet key for "this deal has no value for that column". One constant, so
// a chip, a filter test and a breakdown row can't each spell it their own way.
export const NONE = 'none'

// Closed edges, not quantiles: a chip that reads "₹5–10L" has to mean the same
// thing next month. Picked against the real deal sizes (89 won leads, median
// ₹10.6L, p10 ₹1L, p90 ₹31L) — each band holds 16–29 of them, none is empty.
// A band with no deal in the period isn't offered (see bookedFacets).
export const DEAL_SIZE_BANDS = [
  { key: 'lt5', label: 'Under ₹5L', from: 0, to: 5 * LAKH },
  { key: '5to10', label: '₹5–10L', from: 5 * LAKH, to: 10 * LAKH },
  { key: '10to20', label: '₹10–20L', from: 10 * LAKH, to: 20 * LAKH },
  { key: '20plus', label: '₹20L+', from: 20 * LAKH, to: Infinity },
]

// A won lead with no order value is not a ₹0 deal — it is an unknown one, so it
// belongs to no band (and a size chip therefore never matches it).
export function dealSizeBand(value) {
  if (!(value > 0)) return null
  return DEAL_SIZE_BANDS.find((b) => value >= b.from && value < b.to)?.key ?? null
}

// Rows the legacy imports stamped EXACTLY 12:00:00 UTC between 1 and 6 Sep 2026
// carry the IMPORT day, not the day the order was won (8 "wins" worth ₹1.01 Cr
// on one sheet). They still count — the KPI tile and the heatmap count them, and
// this popup must total to the same figure — but they are tagged rather than
// passed off as real dates. Scoped by provenance as well as by stamp, so an
// app-created lead that happens to be won at noon on the 3rd is never tagged.
const IMPORT_STAMP = /^2026-09-0[1-6]T12:00:00(?:\.0+)?(?:Z|\+00:00)?$/

function formatDealDate(raw) {
  const d = parseTimestamp(raw)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', ...(sameYear ? {} : { year: '2-digit' }) })
}

// One deal per lead — its most recent 'won' row. `wonStageHistory` arrives
// newest-first, so the first row seen per lead is that one; a row whose embedded
// `leads` is null is one RLS hid, and is skipped. Not filtered by period: the
// caller narrows with dealsIn, which is also how the previous period is had.
export function closedDeals({ wonStageHistory, breakdownLeads, employees = [] }) {
  const leadById = new Map(breakdownLeads.map((l) => [l.id, l]))
  const employeeById = new Map(employees.map((e) => [e.id, e]))
  const latest = new Map()
  wonStageHistory.forEach((row) => {
    if (!row.leads) return
    if (!latest.has(row.lead_id)) latest.set(row.lead_id, row)
  })

  return [...latest.values()].map((row) => {
    const lead = leadById.get(row.lead_id) ?? null
    const ownerId = row.leads.owner_employee_id ?? null
    const value = Number(row.leads.order_value ?? 0)
    const imported = isImportedLead(lead)
    // Membership timestamp — see the header. Deliberately NOT parseTimestamp:
    // computeOrderValueActuals reads it this way, and a different parse would
    // put a deal near a period boundary in one figure and not the other.
    const at = new Date(row.changed_at)

    return {
      leadId: row.lead_id,
      at,
      date: formatDealDate(row.changed_at),
      value,
      hasValue: value > 0,
      band: dealSizeBand(value),
      ownerId,
      ownerName: lead?.employees?.name ?? employeeById.get(ownerId)?.name ?? 'Unassigned',
      name: lead ? leadDisplayName(lead) : `Lead #${row.lead_id}`,
      source: lead?.source_type ?? null,
      territory: lead?.office_territory ?? null,
      product: lead?.products?.name ?? null,
      bdmId: lead?.bdm_employee_id ?? row.leads.bdm_employee_id ?? null,
      importDate: imported && IMPORT_STAMP.test(String(row.changed_at)),
    }
  })
}

export function dealsIn(deals, range) {
  return deals.filter((d) => d.at >= range.start && d.at <= range.end)
}

// ---------- filters ----------

// Each filterable column and how a deal answers it. Every value is a string, so
// a <select> (which only ever returns strings) and a chip compare the same way —
// numeric owner ids silently matched nothing on the pipeline popup until a live
// run caught it.
const DIMENSIONS = {
  owner: (d) => String(d.ownerId),
  source: (d) => d.source ?? NONE,
  size: (d) => d.band ?? NONE,
  product: (d) => d.product ?? NONE,
}

// `skip` lets a breakdown ignore its OWN dimension, so picking Scanning doesn't
// collapse "By source" to a single bar and picking an exec doesn't collapse "By
// exec" to a single row — the section that was meant to compare would stop
// comparing.
function matches(deal, filters, skip) {
  return Object.keys(DIMENSIONS).every((k) => k === skip || !filters[k] || DIMENSIONS[k](deal) === filters[k])
}

// What the popup offers to filter by. Options come from the UNFILTERED deals of
// the period, so choosing one never shrinks the others; a facet with a single
// choice comes back empty, because a one-option control asks the reader to make
// a decision that isn't one. `roster` lets an exec with no deals still be
// picked — the heatmap opens this popup on exactly such a person.
export function bookedFacets(deals, roster = []) {
  const owners = new Map()
  roster.forEach((e) => owners.set(String(e.id), { key: String(e.id), id: e.id, name: e.name, count: 0 }))
  deals.forEach((d) => {
    const key = String(d.ownerId)
    if (!owners.has(key)) owners.set(key, { key, id: d.ownerId, name: d.ownerName, count: 0 })
    owners.get(key).count += 1
  })

  const sources = SOURCE_TYPE_OPTIONS.filter((s) => deals.some((d) => d.source === s.value)).map((s) => ({ key: s.value, label: s.label }))
  if (deals.some((d) => d.source == null)) sources.push({ key: NONE, label: 'Not recorded' })

  const sizes = DEAL_SIZE_BANDS.filter((b) => deals.some((d) => d.band === b.key)).map((b) => ({ key: b.key, label: b.label }))

  const productCounts = new Map()
  deals.forEach((d) => productCounts.set(d.product ?? NONE, (productCounts.get(d.product ?? NONE) ?? 0) + 1))
  const products = [...productCounts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([key]) => ({ key, label: key === NONE ? 'Not specified' : key }))

  const ownerList = [...owners.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return {
    owners: ownerList.length > 1 ? ownerList : [],
    sources: sources.length > 1 ? sources : [],
    sizes: sizes.length > 1 ? sizes : [],
    products: products.length > 1 ? products : [],
    total: deals.length,
  }
}

// ---------- the view ----------

const sumValue = (rows) => rows.reduce((s, d) => s + d.value, 0)
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
const barWidth = (value, max) => `${max > 0 ? Math.round((value / max) * 100) : 0}%`
const dealsWord = (n) => `${n} deal${n === 1 ? '' : 's'}`

// One breakdown, as rows: bucket the deals, order by value, and give each a bar
// against the biggest bucket and a share of the total. `universe` is every
// bucket the period has, so a bucket the current filters empty still shows —
// at zero — rather than the list reshuffling under the reader.
function breakdown({ scope, universe, keyOf, labelOf, activeKey }) {
  const buckets = new Map(universe.map((k) => [k, { key: k, label: labelOf(k), value: 0, count: 0 }]))
  scope.forEach((d) => {
    const k = keyOf(d)
    if (!buckets.has(k)) buckets.set(k, { key: k, label: labelOf(k), value: 0, count: 0 })
    const b = buckets.get(k)
    b.value += d.value
    b.count += 1
  })
  const rows = [...buckets.values()].sort((a, b) => b.value - a.value || b.count - a.count || a.label.localeCompare(b.label))
  const total = sumValue(scope)
  const max = Math.max(0, ...rows.map((r) => r.value))
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: money(r.value),
    count: r.count,
    pct: barWidth(r.value, max),
    sub: r.count ? `${dealsWord(r.count)} · ${pct(r.value, total)}% of booked` : 'none',
    active: r.key === activeKey,
  }))
}

export function computeBookedView({ deals, previousDeals, roster = [], filters, sort = 'latest', previousLabel }) {
  const selected = deals.filter((d) => matches(d, filters))
  const prevSelected = previousDeals ? previousDeals.filter((d) => matches(d, filters)) : null

  // ---- the strip ----
  const booked = sumValue(selected)
  const prevBooked = prevSelected ? sumValue(prevSelected) : null
  const priced = selected.filter((d) => d.hasValue)
  const prevPriced = prevSelected ? prevSelected.filter((d) => d.hasValue) : null
  // The average is over deals that HAVE a value: a won lead nobody priced would
  // otherwise pull it down by counting as a ₹0 sale.
  const avg = priced.length ? sumValue(priced) / priced.length : null
  const prevAvg = prevPriced?.length ? sumValue(prevPriced) / prevPriced.length : null
  const biggest = priced.reduce((top, d) => (!top || d.value > top.value ? d : top), null)
  const note = (current, previous) => changeVs(current, previous, previousLabel)?.text

  const stats = [
    { label: 'Booked', value: money(booked), sub: note(booked, prevBooked) ?? 'this period' },
    { label: 'Deals closed', value: String(selected.length), sub: note(selected.length, prevSelected ? prevSelected.length : null) ?? 'this period' },
    {
      label: 'Average deal',
      value: avg != null ? money(avg) : '—',
      sub: (avg != null && prevAvg != null ? note(avg, prevAvg) : null) ?? (avg != null ? 'per priced deal' : 'no priced deals'),
    },
    { label: 'Biggest deal', value: biggest ? money(biggest.value) : '—', sub: biggest ? biggest.name : 'none yet' },
  ]

  // ---- by exec: follows every filter except the owner one ----
  const execScope = deals.filter((d) => matches(d, filters, 'owner'))
  const prevExecScope = previousDeals ? previousDeals.filter((d) => matches(d, filters, 'owner')) : null
  const execs = new Map(roster.map((e) => [String(e.id), { key: String(e.id), id: e.id, name: e.name, value: 0, count: 0, priced: 0 }]))
  execScope.forEach((d) => {
    const key = String(d.ownerId)
    if (!execs.has(key)) execs.set(key, { key, id: d.ownerId, name: d.ownerName, value: 0, count: 0, priced: 0 })
    const e = execs.get(key)
    e.value += d.value
    e.count += 1
    if (d.hasValue) e.priced += 1
  })
  const execTotal = sumValue(execScope)
  const maxExec = Math.max(0, ...[...execs.values()].map((e) => e.value))
  // An exec with nothing booked is a finding, not noise — so they stay on the
  // list, at the bottom, rather than vanishing from a comparison of execs.
  const byExec = [...execs.values()]
    .sort((a, b) => b.value - a.value || b.count - a.count || a.name.localeCompare(b.name))
    .map((e) => {
      const previousValue = prevExecScope ? sumValue(prevExecScope.filter((d) => String(d.ownerId) === e.key)) : null
      const parts = e.count
        ? [dealsWord(e.count), e.priced ? `avg ${money(e.value / e.priced)}` : null, `${pct(e.value, execTotal)}% of booked`]
        : ['no orders booked']
      return {
        key: e.key,
        id: e.id,
        name: e.name,
        initials: getInitials(e.name),
        value: money(e.value),
        pct: barWidth(e.value, maxExec),
        sub: parts.filter(Boolean).join(' · '),
        change: prevExecScope ? changeVs(e.value, previousValue, previousLabel) : null,
        selected: e.key === filters.owner,
      }
    })

  // ---- where it came from ----
  const sourceUniverse = [...new Set(deals.map((d) => d.source ?? NONE))]
  const bySource = breakdown({
    scope: deals.filter((d) => matches(d, filters, 'source')),
    universe: sourceUniverse,
    keyOf: (d) => d.source ?? NONE,
    labelOf: (k) => (k === NONE ? 'Not recorded' : SOURCE_TYPE_LABELS[k] ?? k),
    activeKey: filters.source,
  })

  const territoryOrder = TERRITORY_OPTIONS.map((t) => t.value)
  const territoryUniverse = [...new Set(deals.map((d) => d.territory ?? NONE))].sort(
    (a, b) => (territoryOrder.indexOf(a) + 1 || 99) - (territoryOrder.indexOf(b) + 1 || 99)
  )
  // No territory filter exists, so this follows all four of the others.
  const byTerritory = breakdown({
    scope: selected,
    universe: territoryUniverse,
    keyOf: (d) => d.territory ?? NONE,
    labelOf: (k) => (k === NONE ? 'Not set' : territoryLabel(k)),
    activeKey: null,
  })

  const productUniverse = [...new Set(deals.map((d) => d.product ?? NONE))]
  const byProduct =
    productUniverse.length > 1
      ? breakdown({
          scope: deals.filter((d) => matches(d, filters, 'product')),
          universe: productUniverse,
          keyOf: (d) => d.product ?? NONE,
          labelOf: (k) => (k === NONE ? 'Not specified' : k),
          activeKey: filters.product,
        })
      : []

  const viaBdm = selected.filter((d) => d.bdmId != null)

  // ---- the deals themselves ----
  const rows = [...selected]
    .sort((a, b) => (sort === 'biggest' ? b.value - a.value || b.at - a.at : b.at - a.at || b.leadId - a.leadId))
    .map((d) => ({
      leadId: d.leadId,
      name: d.name,
      date: d.date,
      value: d.hasValue ? money(d.value) : '—',
      hasValue: d.hasValue,
      ownerId: d.ownerId,
      ownerName: d.ownerName,
      bdmId: d.bdmId,
      // The quiet line under the name: where it came from, and which office.
      meta: [d.source ? SOURCE_TYPE_LABELS[d.source] ?? d.source : null, d.territory ? territoryLabel(d.territory) : null]
        .filter(Boolean)
        .join(' · '),
      importDate: d.importDate,
    }))

  return {
    total: selected.length,
    stats,
    byExec,
    bySource,
    byTerritory,
    byProduct,
    viaBdm: viaBdm.length ? { count: viaBdm.length, value: money(sumValue(viaBdm)) } : null,
    rows,
    imported: selected.filter((d) => d.importDate).length,
    unpriced: selected.filter((d) => !d.hasValue).length,
  }
}
