// Pure rules for the business development manager's architect screens
// (BDM.md Step 4): My Architects, the architect profile and Today's
// "Architects to meet". No network — src/lib/architectQueries.js fetches.

import { parseTimestamp } from './dbTime'
import { dealValueFor, sumOpenPipelineValue } from './pipelineValue'
import { firmLabel } from './firmLabel'
import { sourcingArchitect } from './poolLeads'

// The owner's one Needs-attention rule for a BDM (BDM.md §3): a portfolio
// architect with no meeting in this many days. Deliberately its own constant,
// not attention.js's ATTENTION_DAYS — that one is about leads going cold, and
// the two happening to both be 14 today is not a reason to tie them together.
export const ARCHITECT_MEETING_DAYS = 14

const DAY_MS = 86400000

// Map(architectId -> latest meeting timestamp string). `meetings` are
// architect_meeting activities carrying party_id = the architect.
export function lastMeetingByArchitect(meetings) {
  const map = new Map()
  for (const m of meetings ?? []) {
    if (!m.party_id || !m.created_at) continue
    const prev = map.get(m.party_id)
    if (!prev || parseTimestamp(m.created_at) > parseTimestamp(prev)) map.set(m.party_id, m.created_at)
  }
  return map
}

// Whole days since `value` (a naive TIMESTAMP string), or null.
export function daysSince(value, now = new Date()) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS))
}

// "met today" / "last met 3d ago" / "not met yet" — one wording for every
// architect row, from a day count (null = never met).
export function lastMetLabel(days) {
  if (days == null) return 'not met yet'
  if (days === 0) return 'met today'
  return `last met ${days}d ago`
}

// Every portfolio architect whose clock has run past `days`. The clock
// starts at the later of their last meeting and the day they entered the
// portfolio (bdm_since) — owner's ruling: an imported portfolio must not flood
// the queue on day one, so an architect nobody has met yet waits from
// bdm_since, not from the beginning of time. Most overdue first; ties by name
// so the order is stable.
//
// Each row: { architect, lastMetAt, lastMetDays, clockDays }.
export function architectsToMeet(architects, lastMetById, now = new Date(), days = ARCHITECT_MEETING_DAYS) {
  const rows = []
  for (const a of architects ?? []) {
    const lastMetAt = lastMetById?.get(a.id) ?? null
    const lastMetDays = lastMetAt ? daysSince(lastMetAt, now) : null
    const sinceDays = a.bdm_since ? daysSince(a.bdm_since, now) : null
    const candidates = [lastMetDays, sinceDays].filter((n) => n != null)
    if (!candidates.length) continue
    // The later of the two events = the smaller day count.
    const clockDays = Math.min(...candidates)
    if (clockDays >= days) rows.push({ architect: a, lastMetAt, lastMetDays, clockDays })
  }
  return rows.sort((x, y) => y.clockDays - x.clockDays || (x.architect.name ?? '').localeCompare(y.architect.name ?? ''))
}

// Which architect a lead counts for — the same answer "via Architect {name}"
// gives on Lead Detail (sourcingArchitect), by id. A lead embeds `referrer`
// and `other` as { id, party_type }.
export function architectIdForLead(lead) {
  return sourcingArchitect(lead?.referrer, lead?.other)?.id ?? null
}

// Per-architect lead figures. Win rate is won / (won + lost), null until
// something has been decided — a 0% that really means "nothing closed yet"
// would read as a failing architect.
export function summariseArchitectLeads(leads) {
  const list = leads ?? []
  const won = list.filter((l) => l.current_stage === 'won')
  const lost = list.filter((l) => l.current_stage === 'lost')
  const open = list.filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'calling'))
  const decided = won.length + lost.length
  return {
    referred: list.length,
    openCount: open.length,
    openValue: sumOpenPipelineValue(list),
    wonCount: won.length,
    wonValue: won.reduce((s, l) => s + dealValueFor(l), 0),
    lostCount: lost.length,
    winRate: decided ? Math.round((won.length / decided) * 100) : null,
  }
}

// Map(architectId -> summariseArchitectLeads(their leads)).
export function leadStatsByArchitect(leads) {
  const byArchitect = new Map()
  for (const l of leads ?? []) {
    const id = architectIdForLead(l)
    if (!id) continue
    if (!byArchitect.has(id)) byArchitect.set(id, [])
    byArchitect.get(id).push(l)
  }
  return new Map([...byArchitect].map(([id, rows]) => [id, summariseArchitectLeads(rows)]))
}

// My Architects' grouping (owner's ruling: grouped by firm, "No firm" last).
// Firms alphabetical, architects alphabetical inside each. A firm the viewer
// can't resolve falls back to the legacy firm_name text, the same way every
// party picker labels it (firmLabel).
export function groupArchitectsByFirm(architects) {
  const groups = new Map()
  for (const a of architects ?? []) {
    const label = firmLabel(a)
    const key = a.firm?.id ? `id:${a.firm.id}` : label ? `name:${label.toLowerCase()}` : 'none'
    if (!groups.has(key)) groups.set(key, { key, firmName: label, firmId: a.firm?.id ?? null, architects: [] })
    groups.get(key).architects.push(a)
  }
  const byName = (x, y) => (x.name ?? '').localeCompare(y.name ?? '')
  return [...groups.values()]
    .map((g) => ({ ...g, architects: [...g.architects].sort(byName) }))
    .sort((x, y) => {
      if (x.key === 'none') return 1
      if (y.key === 'none') return -1
      return (x.firmName ?? '').localeCompare(y.firmName ?? '')
    })
}

// How an architect's portfolio reads next to their name in search, pickers
// and the profile (BDM.md §3: tagged "Yours" / the BDM's name). null when the
// architect is in no portfolio — search and pickers then show no tag at all.
export function portfolioTag(party, viewerId) {
  if (!party || party.party_type !== 'architect' || party.bdm_employee_id == null) return null
  if (party.bdm_employee_id === viewerId) return 'Yours'
  return party.bdm?.name ? `With ${party.bdm.name}` : 'With a BDM'
}
