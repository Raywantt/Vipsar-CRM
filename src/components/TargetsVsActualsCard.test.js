import { describe, it, expect } from 'vitest'
import {
  computeOrderValueActuals,
  computeQuoteSentActuals,
  computeScanningLeadsActuals,
  computeWonCountActuals,
  computeActivityActuals,
  blendedAttainmentFor,
  targetFor,
  targetRowFor,
  mergeTargetRow,
  computeTargetActuals,
  computeSourceLeadsActuals,
  actualFor,
} from './TargetsVsActualsCard'
import { METRIC_OPTIONS, METRIC_GROUPS, metricsForPeriod } from '../lib/targetMetrics'

const range = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59) }

function wonRow(leadId, changedAt, ownerEmployeeId, orderValue) {
  return { lead_id: leadId, changed_at: changedAt, leads: { owner_employee_id: ownerEmployeeId, order_value: orderValue } }
}

describe('computeOrderValueActuals', () => {
  it('sums order_value from the most recent won transition per lead, inside range', () => {
    const wonStageHistory = [
      wonRow('L1', '2026-08-10T00:00:00Z', 'e1', 50000),
      wonRow('L1', '2026-08-05T00:00:00Z', 'e1', 40000), // older row for same lead, ignored
      wonRow('L2', '2026-08-15T00:00:00Z', 'e1', 20000),
      wonRow('L3', '2026-07-01T00:00:00Z', 'e1', 99999), // outside range
    ]
    const total = computeOrderValueActuals(wonStageHistory, range, false)
    expect(total).toBe(70000)
  })

  it('drops rows RLS hid (leads: null)', () => {
    const wonStageHistory = [{ lead_id: 'L1', changed_at: '2026-08-10T00:00:00Z', leads: null }]
    expect(computeOrderValueActuals(wonStageHistory, range, false)).toBe(0)
  })

  it('when showByEmployee, buckets totals per owner_employee_id, using "unassigned" for null', () => {
    const wonStageHistory = [
      wonRow('L1', '2026-08-10T00:00:00Z', 'e1', 50000),
      wonRow('L2', '2026-08-10T00:00:00Z', 'e2', 20000),
      wonRow('L3', '2026-08-10T00:00:00Z', null, 5000),
    ]
    const map = computeOrderValueActuals(wonStageHistory, range, true)
    expect(map.get('e1')).toBe(50000)
    expect(map.get('e2')).toBe(20000)
    expect(map.get('unassigned')).toBe(5000)
  })
})

describe('computeWonCountActuals', () => {
  it('counts distinct leads whose latest won row falls in range, not summed value', () => {
    const wonStageHistory = [
      wonRow('L1', '2026-08-10T00:00:00Z', 'e1', 50000),
      wonRow('L1', '2026-08-05T00:00:00Z', 'e1', 40000),
      wonRow('L2', '2026-08-15T00:00:00Z', 'e1', 20000),
    ]
    expect(computeWonCountActuals(wonStageHistory, range, false)).toBe(2)
  })

  it('matches buildWinRatePanel-style scoping when grouped by employee', () => {
    const wonStageHistory = [
      wonRow('L1', '2026-08-10T00:00:00Z', 'e1', 50000),
      wonRow('L2', '2026-08-10T00:00:00Z', 'e2', 20000),
    ]
    const map = computeWonCountActuals(wonStageHistory, range, true)
    expect(map.get('e1')).toBe(1)
    expect(map.get('e2')).toBe(1)
  })
})

describe('computeQuoteSentActuals', () => {
  it('counts leads whose quote_sent_at falls within range', () => {
    const breakdownLeads = [
      { owner_employee_id: 'e1', quote_sent_at: '2026-08-05T00:00:00Z' },
      { owner_employee_id: 'e1', quote_sent_at: '2026-07-05T00:00:00Z' }, // outside range
      { owner_employee_id: 'e2', quote_sent_at: null }, // no quote at all
    ]
    expect(computeQuoteSentActuals(breakdownLeads, range, false)).toBe(1)
  })

  it('when showByEmployee, buckets counts per owner', () => {
    const breakdownLeads = [
      { owner_employee_id: 'e1', quote_sent_at: '2026-08-05T00:00:00Z' },
      { owner_employee_id: 'e1', quote_sent_at: '2026-08-06T00:00:00Z' },
      { owner_employee_id: 'e2', quote_sent_at: '2026-08-06T00:00:00Z' },
    ]
    const map = computeQuoteSentActuals(breakdownLeads, range, true)
    expect(map.get('e1')).toBe(2)
    expect(map.get('e2')).toBe(1)
  })
})

describe('computeScanningLeadsActuals', () => {
  it('counts leads whose source is scanning and created_at falls within range', () => {
    const breakdownLeads = [
      { owner_employee_id: 'e1', source_type: 'scanning', created_at: '2026-08-05T00:00:00Z' },
      { owner_employee_id: 'e1', source_type: 'scanning', created_at: '2026-07-05T00:00:00Z' }, // outside range
      { owner_employee_id: 'e1', source_type: 'lixil', created_at: '2026-08-05T00:00:00Z' }, // wrong source
      { owner_employee_id: 'e2', source_type: 'scanning', created_at: null }, // no created_at
    ]
    expect(computeScanningLeadsActuals(breakdownLeads, range, false)).toBe(1)
  })

  it('when showByEmployee, buckets counts per owner, using "unassigned" for null', () => {
    const breakdownLeads = [
      { owner_employee_id: 'e1', source_type: 'scanning', created_at: '2026-08-05T00:00:00Z' },
      { owner_employee_id: 'e1', source_type: 'scanning', created_at: '2026-08-06T00:00:00Z' },
      { owner_employee_id: 'e2', source_type: 'scanning', created_at: '2026-08-06T00:00:00Z' },
      { owner_employee_id: null, source_type: 'scanning', created_at: '2026-08-06T00:00:00Z' },
    ]
    const map = computeScanningLeadsActuals(breakdownLeads, range, true)
    expect(map.get('e1')).toBe(2)
    expect(map.get('e2')).toBe(1)
    expect(map.get('unassigned')).toBe(1)
  })
})

describe('targetFor', () => {
  const targets = [
    { employee_id: 'e1', metric_name: 'order_value', target_value: '100000' },
    { employee_id: 'e2', metric_name: 'order_value', target_value: '50000' },
  ]

  it('finds a target row scoped to metric and employee', () => {
    expect(targetFor(targets, 'e1', 'order_value')).toBe(100000)
  })

  it('returns null when no matching target row exists', () => {
    expect(targetFor(targets, 'e1', 'site_visit')).toBeNull()
    expect(targetFor(targets, 'e3', 'order_value')).toBeNull()
  })

  it('coerces the stored string target_value to a number', () => {
    expect(targetFor(targets, 'e2', 'order_value')).toBe(50000)
  })
})

describe('computeActivityActuals', () => {
  it('tallies by activity_type, and by employee_id too when showByEmployee', () => {
    const activities = [
      { employee_id: 'e1', activity_type: 'call' },
      { employee_id: 'e1', activity_type: 'call' },
      { employee_id: 'e2', activity_type: 'call' },
      { employee_id: 'e1', activity_type: 'rfq_raised' },
    ]
    expect(computeActivityActuals(activities, false).call).toBe(3)
    const map = computeActivityActuals(activities, true)
    expect(map.get('e1').call).toBe(2)
    expect(map.get('e2').call).toBe(1)
    expect(map.get('e1').rfq_raised).toBe(1)
  })

  it('excludes a revised RFQ from the rfq_raised tally, but not an untagged or fresh one', () => {
    const activities = [
      { employee_id: 'e1', activity_type: 'rfq_raised', rfq_kind: 'fresh' },
      { employee_id: 'e1', activity_type: 'rfq_raised', rfq_kind: 'revised' },
      { employee_id: 'e1', activity_type: 'rfq_raised', rfq_kind: null },
    ]
    expect(computeActivityActuals(activities, false).rfq_raised).toBe(2)
  })
})

// RFQ-DESK.md Step 6: once the desk is live an RFQ counts when it passes the
// technical check (the database's counted approvals), and one logged before
// the cutover still counts by its logging day — never both.
describe('computeActivityActuals — RFQ Raised with the desk live', () => {
  const liveFrom = '2026-08-15T03:30:00+00:00' // 15 Aug, 09:00 IST
  const activities = [
    // before the cutover: counts by logging day
    { employee_id: 'e1', activity_type: 'rfq_raised', rfq_kind: 'fresh', created_at: '2026-08-10T05:00:00' },
    // after it: counts only through an approval
    { employee_id: 'e1', activity_type: 'rfq_raised', rfq_kind: 'fresh', created_at: '2026-08-20T05:00:00' },
    { employee_id: 'e2', activity_type: 'rfq_raised', rfq_kind: 'fresh', created_at: '2026-08-21T05:00:00' },
    // a revision never counts here, before or after
    { employee_id: 'e1', activity_type: 'rfq_raised', rfq_kind: 'revised', created_at: '2026-08-11T05:00:00' },
    { employee_id: 'e1', activity_type: 'call', created_at: '2026-08-20T05:00:00' },
  ]
  const counted = [
    { raised_by_employee_id: 'e1', approved_at: '2026-08-21T06:00:00+00:00' },
    { raised_by_employee_id: 'e3', approved_at: '2026-08-22T06:00:00+00:00' },
  ]

  it('adds each counted approval to the exec who raised it, and stops counting post-cutover logging', () => {
    const map = computeActivityActuals(activities, true, { liveFrom, counted })
    expect(map.get('e1').rfq_raised).toBe(2) // one pre-cutover log + one approval
    expect(map.get('e2').rfq_raised).toBe(0) // logged after the cutover, not approved yet
    expect(map.get('e3').rfq_raised).toBe(1) // approved; raised by e3 (activity not in view)
    expect(map.get('e1').call).toBe(1)
  })

  it('totals the same way for a single-person view', () => {
    expect(computeActivityActuals(activities, false, { liveFrom, counted }).rfq_raised).toBe(1 + 2)
  })

  it('with the desk off every fresh RFQ counts by its logging day and approvals are ignored', () => {
    expect(computeActivityActuals(activities, false, { liveFrom: null, counted }).rfq_raised).toBe(3)
    // the default is the same "desk off"
    expect(computeActivityActuals(activities, false).rfq_raised).toBe(3)
  })
})

// blendedAttainmentFor is the ONE place "overall attainment" should be
// computed — EmployeeProfile's rank pill, this card's own mobile
// ExecAttainmentRow, DashboardHeatmap's desktop "Overall" column and
// drilldownBuilders.js's buildOverallAttainPanel all call this rather than
// each re-deriving their own average, after a real bug where the latter two
// didn't cap a metric's ratio before averaging (see this function's own
// header comment) — an exec with one metric at 225% of target showed a
// desktop "Overall" number nowhere near what every other view of the exact
// same person/period showed.
describe('blendedAttainmentFor', () => {
  const actuals = {
    activityActuals: new Map([['e1', { call: 16, rfq_raised: 9 }]]),
    orderValueActuals: new Map(),
    scanningLeadsActuals: new Map([['e1', 1]]),
  }
  const targets = [
    { employee_id: 'e1', metric_name: 'call', target_value: 40 },
    { employee_id: 'e1', metric_name: 'rfq_raised', target_value: 4 },
    { employee_id: 'e1', metric_name: 'scanning_leads', target_value: 10 },
  ]

  it('caps a wildly over-target metric at 100% before averaging, not its raw ratio', () => {
    // call: 16/40 = 40%, rfq_raised: 9/4 = 225% -> capped to 100%, scanning_leads: 1/10 = 10%.
    // Uncapped this would average to (0.40 + 2.25 + 0.10) / 3 = 91.7%; capped it's (0.40 + 1.00 + 0.10) / 3.
    const blended = blendedAttainmentFor('e1', actuals, targets)
    expect(blended).toBeCloseTo((0.4 + 1.0 + 0.1) / 3, 10)
    expect(Math.round(blended * 100)).toBe(50)
  })

  it('skips a metric with no target set rather than treating it as a zero', () => {
    const targetsMissingOne = targets.filter((t) => t.metric_name !== 'scanning_leads')
    // Only call (40%) and rfq_raised (capped 100%) should count now.
    expect(blendedAttainmentFor('e1', actuals, targetsMissingOne)).toBeCloseTo((0.4 + 1.0) / 2, 10)
  })

  it('returns null when the employee has no targets at all', () => {
    expect(blendedAttainmentFor('e2', actuals, targets)).toBeNull()
  })
})

// Used by the "Cancel this target" feature (drilldownBuilders.js's
// buildLogPanel/buildOrderValueAttainPanel/buildScanningLeadsAttainPanel) to
// find the actual row to delete, which targetFor's plain numeric value can't
// give it.
describe('targetRowFor', () => {
  const targets = [
    { id: 501, employee_id: 'e1', metric_name: 'call', target_value: '40' },
    { id: 502, employee_id: 'e2', metric_name: 'call', target_value: '30' },
  ]

  it('finds the row scoped to metric and employee', () => {
    expect(targetRowFor(targets, 'e1', 'call')).toEqual(targets[0])
  })

  it('returns null when no matching row exists', () => {
    expect(targetRowFor(targets, 'e1', 'rfq_raised')).toBeNull()
    expect(targetRowFor(targets, 'e3', 'call')).toBeNull()
  })

  it('unlike targetFor, never matches a company-wide (employeeId null) lookup', () => {
    expect(targetRowFor(targets, null, 'call')).toBeNull()
  })
})

// Regression suite for the reported bug (2026-09-11): "set a target for NEXT
// week and the heatmap, which shows THIS week, displays it." Every case below
// goes through targetFor afterwards rather than only asserting array shape —
// what the owner sees is the lookup's answer, and the previous inline merge
// produced an array that looked plausible while the lookup read wrong.
describe('mergeTargetRow', () => {
  const thisWeek = { periodType: 'week', periodValue: '2026-W38' }

  // Shaped exactly as fetchTargetsForPeriod returns them.
  function stored(id, employeeId, metric, value, periodValue = '2026-W38') {
    return {
      id,
      employee_id: employeeId,
      metric_name: metric,
      target_value: value,
      period_type: 'week',
      period_value: periodValue,
      employees: { name: `E${employeeId}` },
    }
  }

  it('does NOT merge a target saved for a different period than the one on screen', () => {
    const state = [stored(100, 33, 'call', 5)]
    const nextWeek = stored(202, 26, 'call', 99, '2026-W39')

    const after = mergeTargetRow(state, nextWeek, thisWeek)

    expect(after).toEqual(state)
    // The exact reported symptom: employee 26 has no call target THIS week,
    // and must still have none after saving one for next week.
    expect(targetFor(after, 26, 'call')).toBe(null)
  })

  it('does not merge a different period even when that employee/metric already has a row here', () => {
    const state = [stored(101, 26, 'call', 4)]
    const nextWeek = stored(202, 26, 'call', 99, '2026-W39')

    const after = mergeTargetRow(state, nextWeek, thisWeek)

    expect(after).toHaveLength(1)
    expect(targetFor(after, 26, 'call')).toBe(4)
  })

  it('does not merge a different period TYPE with a coincidentally equal value', () => {
    const state = [stored(101, 26, 'call', 4)]
    const monthRow = { ...stored(303, 26, 'call', 77), period_type: 'month', period_value: '2026-W38' }

    expect(mergeTargetRow(state, monthRow, thisWeek)).toEqual(state)
  })

  it('REPLACES, not appends, when correcting a target for the period on screen', () => {
    // insertTarget is an upsert, so a correction comes back as the SAME row
    // id with a new value. Appending it left the stale copy first in the
    // array, and targetFor returns its first match — so the correction
    // appeared to do nothing.
    const state = [stored(101, 26, 'call', 4)]
    const corrected = stored(101, 26, 'call', 12)

    const after = mergeTargetRow(state, corrected, thisWeek)

    expect(after).toHaveLength(1)
    expect(targetFor(after, 26, 'call')).toBe(12)
  })

  it('replaces even when the stored row carries no period columns', () => {
    // Defence for any row that predates fetchTargetsForPeriod selecting
    // period_type/period_value: within a single-period array, "same target"
    // is employee + metric, never re-read off the stored row.
    const legacy = { id: 101, employee_id: 26, metric_name: 'call', target_value: 4 }
    const corrected = stored(101, 26, 'call', 12)

    const after = mergeTargetRow([legacy], corrected, thisWeek)

    expect(after).toHaveLength(1)
    expect(targetFor(after, 26, 'call')).toBe(12)
  })

  it('appends a new target for the period on screen', () => {
    const state = [stored(100, 33, 'call', 5)]
    const fresh = stored(202, 26, 'call', 9)

    const after = mergeTargetRow(state, fresh, thisWeek)

    expect(after).toHaveLength(2)
    expect(targetFor(after, 26, 'call')).toBe(9)
    expect(targetFor(after, 33, 'call')).toBe(5)
  })

  it('leaves other employees and other metrics untouched when replacing', () => {
    const state = [stored(100, 33, 'call', 5), stored(101, 26, 'call', 4), stored(102, 26, 'rfq_raised', 7)]

    const after = mergeTargetRow(state, stored(101, 26, 'call', 12), thisWeek)

    expect(after).toHaveLength(3)
    expect(targetFor(after, 33, 'call')).toBe(5)
    expect(targetFor(after, 26, 'rfq_raised')).toBe(7)
  })

  it('is inert with no display period (15D/Custom have none) and with no row', () => {
    const state = [stored(101, 26, 'call', 4)]
    expect(mergeTargetRow(state, stored(202, 26, 'call', 9), null)).toEqual(state)
    expect(mergeTargetRow(state, null, thisWeek)).toEqual(state)
  })
})

// ---------- the target metrics (owner, 2026-10-19) ----------
// The H2 targets workbook's per-person plan; the CRM tracked six. Orders won was
// taken out again the same day, and Order value is not a weekly target.
// Every metric has a column and a rule, and the rule is ALWAYS the function
// the metric's own screen already uses — so a target can't read a different
// figure from the Sales Exec Profile, the Team Report or the popups.
describe('target metrics', () => {
  const metric = (v) => METRIC_OPTIONS.find((m) => m.value === v)

  it('are the eleven, grouped Results / Activity / Leads in that order', () => {
    expect(METRIC_OPTIONS.map((m) => m.value)).toEqual([
      'order_value', 'quote_sent', 'rfq_raised',
      'client_meeting_new', 'client_meeting_old', 'site_visit', 'architect_meeting', 'call',
      'scanning_leads', 'architect_leads', 'referral_leads',
    ])
    expect(METRIC_GROUPS.map((g) => g.key)).toEqual(['results', 'activity', 'leads'])
    // Grouped contiguously, so the heatmap's group headings can span columns.
    const groups = METRIC_OPTIONS.map((m) => m.group)
    expect(groups).toEqual([...groups].sort((a, b) => METRIC_GROUPS.findIndex((g) => g.key === a) - METRIC_GROUPS.findIndex((g) => g.key === b)))
    expect(METRIC_OPTIONS.every((m) => m.short && m.label && m.kind)).toBe(true)
  })

  it('keep the keys the Sales Exec Profile tiles already read', () => {
    for (const key of ['order_value', 'site_visit', 'call', 'rfq_raised', 'quote_sent']) expect(metric(key)).toBeTruthy()
  })

  it('never offer Orders won, for any period', () => {
    for (const t of ['week', 'month', 'quarter']) expect(metricsForPeriod(t).some((m) => m.value === 'won_count')).toBe(false)
  })

  it('leave Order value out of a week only', () => {
    expect(metricsForPeriod('week').map((m) => m.value)).not.toContain('order_value')
    expect(metricsForPeriod('week')).toHaveLength(METRIC_OPTIONS.length - 1)
    expect(metricsForPeriod('month')).toBe(METRIC_OPTIONS)
    expect(metricsForPeriod('quarter')).toBe(METRIC_OPTIONS)
  })

  const inputs = {
    activities: [
      { employee_id: 'e1', activity_type: 'site_visit' },
      { employee_id: 'e1', activity_type: 'site_visit' },
      { employee_id: 'e1', activity_type: 'architect_meeting' },
      { employee_id: 'e2', activity_type: 'site_visit' },
      { employee_id: 'e1', activity_type: 'rfq_raised', rfq_kind: 'revised' }, // a revision never counts
    ],
    wonStageHistory: [
      wonRow('L1', '2026-08-10T00:00:00Z', 'e1', 50000),
      wonRow('L2', '2026-08-12T00:00:00Z', 'e1', 20000),
      wonRow('L3', '2026-07-01T00:00:00Z', 'e1', 99999), // before the range
    ],
    breakdownLeads: [
      { id: 1, owner_employee_id: 'e1', source_type: 'referral_architect', created_at: '2026-08-03T05:00:00Z' },
      { id: 2, owner_employee_id: 'e1', source_type: 'referral_architect', created_at: '2026-08-04T05:00:00Z', quote_sent_at: '2026-08-20' },
      { id: 3, owner_employee_id: 'e1', source_type: 'referral_other', created_at: '2026-08-05T05:00:00Z', quote_sent_at: '2026-07-20' },
      { id: 4, owner_employee_id: 'e2', source_type: 'referral_other', created_at: '2026-08-06T05:00:00Z' },
      { id: 5, owner_employee_id: 'e1', source_type: 'scanning', created_at: '2026-08-07T05:00:00Z', quote_sent_at: '2026-08-21' },
    ],
    range,
  }

  it('count every metric by the function its own screen uses', () => {
    const a = computeTargetActuals(inputs, true)
    expect(actualFor(metric('quote_sent'), a, 'e1')).toBe(computeQuoteSentActuals(inputs.breakdownLeads, range, true).get('e1'))
    expect(actualFor(metric('quote_sent'), a, 'e1')).toBe(2)
    expect(actualFor(metric('architect_leads'), a, 'e1')).toBe(computeSourceLeadsActuals(inputs.breakdownLeads, 'referral_architect', range, true).get('e1'))
    expect(actualFor(metric('architect_leads'), a, 'e1')).toBe(2)
    expect(actualFor(metric('referral_leads'), a, 'e1')).toBe(1)
    expect(actualFor(metric('referral_leads'), a, 'e2')).toBe(1)
    expect(actualFor(metric('scanning_leads'), a, 'e1')).toBe(1)
    expect(actualFor(metric('site_visit'), a, 'e1')).toBe(2)
    expect(actualFor(metric('architect_meeting'), a, 'e1')).toBe(1)
    expect(actualFor(metric('rfq_raised'), a, 'e1')).toBe(0)
    expect(actualFor(metric('order_value'), a, 'e1')).toBe(70000)
  })

  it('read the same as one total for a one-person view', () => {
    const one = { ...inputs, activities: inputs.activities.filter((x) => x.employee_id === 'e1') }
    const byPerson = computeTargetActuals(one, true)
    const total = computeTargetActuals(one, false)
    for (const m of METRIC_OPTIONS.filter((x) => x.kind === 'activity')) expect(actualFor(m, total, null)).toBe(actualFor(m, byPerson, 'e1'))
  })

  it('count a site-visit and a quotes target into Overall, capped like the rest', () => {
    const a = computeTargetActuals(inputs, true)
    const targets = [
      { employee_id: 'e1', metric_name: 'site_visit', target_value: 4 }, // 2/4 = 50%
      { employee_id: 'e1', metric_name: 'quote_sent', target_value: 1 }, // 2/1 → capped at 100%
    ]
    expect(blendedAttainmentFor('e1', a, targets)).toBeCloseTo((0.5 + 1) / 2, 10)
  })

  it('leave a stray weekly order-value or orders target out of a week’s Overall', () => {
    const a = computeTargetActuals(inputs, true)
    const targets = [
      { employee_id: 'e1', metric_name: 'site_visit', target_value: 4 }, // 50%
      { employee_id: 'e1', metric_name: 'order_value', target_value: 7000000 }, // 1% — a month counts it
      { employee_id: 'e1', metric_name: 'won_count', target_value: 1 }, // no longer a metric anywhere
    ]
    expect(blendedAttainmentFor('e1', a, targets, metricsForPeriod('week'))).toBeCloseTo(0.5, 10)
    expect(blendedAttainmentFor('e1', a, targets, metricsForPeriod('month'))).toBeCloseTo((0.5 + 0.01) / 2, 10)
  })
})
