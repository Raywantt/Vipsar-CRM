import { describe, it, expect } from 'vitest'
import {
  isPoolLead,
  applyPoolExclusion,
  withoutPoolLeadRows,
  NOT_POOL_LEAD_FILTER,
  sourcingArchitect,
  normaliseMobile,
  findPossibleDuplicates,
  waitingLabel,
} from './poolLeads'

describe('isPoolLead', () => {
  it('is an ownerless lead carrying a BDM tag', () => {
    expect(isPoolLead({ owner_employee_id: null, bdm_employee_id: 7 })).toBe(true)
  })

  it('is not a BDM lead someone owns (assigned, or "I\'ll work this myself")', () => {
    expect(isPoolLead({ owner_employee_id: 3, bdm_employee_id: 7 })).toBe(false)
    expect(isPoolLead({ owner_employee_id: 7, bdm_employee_id: 7 })).toBe(false)
  })

  it('is not an ownerless lead without a tag — that stays plain "Unassigned"', () => {
    expect(isPoolLead({ owner_employee_id: null, bdm_employee_id: null })).toBe(false)
  })

  it('treats a missing lead (an RLS-null embed) as not a pool lead', () => {
    expect(isPoolLead(null)).toBe(false)
    expect(isPoolLead(undefined)).toBe(false)
  })
})

describe('applyPoolExclusion', () => {
  function fakeQuery() {
    const calls = []
    const q = { or: (f) => (calls.push(f), q), calls }
    return q
  }

  it('adds the not-a-pool-lead filter by default', () => {
    const q = fakeQuery()
    applyPoolExclusion(q)
    expect(q.calls).toEqual([NOT_POOL_LEAD_FILTER])
  })

  it('leaves the query alone when a BDM screen asks for pool leads', () => {
    const q = fakeQuery()
    applyPoolExclusion(q, true)
    expect(q.calls).toEqual([])
  })

  it('keeps exactly the complement of isPoolLead', () => {
    // owner_employee_id.not.is.null OR bdm_employee_id.is.null
    const keeps = (l) => l.owner_employee_id != null || l.bdm_employee_id == null
    const cases = [
      { owner_employee_id: null, bdm_employee_id: 7 },
      { owner_employee_id: 3, bdm_employee_id: 7 },
      { owner_employee_id: null, bdm_employee_id: null },
      { owner_employee_id: 3, bdm_employee_id: null },
    ]
    for (const l of cases) expect(keeps(l)).toBe(!isPoolLead(l))
  })
})

describe('withoutPoolLeadRows', () => {
  it('drops rows whose embedded lead is in the pool and keeps RLS-null embeds', () => {
    const res = {
      data: [
        { lead_id: 1, leads: { owner_employee_id: null, bdm_employee_id: 7 } },
        { lead_id: 2, leads: { owner_employee_id: 4, bdm_employee_id: 7 } },
        { lead_id: 3, leads: null },
      ],
      error: null,
    }
    expect(withoutPoolLeadRows(res).data.map((r) => r.lead_id)).toEqual([2, 3])
  })

  it('passes an error result through untouched', () => {
    const res = { data: null, error: { message: 'boom' } }
    expect(withoutPoolLeadRows(res)).toBe(res)
  })
})

describe('sourcingArchitect', () => {
  const arch = { name: 'Ar. Mehta', party_type: 'architect' }
  const client = { name: 'Sharma', party_type: 'client' }

  it('prefers the referrer when they are an architect', () => {
    expect(sourcingArchitect(arch, { name: 'Other', party_type: 'architect' })).toBe(arch)
  })

  it('falls back to the other party on a non-architect source', () => {
    expect(sourcingArchitect(client, arch)).toBe(arch)
    expect(sourcingArchitect(null, arch)).toBe(arch)
  })

  it('is null when no architect is on the lead', () => {
    expect(sourcingArchitect(client, { party_type: 'builder' })).toBe(null)
    expect(sourcingArchitect(null, null)).toBe(null)
  })
})

describe('normaliseMobile', () => {
  it('keeps the last 10 digits, whatever formatting a legacy row carries', () => {
    expect(normaliseMobile('9876543210')).toBe('9876543210')
    expect(normaliseMobile('+91 98765-43210')).toBe('9876543210')
    expect(normaliseMobile('919876543210')).toBe('9876543210')
  })

  it('is null for anything shorter than a real number', () => {
    expect(normaliseMobile('98765')).toBe(null)
    expect(normaliseMobile(null)).toBe(null)
  })
})

describe('findPossibleDuplicates', () => {
  const client = (id, mobile) => ({ id, name: `C${id}`, mobile, party_type: 'client' })

  it('flags another lead whose client has the same mobile', () => {
    const pool = [{ id: 10, parties: client(1, '9876543210') }]
    const candidates = [
      { id: 10, parties: client(1, '9876543210') },
      { id: 4, parties: client(2, '+91 98765 43210') },
    ]
    const result = findPossibleDuplicates(pool, candidates)
    expect(result.get(10).map((c) => c.id)).toEqual([4])
  })

  it('never flags the pool lead against itself', () => {
    const pool = [{ id: 10, parties: client(1, '9876543210') }]
    expect(findPossibleDuplicates(pool, [{ id: 10, parties: client(1, '9876543210') }]).has(10)).toBe(false)
  })

  it('also catches two pool leads for the same client', () => {
    const pool = [
      { id: 10, parties: client(1, '9876543210') },
      { id: 11, parties: client(1, '9876543210') },
    ]
    const result = findPossibleDuplicates(pool, pool)
    expect(result.get(10).map((c) => c.id)).toEqual([11])
    expect(result.get(11).map((c) => c.id)).toEqual([10])
  })

  it('ignores an architect in the party slot — their number is on every lead they refer', () => {
    const arch = { id: 5, name: 'Ar. X', mobile: '9000000000', party_type: 'architect' }
    const pool = [{ id: 10, parties: arch }]
    const candidates = [{ id: 3, parties: arch }]
    expect(findPossibleDuplicates(pool, candidates).size).toBe(0)
  })

  it('gives no hint to a lead with no client mobile', () => {
    const pool = [{ id: 10, parties: client(1, null) }]
    const candidates = [{ id: 3, parties: client(2, null) }]
    expect(findPossibleDuplicates(pool, candidates).size).toBe(0)
  })
})

describe('waitingLabel', () => {
  const now = new Date('2026-09-15T12:00:00Z')

  it('reads minutes, then hours up to two days, then days', () => {
    expect(waitingLabel(new Date('2026-09-15T11:45:00Z'), now)).toBe('15m')
    expect(waitingLabel(new Date('2026-09-15T09:00:00Z'), now)).toBe('3h')
    expect(waitingLabel(new Date('2026-09-14T08:00:00Z'), now)).toBe('28h')
    expect(waitingLabel(new Date('2026-09-12T12:00:00Z'), now)).toBe('3d')
  })

  it('is null for a missing or invalid date', () => {
    expect(waitingLabel(null, now)).toBe(null)
    expect(waitingLabel(new Date('nope'), now)).toBe(null)
  })
})
