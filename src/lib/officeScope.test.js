import { describe, it, expect } from 'vitest'
import {
  OFFICE_ALL,
  OFFICE_NONE,
  buildOfficeDirectory,
  createOfficeScope,
  officeChoices,
  officeAware,
} from './officeScope'
import {
  buildPipelinePanel,
  buildLossPanel,
  buildWinRatePanel,
  buildForecastPanel,
  buildCategoryMixPanel,
  buildFollowupGapPanel,
  buildOnHoldInsightsPanel,
  buildCompletenessPanel,
  buildWorkloadPanel,
  buildActivitiesPanel,
  buildLogPanel,
  buildBookedPanel,
  buildScanningLeadsAttainPanel,
  workloadRowsFromLeads,
} from './drilldownBuilders'
import { buildAgeingPanel } from './attention'
import { buildDayTilePanel } from './dayReview'

// Three leads: Ludhiana, Amritsar, and one that predates the office column.
const directory = buildOfficeDirectory([
  { id: 1, office_territory: 'ludhiana' },
  { id: 2, office_territory: 'amritsar' },
  { id: 3, office_territory: null },
])

const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31, 23, 59, 59) }

describe('createOfficeScope', () => {
  it('keeps everything while no office is chosen', () => {
    const scope = createOfficeScope(OFFICE_ALL, directory)
    expect(scope.active).toBe(false)
    const rows = [{ lead_id: 1 }, { lead_id: null }, { lead_id: 99 }]
    expect(scope.rows(rows, (r) => r.lead_id)).toEqual(rows)
  })

  it("keeps only the chosen office's rows, and drops a row with no lead at all", () => {
    const scope = createOfficeScope('ludhiana', directory)
    const rows = [{ lead_id: 1 }, { lead_id: 2 }, { lead_id: 3 }, { lead_id: null }]
    expect(scope.rows(rows, (r) => r.lead_id)).toEqual([{ lead_id: 1 }])
  })

  it('files a lead with no office, and a lead the lookup has never seen, under Not set', () => {
    const scope = createOfficeScope(OFFICE_NONE, directory)
    const rows = [{ lead_id: 1 }, { lead_id: 3 }, { lead_id: 99 }, { lead_id: null }]
    expect(scope.rows(rows, (r) => r.lead_id).map((r) => r.lead_id)).toEqual([3, 99])
  })

  it('matches ids whatever their type — a lead id is a number in a row and a string in a Map key', () => {
    const scope = createOfficeScope('amritsar', directory)
    expect(scope.keep('2')).toBe(true)
    expect(scope.keep(2)).toBe(true)
    expect(scope.leads([{ id: 2 }, { id: 1 }])).toEqual([{ id: 2 }])
  })
})

describe('officeChoices', () => {
  it('offers only the offices present, in the fixed office order, Not set last', () => {
    expect(officeChoices([3, 2, 1, 1], directory)).toEqual([
      { key: 'ludhiana', label: 'Ludhiana' },
      { key: 'amritsar', label: 'Amritsar' },
      { key: OFFICE_NONE, label: 'Not set' },
    ])
  })

  it('offers a single choice when every lead is in one office (the shell then hides the chips)', () => {
    expect(officeChoices([1], directory)).toEqual([{ key: 'ludhiana', label: 'Ludhiana' }])
  })

  it('ignores a row with no lead', () => {
    expect(officeChoices([null, undefined], directory)).toEqual([])
  })
})

describe('officeAware', () => {
  const build = (rows) => ({ kind: 'x', value: String(rows.length) })
  const wrapped = officeAware(build, {
    leadIds: (rows) => rows.map((r) => r.lead_id),
    narrow: (scope, rows) => [scope.rows(rows, (r) => r.lead_id)],
  })
  const rows = [{ lead_id: 1 }, { lead_id: 2 }, { lead_id: 2 }]

  it('returns exactly what the builder returns, plus how to build it again', () => {
    const panel = wrapped(rows)
    expect(panel.value).toBe('3')
    expect(panel.office.leadIds()).toEqual([1, 2, 2])
    expect(panel.office.rebuild(createOfficeScope('amritsar', directory)).value).toBe('2')
  })

  it('leaves the panel alone when the call cannot be narrowed', () => {
    const noExtra = officeAware(build, { available: () => false, leadIds: () => [], narrow: (s, r) => [r] })
    expect(noExtra(rows).office).toBeUndefined()
  })

  it('passes a null panel through', () => {
    expect(officeAware(() => null, { leadIds: () => [], narrow: () => [] })()).toBeNull()
  })
})

// Each popup rebuilt for Ludhiana must equal the popup built from Ludhiana's
// rows alone — the narrowing is the only thing the filter adds.
const ludhiana = createOfficeScope('ludhiana', directory)
const lead = (id, extra = {}) => ({ id, current_stage: 'calling', quote_value: 1000, owner_employee_id: 'e1', employees: { name: 'Exec One' }, ...extra })

describe('the popups follow the chosen office', () => {
  it('pipeline: header, stage bars and the per-stage drill all come from that office’s leads', () => {
    const breakdownLeads = [lead(1, { quote_value: 5000 }), lead(2, { quote_value: 7000 }), lead(3, { quote_value: 100 })]
    const panel = buildPipelinePanel({ breakdownLeads, funnelStageHistory: [], scopeLabel: 'Company' })
    const rebuilt = panel.office.rebuild(ludhiana)
    expect(panel.stageRows.find((r) => r.label === 'Calling').count).toBe(3)
    expect(rebuilt.stageRows.find((r) => r.label === 'Calling').count).toBe(1)
    expect(rebuilt.stats[0].sub).toBe('1 leads')
    expect(rebuilt.stageRows.find((r) => r.label === 'Calling').drill.leadRows.map((r) => r.leadId)).toEqual([1])
    // the lifetime funnel stats follow too — only lead 1's history counts
    const withHistory = buildPipelinePanel({
      breakdownLeads,
      funnelStageHistory: [
        { lead_id: 1, stage: 'won', changed_at: '2026-10-01T00:00:00Z', leads: { owner_employee_id: 'e1' } },
        { lead_id: 2, stage: 'won', changed_at: '2026-10-01T00:00:00Z', leads: { owner_employee_id: 'e1' } },
      ],
    })
    expect(withHistory.stats.find((s) => s.label === 'Reached Won').value).toBe('2')
    expect(withHistory.office.rebuild(ludhiana).stats.find((s) => s.label === 'Reached Won').value).toBe('1')
  })

  it('loss reasons: only that office’s lost leads are counted', () => {
    const lossReasons = [
      { lead_id: 1, reason: 'price', lost_at: '2026-10-02', leads: { order_value: 100 } },
      { lead_id: 2, reason: 'price', lost_at: '2026-10-03', leads: { order_value: 900 } },
    ]
    const panel = buildLossPanel({ lossReasons })
    expect(panel.value).toBe('2')
    const rebuilt = panel.office.rebuild(ludhiana)
    expect(rebuilt.value).toBe('1')
    expect(rebuilt.lostLeads.map((l) => l.leadId)).toEqual([1])
  })

  it('win rate: decided leads are cut by the lead’s office', () => {
    const decidedStageHistory = [
      { lead_id: 1, stage: 'won', changed_at: '2026-10-05T00:00:00Z', leads: { owner_employee_id: 'e1' } },
      { lead_id: 2, stage: 'lost', changed_at: '2026-10-05T00:00:00Z', leads: { owner_employee_id: 'e1' } },
    ]
    const panel = buildWinRatePanel({ decidedStageHistory, employees: [{ id: 'e1', name: 'E' }], range, rangeLabel: 'October' })
    expect(panel.value).toBe('50%')
    expect(panel.office.rebuild(ludhiana).value).toBe('100%')
  })

  it('forecast: the weighted total is that office’s', () => {
    const forecast = [lead(1, { quote_value: 1000, closure_probability: 50 }), lead(2, { quote_value: 9000, closure_probability: 50 })]
    const panel = buildForecastPanel({ forecast })
    expect(panel.stats[0].sub).toBe('2 leads')
    expect(panel.office.rebuild(ludhiana).stats[0].sub).toBe('1 leads')
  })

  it('area / stage / product mix: counts only that office’s leads', () => {
    const breakdownLeads = [lead(1), lead(2), lead(3)]
    const panel = buildCategoryMixPanel({ breakdownLeads, getCategory: () => 'X', eyebrow: 'e', title: 't', unit: 'area' })
    expect(panel.value).toBe('3')
    expect(panel.office.rebuild(ludhiana).value).toBe('1')
  })

  it('the three RPC-backed lists: rows are cut by lead_id and the counts re-derived', () => {
    const gapRows = [
      { lead_id: 1, party: 'A', stage: 'calling', owner_id: 'e1', owner_name: 'E', value: 10, last_activity_at: null },
      { lead_id: 2, party: 'B', stage: 'calling', owner_id: 'e1', owner_name: 'E', value: 20, last_activity_at: null },
    ]
    expect(buildFollowupGapPanel(gapRows).office.rebuild(ludhiana).value).toBe('1')

    const holdRows = [
      { lead_id: 1, party: 'A', owner_id: 'e1', owner_name: 'E', value: 10, days_on_hold: 5 },
      { lead_id: 2, party: 'B', owner_id: 'e1', owner_name: 'E', value: 20, days_on_hold: 9 },
    ]
    expect(buildOnHoldInsightsPanel(holdRows).office.rebuild(ludhiana).value).toBe('1')

    const completeRows = [
      { lead_id: 1, party: 'A', owner_id: 'e1', owner_name: 'E', missing_fields: [], completeness_pct: 100 },
      { lead_id: 2, party: 'B', owner_id: 'e1', owner_name: 'E', missing_fields: ['pincode'], completeness_pct: 50 },
    ]
    const panel = buildCompletenessPanel(completeRows)
    expect(panel.value).toBe('75%')
    expect(panel.office.rebuild(ludhiana).value).toBe('100%')
  })

  it('a follow-up gap keeps a caller’s queueActions choice through a rebuild', () => {
    const rows = [{ lead_id: 1, party: 'A', stage: 'calling', owner_id: 'e1', owner_name: 'E', value: 10, last_activity_at: null }]
    const panel = buildFollowupGapPanel(rows, 'Test BDM', false, { queueActions: false })
    expect(panel.queueActions).toBe(false)
    expect(panel.office.rebuild(ludhiana).queueActions).toBe(false)
  })

  it('workload: re-derived from the leads for an office, and absent without them', () => {
    const leads = [
      lead(1, { quote_value: 100 }),
      lead(2, { quote_value: 900 }),
      lead(3, { current_stage: 'won' }),
    ]
    const rows = workloadRowsFromLeads(leads)
    expect(rows).toEqual([{ owner_id: 'e1', owner_name: 'Exec One', open_lead_count: 2, open_pipeline_value: 1000 }])
    const panel = buildWorkloadPanel(rows, 'Company', leads)
    expect(panel.ownerRows[0].count).toBe(2)
    expect(panel.office.rebuild(ludhiana).ownerRows[0].count).toBe(1)
    expect(buildWorkloadPanel(rows, 'Company').office).toBeUndefined()
  })

  it('Needs Attention / stale popups: the bucket’s rows and count follow', () => {
    const bucket = {
      title: 'Stale',
      count: 2,
      note: '',
      rows: [
        { leadId: 1, party: 'A', stage: 'Calling', chipClass: '', last: '', age: 20, value: 100, owner: 'E', ownerId: 'e1' },
        { leadId: 2, party: 'B', stage: 'Calling', chipClass: '', last: '', age: 30, value: 200, owner: 'E', ownerId: 'e1' },
      ],
    }
    const panel = buildAgeingPanel(bucket, 'Company')
    expect(panel.value).toBe('2')
    const rebuilt = panel.office.rebuild(ludhiana)
    expect(rebuilt.value).toBe('1')
    expect(rebuilt.ageRows.map((r) => r.leadId)).toEqual([1])
    expect(rebuilt.stats[0].sub).toBe('across 1 lead')
  })

  it('Today tiles: new leads and won deals are cut by the lead’s office', () => {
    const data = {
      newLeads: [
        { id: 1, created_by_employee_id: 'e1', created_at: '2026-10-07T04:00:00', quote_value: 100 },
        { id: 2, created_by_employee_id: 'e1', created_at: '2026-10-07T05:00:00', quote_value: 200 },
      ],
      stageChanges: [
        { id: 10, lead_id: 1, stage: 'won', changed_at: '2026-10-07T06:00:00', leads: { id: 1, owner_employee_id: 'e1', order_value: 500 } },
        { id: 11, lead_id: 2, stage: 'won', changed_at: '2026-10-07T07:00:00', leads: { id: 2, owner_employee_id: 'e1', order_value: 700 } },
      ],
    }
    const employees = [{ id: 'e1', name: 'E' }]
    const opts = { data, employees, dateISO: '2026-10-07' }
    const created = buildDayTilePanel('new_leads', opts)
    expect(created.value).toBe('2')
    expect(created.office.rebuild(ludhiana).value).toBe('1')
    const won = buildDayTilePanel('won', opts)
    expect(won.value).toBe('2')
    expect(won.office.rebuild(ludhiana).value).toBe('1')
    expect(buildDayTilePanel('nope', opts)).toBeNull()
  })

  it('Activities logged: rows are cut by lead, targets are dropped, and the loaders answer for the same office', async () => {
    const activities = [
      { activity_type: 'call', employee_id: 'e1', created_at: '2026-10-05T04:00:00', lead_id: 1, employees: { name: 'E' } },
      { activity_type: 'call', employee_id: 'e1', created_at: '2026-10-05T05:00:00', lead_id: 2, employees: { name: 'E' } },
      { activity_type: 'office_day', employee_id: 'e1', created_at: '2026-10-05T06:00:00', lead_id: null, employees: { name: 'E' } },
    ]
    const targets = [{ employee_id: 'e1', metric_name: 'call', target_value: 10 }]
    const calls = []
    const loaders = {
      loadPrevious: async () => [{ lead_id: 1 }, { lead_id: 2 }],
      loadEntries: async (f) => {
        calls.push(f)
        return []
      },
    }
    const panel = buildActivitiesPanel({ activities, targets, employees: [{ id: 'e1', name: 'E' }], range, rangeLabel: 'October', loaders })
    expect(panel.value).toBe('3')
    expect(panel.delta).toBe('of 10 target')
    const rebuilt = panel.office.rebuild(ludhiana)
    expect(rebuilt.value).toBe('1')
    expect(rebuilt.delta).toBeNull()
    expect(await rebuilt.loaders.loadPrevious()).toEqual([{ lead_id: 1 }])
    await rebuilt.loaders.loadEntries({ ownerId: 'e1', type: 'call' })
    expect(calls).toEqual([{ ownerId: 'e1', type: 'call', office: 'ludhiana' }])
    // With no office picked the loaders are the caller's own, untouched.
    expect(panel.office.rebuild(createOfficeScope(OFFICE_ALL, directory)).loaders).toBe(loaders)
  })

  it('an exec’s activity log: entries are cut by lead and the target comparison goes', () => {
    const logRows = [
      { id: 1, lead_id: 1, created_at: new Date(2026, 9, 5, 10).toISOString(), leads: { current_stage: 'calling' } },
      { id: 2, lead_id: 2, created_at: new Date(2026, 9, 6, 10).toISOString(), leads: { current_stage: 'calling' } },
    ]
    const targets = [{ id: 7, employee_id: 'e1', metric_name: 'call', target_value: 10 }]
    const panel = buildLogPanel({ employee: { id: 'e1', name: 'Exec One' }, activityType: 'call', targets, range, rangeLabel: 'October', logRows })
    expect(panel.value).toBe('2 / 10')
    const rebuilt = panel.office.rebuild(ludhiana)
    expect(rebuilt.value).toBe('1')
    expect(rebuilt.log).toHaveLength(1)
  })

  it('Orders booked: deals and the booked figure are that office’s; the target line goes', () => {
    const breakdownLeads = [
      { id: 1, current_stage: 'won', order_value: 5000, owner_employee_id: 'e1', source_type: 'scanning', employees: { name: 'E' } },
      { id: 2, current_stage: 'won', order_value: 9000, owner_employee_id: 'e1', source_type: 'scanning', employees: { name: 'E' } },
    ]
    const wonStageHistory = [
      { lead_id: 1, stage: 'won', changed_at: '2026-10-05T04:00:00Z', leads: { owner_employee_id: 'e1', order_value: 5000 } },
      { lead_id: 2, stage: 'won', changed_at: '2026-10-06T04:00:00Z', leads: { owner_employee_id: 'e1', order_value: 9000 } },
    ]
    const targets = [{ employee_id: 'e1', metric_name: 'order_value', target_value: 100000 }]
    const panel = buildBookedPanel({
      employees: [{ id: 'e1', name: 'E' }],
      targets,
      wonStageHistory,
      breakdownLeads,
      range,
      rangeLabel: 'October',
    })
    expect(panel.delta).toMatch(/target/)
    const rebuilt = panel.office.rebuild(ludhiana)
    expect(rebuilt.delta).toBeNull()
    expect(rebuilt.value).not.toBe(panel.value)
  })

  it('Scanning leads attainment: the count is that office’s and the target goes', () => {
    const breakdownLeads = [
      { id: 1, source_type: 'scanning', created_at: '2026-10-05T04:00:00Z', owner_employee_id: 'e1' },
      { id: 2, source_type: 'scanning', created_at: '2026-10-06T04:00:00Z', owner_employee_id: 'e1' },
    ]
    const targets = [{ employee_id: 'e1', metric_name: 'scanning_leads', target_value: 10 }]
    const panel = buildScanningLeadsAttainPanel({ employees: [{ id: 'e1', name: 'E' }], targets, breakdownLeads, range, rangeLabel: 'October' })
    expect(panel.value).toBe('2')
    const rebuilt = panel.office.rebuild(ludhiana)
    expect(rebuilt.value).toBe('1')
    expect(rebuilt.delta).toBeNull()
  })
})
