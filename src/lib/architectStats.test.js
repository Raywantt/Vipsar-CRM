import { describe, it, expect } from 'vitest'
import {
  ARCHITECT_MEETING_DAYS,
  architectsToMeet,
  architectIdForLead,
  groupArchitectsByFirm,
  lastMeetingByArchitect,
  lastMetLabel,
  leadStatsByArchitect,
  portfolioTag,
  summariseArchitectLeads,
} from './architectStats'

// Naive TIMESTAMP strings, the shape the schema serves (UTC wall clock).
const NOW = new Date('2026-09-15T12:00:00Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString().replace('Z', '')

describe('lastMeetingByArchitect', () => {
  it('keeps the latest meeting per architect, whatever order they arrive in', () => {
    const map = lastMeetingByArchitect([
      { party_id: 1, created_at: daysAgo(10) },
      { party_id: 1, created_at: daysAgo(2) },
      { party_id: 2, created_at: daysAgo(30) },
      { party_id: null, created_at: daysAgo(1) },
    ])
    expect(map.get(1)).toBe(daysAgo(2))
    expect(map.get(2)).toBe(daysAgo(30))
    expect(map.size).toBe(2)
  })
})

describe('lastMetLabel', () => {
  it('reads today, a day count, or never', () => {
    expect(lastMetLabel(0)).toBe('met today')
    expect(lastMetLabel(3)).toBe('last met 3d ago')
    expect(lastMetLabel(null)).toBe('not met yet')
  })
})

describe('architectsToMeet', () => {
  const arch = (id, name, sinceDays) => ({ id, name, bdm_since: sinceDays == null ? null : daysAgo(sinceDays) })

  it(`flags an architect not met in ${ARCHITECT_MEETING_DAYS}+ days, most overdue first`, () => {
    const lastMet = new Map([
      [1, daysAgo(20)],
      [2, daysAgo(3)],
      [3, daysAgo(40)],
    ])
    const rows = architectsToMeet([arch(1, 'A', 100), arch(2, 'B', 100), arch(3, 'C', 100)], lastMet, NOW)
    expect(rows.map((r) => [r.architect.id, r.clockDays])).toEqual([
      [3, 40],
      [1, 20],
    ])
  })

  it('does not flag an architect at exactly one day short of the rule', () => {
    const lastMet = new Map([[1, daysAgo(ARCHITECT_MEETING_DAYS - 1)]])
    expect(architectsToMeet([arch(1, 'A', 100)], lastMet, NOW)).toEqual([])
  })

  it('starts a never-met architect\'s clock at bdm_since, so a fresh import does not flood the queue', () => {
    expect(architectsToMeet([arch(1, 'Fresh', 2)], new Map(), NOW)).toEqual([])
    const rows = architectsToMeet([arch(2, 'Old', 30)], new Map(), NOW)
    expect(rows[0]).toMatchObject({ clockDays: 30, lastMetAt: null, lastMetDays: null })
  })

  it('uses the LATER of last meeting and bdm_since — a meeting before joining the portfolio does not age it', () => {
    const lastMet = new Map([[1, daysAgo(90)]])
    expect(architectsToMeet([arch(1, 'A', 5)], lastMet, NOW)).toEqual([])
  })
})

describe('architectIdForLead', () => {
  it('credits the referrer when they are an architect, else the other party', () => {
    expect(architectIdForLead({ referrer: { id: 7, party_type: 'architect' }, other: { id: 8, party_type: 'architect' } })).toBe(7)
    expect(architectIdForLead({ referrer: { id: 7, party_type: 'client' }, other: { id: 8, party_type: 'architect' } })).toBe(8)
    expect(architectIdForLead({ referrer: null, other: null })).toBe(null)
  })
})

describe('summariseArchitectLeads', () => {
  it('counts referred, open pipeline, won value and win rate', () => {
    const s = summariseArchitectLeads([
      { current_stage: 'rfq', quote_value: 100000 },
      { current_stage: 'on_hold', quote_value: 50000 },
      { current_stage: 'won', order_value: 400000, quote_value: 350000 },
      { current_stage: 'lost', quote_value: 90000 },
    ])
    expect(s).toMatchObject({ referred: 4, openCount: 2, openValue: 100000, wonCount: 1, wonValue: 400000, lostCount: 1, winRate: 50 })
  })

  it('has no win rate until something is decided', () => {
    expect(summariseArchitectLeads([{ current_stage: 'calling' }]).winRate).toBe(null)
    expect(summariseArchitectLeads([]).winRate).toBe(null)
  })
})

describe('leadStatsByArchitect', () => {
  it('groups leads under the architect each is credited to and skips leads with none', () => {
    const arch = (id) => ({ id, party_type: 'architect' })
    const stats = leadStatsByArchitect([
      { current_stage: 'won', order_value: 10, referrer: arch(1) },
      { current_stage: 'calling', referrer: arch(1) },
      { current_stage: 'lost', other: arch(2) },
      { current_stage: 'calling' },
    ])
    expect(stats.get(1)).toMatchObject({ referred: 2, wonCount: 1 })
    expect(stats.get(2)).toMatchObject({ referred: 1, lostCount: 1 })
    expect(stats.size).toBe(2)
  })
})

describe('groupArchitectsByFirm', () => {
  it('groups by firm alphabetically with "No firm" last and names sorted inside', () => {
    const groups = groupArchitectsByFirm([
      { id: 1, name: 'Zed', firm: { id: 10, name: 'Studio SK' } },
      { id: 2, name: 'Vikram', firm: null },
      { id: 3, name: 'Neha', firm: { id: 11, name: 'Mehta & Co' } },
      { id: 4, name: 'Rohit', firm: { id: 11, name: 'Mehta & Co' } },
      { id: 5, name: 'Legacy', firm: null, firm_name: 'Old Text Firm' },
    ])
    expect(groups.map((g) => [g.firmName, g.architects.map((a) => a.name)])).toEqual([
      ['Mehta & Co', ['Neha', 'Rohit']],
      ['Old Text Firm', ['Legacy']],
      ['Studio SK', ['Zed']],
      [null, ['Vikram']],
    ])
  })
})

describe('portfolioTag', () => {
  it('reads "Yours" for the viewer\'s own architect and names another BDM\'s', () => {
    const party = { party_type: 'architect', bdm_employee_id: 46, bdm: { name: 'Test BDM' } }
    expect(portfolioTag(party, 46)).toBe('Yours')
    expect(portfolioTag(party, 3)).toBe('With Test BDM')
  })

  it('shows nothing for an architect in no portfolio, or for a non-architect', () => {
    expect(portfolioTag({ party_type: 'architect', bdm_employee_id: null }, 46)).toBe(null)
    expect(portfolioTag({ party_type: 'client', bdm_employee_id: 46 }, 46)).toBe(null)
  })
})
