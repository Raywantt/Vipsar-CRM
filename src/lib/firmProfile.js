// Pure rules for one firm's page (/firms/:id, /firms/by-name?name= — the owner's
// Architect Network, Firms tab → a row). No network: src/lib/architectQueries.js
// fetches, src/pages/FirmProfile.jsx draws.
//
// A firm has no figures of its own. Everything here is the pooled answer for the
// architects AT the firm, built from the SAME reducers the Firms tab and the
// architect pages use (summariseArchitectLeads, buildDirectoryRows), so the
// firm's page can never read a different number than the row that opened it.
// firmProfile.test.js pins that against buildFirmRows.

import { parseTimestamp } from './dbTime'
import { architectIdForLead, daysSince, summariseArchitectLeads } from './architectStats'
import { buildDirectoryRows, sortDirectoryRows } from './architectNetwork'
import { LEAD_STAGE_OPTIONS } from './leadStageOptions'
import { dealValueFor } from './pipelineValue'
import { hasImportDate } from './leadSources'
import { OLD_MEETING, NEW_MEETING, PICKABLE_MEETING } from './meetingBucket'
import { ROLES } from './roles'

// A firm that has sent leads before but none for this long reads "gone quiet".
// A quarter, because architects work in project cycles — one lead every couple
// of months is a normal rhythm, not a silence. Tune here, never inline.
export const FIRM_QUIET_DAYS = 90

// How many calendar months the "Leads over time" strip shows, current month last.
export const FIRM_MONTHS = 12

const CLIENT_MEETING_TYPES = [OLD_MEETING, NEW_MEETING, PICKABLE_MEETING]

// The firm's leads by stage, in the funnel's own order, stages with no lead left
// out (a firm has 1–2 leads on average — twelve rows of zeros would say nothing).
// A stage the app doesn't list (free text at the database layer) follows the
// known ones under its own name. `value` is the lead-by-lead deal value
// (pipelineValue.js) summed — 0 means "nobody has quoted these", which the page
// shows as "—", never ₹0. `share` is count / all the firm's leads, so a bar is
// an honest ratio of one fixed whole.
export function firmStageRows(leads) {
  const list = leads ?? []
  const byStage = new Map()
  for (const l of list) {
    const stage = l.current_stage ?? 'calling'
    if (!byStage.has(stage)) byStage.set(stage, [])
    byStage.get(stage).push(l)
  }
  const known = LEAD_STAGE_OPTIONS.filter((s) => byStage.has(s))
  const unknown = [...byStage.keys()].filter((s) => !LEAD_STAGE_OPTIONS.includes(s)).sort()
  return [...known, ...unknown].map((stage) => {
    const rows = byStage.get(stage)
    return {
      stage,
      count: rows.length,
      value: rows.reduce((sum, l) => sum + dealValueFor(l), 0),
      share: rows.length / list.length,
    }
  })
}

const monthIndex = (d) => d.getFullYear() * 12 + d.getMonth()

// When the firm's leads arrived: a strip of the last `months` calendar months
// (local time, current month last) with a count in each, the leads older than
// the strip, and the first / latest lead.
//
// `importDated` counts leads whose created_at is the day a spreadsheet was
// loaded rather than the day the lead came in (leadSources.js's hasImportDate,
// the rule the New-leads-by-source popup tags). They are COUNTED — the Firms tab
// counts them — and named, so a month with a spike can be read for what it is.
export function firmTimeline(leads, now = new Date(), months = FIRM_MONTHS) {
  const dated = []
  for (const l of leads ?? []) {
    const at = parseTimestamp(l.created_at)
    if (at && !Number.isNaN(at.getTime())) dated.push({ lead: l, at })
  }

  const first = monthIndex(now) - (months - 1)
  const strip = Array.from({ length: months }, (_, i) => {
    const idx = first + i
    const year = Math.floor(idx / 12)
    const month = idx % 12
    return { key: `${year}-${String(month + 1).padStart(2, '0')}`, year, month, count: 0 }
  })
  let earlier = 0
  for (const { at } of dated) {
    const offset = monthIndex(at) - first
    if (offset < 0) earlier += 1
    else if (offset < months) strip[offset].count += 1
  }

  let firstAt = null
  let latestAt = null
  for (const { lead, at } of dated) {
    if (!firstAt || at < parseTimestamp(firstAt)) firstAt = lead.created_at
    if (!latestAt || at > parseTimestamp(latestAt)) latestAt = lead.created_at
  }
  const latestDays = latestAt ? daysSince(latestAt, now) : null

  return {
    strip,
    earlier,
    total: dated.length,
    firstAt,
    latestAt,
    latestDays,
    quiet: latestDays != null && latestDays >= FIRM_QUIET_DAYS,
    importDated: (leads ?? []).filter(hasImportDate).length,
  }
}

// Everyone connected to the firm, one row each (owner's brief: the BDM, and the
// execs and managers who own its leads, visited, or met its architects):
//   portfolio        architects at the firm tagged to them (a BDM's portfolio)
//   brought          the firm's leads they brought in (leads.bdm_employee_id)
//   owned / open / won   the firm's leads they own now — what the Sales Exec
//                    Profile would call "their" leads from this firm
//   visits           site visits they logged on those leads
//   clientMeetings   client meetings (either bucket) they logged on those leads
//   architectMeetings  meetings they logged with the firm's architects
//
// A person appears only if at least one of those is above zero. The name and
// role come from whichever embed carried them; a BDM seen only through a tag
// takes their name from `bdmNames` (the roster) and the BDM role. Calls are not
// a visit and are not counted.
export function buildFirmPeople({ architects, leads, meetings, activities, bdmNames = new Map() }) {
  const people = new Map()
  const at = (id) => {
    if (id == null) return null
    if (!people.has(id)) {
      people.set(id, {
        id,
        name: null,
        role: null,
        portfolio: 0,
        brought: 0,
        owned: 0,
        openValue: 0,
        wonValue: 0,
        visits: 0,
        clientMeetings: 0,
        architectMeetings: 0,
      })
    }
    return people.get(id)
  }
  const identify = (p, embed, asBdm) => {
    if (!p) return
    if (!p.name) p.name = embed?.name ?? (asBdm ? bdmNames.get(p.id) : null) ?? null
    if (!p.role) p.role = embed?.role ?? (asBdm ? ROLES.BDM : null)
  }

  for (const a of architects ?? []) {
    const p = at(a.bdm_employee_id)
    if (!p) continue
    p.portfolio += 1
    identify(p, a.bdm, true)
  }

  const leadList = leads ?? []
  const byOwner = new Map()
  for (const l of leadList) {
    const b = at(l.bdm_employee_id)
    if (b) {
      b.brought += 1
      identify(b, null, true)
    }
    const o = at(l.owner_employee_id)
    if (o) {
      identify(o, l.employees, false)
      if (!byOwner.has(o.id)) byOwner.set(o.id, [])
      byOwner.get(o.id).push(l)
    }
  }
  for (const [id, owned] of byOwner) {
    const s = summariseArchitectLeads(owned)
    const p = people.get(id)
    p.owned = s.referred
    p.openValue = s.openValue
    p.wonValue = s.wonValue
  }

  const leadIds = new Set(leadList.map((l) => l.id))
  for (const act of activities ?? []) {
    if (!leadIds.has(act.lead_id)) continue
    const p = at(act.employee_id)
    if (!p) continue
    identify(p, act.employees, false)
    if (act.activity_type === 'site_visit') p.visits += 1
    else if (CLIENT_MEETING_TYPES.includes(act.activity_type)) p.clientMeetings += 1
  }

  for (const m of meetings ?? []) {
    const p = at(m.employee_id)
    if (!p) continue
    identify(p, m.employees, false)
    p.architectMeetings += 1
  }

  // A BDM first (the relationship), then whoever carries the most of the firm's
  // business, then whoever has been most hands-on; the name settles a tie so the
  // order is stable.
  const touches = (p) => p.visits + p.clientMeetings + p.architectMeetings
  return [...people.values()].sort(
    (a, b) =>
      (b.role === ROLES.BDM) - (a.role === ROLES.BDM) ||
      b.owned - a.owned ||
      touches(b) - touches(a) ||
      (a.name ?? '').localeCompare(b.name ?? '')
  )
}

// The whole page, from one bundle (fetchFirmBundle's data).
export function buildFirmProfile({ architects, meetings, leads, activities, bdmNames = new Map(), now = new Date() }) {
  const ids = new Set((architects ?? []).map((a) => a.id))
  // The bundle already keeps only these, but the figures here must not depend on
  // a caller having done it: a lead credited to someone else's architect is not
  // this firm's.
  const firmLeads = (leads ?? []).filter((l) => ids.has(architectIdForLead(l)))
  const firmMeetings = (meetings ?? []).filter((m) => ids.has(m.party_id))
  const leadIds = new Set(firmLeads.map((l) => l.id))
  const firmActivities = (activities ?? []).filter((a) => leadIds.has(a.lead_id))

  const stats = summariseArchitectLeads(firmLeads)
  const architectRows = sortDirectoryRows(
    buildDirectoryRows({ architects, meetings: firmMeetings, leads: firmLeads, now }),
    'referred'
  )
  const nameById = new Map(architectRows.map((r) => [r.id, r.name]))

  const lastMeetingAt = firmMeetings.reduce(
    (best, m) => (!best || parseTimestamp(m.created_at) > parseTimestamp(best) ? m.created_at : best),
    null
  )

  return {
    stats,
    stages: firmStageRows(firmLeads),
    timeline: firmTimeline(firmLeads, now),
    architectRows,
    inPortfolio: architectRows.filter((r) => r.bdmId != null).length,
    meetings: firmMeetings.map((m) => ({ ...m, architectName: nameById.get(m.party_id) ?? 'Architect' })),
    meetingCount: firmMeetings.length,
    lastMeetingAt,
    lastMeetingDays: lastMeetingAt ? daysSince(lastMeetingAt, now) : null,
    // Each lead names the architect it is credited to ("via …" on the page).
    leads: firmLeads.map((l) => ({ ...l, architectName: nameById.get(architectIdForLead(l)) ?? null })),
    people: buildFirmPeople({ architects, leads: firmLeads, meetings: firmMeetings, activities: firmActivities, bdmNames }),
  }
}

// Where a Firms-tab row goes. A firm that is a real `parties` row has an id; one
// that exists only as text on its architects is addressed by that text — in the
// query string, not the path, because a typed firm name can hold any character
// (a "/" among them) and a path segment is no place for free text.
export function firmPath(row) {
  return row.firmId != null ? `/firms/${row.firmId}` : `/firms/by-name?name=${encodeURIComponent(row.name ?? '')}`
}
