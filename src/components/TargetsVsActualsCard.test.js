import { describe, it, expect } from 'vitest'
import { computeOrderValueActuals, computeQuoteSentActuals, computeWonCountActuals, targetFor } from './TargetsVsActualsCard'

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
