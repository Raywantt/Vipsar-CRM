import { describe, it, expect } from 'vitest'
import { mergeManagerActivity, shapeManagerActivityRow } from './leadDetailQueries'

// A manager's activity on a team member's lead reaches the rep (and their
// coordinator) through manager_activity_on_team_leads(), not RLS. These pin the
// shape it is folded into the lead's own activity list in, so the timeline, the
// last-touch figure and the RFQ summary can read it without a special case.

const rpcRow = {
  id: 91,
  lead_id: 12,
  activity_type: 'client_meeting_old',
  rfq_kind: null,
  notes: 'Stepped in for Ravi',
  created_at: '2026-10-07T09:30:00',
  employee_id: 4,
  employee_name: 'Aanchal Tripathi',
  accompanied_by: null,
  accompanied_by_name: null,
}

describe('shapeManagerActivityRow', () => {
  it('has the same fields an activities row from the lead\'s own fetch has', () => {
    const shaped = shapeManagerActivityRow(rpcRow)
    expect(shaped).toMatchObject({
      id: 91,
      activity_type: 'client_meeting_old',
      notes: 'Stepped in for Ravi',
      created_at: '2026-10-07T09:30:00',
      employee_id: 4,
      employees: { name: 'Aanchal Tripathi' },
      accompanied_by_employee: null,
      logged_by: null,
    })
  })

  it('names a tagged colleague the way the timeline already reads one', () => {
    const shaped = shapeManagerActivityRow({ ...rpcRow, accompanied_by: 9, accompanied_by_name: 'Vipul' })
    expect(shaped.accompanied_by_employee).toEqual({ name: 'Vipul' })
  })

  it('is marked as having come from the manager, so a surface can say so', () => {
    expect(shapeManagerActivityRow(rpcRow).viaManager).toBe(true)
  })
})

describe('mergeManagerActivity', () => {
  const own = [
    { id: 5, created_at: '2026-10-06T10:00:00' },
    { id: 3, created_at: '2026-10-01T10:00:00' },
  ]
  const manager = [shapeManagerActivityRow(rpcRow)]

  it('returns the lead\'s own list untouched when there is nothing from the manager', () => {
    expect(mergeManagerActivity(own, [])).toBe(own)
  })

  it('keeps the newest-first order the lead\'s own fetch returns', () => {
    expect(mergeManagerActivity(own, manager).map((a) => a.id)).toEqual([91, 5, 3])
    const older = [{ ...manager[0], id: 92, created_at: '2026-10-03T10:00:00' }]
    expect(mergeManagerActivity(own, older).map((a) => a.id)).toEqual([5, 92, 3])
  })

  it('never lists a row twice if RLS already returned it', () => {
    const merged = mergeManagerActivity([...own, { id: 91, created_at: '2026-10-07T09:30:00' }], manager)
    expect(merged.filter((a) => a.id === 91)).toHaveLength(1)
  })
})
