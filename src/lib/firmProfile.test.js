import { describe, expect, it } from 'vitest'
import { buildFirmRows } from './architectNetwork'
import { FIRM_QUIET_DAYS, buildFirmPeople, buildFirmProfile, firmPath, firmStageRows, firmTimeline } from './firmProfile'

// An explicit UTC instant: the leads' naive timestamps are UTC wall clocks
// (dbTime.js), so a local `now` would make the day counts depend on the machine.
const NOW = new Date('2026-10-09T12:00:00Z')
const BDM = 46
const EXEC = 12
const MGR = 13

const arch = (id, name, extra = {}) => ({ id, name, party_type: 'architect', firm_name: 'Habitat', ...extra })
const lead = (id, architectId, extra = {}) => ({
  id,
  created_at: '2026-09-20T09:00:00',
  current_stage: 'calling',
  referrer: { id: architectId, party_type: 'architect' },
  other: null,
  owner_employee_id: EXEC,
  employees: { name: 'Eshan Exec', role: 'sales_executive' },
  ...extra,
})

const architects = [
  arch(1, 'Asha', { bdm_employee_id: BDM, bdm: { name: 'Raghav' }, bdm_since: '2026-08-01T00:00:00' }),
  arch(2, 'Bhavna'),
  arch(3, 'Chetan'),
]
const leads = [
  lead(10, 1, { current_stage: 'rfq', quote_value: 500000, bdm_employee_id: BDM }),
  lead(11, 1, { current_stage: 'won', order_value: 300000, quote_value: 280000, created_at: '2026-04-02T09:00:00' }),
  lead(12, 2, { current_stage: 'lost', quote_value: 100000, owner_employee_id: MGR, employees: { name: 'Mina Manager', role: 'sales_manager' } }),
  lead(13, 2, { current_stage: 'negotiation' }),
  // Credited to an architect who is NOT at this firm — never this firm's.
  lead(14, 99, { current_stage: 'won', order_value: 9000000 }),
]
const meetings = [
  { id: 1, party_id: 1, employee_id: BDM, created_at: '2026-10-01T09:00:00', employees: { name: 'Raghav', role: 'business_development_manager' } },
  { id: 2, party_id: 2, employee_id: MGR, created_at: '2026-09-01T09:00:00', employees: { name: 'Mina Manager', role: 'sales_manager' } },
  { id: 3, party_id: 99, employee_id: BDM, created_at: '2026-10-05T09:00:00', employees: { name: 'Raghav', role: 'business_development_manager' } },
]
const activities = [
  { id: 1, lead_id: 10, employee_id: EXEC, activity_type: 'site_visit', employees: { name: 'Eshan Exec', role: 'sales_executive' } },
  { id: 2, lead_id: 10, employee_id: MGR, activity_type: 'client_meeting_old', employees: { name: 'Mina Manager', role: 'sales_manager' } },
  { id: 3, lead_id: 12, employee_id: MGR, activity_type: 'client_meeting_new', employees: { name: 'Mina Manager', role: 'sales_manager' } },
  { id: 4, lead_id: 12, employee_id: MGR, activity_type: 'call', employees: { name: 'Mina Manager', role: 'sales_manager' } },
  // On a lead that isn't this firm's.
  { id: 5, lead_id: 14, employee_id: EXEC, activity_type: 'site_visit', employees: { name: 'Eshan Exec', role: 'sales_executive' } },
]
const bdmNames = new Map([[BDM, 'Raghav']])

function profile() {
  return buildFirmProfile({ architects, meetings, leads, activities, bdmNames, now: NOW })
}

describe('buildFirmProfile', () => {
  it('reads the same figures as the Firms tab row that opened it', () => {
    const tab = buildFirmRows({ architects, meetings, leads, now: NOW })[0]
    const p = profile()
    expect(p.stats.referred).toBe(tab.referred)
    expect(p.stats.openValue).toBe(tab.openValue)
    expect(p.stats.wonValue).toBe(tab.wonValue)
    expect(p.stats.winRate).toBe(tab.winRate)
    expect(p.architectRows.length).toBe(tab.architectCount)
    expect(p.lastMeetingAt).toBe(tab.lastMetAt)
    expect(p.lastMeetingDays).toBe(tab.lastMetDays)
  })

  it("leaves out a lead credited to another firm's architect, and that architect's meeting", () => {
    const p = profile()
    expect(p.leads.map((l) => l.id)).toEqual([10, 11, 12, 13])
    expect(p.meetingCount).toBe(2)
    expect(p.stats.wonValue).toBe(300000)
  })

  it('names the architect on each meeting and lists architects busiest first', () => {
    const p = profile()
    expect(p.meetings.map((m) => m.architectName)).toEqual(['Asha', 'Bhavna'])
    expect(p.architectRows.map((r) => r.name)).toEqual(['Asha', 'Bhavna', 'Chetan'])
    expect(p.inPortfolio).toBe(1)
  })
})

describe('firmStageRows', () => {
  it('lists only stages that hold a lead, in funnel order, and sums to every lead', () => {
    const rows = firmStageRows(profile().leads)
    expect(rows.map((r) => r.stage)).toEqual(['rfq', 'negotiation', 'won', 'lost'])
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(4)
    expect(rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1)
  })

  it('adds up to the same open pipeline the tile shows', () => {
    const p = profile()
    const open = firmStageRows(p.leads).filter((r) => !['won', 'lost'].includes(r.stage))
    expect(open.reduce((n, r) => n + r.value, 0)).toBe(p.stats.openValue)
  })

  it('puts an unlisted stage after the known ones under its own name', () => {
    const rows = firmStageRows([lead(1, 1, { current_stage: 'calling' }), lead(2, 1, { current_stage: 'site_survey' })])
    expect(rows.map((r) => r.stage)).toEqual(['calling', 'site_survey'])
  })

  it('treats a missing stage as calling, like the rest of the app', () => {
    expect(firmStageRows([lead(1, 1, { current_stage: null })])[0].stage).toBe('calling')
  })
})

describe('firmTimeline', () => {
  it('draws twelve months ending this one, counts each, and keeps the older ones apart', () => {
    const t = firmTimeline(profile().leads, NOW)
    expect(t.strip).toHaveLength(12)
    expect(t.strip[11].key).toBe('2026-10')
    expect(t.strip[0].key).toBe('2025-11')
    const sep = t.strip.find((m) => m.key === '2026-09')
    const apr = t.strip.find((m) => m.key === '2026-04')
    expect(sep.count).toBe(3)
    expect(apr.count).toBe(1)
    expect(t.earlier).toBe(0)
    expect(t.total).toBe(4)
  })

  it('counts a lead older than the strip as earlier, not in any month', () => {
    const t = firmTimeline([lead(1, 1, { created_at: '2024-01-15T00:00:00' })], NOW)
    expect(t.earlier).toBe(1)
    expect(t.strip.every((m) => m.count === 0)).toBe(true)
  })

  it('finds the first and latest lead and flags a firm that has gone quiet', () => {
    const t = firmTimeline(profile().leads, NOW)
    expect(t.firstAt).toBe('2026-04-02T09:00:00')
    expect(t.latestAt).toBe('2026-09-20T09:00:00')
    expect(t.latestDays).toBe(19)
    expect(t.quiet).toBe(false)

    const quiet = firmTimeline([lead(1, 1, { created_at: '2026-06-01T00:00:00' })], NOW)
    expect(quiet.latestDays).toBeGreaterThanOrEqual(FIRM_QUIET_DAYS)
    expect(quiet.quiet).toBe(true)
  })

  it('says nothing for a firm with no lead rather than inventing a date', () => {
    const t = firmTimeline([], NOW)
    expect(t.firstAt).toBeNull()
    expect(t.latestAt).toBeNull()
    expect(t.latestDays).toBeNull()
    expect(t.quiet).toBe(false)
  })

  it('names the leads that carry the day a sheet was loaded, not the day they arrived', () => {
    const imported = lead(1, 1, { external_reference_id: 'legacy-9', created_at: '2026-09-18T11:42:07' })
    const sheetDated = lead(2, 1, { external_reference_id: 'legacy-10', created_at: '2026-08-04T00:00:00' })
    const t = firmTimeline([imported, sheetDated, lead(3, 1)], NOW)
    expect(t.importDated).toBe(1)
    expect(t.total).toBe(3)
  })
})

describe('buildFirmPeople', () => {
  const people = () => buildFirmPeople({ architects, leads: profile().leads, meetings: profile().meetings, activities: activities.filter((a) => a.lead_id !== 14), bdmNames })
  const byId = (id) => people().find((p) => p.id === id)

  it('puts the BDM first, with portfolio, leads brought in and architect meetings', () => {
    expect(people()[0].id).toBe(BDM)
    expect(byId(BDM)).toMatchObject({ name: 'Raghav', role: 'business_development_manager', portfolio: 1, brought: 1, owned: 0, architectMeetings: 1 })
  })

  it('counts what an exec owns, with its open and won value', () => {
    expect(byId(EXEC)).toMatchObject({ name: 'Eshan Exec', role: 'sales_executive', owned: 3, openValue: 500000, wonValue: 300000, visits: 1 })
  })

  it('credits a manager with the visits and meetings they logged, and the architect they met', () => {
    expect(byId(MGR)).toMatchObject({ role: 'sales_manager', owned: 1, clientMeetings: 2, visits: 0, architectMeetings: 1 })
  })

  it('does not count a call as a visit', () => {
    expect(byId(MGR).visits + byId(MGR).clientMeetings).toBe(2)
  })

  it('ignores activity on a lead that is not this firm\'s', () => {
    expect(profile().people.find((p) => p.id === EXEC).visits).toBe(1)
  })

  it('names a BDM seen only through a tag from the roster', () => {
    const p = buildFirmPeople({
      architects: [arch(1, 'Asha', { bdm_employee_id: BDM })],
      leads: [],
      meetings: [],
      activities: [],
      bdmNames,
    })
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ name: 'Raghav', role: 'business_development_manager', portfolio: 1 })
  })

  it('has nobody for a firm nobody touches', () => {
    expect(buildFirmPeople({ architects: [arch(1, 'Asha')], leads: [], meetings: [], activities: [] })).toEqual([])
  })
})

describe('firmPath', () => {
  it('addresses a linked firm by id', () => {
    expect(firmPath({ firmId: 7, name: 'Habitat' })).toBe('/firms/7')
  })

  it('addresses a typed-name firm by its name, safely encoded', () => {
    expect(firmPath({ firmId: null, name: 'A & B / Studio?' })).toBe('/firms/by-name?name=A%20%26%20B%20%2F%20Studio%3F')
  })
})
