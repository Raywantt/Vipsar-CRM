import { describe, it, expect } from 'vitest'
import { buildHandedOverRows, buildClosedRows } from './bdmLeadUpdates'

const BDM = 50

describe('buildHandedOverRows', () => {
  it('lists each of this BDM\'s leads once, newest handover first', () => {
    const rows = buildHandedOverRows(
      [
        { id: 3, lead_id: 100, changed_at: '2026-09-14T10:00:00', new: { name: 'Ravi' }, leads: { bdm_employee_id: BDM } },
        { id: 2, lead_id: 101, changed_at: '2026-09-13T10:00:00', new: { name: 'Aman' }, leads: { bdm_employee_id: BDM } },
        { id: 1, lead_id: 100, changed_at: '2026-09-12T10:00:00', new: { name: 'Old' }, leads: { bdm_employee_id: BDM } },
      ],
      BDM
    )
    expect(rows.map((r) => [r.leadId, r.execName])).toEqual([
      [100, 'Ravi'],
      [101, 'Aman'],
    ])
  })

  it('leaves out another BDM\'s leads and rows whose lead RLS hid', () => {
    const rows = buildHandedOverRows(
      [
        { id: 1, lead_id: 100, leads: { bdm_employee_id: 99 } },
        { id: 2, lead_id: 101, leads: null },
      ],
      BDM
    )
    expect(rows).toEqual([])
  })
})

describe('buildClosedRows', () => {
  const lead = (over) => ({ bdm_employee_id: BDM, owner_employee_id: 3, employees: { name: 'Ravi' }, ...over })

  it('shows a won lead with its booked value and who owns it', () => {
    const rows = buildClosedRows(
      [{ id: 1, lead_id: 100, stage: 'won', changed_at: '2026-09-14', leads: lead({ current_stage: 'won', order_value: 420000 }) }],
      [],
      BDM
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome: 'won', value: 420000, ownerName: 'Ravi', reason: null })
  })

  it('shows a lost lead with its most recent loss reason', () => {
    const rows = buildClosedRows(
      [{ id: 1, lead_id: 100, stage: 'lost', changed_at: '2026-09-14', leads: lead({ current_stage: 'lost' }) }],
      [
        { lead_id: 100, reason: 'price', competitor_name: null },
        { lead_id: 100, reason: 'timeline', competitor_name: null },
      ],
      BDM
    )
    expect(rows[0]).toMatchObject({ outcome: 'lost', reason: 'price', value: null })
  })

  it('uses only the most recent close per lead, and drops a lead reopened since', () => {
    const rows = buildClosedRows(
      [
        // newest first: lead 100 was lost after first being won → shows lost
        { id: 3, lead_id: 100, stage: 'lost', leads: lead({ current_stage: 'lost' }) },
        { id: 2, lead_id: 100, stage: 'won', leads: lead({ current_stage: 'lost' }) },
        // lead 101 was won, then reopened → not closed any more
        { id: 1, lead_id: 101, stage: 'won', leads: lead({ current_stage: 'negotiation' }) },
      ],
      [],
      BDM
    )
    expect(rows.map((r) => [r.leadId, r.outcome])).toEqual([[100, 'lost']])
  })

  it('names the BDM "You" on a lead they worked themselves', () => {
    const rows = buildClosedRows(
      [{ id: 1, lead_id: 100, stage: 'won', leads: lead({ current_stage: 'won', owner_employee_id: BDM, order_value: null }) }],
      [],
      BDM
    )
    expect(rows[0]).toMatchObject({ ownerName: 'You', value: null })
  })

  it('leaves out another BDM\'s leads', () => {
    const rows = buildClosedRows(
      [{ id: 1, lead_id: 100, stage: 'won', leads: lead({ current_stage: 'won', bdm_employee_id: 99 }) }],
      [],
      BDM
    )
    expect(rows).toEqual([])
  })
})
