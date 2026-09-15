import { describe, it, expect } from 'vitest'
import { isArchitectFollowUp, logActivityPathFor } from './followUpQueries'

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
