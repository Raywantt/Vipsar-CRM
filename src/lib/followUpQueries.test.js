import { describe, it, expect } from 'vitest'
import {
  isArchitectFollowUp,
  logActivityPathFor,
  canCloseByLogging,
  isCancelBlockedForViewer,
  compareFollowUps,
  reminderSavedMessage,
  isHoldReviewFollowUp,
  lockedFollowUpIds,
} from './followUpQueries'
import { addDays, todayISO } from './followupDates'

// BDM.md Step 7 — an architect's next meeting is a plain follow-up, closed by
// "Log activity & close" exactly like a lead's. These pin where that button
// goes and when it is offered at all.

const architectRow = { id: 7, lead_id: null, party_id: 609, activity_type: 'architect_meeting', parties: { party_type: 'architect' } }

describe('isArchitectFollowUp', () => {
  it('is true for a lead-less reminder on an architect or architect firm', () => {
    expect(isArchitectFollowUp(architectRow)).toBe(true)
    expect(isArchitectFollowUp({ ...architectRow, parties: { party_type: 'firm' } })).toBe(true)
  })

  it("reads the party's type, so a pre-Step-7 row saved as 'other' still counts", () => {
    expect(isArchitectFollowUp({ ...architectRow, activity_type: 'other' })).toBe(true)
  })

  it('is false for a lead reminder, a client party, or an unreadable party embed', () => {
    expect(isArchitectFollowUp({ ...architectRow, lead_id: 12 })).toBe(false)
    expect(isArchitectFollowUp({ ...architectRow, parties: { party_type: 'client' } })).toBe(false)
    expect(isArchitectFollowUp({ ...architectRow, parties: null })).toBe(false)
  })
})

describe('logActivityPathFor', () => {
  it('pre-picks the lead and type for a lead reminder, unchanged', () => {
    expect(logActivityPathFor({ id: 3, lead_id: 12, activity_type: 'call' })).toBe('/activity?lead=12&followup=3&type=call')
    expect(logActivityPathFor({ id: 3, lead_id: 12, activity_type: 'other' })).toBe('/activity?lead=12&followup=3')
  })

  it('pre-picks Architect Meeting and the architect for an architect reminder', () => {
    expect(logActivityPathFor(architectRow)).toBe('/activity?type=architect_meeting&party=609&followup=7')
  })

  it('is null when there is nothing to log against', () => {
    expect(logActivityPathFor({ id: 4, lead_id: null, party_id: null, parties: null })).toBeNull()
    expect(logActivityPathFor({ id: 4, lead_id: null, party_id: 5, parties: { party_type: 'client' } })).toBeNull()
  })
})

describe('canCloseByLogging', () => {
  const repsReminder = { id: 1, assigned_to: 10 }

  it('lets anyone who logs activities close their own reminder', () => {
    for (const role of ['sales_executive', 'sales_manager', 'business_development_manager', 'sales_coordinator']) {
      expect(canCloseByLogging({ id: 10, role }, repsReminder)).toBe(true)
    }
  })

  it("never offers it to an owner, who can't open Log Activity", () => {
    expect(canCloseByLogging({ id: 10, role: 'owner' }, repsReminder)).toBe(false)
    expect(canCloseByLogging({ id: 99, role: 'owner' }, repsReminder)).toBe(false)
  })

  it("stops a manager closing a rep's reminder with their own activity", () => {
    expect(canCloseByLogging({ id: 99, role: 'sales_manager' }, repsReminder)).toBe(false)
  })

  it("lets a coordinator close a team exec's reminder, since they log in the exec's name", () => {
    expect(canCloseByLogging({ id: 99, role: 'sales_coordinator' }, repsReminder)).toBe(true)
  })

  it('is false with no viewer', () => {
    expect(canCloseByLogging(null, repsReminder)).toBe(false)
  })
})

describe('isCancelBlockedForViewer', () => {
  const assigned = { assigned_to: 10, created_by: 1 }

  it('blocks the assignee on a reminder someone else assigned', () => {
    expect(isCancelBlockedForViewer(10, assigned)).toBe(true)
  })

  it('leaves the assigner and supervisors free to cancel it', () => {
    expect(isCancelBlockedForViewer(1, assigned)).toBe(false)
    expect(isCancelBlockedForViewer(55, assigned)).toBe(false)
  })

  it('never blocks a self-made reminder', () => {
    expect(isCancelBlockedForViewer(10, { assigned_to: 10, created_by: 10 })).toBe(false)
  })
})

describe('compareFollowUps', () => {
  it('puts open before done before cancelled, soonest first within each', () => {
    const rows = [
      { id: 1, status: 'cancelled', due_date: '2026-09-01' },
      { id: 2, status: 'done', due_date: '2026-09-02' },
      { id: 3, status: 'open', due_date: '2026-09-20' },
      { id: 4, status: 'open', due_date: '2026-09-10' },
      { id: 5, status: 'done', due_date: '2026-09-01' },
    ]
    expect(rows.sort(compareFollowUps).map((r) => r.id)).toEqual([4, 3, 5, 2, 1])
  })

  it('matches the server order: status descending is open, done, cancelled', () => {
    expect(['open', 'done', 'cancelled'].slice().sort().reverse()).toEqual(['open', 'done', 'cancelled'])
  })
})

describe('reminderSavedMessage', () => {
  it('names the date for a reminder that will not show on Today yet', () => {
    const due = addDays(2)
    const [y, m, d] = due.split('-')
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]
    expect(reminderSavedMessage({ due_date: due })).toBe(
      `Reminder saved for ${Number(d)} ${month} ${y}. It will show here on the day.`
    )
  })

  it('keeps it short for one due today, which is already on screen', () => {
    expect(reminderSavedMessage({ due_date: todayISO() })).toBe('Reminder saved.')
  })

  it('names the person when assigned to someone else', () => {
    expect(reminderSavedMessage({ due_date: todayISO() }, 'Harish Joshi')).toMatch(/^Reminder assigned to Harish Joshi for /)
  })
})

describe('isHoldReviewFollowUp', () => {
  const holdReview = { id: 1, activity_type: 'other', title: 'On hold — resumes after budget approval', leads: { current_stage: 'on_hold' } }

  it('identifies the hold review on an on-hold lead', () => {
    expect(isHoldReviewFollowUp(holdReview)).toBe(true)
  })

  it('is false once the lead is no longer on hold', () => {
    expect(isHoldReviewFollowUp({ ...holdReview, leads: { current_stage: 'calling' } })).toBe(false)
  })

  it('is false for an ordinary reminder on an on-hold lead', () => {
    expect(isHoldReviewFollowUp({ ...holdReview, activity_type: 'call', title: 'Call back' })).toBe(false)
    expect(isHoldReviewFollowUp({ ...holdReview, title: 'Site visit follow-up' })).toBe(false)
  })

  it('is false with no linked lead', () => {
    expect(isHoldReviewFollowUp({ ...holdReview, leads: null })).toBe(false)
  })
})

describe('lockedFollowUpIds', () => {
  it('locks only the hold review row among a mixed list', () => {
    const holdReview = { id: 1, activity_type: 'other', title: 'On hold — resumes soon', leads: { current_stage: 'on_hold' } }
    const ordinary = { id: 2, activity_type: 'call', title: 'Call back', leads: { current_stage: 'calling' } }
    expect(lockedFollowUpIds([holdReview, ordinary])).toEqual(new Set([1]))
  })

  it('is an empty set with nothing to lock', () => {
    expect(lockedFollowUpIds([{ id: 2, activity_type: 'call', title: 'Call back', leads: { current_stage: 'calling' } }])).toEqual(new Set())
  })
})
