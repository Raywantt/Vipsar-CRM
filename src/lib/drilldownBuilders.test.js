import { describe, it, expect } from 'vitest'
import {
  wonEventsInRange,
  buildMixPanel,
  buildCategoryMixPanel,
  buildLossPanel,
  buildWinRatePanel,
  buildPipelinePanel,
  buildForecastPanel,
  buildOverallAttainPanel,
  buildLogPanel,
  buildOrderValueAttainPanel,
  buildScanningLeadsAttainPanel,
} from './drilldownBuilders'
import { TONE_NEUTRAL } from './statusColors'

const range = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59) }

describe('wonEventsInRange', () => {
  it('keeps only the most recent won row per lead (re-opened/re-won leads counted once)', () => {
    const wonStageHistory = [
      { lead_id: 'L1', changed_at: '2026-08-10T00:00:00Z', leads: { owner_employee_id: 'e1', order_value: 5000 } },
      { lead_id: 'L1', changed_at: '2026-08-05T00:00:00Z', leads: { owner_employee_id: 'e1', order_value: 4000 } },
    ]
    const events = wonEventsInRange(wonStageHistory, range)
    expect(events).toHaveLength(1)
    expect(events[0].value).toBe(5000)
  })

  it('drops rows RLS hid (leads: null)', () => {
    const wonStageHistory = [{ lead_id: 'L2', changed_at: '2026-08-10T00:00:00Z', leads: null }]
    expect(wonEventsInRange(wonStageHistory, range)).toHaveLength(0)
  })

  it('excludes events outside the given range', () => {
    const wonStageHistory = [
      { lead_id: 'L3', changed_at: '2026-07-15T00:00:00Z', leads: { owner_employee_id: 'e1', order_value: 1000 } },
    ]
    expect(wonEventsInRange(wonStageHistory, range)).toHaveLength(0)
  })
})

describe('buildMixPanel', () => {
  const sourceOptions = [
    { label: 'Scanning', value: 'scanning' },
    { label: 'Lixil', value: 'lixil' },
  ]

  it('computes share of total and all-time conversion per source', () => {
    const periodLeads = [{ source_type: 'scanning' }, { source_type: 'scanning' }, { source_type: 'lixil' }]
    const breakdownLeads = [
      { source_type: 'scanning', current_stage: 'won' },
      { source_type: 'scanning', current_stage: 'negotiation' },
      { source_type: 'lixil', current_stage: 'lost' },
    ]
    const panel = buildMixPanel({ periodLeads, breakdownLeads, sourceOptions, rangeLabel: 'This month' })
    expect(panel.kind).toBe('mix')
    expect(panel.value).toBe('3')
    const scanning = panel.mixRows.find((r) => r.label === 'Scanning')
    expect(scanning.count).toBe(2)
    expect(scanning.share).toBe('67%')
    expect(scanning.conv).toBe('50%') // 1 won / 2 all-time scanning leads
  })

  it('renders "—" conversion for a source with zero all-time leads', () => {
    const panel = buildMixPanel({ periodLeads: [], breakdownLeads: [], sourceOptions, rangeLabel: 'This month' })
    panel.mixRows.forEach((r) => expect(r.conv).toBe('—'))
  })
})

describe('buildCategoryMixPanel', () => {
  it('groups by the supplied category function and sorts by count desc', () => {
    const breakdownLeads = [
      { id: 1, current_stage: 'won', order_value: 1000, sites: { locality: 'Model Town' } },
      { id: 2, current_stage: 'negotiation', order_value: 0, sites: { locality: 'Model Town' } },
      { id: 3, current_stage: 'lost', order_value: 0, sites: { locality: 'DLF' } },
    ]
    const panel = buildCategoryMixPanel({
      breakdownLeads,
      getCategory: (l) => l.sites?.locality ?? 'Unknown',
      eyebrow: 'Company · area',
      title: 'Leads by area',
      unit: 'area',
    })
    expect(panel.mixRows[0]).toMatchObject({ label: 'Model Town', count: 2 })
    expect(panel.mixRows[1]).toMatchObject({ label: 'DLF', count: 1 })
  })
})

describe('buildLossPanel', () => {
  it('buckets reasons and named competitors, and falls back unrecognized reasons to "other"', () => {
    const lossReasons = [
      { reason: 'price', leads: { order_value: 10000 }, lost_at: '2026-08-01', competitor_name: 'Acme' },
      { reason: 'price', leads: { order_value: 5000 }, lost_at: '2026-08-02', competitor_name: 'Acme' },
      { reason: 'not-a-real-reason', leads: { quote_value: 2000 }, lost_at: '2026-08-03', competitor_name: null },
    ]
    const panel = buildLossPanel({ lossReasons })
    expect(panel.value).toBe('3')
    const priceRow = panel.lossRows.find((r) => r.label === 'price')
    expect(priceRow.count).toBe(2)
    const otherRow = panel.lossRows.find((r) => r.label === 'other')
    expect(otherRow.count).toBe(1)
    expect(panel.compRows).toEqual([{ name: 'Acme', count: 2, value: expect.any(String) }])
  })

  it('handles an empty loss list without dividing by zero', () => {
    const panel = buildLossPanel({ lossReasons: [] })
    expect(panel.value).toBe('0')
    expect(panel.compRows).toEqual([])
  })
})

describe('buildWinRatePanel', () => {
  const employees = [{ id: 'e1', name: 'Asha' }, { id: 'e2', name: 'Ravi' }]

  it('computes win rate from decided (won/lost) leads only, ignoring rows outside the range', () => {
    const decidedStageHistory = [
      { stage: 'won', changed_at: '2026-08-05', leads: { owner_employee_id: 'e1' } },
      { stage: 'lost', changed_at: '2026-08-06', leads: { owner_employee_id: 'e1' } },
      { stage: 'won', changed_at: '2026-07-01', leads: { owner_employee_id: 'e2' } }, // outside range
    ]
    const panel = buildWinRatePanel({ decidedStageHistory, employees, range, rangeLabel: 'This month' })
    expect(panel.value).toBe('50%')
    expect(panel.stats.find((s) => s.label === 'Decided').value).toBe('2')
  })

  it('returns "—" when nothing was decided in range', () => {
    const panel = buildWinRatePanel({ decidedStageHistory: [], employees, range, rangeLabel: 'This month' })
    expect(panel.value).toBe('—')
  })
})

describe('buildPipelinePanel', () => {
  it('excludes lost and on_hold from the stage-to-stage conversion chain (no "won -> lost" row)', () => {
    const breakdownLeads = [
      { id: 'L1', current_stage: 'calling', quote_value: 1000, order_value: null },
    ]
    const funnelStageHistory = []
    const panel = buildPipelinePanel({ breakdownLeads, funnelStageHistory })
    const labels = panel.convRows.map((r) => r.label)
    labels.forEach((label) => {
      expect(label).not.toMatch(/Won.*Lost/i)
      expect(label).not.toMatch(/On hold/i)
    })
  })

  it('sums open pipeline value only from leads not won/lost', () => {
    const breakdownLeads = [
      { id: 'L1', current_stage: 'negotiation', quote_value: 10000, order_value: null },
      { id: 'L2', current_stage: 'won', quote_value: 5000, order_value: 8000 },
    ]
    const panel = buildPipelinePanel({ breakdownLeads, funnelStageHistory: [] })
    expect(panel.stats.find((s) => s.label === 'Open value').sub).toBe('1 leads')
  })
})

describe('buildForecastPanel', () => {
  // An unset closure_probability is a lead nobody has assessed, not a lead
  // judged unlikely. It renders as an em-dash, so the colour is the only
  // thing left that could still assert a number the exec never typed.
  const forecast = [
    { id: 'L1', closure_probability: null, quote_value: 100000, current_stage: 'negotiation' },
    { id: 'L2', closure_probability: 20, quote_value: 100000, current_stage: 'negotiation' },
    { id: 'L3', closure_probability: 80, quote_value: 100000, current_stage: 'negotiation' },
  ]

  it('renders an unset probability as an em-dash in a neutral tone, not red', () => {
    const [unset] = buildForecastPanel({ forecast }).fcRows
    expect(unset.prob).toBe('—')
    expect(unset.probColor).toBe(TONE_NEUTRAL)
  })

  it('still colours a genuinely low probability red', () => {
    const low = buildForecastPanel({ forecast }).fcRows[1]
    expect(low.prob).toBe('20%')
    expect(low.probColor).toBe('#b4232a')
  })

  it('still colours a high probability green', () => {
    const high = buildForecastPanel({ forecast }).fcRows[2]
    expect(high.probColor).toBe('#1f6f4a')
  })
})

// Regression test for a real reported/confirmed bug: this panel's headline
// used to average raw, uncapped ratios, so an exec with one metric far over
// target (Raghav Gupta: 9 RFQs raised against a target of 4, i.e. 225%) got
// a desktop "Overall" figure nowhere near what EmployeeProfile's rank pill
// or this card's own mobile row showed for the identical person/period. The
// headline must now match blendedAttainmentFor's 100%-per-metric cap; the
// "Line by line" rows stay uncapped, since a real 225% on one metric is
// still worth showing honestly on its own.
describe('buildOverallAttainPanel', () => {
  const employee = { id: 'e1', name: 'Raghav Gupta' }
  const targets = [
    { employee_id: 'e1', metric_name: 'call', target_value: 40 },
    { employee_id: 'e1', metric_name: 'rfq_raised', target_value: 4 },
    { employee_id: 'e1', metric_name: 'scanning_leads', target_value: 10 },
  ]
  const activities = [
    ...Array.from({ length: 16 }, () => ({ employee_id: 'e1', activity_type: 'call' })),
    ...Array.from({ length: 9 }, () => ({ employee_id: 'e1', activity_type: 'rfq_raised' })),
  ]
  const breakdownLeads = [{ owner_employee_id: 'e1', source_type: 'scanning', created_at: '2026-08-05T00:00:00Z' }]

  it('caps the headline the same way blendedAttainmentFor does, not a raw average', () => {
    const panel = buildOverallAttainPanel({ employee, targets, activities, wonStageHistory: [], breakdownLeads, range, rangeLabel: 'this week' })
    // Raw ratios: call 16/40=40%, rfq_raised 9/4=225%, scanning_leads 1/10=10%.
    // A naive average of the raw pct's would be round((40+225+10)/3) = 92%.
    // Capped at 100% per metric first: (0.40 + 1.00 + 0.10) / 3 = 50%.
    expect(panel.value).toBe('50%')
    expect(panel.stats[0].value).toBe('50%')
  })

  it('still reports the RFQ line-by-line row at its real, uncapped 225%', () => {
    const panel = buildOverallAttainPanel({ employee, targets, activities, wonStageHistory: [], breakdownLeads, range, rangeLabel: 'this week' })
    const rfqRow = panel.contrib.find((r) => r.label === 'RFQ Raised')
    expect(rfqRow.value).toBe('9 / 4')
  })
})

// Regression tests for a real reported bug (2026-09-10): this panel's entry
// list used to show every fetched row (up to ~60 days back) regardless of
// which Dashboard period (Week/Month/Quarter) was selected, so a cell's own
// drill-down could list activity from weeks the cell's own headline count
// didn't include at all. The list must now match the SAME range the
// headline (`value`) is computed from — the rhythm chart's own fixed "last
// 20 working days" stat is deliberately untouched (see buildLogPanel's
// header comment), so this only pins the entry-list scoping, not the chart.
describe('buildLogPanel', () => {
  const employee = { id: 'e1', name: 'Raghav Gupta' }
  const targets = [{ id: 501, employee_id: 'e1', metric_name: 'call', target_value: 10 }]
  const logRows = [
    { id: 1, created_at: '2026-08-15T10:00:00Z', notes: 'In range', parties: { name: 'Party A' } },
    { id: 2, created_at: '2026-08-20T10:00:00Z', notes: 'Also in range', parties: { name: 'Party B' } },
    { id: 3, created_at: '2026-07-10T10:00:00Z', notes: 'Before the selected month', parties: { name: 'Party C' } },
  ]

  it('scopes the entry list to the selected period, not every fetched row', () => {
    const panel = buildLogPanel({ employee, activityType: 'call', targets, range, rangeLabel: 'this month', logRows })
    expect(panel.log).toHaveLength(2)
    expect(panel.log.map((r) => r.id)).toEqual([1, 2])
  })

  it('headline count matches the scoped list, not the full fetch', () => {
    const panel = buildLogPanel({ employee, activityType: 'call', targets, range, rangeLabel: 'this month', logRows })
    expect(panel.value).toBe('2 / 10')
  })

  // buildLogPanel's own cancelTarget attachment — see DrilldownPanel.jsx's
  // CancelTargetControl and targetQueries.js's deleteTarget for the rest of
  // this feature (a "Cancel this target" option on a heatmap cell's panel).
  it('attaches cancelTarget only when canCancelTarget is true and a real target row exists', () => {
    const withCancel = buildLogPanel({ employee, activityType: 'call', targets, range, rangeLabel: 'this month', logRows, canCancelTarget: true })
    expect(withCancel.cancelTarget).toEqual({ id: 501 })

    const flagOff = buildLogPanel({ employee, activityType: 'call', targets, range, rangeLabel: 'this month', logRows })
    expect(flagOff.cancelTarget).toBeNull()

    const noTargetSet = buildLogPanel({ employee, activityType: 'rfq_raised', targets, range, rangeLabel: 'this month', logRows, canCancelTarget: true })
    expect(noTargetSet.cancelTarget).toBeNull()
  })
})

describe('buildOrderValueAttainPanel cancelTarget', () => {
  const employees = [{ id: 'e1', name: 'Raghav Gupta' }]
  const targets = [{ id: 601, employee_id: 'e1', metric_name: 'order_value', target_value: 500000 }]

  it('attaches cancelTarget only for a single-employee scope with canCancelTarget and a real row', () => {
    const single = buildOrderValueAttainPanel({ employees, targets, wonStageHistory: [], range, employeeId: 'e1', rangeLabel: 'this week', canCancelTarget: true })
    expect(single.cancelTarget).toEqual({ id: 601 })

    const flagOff = buildOrderValueAttainPanel({ employees, targets, wonStageHistory: [], range, employeeId: 'e1', rangeLabel: 'this week' })
    expect(flagOff.cancelTarget).toBeNull()

    // Company-wide (employeeId: null) has no single row to cancel, even with the flag on.
    const companyWide = buildOrderValueAttainPanel({ employees, targets, wonStageHistory: [], range, employeeId: null, rangeLabel: 'this week', canCancelTarget: true })
    expect(companyWide.cancelTarget).toBeNull()
  })
})

describe('buildScanningLeadsAttainPanel cancelTarget', () => {
  const employees = [{ id: 'e1', name: 'Raghav Gupta' }]
  const targets = [{ id: 701, employee_id: 'e1', metric_name: 'scanning_leads', target_value: 10 }]

  it('attaches cancelTarget only for a single-employee scope with canCancelTarget and a real row', () => {
    const single = buildScanningLeadsAttainPanel({ employees, targets, breakdownLeads: [], range, employeeId: 'e1', rangeLabel: 'this week', canCancelTarget: true })
    expect(single.cancelTarget).toEqual({ id: 701 })

    const flagOff = buildScanningLeadsAttainPanel({ employees, targets, breakdownLeads: [], range, employeeId: 'e1', rangeLabel: 'this week' })
    expect(flagOff.cancelTarget).toBeNull()

    const companyWide = buildScanningLeadsAttainPanel({ employees, targets, breakdownLeads: [], range, employeeId: null, rangeLabel: 'this week', canCancelTarget: true })
    expect(companyWide.cancelTarget).toBeNull()
  })
})
