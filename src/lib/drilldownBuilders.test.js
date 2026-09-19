import { describe, it, expect } from 'vitest'
import {
  wonEventsInRange,
  buildMixPanel,
  buildCategoryMixPanel,
  buildLossPanel,
  buildWinRatePanel,
  buildPipelinePanel,
  buildForecastPanel,
  buildActivitiesPanel,
  shapeActivityEntry,
  buildOverallAttainPanel,
  buildLogPanel,
  buildOrderValueAttainPanel,
  buildBookedPanel,
  buildScanningLeadsAttainPanel,
  buildArchitectsToMeetPanel,
} from './drilldownBuilders'
import { TONE_NEUTRAL } from './statusColors'

describe('buildArchitectsToMeetPanel', () => {
  it("lists architectsToMeet's rows in order, each with firm and last meeting", () => {
    const panel = buildArchitectsToMeetPanel(
      [
        { architect: { id: 7, name: 'Alpha', firm: { id: 1, name: 'Studio A' } }, lastMetDays: null, clockDays: 30 },
        { architect: { id: 8, name: 'Beta', firm: null }, lastMetDays: 16, clockDays: 16 },
      ],
      'Test BDM'
    )
    expect(panel.kind).toBe('architects')
    expect(panel.eyebrow).toBe('Test BDM · architects to meet')
    expect(panel.value).toBe('2')
    expect(panel.architectRows).toEqual([
      { id: 7, name: 'Alpha', meta: 'Studio A · not met yet', days: '30d' },
      { id: 8, name: 'Beta', meta: 'last met 16d ago', days: '16d' },
    ])
  })
})

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

  it('names an owner outside the exec roster (a BDM working their own lead) from the embed, not "Unassigned"', () => {
    const decidedStageHistory = [
      { stage: 'won', changed_at: '2026-08-05', leads: { owner_employee_id: 'b1', employees: { name: 'Bina (BDM)' } } },
      { stage: 'lost', changed_at: '2026-08-06', leads: { owner_employee_id: null, employees: null } },
    ]
    const panel = buildWinRatePanel({ decidedStageHistory, employees, range, rangeLabel: 'This month' })
    const names = panel.execRows.map((r) => r.name).sort()
    expect(names).toEqual(['Bina (BDM)', 'Unassigned'])
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

  describe('owner + lead-stage filters (showListFilters)', () => {
    const lead = (id, owner, name, stage, quote) => ({
      id,
      current_stage: stage,
      quote_value: quote,
      order_value: null,
      owner_employee_id: owner,
      employees: owner ? { name } : null,
    })
    const breakdownLeads = [
      lead('L1', 1, 'Asha', 'calling', 100000),
      lead('L2', 1, 'Asha', 'negotiation', 300000),
      lead('L3', 2, 'Ravi', 'negotiation', 200000),
      lead('L4', 2, 'Ravi', 'on_hold', 50000),
      lead('L5', null, null, 'calling', 10000),
      lead('L6', 1, 'Asha', 'won', 999999), // closed — never in any view
    ]
    const build = (extra = {}) => buildPipelinePanel({ breakdownLeads, funnelStageHistory: [], showListFilters: true, ...extra })

    it('is off unless asked for, so a viewer of one person\'s leads gets no filters', () => {
      expect(buildPipelinePanel({ breakdownLeads, funnelStageHistory: [] }).filters).toBeNull()
    })

    it('is off in concentration mode, whose focused header a filter would contradict', () => {
      expect(build({ concentrationMode: true }).filters).toBeNull()
    })

    it('offers each view its own owners (busiest first) and its own stages, in funnel order', () => {
      const { options } = build().filters
      expect(options.all.total).toBe(5)
      expect(options.all.owners.map((o) => [o.key, o.name, o.count])).toEqual([
        ['1', 'Asha', 2],
        ['2', 'Ravi', 2],
        ['unassigned', 'Unassigned', 1],
      ])
      expect(options.all.stages.map((s) => s.key)).toEqual(['calling', 'negotiation', 'on_hold'])
      // Active excludes the on-hold lead, so its owner list and chips shrink with it.
      expect(options.active.total).toBe(4)
      expect(options.active.stages.map((s) => s.key)).toEqual(['calling', 'negotiation'])
    })

    it('hides a facet with only one choice — one owner or one stage is decoration', () => {
      const { options } = build().filters
      expect(options.onHold.total).toBe(1)
      expect(options.onHold.owners).toEqual([])
      expect(options.onHold.stages).toEqual([])
    })

    it('re-derives the stage bars, count and value from the filtered leads, listing all of them', () => {
      const { viewFor } = build().filters
      const view = viewFor('all', '1', '')
      expect(view.note).toMatch(/^2 open leads/) // L1 + L2; L6 is won, so it's in no view
      expect(view.topLeadsTotal).toBe(2)
      expect(view.topLeads.map((t) => t.leadId)).toEqual(['L2', 'L1']) // by value, not capped at 5
      const negotiation = view.stageRows.find((r) => r.label === 'Negotiation')
      expect(negotiation.count).toBe(1)
      expect(view.stageRows.find((r) => r.label === 'Calling').count).toBe(1)
    })

    it('lists every match rather than the usual top 5', () => {
      const many = Array.from({ length: 9 }, (_, i) => lead(`M${i}`, 1, 'Asha', 'calling', 1000 + i))
      const { viewFor } = buildPipelinePanel({
        breakdownLeads: [...many, lead('X', 2, 'Ravi', 'calling', 5)],
        funnelStageHistory: [],
        showListFilters: true,
      }).filters
      expect(viewFor('all', '1', '').topLeads).toHaveLength(9)
      expect(buildPipelinePanel({ breakdownLeads: many, funnelStageHistory: [] }).scopeViews.all.topLeads).toHaveLength(5)
    })

    it('combines owner and stage, and the unassigned owner has a key of its own', () => {
      const { viewFor } = build().filters
      expect(viewFor('all', '2', 'negotiation').topLeads.map((t) => t.leadId)).toEqual(['L3'])
      expect(viewFor('all', 'unassigned', '').topLeads.map((t) => t.leadId)).toEqual(['L5'])
      expect(viewFor('all', '1', 'on_hold').topLeads).toEqual([])
    })

    it('scopes a bar\'s drill-down to the chosen owner, so its count and its list agree', () => {
      const { viewFor } = build().filters
      const drill = viewFor('all', '1', '').stageRows.find((r) => r.label === 'Negotiation').drill
      expect(drill.leadRows.map((r) => r.leadId)).toEqual(['L2']) // not Ravi's L3
    })
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

describe('buildBookedPanel', () => {
  const employees = [
    { id: 1, name: 'Raghav Gupta' },
    { id: 2, name: 'Vishal Kumar' },
  ]
  const targets = [{ id: 601, employee_id: 1, metric_name: 'order_value', target_value: 500000 }]
  const breakdownLeads = [
    { id: 10, created_at: '2026-08-01T05:00:00', source_type: 'scanning', office_territory: 'ludhiana', parties: { name: 'Sharma' }, employees: { name: 'Raghav Gupta' }, products: { name: 'TOSTEM' } },
    { id: 11, created_at: '2026-08-01T05:00:00', source_type: 'referral_other', office_territory: 'amritsar', parties: { name: 'Gill' }, employees: { name: 'Vishal Kumar' }, products: { name: 'TOSTEM' } },
  ]
  const wonStageHistory = [
    { lead_id: 11, changed_at: '2026-08-20T05:00:00', leads: { owner_employee_id: 2, bdm_employee_id: null, order_value: 900000 } },
    { lead_id: 10, changed_at: '2026-08-10T05:00:00', leads: { owner_employee_id: 1, bdm_employee_id: null, order_value: 300000 } },
  ]
  const base = { employees, targets, wonStageHistory, breakdownLeads, range, rangeLabel: 'this month' }

  it('is its own kind, headed by the same figure the KPI tile shows', () => {
    const panel = buildBookedPanel(base)
    expect(panel.kind).toBe('booked')
    expect(panel.title).toBe('Orders booked')
    expect(panel.value).toBe('₹12.0L')
    // The strip is in the body, following the filters; the head carries none.
    expect(panel.stats).toBeNull()
  })

  it('offers the owner and source filters the period supports', () => {
    const panel = buildBookedPanel(base)
    expect(panel.filters.owners.map((o) => o.name)).toEqual(['Raghav Gupta', 'Vishal Kumar'])
    expect(panel.filters.sources.map((s) => s.key)).toEqual(['scanning', 'referral_other'])
    expect(panel.filters.total).toBe(2)
  })

  it('offers no Owner filter for a single-person view, even though the roster holds everyone', () => {
    // A sales exec's `employees` is the whole company roster. BookedBody shows
    // "Closed by" only when there are owners to choose between, so an empty facet
    // is what keeps every colleague off the list at ₹0.
    const solo = buildBookedPanel({ ...base, compareExecs: false })
    expect(solo.filters.owners).toEqual([])
    // A zero-deal colleague never enters the view's roster, only the deals' owners do.
    const rosterHeavy = buildBookedPanel({ ...base, compareExecs: false, employees: [...employees, { id: 3, name: 'Colleague' }] })
    expect(rosterHeavy.viewFor({}, 'latest').byExec.map((e) => e.name)).not.toContain('Colleague')
    // …and the figures themselves are untouched.
    expect(solo.viewFor({}, 'latest').total).toBe(2)
    expect(buildBookedPanel(base).filters.owners).toHaveLength(2)
  })

  it('says it is not ready while the leads fetch is still in flight, rather than naming deals by id', () => {
    expect(buildBookedPanel(base).ready).toBe(true)
    expect(buildBookedPanel({ ...base, leadsReady: false }).ready).toBe(false)
  })

  it('re-derives every section for a filter through viewFor', () => {
    const panel = buildBookedPanel(base)
    expect(panel.viewFor({}, 'latest').rows.map((r) => r.leadId)).toEqual([11, 10])
    expect(panel.viewFor({ owner: '1' }, 'latest').rows.map((r) => r.leadId)).toEqual([10])
  })

  it('opens on one exec when the heatmap asks, and keeps that exec’s target-cancel control', () => {
    const panel = buildBookedPanel({ ...base, employeeId: 1, canCancelTarget: true })
    expect(panel.initialOwner).toBe('1')
    expect(panel.cancelTarget).toEqual({ id: 601 })
    expect(panel.eyebrow).toBe('Raghav Gupta · order value')
    // The company-wide entry has no single target to cancel and opens on everyone.
    const company = buildBookedPanel({ ...base, canCancelTarget: true })
    expect(company.initialOwner).toBe('')
    expect(company.cancelTarget).toBeNull()
  })

  it('compares against the previous period it is given, and against nothing when it is not', () => {
    const previous = { range: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31, 23, 59, 59) }, label: 'last month' }
    const priorHistory = [
      ...wonStageHistory,
      { lead_id: 12, changed_at: '2026-07-05T05:00:00', leads: { owner_employee_id: 1, bdm_employee_id: null, order_value: 600000 } },
    ]
    const compared = buildBookedPanel({ ...base, wonStageHistory: priorHistory, previous })
    expect(compared.previousLabel).toBe('last month')
    expect(compared.viewFor({}, 'latest').stats[0].sub).toBe('▲ 100% vs last month')
    expect(buildBookedPanel(base).viewFor({}, 'latest').stats[0].sub).toBe('this period')
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

describe('buildActivitiesPanel', () => {
  // Mon 7 – Sun 13 Sep 2026: wholly in the past, so every day counts as elapsed
  // whenever the suite runs. Employee ids are NUMBERS on purpose — the owner
  // filter's keys are strings (a <select> hands back strings), and a fixture
  // with string ids would hide exactly the mismatch that broke the pipeline
  // panel's owner filter.
  const range = { start: new Date(2026, 8, 7), end: new Date(2026, 8, 13, 23, 59, 59, 999) }
  const at = (day, hour = 10) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`
  const act = (id, emp, name, type, day, leadId = null) => ({
    id,
    employee_id: emp,
    employees: { name },
    activity_type: type,
    created_at: at(day),
    lead_id: leadId,
    rfq_kind: null,
  })
  const activities = [
    act(1, 1, 'Asha', 'call', 7, 100),
    act(2, 1, 'Asha', 'call', 7, 100),
    act(3, 1, 'Asha', 'site_visit', 8, 101),
    act(4, 2, 'Ravi', 'call', 8, 100),
    act(5, 2, 'Ravi', 'office_day', 9, null),
  ]
  const build = (over = {}) =>
    buildActivitiesPanel({
      activities,
      targets: [],
      employees: [{ id: 1, name: 'Asha' }, { id: 2, name: 'Ravi' }],
      range,
      rangeLabel: 'this week',
      previousLabel: 'last week',
      ...over,
    })

  it('offers each owner (busiest first) and only the types actually logged, in the app\'s own order', () => {
    const { filters } = build()
    expect(filters.owners.map((o) => [o.key, o.name, o.count])).toEqual([['1', 'Asha', 3], ['2', 'Ravi', 2]])
    expect(filters.types.map((t) => t.key)).toEqual(['site_visit', 'call', 'office_day'])
    expect(filters.total).toBe(5)
  })

  it('offers no owner choice to a single-person view, which is also what keeps By exec off it', () => {
    const solo = build({ activities: activities.filter((a) => a.employee_id === 1) })
    expect(solo.filters.owners).toEqual([])
    expect(solo.filters.types.length).toBeGreaterThan(1)
  })

  it('counts leads touched and ranks the most-worked leads, ignoring activity on no lead', () => {
    const view = build().viewFor('', '', null)
    expect(view.total).toBe(5)
    expect(view.leadsTouched).toBe(2)
    expect(view.topLeads).toEqual([{ leadId: 100, count: 3 }, { leadId: 101, count: 1 }])
    expect(view.stats.find((s) => s.label === 'Leads touched').sub).toBe('2.0 activities per lead')
  })

  it('reads the rhythm off real days: active days, busiest day, quiet weekdays', () => {
    const view = build().viewFor('', '', null)
    expect(view.rhythm).toHaveLength(7)
    expect(view.rhythm.filter((d) => d.filled)).toHaveLength(3) // Mon, Tue, Wed
    expect(view.stats.find((s) => s.label === 'Per active day')).toMatchObject({ value: '1.7', sub: '3 active days of 7' })
    expect(view.stats.find((s) => s.label === 'Busiest day').value).toBe('2')
    expect(view.silentWeekdays).toBe(2) // Thu and Fri — a quiet weekend is not counted
  })

  it('averages per weekday rather than totalling, so a weekday that occurs more often cannot look busier', () => {
    const view = build().viewFor('', '', null)
    expect(view.weekday.map((w) => w.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(view.weekday[0]).toMatchObject({ avg: '2', total: 2 })
    expect(view.weekday[3]).toMatchObject({ avg: '0', total: 0 })
  })

  it('filters by owner and type together, keyed on a STRING owner key against numeric ids', () => {
    const panel = build()
    expect(panel.viewFor('2', '', null).total).toBe(2)
    expect(panel.viewFor('1', 'call', null).total).toBe(2)
    expect(panel.viewFor('2', 'call', null).topLeads).toEqual([{ leadId: 100, count: 1 }])
  })

  it('never filters a breakdown by its own dimension', () => {
    const view = build().viewFor('1', 'call', null)
    // By type follows the OWNER filter (Asha's 2 calls + 1 visit), not the type one.
    const byType = Object.fromEntries(view.byType.map((t) => [t.key, t.value]))
    expect(byType).toMatchObject({ call: '2', site_visit: '1', office_day: '0' })
    expect(view.byType.find((t) => t.key === 'call').active).toBe(true)
    // By exec follows the TYPE filter (calls only), not the owner one — both
    // execs still there, the chosen one marked.
    expect(view.byExec.map((e) => [e.name, e.total, e.selected])).toEqual([['Asha', 2, true], ['Ravi', 1, false]])
  })

  it('shows what each exec\'s total is made of, top three types', () => {
    const asha = build().viewFor('', '', null).byExec.find((e) => e.name === 'Asha')
    expect(asha.mix).toBe('2 Call · 1 Site Visit')
  })

  it('states the change against the previous period only once it has loaded', () => {
    const panel = build()
    expect(panel.viewFor('', '', null).stats[0].sub).not.toMatch(/vs last week/)
    const previous = [act(90, 1, 'Asha', 'call', 1), act(91, 1, 'Asha', 'call', 2)] // 2 last week → 5 now
    const view = panel.viewFor('', '', previous)
    expect(view.stats[0].sub).toBe('▲ 150% vs last week')
    expect(view.byType.find((t) => t.key === 'call').change).toMatchObject({ up: true })
    expect(view.byExec.find((e) => e.name === 'Ravi').change).toMatchObject({ up: true, text: 'new — none in last week' })
  })

  it('caps a swing against a near-empty previous period rather than printing "52300%"', () => {
    const many = Array.from({ length: 5 }, (_, i) => act(300 + i, 1, 'Asha', 'call', 1))
    const panel = build({ activities: [...activities, ...Array.from({ length: 1200 }, (_, i) => act(400 + i, 1, 'Asha', 'call', 8))] })
    // 1205 now vs 5 before = +24000%
    expect(panel.viewFor('', '', many).stats[0].sub).toBe('▲ 999%+ vs last week')
  })

  it('reads a drop as down, and a flat period as neither', () => {
    const panel = build()
    const more = Array.from({ length: 10 }, (_, i) => act(100 + i, 1, 'Asha', 'call', 1))
    expect(panel.viewFor('', '', more).stats[0].sub).toBe('▼ 50% vs last week')
    const same = Array.from({ length: 5 }, (_, i) => act(200 + i, 1, 'Asha', 'call', 1))
    expect(panel.viewFor('', '', same).stats[0].sub).toBe('level with last week')
  })

  it('pins the target to whoever and whatever is in view', () => {
    const targets = [
      { employee_id: 1, metric_name: 'call', target_value: 10 },
      { employee_id: 2, metric_name: 'call', target_value: 6 },
    ]
    const panel = build({ targets })
    expect(panel.delta).toBe('of 16 target') // the header, as the popup opened
    expect(panel.viewFor('1', '', null).target).toBe(10)
    expect(panel.viewFor('', 'site_visit', null).target).toBeNull() // Site Visit isn't targetable
  })

  describe('shapeActivityEntry', () => {
    it('names a lead-anchored entry by the lead and tags its type', () => {
      const e = shapeActivityEntry({
        id: 9,
        activity_type: 'call',
        created_at: at(8),
        notes: '  Sent the revised quote  ',
        lead_id: 100,
        employee_id: 1,
        employees: { name: 'Asha' },
        leads: { id: 100, current_stage: 'negotiation', parties: { name: 'Mr. Jain' }, sites: null },
        parties: null,
      })
      expect(e).toMatchObject({ party: 'Mr. Jain', leadId: 100, stage: 'Negotiation', exec: 'Asha', execId: 1, notes: 'Sent the revised quote' })
      expect(e.tag).toEqual({ label: 'Call', className: 'vip-dd-day-tag vip-dd-day-tag-call' })
    })

    it('has no name for an Office Day, and shows its hours as the meta line', () => {
      const e = shapeActivityEntry({
        id: 10,
        activity_type: 'office_day',
        created_at: at(9),
        notes: null,
        lead_id: null,
        employee_id: 2,
        employees: { name: 'Ravi' },
        leads: null,
        parties: null,
        start_time: '10:00',
        end_time: '17:30',
      })
      expect(e.party).toBeNull()
      expect(e.leadId).toBeNull()
      expect(e.meta).toBe('10:00 am – 5:30 pm')
      expect(e.notes).toBeNull()
    })

    it('falls back to the party when an entry is anchored on an architect rather than a lead', () => {
      const e = shapeActivityEntry({
        id: 11,
        activity_type: 'architect_meeting',
        created_at: at(9),
        lead_id: null,
        employee_id: 2,
        employees: { name: 'Ravi' },
        leads: null,
        parties: { name: 'Ar. Bedi' },
      })
      expect(e.party).toBe('Ar. Bedi')
    })
  })
})