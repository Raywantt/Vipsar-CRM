// Pure rules for the owner's Architect Network (/network, BDM.md Step 6):
// the per-BDM summary card, the company-wide architect directory and the
// "set all three targets at once" form. No network — the queries live in
// bdmQueries.js / architectQueries.js, the page in ArchitectNetwork.jsx.
//
// Everything here REUSES the rules the BDM's own screens already run
// (computeBdmTargetActuals, buildClosedRows, architectsToMeet, …) rather than
// re-deriving them, so the owner can never see a different number for a BDM
// than that BDM sees for themselves.

import { computeBdmTargetActuals, summariseClosedRows } from './bdmDashboard'
import { buildClosedRows, buildHandedOverRows } from './bdmLeadUpdates'
import {
  architectIdForLead,
  architectsToMeet,
  daysSince,
  groupArchitectsByFirm,
  lastMeetingByArchitect,
  leadStatsByArchitect,
  summariseArchitectLeads,
} from './architectStats'
import { countOpenPipelineLeads, sumOpenPipelineValue } from './pipelineValue'
import { parseTimestamp } from './dbTime'
import { firmLabel } from './firmLabel'
import { BDM_METRIC_OPTIONS } from './targetMetrics'

// One BDM's card. Every input may still be loading (null); the matching
// output is then null and the card renders a placeholder for just that
// figure, so a range change doesn't blank the snapshot numbers.
//
//   leads             every BDM-tagged lead (any BDM) — filtered here
//   periodMeetings    BDM architect meetings inside `range` (any BDM)
//   architects        every portfolio architect (any BDM)
//   portfolioMeetings all-time architect meetings with those architects, by
//                     anyone — only this BDM's own count toward their clock,
//                     which is exactly what their own Today and Dashboard see
//                     (a BDM's RLS returns only their own architect meetings)
//   closedData        fetchClosedRows(range)'s { stageRows, lossRows }
//   handedOverData    fetchHandedOverRows(range)'s rows
export function summariseBdm({
  bdmId,
  leads,
  periodMeetings,
  architects,
  portfolioMeetings,
  closedData,
  handedOverData,
  range,
  now = new Date(),
}) {
  const mine = leads ? leads.filter((l) => l.bdm_employee_id === bdmId) : null
  const portfolio = architects ? architects.filter((a) => a.bdm_employee_id === bdmId) : null
  const closed = closedData ? summariseClosedRows(buildClosedRows(closedData.stageRows, closedData.lossRows, bdmId)) : null

  let toMeet = null
  if (portfolio && portfolioMeetings) {
    const own = portfolioMeetings.filter((m) => m.employee_id === bdmId)
    toMeet = architectsToMeet(portfolio, lastMeetingByArchitect(own), now)
  }

  return {
    actuals: mine && periodMeetings && range ? computeBdmTargetActuals({ leads: mine, meetings: periodMeetings, range, bdmId }) : null,
    openValue: mine ? sumOpenPipelineValue(mine) : null,
    openCount: mine ? countOpenPipelineLeads(mine) : null,
    // The pool rule (poolLeads.js): no owner yet. Only a BDM-tagged lead can be
    // ownerless here, and `mine` is already this BDM's.
    waitingCount: mine ? mine.filter((l) => l.owner_employee_id == null).length : null,
    handedOverCount: handedOverData ? buildHandedOverRows(handedOverData, bdmId).length : null,
    closed,
    portfolioCount: portfolio ? portfolio.length : null,
    toMeet,
  }
}

// ---- Directory ----

// One row per architect, all-time (owner's ruling: no date picker on this
// tab). Leads are attributed the way Lead Detail's "via Architect" is
// (leadStatsByArchitect → architectIdForLead), so a row's figures match that
// architect's profile page exactly. Last meeting is anyone's, the same set
// the profile's Meetings card lists.
export function buildDirectoryRows({ architects, meetings, leads, now = new Date() }) {
  const lastMet = lastMeetingByArchitect(meetings)
  const stats = leadStatsByArchitect(leads)
  return (architects ?? []).map((a) => {
    const s = stats.get(a.id)
    const lastMetAt = lastMet.get(a.id) ?? null
    return {
      id: a.id,
      name: a.name ?? 'Architect',
      mobile: a.mobile ?? null,
      firm: firmLabel(a) ?? null,
      bdmId: a.bdm_employee_id ?? null,
      bdmName: a.bdm_employee_id != null ? a.bdm?.name ?? 'a BDM' : null,
      lastMetAt,
      lastMetDays: lastMetAt ? daysSince(lastMetAt, now) : null,
      referred: s?.referred ?? 0,
      openValue: s?.openValue ?? 0,
      wonValue: s?.wonValue ?? 0,
    }
  })
}

// The portfolio filter's value: 'all', 'none' (not with a BDM), or a BDM's id
// as a string. A string throughout because it's a <select> value.
export const PORTFOLIO_ALL = 'all'
export const PORTFOLIO_NONE = 'none'

export function filterDirectoryRows(rows, { term = '', portfolio = PORTFOLIO_ALL } = {}) {
  const q = term.trim().toLowerCase()
  const digits = q.replace(/\D/g, '')
  return (rows ?? []).filter((r) => {
    if (portfolio === PORTFOLIO_NONE && r.bdmId != null) return false
    if (portfolio !== PORTFOLIO_ALL && portfolio !== PORTFOLIO_NONE && String(r.bdmId) !== portfolio) return false
    if (!q) return true
    return (
      r.name.toLowerCase().includes(q) ||
      (r.firm ?? '').toLowerCase().includes(q) ||
      // A number typed with spaces or a +91 still finds the architect; a
      // single stray digit inside a name search doesn't match every mobile.
      (digits.length >= 3 && (r.mobile ?? '').replace(/\D/g, '').includes(digits))
    )
  })
}

// Numbers high to low, names A→Z, "no firm" and "never met" last. Every sort
// breaks ties on name so the order is stable while typing a search.
// `label` is short on purpose: it's the phone's sort dropdown, which shares a
// row with the portfolio filter and gets ~150px ("Sort: Leads referred" was cut
// off at 375px). The desktop header names its columns itself.
export const DIRECTORY_SORTS = [
  { value: 'referred', label: 'Leads' },
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Won' },
  { value: 'met', label: 'Last met' },
  { value: 'name', label: 'Name' },
  { value: 'firm', label: 'Firm' },
]
export const DEFAULT_DIRECTORY_SORT = 'referred'

export function sortDirectoryRows(rows, sort = DEFAULT_DIRECTORY_SORT) {
  const byName = (a, b) => a.name.localeCompare(b.name)
  const nullsLast = (x, y) => (x == null) - (y == null)
  const cmp = {
    referred: (a, b) => b.referred - a.referred,
    open: (a, b) => b.openValue - a.openValue,
    won: (a, b) => b.wonValue - a.wonValue,
    met: (a, b) => nullsLast(a.lastMetDays, b.lastMetDays) || (a.lastMetDays ?? 0) - (b.lastMetDays ?? 0),
    name: () => 0,
    firm: (a, b) => nullsLast(a.firm, b.firm) || (a.firm ?? '').localeCompare(b.firm ?? ''),
  }[sort] ?? (() => 0)
  return [...(rows ?? [])].sort((a, b) => cmp(a, b) || byName(a, b))
}

// ---- Firms ----

// One row per firm, all-time, rolling up every architect at that firm — the
// Architects tab's own third view. Grouped the same way My Architects groups
// a BDM's own portfolio (groupArchitectsByFirm), so a firm can't be split into
// two rows here just because this screen wrote its own key logic. The "no
// firm" bucket that function returns is dropped: a list of firms has nothing
// to say about architects who aren't at one.
//
// Figures are summariseArchitectLeads run over the POOLED leads of every
// architect at the firm, not an average of each architect's own row — a
// pooled win rate is the honest one (won / (won+lost) across the whole firm),
// where averaging per-architect win rates would over-weight an architect with
// one decided lead against one with twenty.
export function buildFirmRows({ architects, meetings, leads, now = new Date() }) {
  const lastMet = lastMeetingByArchitect(meetings)
  const groups = groupArchitectsByFirm(architects).filter((g) => g.key !== 'none')

  return groups.map((g) => {
    const architectIds = new Set(g.architects.map((a) => a.id))
    const firmLeads = (leads ?? []).filter((l) => architectIds.has(architectIdForLead(l)))
    const s = summariseArchitectLeads(firmLeads)

    let lastMetAt = null
    for (const a of g.architects) {
      const t = lastMet.get(a.id)
      if (t && (!lastMetAt || parseTimestamp(t) > parseTimestamp(lastMetAt))) lastMetAt = t
    }

    return {
      key: g.key,
      // Only a real linked firm party has an id — a legacy firm_name-only
      // group (no parties.firm_party_id anywhere) has nothing to link to.
      firmId: g.firmId,
      name: g.firmName,
      architectCount: g.architects.length,
      lastMetAt,
      lastMetDays: lastMetAt ? daysSince(lastMetAt, now) : null,
      referred: s.referred,
      openCount: s.openCount,
      openValue: s.openValue,
      wonCount: s.wonCount,
      wonValue: s.wonValue,
      lostCount: s.lostCount,
      winRate: s.winRate,
    }
  })
}

export function filterFirmRows(rows, term = '') {
  const q = term.trim().toLowerCase()
  if (!q) return rows ?? []
  return (rows ?? []).filter((r) => (r.name ?? '').toLowerCase().includes(q))
}

// Same "numbers high to low, names A→Z, blanks last" shape as
// DIRECTORY_SORTS/sortDirectoryRows — kept as a separate list rather than
// merged with it because the columns aren't the same (an architect count and
// a win rate have no equivalent on that table).
export const FIRM_SORTS = [
  { value: 'architects', label: 'Architects' },
  { value: 'referred', label: 'Leads' },
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Won' },
  { value: 'winRate', label: 'Win rate' },
  { value: 'met', label: 'Last met' },
  { value: 'name', label: 'Name' },
]
export const DEFAULT_FIRM_SORT = 'architects'

export function sortFirmRows(rows, sort = DEFAULT_FIRM_SORT) {
  const byName = (a, b) => (a.name ?? '').localeCompare(b.name ?? '')
  const nullsLast = (x, y) => (x == null) - (y == null)
  const cmp = {
    architects: (a, b) => b.architectCount - a.architectCount,
    referred: (a, b) => b.referred - a.referred,
    open: (a, b) => b.openValue - a.openValue,
    won: (a, b) => b.wonValue - a.wonValue,
    winRate: (a, b) => nullsLast(a.winRate, b.winRate) || (b.winRate ?? 0) - (a.winRate ?? 0),
    met: (a, b) => nullsLast(a.lastMetDays, b.lastMetDays) || (a.lastMetDays ?? 0) - (b.lastMetDays ?? 0),
    name: () => 0,
  }[sort] ?? (() => 0)
  return [...(rows ?? [])].sort((a, b) => cmp(a, b) || byName(a, b))
}

// ---- Set targets (all three at once) ----

// The form's boxes prefilled from what's on file for one BDM and period:
// { [metric]: '12' | '' }.
export function targetInputsFrom(targets, bdmId) {
  return Object.fromEntries(
    BDM_METRIC_OPTIONS.map((m) => {
      const row = (targets ?? []).find((t) => t.employee_id === bdmId && t.metric_name === m.value)
      return [m.value, row ? String(Number(row.target_value)) : '']
    })
  )
}

// What Save writes: every box with a whole number in it that differs from what
// is on file. A blank box leaves that target alone (owner's ruling) — there is
// no delete here. Returns { writes, invalid } where invalid names any box
// holding something that isn't a whole number ≥ 0.
export function targetWrites(inputs, targets, bdmId) {
  const onFile = targetInputsFrom(targets, bdmId)
  const writes = []
  const invalid = []
  for (const m of BDM_METRIC_OPTIONS) {
    const raw = String(inputs?.[m.value] ?? '').trim()
    if (raw === '') continue
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) {
      invalid.push(m.value)
      continue
    }
    if (onFile[m.value] !== '' && Number(onFile[m.value]) === n) continue
    writes.push({ metricName: m.value, targetValue: n })
  }
  return { writes, invalid }
}
