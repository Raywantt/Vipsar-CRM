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
} from './TargetsVsActualsCard'

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
