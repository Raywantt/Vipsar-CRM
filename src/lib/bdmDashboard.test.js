import { describe, it, expect } from 'vitest'
import { computeBdmTargetActuals, inRange, summariseClosedRows, topArchitects } from './bdmDashboard'
import { BDM_METRIC_OPTIONS, METRIC_OPTIONS } from './targetMetrics'

const BDM = 46
const OTHER_BDM = 47
// Naive TIMESTAMP strings, the shape the schema serves (UTC wall clock).
const RANGE = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-15T23:59:59.999Z') }
const IN = '2026-09-10T09:00:00'
const OUT = '2026-08-20T09:00:00'

const arch = (id, name) => ({ id, name, party_type: 'architect' })

describe('inRange', () => {
  it('reads a naive timestamp as UTC and includes both bounds', () => {
    expect(inRange('2026-09-01T00:00:00', RANGE)).toBe(true)
    expect(inRange('2026-09-15T23:59:59', RANGE)).toBe(true)
    expect(inRange('2026-08-31T23:59:59', RANGE)).toBe(false)
    expect(inRange(null, RANGE)).toBe(false)
    expect(inRange(IN, null)).toBe(false)
  })
})

describe('BDM target metrics', () => {
  it('are their own three, sharing no metric_name with the exec list', () => {
    expect(BDM_METRIC_OPTIONS.map((m) => m.value)).toEqual([
      'bdm_architect_meetings',
      'bdm_joineries_received',
      'bdm_leads_generated',
    ])
    const exec = new Set(METRIC_OPTIONS.map((m) => m.value))
    expect(BDM_METRIC_OPTIONS.some((m) => exec.has(m.value))).toBe(false)
    // An exec must never get Architect Meeting back (removed 2026-09-08).
    expect(exec.has('architect_meeting')).toBe(false)
  })
})

describe('computeBdmTargetActuals', () => {
  it('counts this BDM\'s meetings, joineries and leads in the period only', () => {
    const leads = [
      { bdm_employee_id: BDM, created_at: IN, joinery_received: true, owner_employee_id: null },
      { bdm_employee_id: BDM, created_at: IN, joinery_received: false, owner_employee_id: BDM },
      { bdm_employee_id: BDM, created_at: IN, joinery_received: true, owner_employee_id: 12 },
      { bdm_employee_id: BDM, created_at: OUT, joinery_received: true },
      { bdm_employee_id: OTHER_BDM, created_at: IN, joinery_received: true },
      { bdm_employee_id: null, created_at: IN, joinery_received: null },
    ]
    const meetings = [
      { activity_type: 'architect_meeting', employee_id: BDM, created_at: IN },
      { activity_type: 'architect_meeting', employee_id: BDM, created_at: IN, parties: { party_type: 'firm' } },
      { activity_type: 'architect_meeting', employee_id: BDM, created_at: OUT },
      { activity_type: 'architect_meeting', employee_id: 12, created_at: IN },
      { activity_type: 'call', employee_id: BDM, created_at: IN },
    ]
    expect(computeBdmTargetActuals({ leads, meetings, range: RANGE, bdmId: BDM })).toEqual({
      bdm_architect_meetings: 2,
      bdm_joineries_received: 2,
      bdm_leads_generated: 3,
    })
  })

  it('reads zero, not undefined, with nothing fetched', () => {
    expect(computeBdmTargetActuals({ leads: null, meetings: undefined, range: RANGE, bdmId: BDM })).toEqual({
      bdm_architect_meetings: 0,
      bdm_joineries_received: 0,
      bdm_leads_generated: 0,
    })
  })
})

describe('summariseClosedRows', () => {
  it('sums won value, counts lost and gives a win rate', () => {
    expect(
      summariseClosedRows([
        { outcome: 'won', value: 300000 },
        { outcome: 'won', value: null },
        { outcome: 'lost', value: null },
      ])
    ).toEqual({ wonCount: 2, wonValue: 300000, lostCount: 1, winRate: 67 })
  })

  it('has no win rate until something closed', () => {
    expect(summariseClosedRows([])).toEqual({ wonCount: 0, wonValue: 0, lostCount: 0, winRate: null })
    expect(summariseClosedRows([{ outcome: 'lost' }]).winRate).toBe(0)
  })
})

describe('topArchitects', () => {
  const alpha = arch(1, 'Alpha')
  const beta = arch(2, 'Beta')
  const gamma = arch(3, 'Gamma')

  const leads = [
    // Alpha: 2 joineries in the period, ₹5L open (on hold left out).
    { bdm_employee_id: BDM, created_at: IN, joinery_received: true, current_stage: 'rfq', quote_value: 500000, referrer: alpha },
    { bdm_employee_id: BDM, created_at: IN, joinery_received: true, current_stage: 'won', order_value: 300000, other: alpha },
    { bdm_employee_id: BDM, created_at: IN, joinery_received: false, current_stage: 'on_hold', quote_value: 900000, referrer: alpha },
    // Beta: a joinery before the period, still open — no period joinery.
    { bdm_employee_id: BDM, created_at: OUT, joinery_received: true, current_stage: 'quote_submission', quote_value: 200000, referrer: beta },
    // Gamma: only old pipeline, nothing in the period → doesn't qualify.
    { bdm_employee_id: BDM, created_at: OUT, joinery_received: true, current_stage: 'rfq', quote_value: 999999, referrer: gamma },
    // Another BDM's lead via Alpha never counts here.
    { bdm_employee_id: OTHER_BDM, created_at: IN, joinery_received: true, current_stage: 'rfq', quote_value: 1, referrer: alpha },
    // A client referrer credits no architect.
    { bdm_employee_id: BDM, created_at: IN, joinery_received: true, current_stage: 'rfq', referrer: { id: 9, name: 'C', party_type: 'client' } },
  ]
  const meetings = [
    { activity_type: 'architect_meeting', employee_id: BDM, created_at: IN, parties: beta },
    { activity_type: 'architect_meeting', employee_id: BDM, created_at: IN, parties: beta },
    { activity_type: 'architect_meeting', employee_id: BDM, created_at: OUT, parties: gamma },
    { activity_type: 'architect_meeting', employee_id: BDM, created_at: IN, parties: { id: 20, name: 'Firm', party_type: 'firm' } },
  ]

  it('ranks by period joineries, then meetings, with open pipeline as a snapshot', () => {
    expect(topArchitects({ leads, meetings, range: RANGE, bdmId: BDM })).toEqual([
      { architectId: 1, name: 'Alpha', joineries: 2, meetings: 0, openValue: 500000 },
      { architectId: 2, name: 'Beta', joineries: 0, meetings: 2, openValue: 200000 },
    ])
  })

  it('breaks ties on open pipeline, then name', () => {
    const tied = [
      { bdm_employee_id: BDM, created_at: IN, joinery_received: true, current_stage: 'rfq', quote_value: 100, referrer: arch(5, 'Zed') },
      { bdm_employee_id: BDM, created_at: IN, joinery_received: true, current_stage: 'rfq', quote_value: 100, referrer: arch(6, 'Amy') },
      { bdm_employee_id: BDM, created_at: IN, joinery_received: true, current_stage: 'rfq', quote_value: 500, referrer: arch(7, 'Mid') },
    ]
    expect(topArchitects({ leads: tied, meetings: [], range: RANGE, bdmId: BDM }).map((r) => r.name)).toEqual(['Mid', 'Amy', 'Zed'])
  })

  it('ranks across several BDMs for the owner, still ignoring anyone else', () => {
    const EXEC = 12
    const both = [
      ...leads,
      { bdm_employee_id: OTHER_BDM, created_at: IN, joinery_received: true, current_stage: 'rfq', quote_value: 1, referrer: beta },
    ]
    const withExec = [...meetings, { activity_type: 'architect_meeting', employee_id: EXEC, created_at: IN, parties: gamma }]
    expect(topArchitects({ leads: both, meetings: withExec, range: RANGE, bdmIds: [BDM, OTHER_BDM] })).toEqual([
      // Alpha: 2 joineries for BDM + 1 for OTHER_BDM; open ₹5L + ₹1.
      { architectId: 1, name: 'Alpha', joineries: 3, meetings: 0, openValue: 500001 },
      { architectId: 2, name: 'Beta', joineries: 1, meetings: 2, openValue: 200001 },
    ])
    // One BDM's own view is unchanged by the other BDM's rows.
    expect(topArchitects({ leads: both, meetings: withExec, range: RANGE, bdmId: BDM })[0].joineries).toBe(2)
  })

  it('stops at five', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      bdm_employee_id: BDM,
      created_at: IN,
      joinery_received: true,
      current_stage: 'calling',
      referrer: arch(100 + i, `A${i}`),
    }))
    expect(topArchitects({ leads: many, meetings: [], range: RANGE, bdmId: BDM })).toHaveLength(5)
  })
})
