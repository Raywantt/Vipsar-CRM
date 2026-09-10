import { describe, it, expect } from 'vitest'
import { ROLES, canHaveCoordinator, canHaveManager, carriesOwnLeads, roleLabel } from './roles'

describe('canHaveCoordinator', () => {
  it('is true for a sales executive', () => {
    expect(canHaveCoordinator(ROLES.SALES_EXECUTIVE)).toBe(true)
  })

  it('is true for a sales manager (2026-09-10: a coordinator may now supervise a manager too)', () => {
    expect(canHaveCoordinator(ROLES.SALES_MANAGER)).toBe(true)
  })

  it('is false for a coordinator or owner — nobody can be their own peer/superior\'s report this way', () => {
    expect(canHaveCoordinator(ROLES.SALES_COORDINATOR)).toBe(false)
    expect(canHaveCoordinator(ROLES.OWNER)).toBe(false)
  })
})

describe('canHaveManager', () => {
  it('is true only for a sales executive — unaffected by the coordinator widening', () => {
    expect(canHaveManager(ROLES.SALES_EXECUTIVE)).toBe(true)
    expect(canHaveManager(ROLES.SALES_MANAGER)).toBe(false)
    expect(canHaveManager(ROLES.SALES_COORDINATOR)).toBe(false)
    expect(canHaveManager(ROLES.OWNER)).toBe(false)
  })
})

describe('carriesOwnLeads', () => {
  it('is true for exec and manager, false for coordinator and owner', () => {
    expect(carriesOwnLeads(ROLES.SALES_EXECUTIVE)).toBe(true)
    expect(carriesOwnLeads(ROLES.SALES_MANAGER)).toBe(true)
    expect(carriesOwnLeads(ROLES.SALES_COORDINATOR)).toBe(false)
    expect(carriesOwnLeads(ROLES.OWNER)).toBe(false)
  })
})

describe('roleLabel', () => {
  it('labels every known role', () => {
    expect(roleLabel(ROLES.SALES_EXECUTIVE)).toBe('Sales Executive')
    expect(roleLabel(ROLES.SALES_MANAGER)).toBe('Sales Manager')
    expect(roleLabel(ROLES.SALES_COORDINATOR)).toBe('Sales Coordinator')
    expect(roleLabel(ROLES.OWNER)).toBe('Owner')
  })

  it('falls back to the raw value for an unrecognized role', () => {
    expect(roleLabel('something_else')).toBe('something_else')
  })

  it('falls back to an em-dash for a missing role', () => {
    expect(roleLabel(null)).toBe('—')
    expect(roleLabel(undefined)).toBe('—')
  })
})
