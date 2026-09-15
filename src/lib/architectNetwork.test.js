import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIRECTORY_SORT,
  PORTFOLIO_ALL,
  PORTFOLIO_NONE,
  buildDirectoryRows,
  filterDirectoryRows,
  sortDirectoryRows,
  summariseBdm,
  targetInputsFrom,
  targetWrites,
} from './architectNetwork'

const BDM = 46
const OTHER = 47
const EXEC = 12
const NOW = new Date('2026-09-15T12:00:00Z')
const RANGE = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-15T23:59:59.999Z') }
const IN = '2026-09-10T09:00:00'
const OUT = '2026-08-01T09:00:00'
const arch = (id, name, extra = {}) => ({ id, name, party_type: 'architect', ...extra })

describe('summariseBdm', () => {
  const leads = [
    { id: 1, bdm_employee_id: BDM, owner_employee_id: null, created_at: IN, joinery_received: true, current_stage: 'joinery_follow_up' },
    { id: 2, bdm_employee_id: BDM, owner_employee_id: EXEC, created_at: IN, joinery_received: false, current_stage: 'rfq', quote_value: 500000 },
    { id: 3, bdm_employee_id: BDM, owner_employee_id: EXEC, created_at: OUT, joinery_received: true, current_stage: 'won', order_value: 300000 },
    { id: 4, bdm_employee_id: OTHER, owner_employee_id: null, created_at: IN, joinery_received: true, current_stage: 'calling' },
  ]
  const periodMeetings = [
    { activity_type: 'architect_meeting', employee_id: BDM, created_at: IN },
    { activity_type: 'architect_meeting', employee_id: OTHER, created_at: IN },
  ]
  const architects = [
    arch(10, 'Met recently', { bdm_employee_id: BDM, bdm_since: '2026-08-01T00:00:00' }),
    arch(11, 'Only an exec met', { bdm_employee_id: BDM, bdm_since: '2026-08-01T00:00:00' }),
    arch(12, 'Other BDM', { bdm_employee_id: OTHER, bdm_since: '2026-08-01T00:00:00' }),
  ]
  const portfolioMeetings = [
    { party_id: 10, employee_id: BDM, created_at: '2026-09-14T09:00:00' },
    // An exec meeting the architect doesn't reset the BDM's clock.
    { party_id: 11, employee_id: EXEC, created_at: '2026-09-14T09:00:00' },
  ]
  const closedData = {
    stageRows: [
      { id: 90, lead_id: 3, stage: 'won', changed_at: IN, leads: leads[2] },
      { id: 91, lead_id: 4, stage: 'won', changed_at: IN, leads: { ...leads[3], current_stage: 'won' } },
    ],
    lossRows: [],
  }
  const handedOverData = [
    { id: 70, lead_id: 2, changed_at: IN, leads: leads[1] },
    { id: 71, lead_id: 4, changed_at: IN, leads: leads[3] },
  ]

  it("uses only this BDM's leads, meetings and architects", () => {
    const s = summariseBdm({ bdmId: BDM, leads, periodMeetings, architects, portfolioMeetings, closedData, handedOverData, range: RANGE, now: NOW })
    expect(s.actuals).toEqual({ bdm_architect_meetings: 1, bdm_joineries_received: 1, bdm_leads_generated: 2 })
    expect(s.openValue).toBe(500000)
    expect(s.openCount).toBe(2)
    expect(s.waitingCount).toBe(1)
    expect(s.handedOverCount).toBe(1)
    expect(s.closed).toEqual({ wonCount: 1, wonValue: 300000, lostCount: 0, winRate: 100 })
    expect(s.portfolioCount).toBe(2)
    expect(s.toMeet.map((r) => r.architect.id)).toEqual([11])
  })

  it('returns null for whatever is still loading', () => {
    const s = summariseBdm({ bdmId: BDM, leads, periodMeetings: null, architects: null, portfolioMeetings: null, closedData: null, handedOverData: null, range: RANGE, now: NOW })
    expect(s.openValue).toBe(500000)
    expect(s.actuals).toBeNull()
    expect(s.closed).toBeNull()
    expect(s.handedOverCount).toBeNull()
    expect(s.toMeet).toBeNull()
    expect(s.portfolioCount).toBeNull()
  })
})

describe('buildDirectoryRows', () => {
  it('attributes leads like Lead Detail and takes anyone\'s latest meeting', () => {
    const rows = buildDirectoryRows({
      architects: [
        arch(1, 'Alpha', { bdm_employee_id: BDM, bdm: { name: 'Test BDM' }, firm: { id: 5, name: 'Studio' } }),
        arch(2, 'Beta', { firm_name: 'Legacy Firm' }),
      ],
      meetings: [
        { party_id: 1, employee_id: EXEC, created_at: '2026-09-10T09:00:00' },
        { party_id: 1, employee_id: BDM, created_at: '2026-09-13T09:00:00' },
      ],
      leads: [
        { current_stage: 'rfq', quote_value: 400000, referrer: { id: 1, party_type: 'architect' } },
        { current_stage: 'won', order_value: 250000, other: { id: 1, party_type: 'architect' } },
        // A client referrer with Beta as the "other" party credits Beta.
        { current_stage: 'calling', referrer: { id: 9, party_type: 'client' }, other: { id: 2, party_type: 'architect' } },
      ],
      now: NOW,
    })
    expect(rows).toEqual([
      { id: 1, name: 'Alpha', mobile: null, firm: 'Studio', bdmId: BDM, bdmName: 'Test BDM', lastMetAt: '2026-09-13T09:00:00', lastMetDays: 2, referred: 2, openValue: 400000, wonValue: 250000 },
      { id: 2, name: 'Beta', mobile: null, firm: 'Legacy Firm', bdmId: null, bdmName: null, lastMetAt: null, lastMetDays: null, referred: 1, openValue: 0, wonValue: 0 },
    ])
  })
})

describe('directory filter and sort', () => {
  const rows = [
    { id: 1, name: 'Zed', firm: null, mobile: '+91 98765 43210', bdmId: BDM, lastMetDays: 20, referred: 1, openValue: 0, wonValue: 900 },
    { id: 2, name: 'Amy', firm: 'Studio A', mobile: null, bdmId: null, lastMetDays: null, referred: 5, openValue: 100, wonValue: 0 },
    { id: 3, name: 'Bob', firm: 'Builders', mobile: '9000000001', bdmId: OTHER, lastMetDays: 2, referred: 5, openValue: 300, wonValue: 10 },
  ]

  it('filters by portfolio', () => {
    expect(filterDirectoryRows(rows, { portfolio: PORTFOLIO_ALL })).toHaveLength(3)
    expect(filterDirectoryRows(rows, { portfolio: PORTFOLIO_NONE }).map((r) => r.id)).toEqual([2])
    expect(filterDirectoryRows(rows, { portfolio: String(BDM) }).map((r) => r.id)).toEqual([1])
  })

  it('searches name, firm and mobile digits', () => {
    expect(filterDirectoryRows(rows, { term: 'studio' }).map((r) => r.id)).toEqual([2])
    expect(filterDirectoryRows(rows, { term: '98765 432' }).map((r) => r.id)).toEqual([1])
    // Too few digits to be a phone search.
    expect(filterDirectoryRows(rows, { term: '9' })).toHaveLength(0)
  })

  it('sorts high to low with name tie-breaks, and puts blanks last', () => {
    expect(sortDirectoryRows(rows, DEFAULT_DIRECTORY_SORT).map((r) => r.name)).toEqual(['Amy', 'Bob', 'Zed'])
    expect(sortDirectoryRows(rows, 'open').map((r) => r.name)).toEqual(['Bob', 'Amy', 'Zed'])
    expect(sortDirectoryRows(rows, 'met').map((r) => r.name)).toEqual(['Bob', 'Zed', 'Amy'])
    expect(sortDirectoryRows(rows, 'firm').map((r) => r.name)).toEqual(['Bob', 'Amy', 'Zed'])
    expect(sortDirectoryRows(rows, 'name').map((r) => r.name)).toEqual(['Amy', 'Bob', 'Zed'])
  })
})

describe('set targets', () => {
  const onFile = [
    { employee_id: BDM, metric_name: 'bdm_architect_meetings', target_value: '5' },
    { employee_id: OTHER, metric_name: 'bdm_leads_generated', target_value: '9' },
  ]

  it("prefills only this BDM's targets", () => {
    expect(targetInputsFrom(onFile, BDM)).toEqual({ bdm_architect_meetings: '5', bdm_joineries_received: '', bdm_leads_generated: '' })
  })

  it('writes only changed, non-blank whole numbers', () => {
    expect(
      targetWrites({ bdm_architect_meetings: '5', bdm_joineries_received: '4', bdm_leads_generated: '' }, onFile, BDM)
    ).toEqual({ writes: [{ metricName: 'bdm_joineries_received', targetValue: 4 }], invalid: [] })
    expect(targetWrites({ bdm_architect_meetings: '6' }, onFile, BDM).writes).toEqual([
      { metricName: 'bdm_architect_meetings', targetValue: 6 },
    ])
    expect(targetWrites({ bdm_architect_meetings: '2.5', bdm_leads_generated: '0' }, onFile, BDM)).toEqual({
      writes: [{ metricName: 'bdm_leads_generated', targetValue: 0 }],
      invalid: ['bdm_architect_meetings'],
    })
  })
})
