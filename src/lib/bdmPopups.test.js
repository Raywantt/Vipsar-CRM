import { describe, it, expect } from 'vitest'
import {
  buildBdmTargetPanel,
  buildBdmMeetingsPanel,
  buildBdmPoolPanel,
  buildBdmHandedOverPanel,
  buildBdmClosedPanel,
} from './bdmPopups'
import { computeBdmTargetActuals, summariseClosedRows } from './bdmDashboard'
import { buildClosedRows } from './bdmLeadUpdates'
import { buildOfficeDirectory, createOfficeScope } from './officeScope'

const BDM = { id: 9, name: 'Test BDM' }
const range = { start: new Date(Date.UTC(2026, 9, 1)), end: new Date(Date.UTC(2026, 9, 31, 23, 59, 59)) }

const lead = (id, extra = {}) => ({
  id,
  bdm_employee_id: 9,
  owner_employee_id: 5,
  current_stage: 'calling',
  quote_value: null,
  created_at: '2026-10-05T04:00:00',
  source_type: 'scanning',
  office_territory: 'ludhiana',
  joinery_received: false,
  employees: { name: 'Exec One' },
  parties: { name: `Client ${id}` },
  referrer: null,
  other: null,
  ...extra,
})

// 1 pool lead with joinery (Ludhiana), 1 handed-over lead with joinery (Amritsar),
// 1 plain handed-over lead (Ludhiana), 1 created last month, 1 another BDM's.
const leads = [
  lead(1, { owner_employee_id: null, joinery_received: true, employees: null }),
  lead(2, { joinery_received: true, office_territory: 'amritsar', quote_value: 500000 }),
  lead(3),
  lead(4, { created_at: '2026-09-02T04:00:00' }),
  lead(5, { bdm_employee_id: 77 }),
]
const directory = buildOfficeDirectory(leads.map((l) => ({ id: l.id, office_territory: l.office_territory })))
const ludhiana = createOfficeScope('ludhiana', directory)

describe('target rows open the list their figure counts', () => {
  const meetings = [
    { id: 1, activity_type: 'architect_meeting', employee_id: 9, created_at: '2026-10-02T05:00:00', parties: { id: 40, name: 'Arch A', party_type: 'architect' } },
    { id: 2, activity_type: 'architect_meeting', employee_id: 9, created_at: '2026-10-04T05:00:00', parties: { id: 40, name: 'Arch A', party_type: 'architect' } },
    { id: 3, activity_type: 'architect_meeting', employee_id: 9, created_at: '2026-10-06T05:00:00', parties: { id: 41, name: 'Studio X', party_type: 'firm' } },
    { id: 4, activity_type: 'architect_meeting', employee_id: 9, created_at: '2026-08-06T05:00:00', parties: { id: 42, name: 'Old', party_type: 'architect' } },
    { id: 5, activity_type: 'architect_meeting', employee_id: 77, created_at: '2026-10-06T05:00:00', parties: { id: 43, name: 'Other BDM', party_type: 'architect' } },
    { id: 6, activity_type: 'call', employee_id: 9, created_at: '2026-10-06T05:00:00', parties: null },
  ]

  it('Architect meetings lists exactly the rows computeBdmTargetActuals counts', () => {
    const panel = buildBdmTargetPanel({ metric: 'bdm_architect_meetings', bdm: BDM, leads, meetings, range, rangeLabel: 'this month', target: 4 })
    const counted = computeBdmTargetActuals({ leads, meetings, range, bdmId: 9 }).bdm_architect_meetings
    expect(counted).toBe(3)
    expect(panel.kind).toBe('records')
    expect(panel.value).toBe(String(counted))
    expect(panel.delta).toBe('of 4 target')
    const rows = panel.sections[0].rows
    expect(rows).toHaveLength(counted)
    // newest first; an architect links to the profile, a firm is plain text
    expect(rows.map((r) => r.name)).toEqual(['Studio X', 'Arch A', 'Arch A'])
    expect(rows[0].to).toBeNull()
    expect(rows[1].to).toBe('/architects/40')
    expect(panel.figures.map((f) => f.value)).toEqual(['3', '1', '1', '1'])
  })

  it('Joineries received lists the joinery leads created in the period, and says where each is', () => {
    const panel = buildBdmTargetPanel({ metric: 'bdm_joineries_received', bdm: BDM, leads, meetings, range, rangeLabel: 'this month', target: 3 })
    const counted = computeBdmTargetActuals({ leads, meetings, range, bdmId: 9 }).bdm_joineries_received
    expect(counted).toBe(2)
    expect(panel.value).toBe('2')
    expect(panel.sections[0].rows.map((r) => r.key).sort()).toEqual(['lead-1', 'lead-2'])
    expect(panel.sections[0].rows).toHaveLength(counted)
    expect(panel.sections[0].rows.find((r) => r.key === 'lead-1').meta).toContain('Waiting in pool')
    expect(panel.sections[0].rows.find((r) => r.key === 'lead-2').meta).toContain('With Exec One')
    // Joineries · With a rep · In the pool · Open pipeline
    expect(panel.figures.map((f) => f.value)).toEqual(['2', '1', '1', '₹5.0L'])
  })

  it('Leads generated lists every lead created in the period, pool and assigned alike', () => {
    const panel = buildBdmTargetPanel({ metric: 'bdm_leads_generated', bdm: BDM, leads, meetings, range, rangeLabel: 'this month', target: null })
    const counted = computeBdmTargetActuals({ leads, meetings, range, bdmId: 9 }).bdm_leads_generated
    expect(counted).toBe(3)
    expect(panel.sections[0].rows.map((r) => r.key).sort()).toEqual(['lead-1', 'lead-2', 'lead-3'])
    expect(panel.delta).toBeNull()
    expect(panel.figures.map((f) => f.value)).toEqual(['3', '2', '2', '1'])
  })

  it('a leads target popup follows an office and drops the target while one is chosen', () => {
    const panel = buildBdmTargetPanel({ metric: 'bdm_leads_generated', bdm: BDM, leads, meetings, range, rangeLabel: 'this month', target: 5 })
    expect(panel.delta).toBe('of 5 target')
    const rebuilt = panel.office.rebuild(ludhiana)
    expect(rebuilt.sections[0].rows.map((r) => r.key).sort()).toEqual(['lead-1', 'lead-3'])
    expect(rebuilt.delta).toBeNull()
    // only the offices the popup's own leads are in are offered
    expect(panel.office.leadIds().sort()).toEqual([1, 2, 3])
  })

  it('the meetings popup is not about leads, so it carries no office chips', () => {
    expect(buildBdmMeetingsPanel({ bdm: BDM, meetings, range, rangeLabel: 'this month' }).office).toBeUndefined()
  })

  it('an empty period says so rather than draw empty lists', () => {
    const panel = buildBdmTargetPanel({ metric: 'bdm_architect_meetings', bdm: BDM, leads, meetings: [], range, rangeLabel: 'this week' })
    expect(panel.value).toBe('0')
    expect(panel.sections[0].rows).toEqual([])
    expect(panel.empty).toMatch(/no Architect Meeting this week/)
  })
})

describe('Waiting in pool', () => {
  it('lists this BDM’s ownerless leads, oldest first, with how long each has waited', () => {
    const two = [lead(1, { owner_employee_id: null, created_at: '2026-10-01T04:00:00', joinery_received: true }), lead(2, { owner_employee_id: null, created_at: '2026-10-05T04:00:00' }), lead(3), lead(6, { owner_employee_id: null, bdm_employee_id: 77 })]
    const panel = buildBdmPoolPanel({ bdm: BDM, leads: two })
    expect(panel.value).toBe('2')
    expect(panel.sections[0].rows.map((r) => r.key)).toEqual(['lead-1', 'lead-2'])
    expect(panel.sections[0].rows[0].meta).toMatch(/waiting \d+d/)
    expect(panel.figures[3].value).toBe('1') // joinery received
    expect(panel.figures[0].value).toBe('2')
  })

  it('narrows to an office', () => {
    const two = [lead(1, { owner_employee_id: null }), lead(2, { owner_employee_id: null, office_territory: 'amritsar' })]
    const dir = buildOfficeDirectory(two.map((l) => ({ id: l.id, office_territory: l.office_territory })))
    const rebuilt = buildBdmPoolPanel({ bdm: BDM, leads: two }).office.rebuild(createOfficeScope('amritsar', dir))
    expect(rebuilt.value).toBe('1')
  })
})

describe('Handed over', () => {
  const handedOverData = [
    { id: 1, lead_id: 11, changed_at: '2026-10-06T05:00:00', new: { name: 'Exec One' }, leads: { id: 11, bdm_employee_id: 9, current_stage: 'won', parties: { name: 'Won Lead' } } },
    { id: 2, lead_id: 12, changed_at: '2026-10-04T05:00:00', new: { name: 'Exec Two' }, leads: { id: 12, bdm_employee_id: 9, current_stage: 'calling', parties: { name: 'Open Lead' } } },
    { id: 3, lead_id: 13, changed_at: '2026-10-03T05:00:00', new: { name: 'Exec One' }, leads: { id: 13, bdm_employee_id: 77, current_stage: 'calling', parties: { name: 'Not mine' } } },
  ]

  it('is the BDM’s Handed over list, newest first, with who got each lead', () => {
    const panel = buildBdmHandedOverPanel({ bdm: BDM, handedOverData, rangeLabel: 'this week' })
    expect(panel.value).toBe('2')
    expect(panel.sections[0].rows.map((r) => r.name)).toEqual(['Won Lead', 'Open Lead'])
    expect(panel.sections[0].rows[0].meta).toBe('Assigned to Exec One')
    // Handed over · Reps · Still open · Won since
    expect(panel.figures.map((f) => f.value)).toEqual(['2', '2', '1', '1'])
  })

  it('narrows to an office by lead id', () => {
    const dir = buildOfficeDirectory([{ id: 11, office_territory: 'ludhiana' }, { id: 12, office_territory: 'amritsar' }])
    const rebuilt = buildBdmHandedOverPanel({ bdm: BDM, handedOverData, rangeLabel: 'this week' }).office.rebuild(createOfficeScope('amritsar', dir))
    expect(rebuilt.value).toBe('1')
  })
})

describe('Won and Win rate share one Closed popup', () => {
  const stageRows = [
    { id: 1, lead_id: 21, stage: 'won', changed_at: '2026-10-06T05:00:00', leads: { id: 21, bdm_employee_id: 9, owner_employee_id: 5, current_stage: 'won', order_value: 900000, parties: { name: 'Big Win' }, employees: { name: 'Exec One' } } },
    { id: 2, lead_id: 22, stage: 'lost', changed_at: '2026-10-05T05:00:00', leads: { id: 22, bdm_employee_id: 9, owner_employee_id: 9, current_stage: 'lost', parties: { name: 'Lost One' }, employees: { name: 'Test BDM' } } },
    { id: 3, lead_id: 23, stage: 'won', changed_at: '2026-10-04T05:00:00', leads: { id: 23, bdm_employee_id: 9, owner_employee_id: 5, current_stage: 'calling', order_value: 1, parties: { name: 'Reopened' }, employees: { name: 'Exec One' } } },
  ]
  const lossRows = [{ lead_id: 22, reason: 'price', competitor_name: 'Acme', lost_at: '2026-10-05' }]
  const closedData = { stageRows, lossRows }

  it('totals exactly what the Closed card and Pipeline closed figure total', () => {
    const s = summariseClosedRows(buildClosedRows(stageRows, lossRows, 9))
    const won = buildBdmClosedPanel({ bdm: BDM, closedData, rangeLabel: 'this week', focus: 'won' })
    const rate = buildBdmClosedPanel({ bdm: BDM, closedData, rangeLabel: 'this week', focus: 'winrate' })
    expect(s).toMatchObject({ wonCount: 1, lostCount: 1, winRate: 50 })
    expect(won.value).toBe('₹9.0L')
    expect(won.delta).toBe('1 lead')
    expect(rate.value).toBe('50%')
    expect(rate.delta).toBe('1 won · 1 lost')
    // same sections either way; a reopened lead is left out
    expect(won.sections).toEqual(rate.sections)
    expect(won.sections.map((x) => x.rows.length)).toEqual([1, 1])
    expect(won.figures.map((f) => f.value)).toEqual(['₹9.0L', '1', '1', '50%'])
  })

  it('says why a lost lead was lost, and names the owner by name when the BDM worked it themselves', () => {
    const owner = buildBdmClosedPanel({ bdm: BDM, closedData, rangeLabel: 'this week', selfLabel: 'Test BDM' })
    const lost = owner.sections[1].rows[0]
    expect(lost.meta).toContain('Acme')
    expect(lost.meta).toContain('Test BDM')
    expect(lost.meta).not.toContain('You')
    const own = buildBdmClosedPanel({ bdm: BDM, closedData, rangeLabel: 'this week' })
    expect(own.sections[1].rows[0].meta).toContain('You')
  })

  it('nothing closed reads "—", never 0%', () => {
    const panel = buildBdmClosedPanel({ bdm: BDM, closedData: { stageRows: [], lossRows: [] }, rangeLabel: 'this week', focus: 'winrate' })
    expect(panel.value).toBe('—')
    expect(panel.empty).toMatch(/were won or lost this week/)
  })

  it('narrows both the stage rows and the loss rows to an office', () => {
    const dir = buildOfficeDirectory([{ id: 21, office_territory: 'ludhiana' }, { id: 22, office_territory: 'amritsar' }, { id: 23, office_territory: 'ludhiana' }])
    const rebuilt = buildBdmClosedPanel({ bdm: BDM, closedData, rangeLabel: 'this week' }).office.rebuild(createOfficeScope('ludhiana', dir))
    expect(rebuilt.sections.map((x) => x.rows.length)).toEqual([1, 0])
    expect(rebuilt.figures[3].value).toBe('100%')
  })
})
