import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildExecCounts } from './FollowUpsCard'

describe('buildExecCounts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 5, 12)) // Monday 2026-10-05
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const row = (over) => ({
    id: 1,
    assigned_to: 10,
    status: 'open',
    due_date: '2026-10-07',
    assigned_to_employee: { name: 'Someone' },
    ...over,
  })

  it('lists every roster person, BDMs included, even with nothing in the period', () => {
    const roster = [
      { id: 10, name: 'Exec One' },
      { id: 47, name: 'Raghav Dhingra', isBdm: true },
    ]
    const counts = buildExecCounts([row({ assigned_to: 10 })], roster)
    expect(counts.map((c) => c.name)).toEqual(['Exec One', 'Raghav Dhingra'])
    // The BDM has no reminder, and reads as zero — not as "not shown".
    expect(counts[1]).toMatchObject({ id: 47, isBdm: true, assigned: 0, done: 0, missed: 0 })
    expect(counts[0]).toMatchObject({ id: 10, isBdm: false, assigned: 1 })
  })

  it('counts a BDM the same way as an exec: cancelled is left out, done and missed split out', () => {
    const roster = [{ id: 47, name: 'Raghav Dhingra', isBdm: true }]
    const counts = buildExecCounts(
      [
        row({ id: 1, assigned_to: 47, status: 'done' }),
        row({ id: 2, assigned_to: 47, status: 'open', due_date: '2026-10-01' }), // overdue
        row({ id: 3, assigned_to: 47, status: 'open', due_date: '2026-10-09' }), // upcoming
        row({ id: 4, assigned_to: 47, status: 'cancelled' }),
      ],
      roster
    )
    expect(counts).toHaveLength(1)
    expect(counts[0]).toMatchObject({ assigned: 3, done: 1, missed: 1, isBdm: true })
  })

  it('still surfaces someone missing from the roster, untagged', () => {
    const counts = buildExecCounts([row({ assigned_to: 99, assigned_to_employee: { name: 'Left Company' } })], [])
    expect(counts).toEqual([{ id: 99, name: 'Left Company', isBdm: false, assigned: 1, done: 0, missed: 0 }])
  })
})
