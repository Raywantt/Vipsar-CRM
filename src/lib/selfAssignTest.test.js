// Pins the blast radius of the TEMPORARY self-assign test affordance (see
// selfAssignTest.js). The point of these cases is not that the feature works
// — it is that it cannot touch anybody except an owner, and cannot duplicate
// a row that is already in the roster. Both are the ways a "just for testing"
// addition turns into a real, unnoticed product change.
import { describe, it, expect } from 'vitest'
import { withSelfAssignTestOption, SELF_ASSIGN_TEST_ENABLED } from './selfAssignTest'

const roster = [
  { id: 10, name: 'Harish Joshi', role: 'sales_executive' },
  { id: 11, name: 'Vipul Sharma', role: 'sales_executive' },
]

describe('withSelfAssignTestOption', () => {
  // The flag is the documented on/off switch, so every case that depends on it
  // asks it rather than assuming a value — otherwise turning the affordance
  // off (which is the normal resting state) breaks the suite, and a red test
  // that only means "the feature is correctly disabled" trains people to
  // ignore it.
  it('adds the owner as a clearly-labelled last option, when enabled', () => {
    const out = withSelfAssignTestOption(roster, { id: 1, name: 'Raywant', role: 'owner' })

    if (!SELF_ASSIGN_TEST_ENABLED) {
      expect(out).toBe(roster)
      return
    }

    expect(out).toHaveLength(3)
    expect(out.slice(0, 2)).toEqual(roster)
    expect(out[2]).toMatchObject({ id: 1, isSelfAssignTest: true })
    // The label has to say it is a test, or it stops being obvious that this
    // was meant to be removed.
    expect(out[2].name).toContain('TEST')
  })

  it.each([
    ['sales_executive', { id: 10, name: 'Harish Joshi', role: 'sales_executive' }],
    ['sales_coordinator', { id: 20, name: 'Aaradhya Mishra', role: 'sales_coordinator' }],
    ['sales_manager', { id: 21, name: 'Pawan Kumar', role: 'sales_manager' }],
  ])('leaves the roster untouched for a %s', (_role, employee) => {
    expect(withSelfAssignTestOption(roster, employee)).toBe(roster)
  })

  it('leaves the roster untouched when nobody is logged in yet', () => {
    expect(withSelfAssignTestOption(roster, null)).toBe(roster)
    expect(withSelfAssignTestOption(roster, { role: 'owner' })).toBe(roster)
  })

  // An owner who somehow already carries leads would otherwise appear twice in
  // the same dropdown, with two different labels for one person.
  it('does not duplicate an owner already in the roster', () => {
    const withOwner = [...roster, { id: 1, name: 'Raywant', role: 'owner' }]
    expect(withSelfAssignTestOption(withOwner, { id: 1, name: 'Raywant', role: 'owner' })).toBe(withOwner)
  })

  it('is a no-op for an owner once the flag is turned off', () => {
    // Guards the documented removal path: flipping the flag is the whole
    // removal, so if this ever stops being the switch, the test says so. The
    // roster is returned by identity, not a copy, which is also how every
    // other early return in this module behaves.
    const out = withSelfAssignTestOption(roster, { id: 1, name: 'Raywant', role: 'owner' })
    expect(SELF_ASSIGN_TEST_ENABLED ? out.length : out).toEqual(SELF_ASSIGN_TEST_ENABLED ? 3 : roster)
  })
})
