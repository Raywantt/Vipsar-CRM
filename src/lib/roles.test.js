import { describe, it, expect } from 'vitest'
import {
  ROLES,
  canCreateLead,
  canHaveCoordinator,
  canHaveManager,
  canLogActivity,
  canOpenEmployeeProfiles,
  canSeeTeamDirectory,
  canOpenArchitectProfiles,
  canSeeMyArchitects,
  canSeeArchitectNetwork,
  carriesOwnLeads,
  createActionLabel,
  isBdm,
  roleLabel,
  rolesWith,
} from './roles'

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

describe('BDM capabilities', () => {
  it('lets a BDM create leads and log activity', () => {
    expect(canCreateLead(ROLES.BDM)).toBe(true)
    expect(canLogActivity(ROLES.BDM)).toBe(true)
  })

  it('keeps a BDM out of rep-shaped rosters, reporting lines and exec profiles', () => {
    expect(carriesOwnLeads(ROLES.BDM)).toBe(false)
    expect(canHaveCoordinator(ROLES.BDM)).toBe(false)
    expect(canHaveManager(ROLES.BDM)).toBe(false)
    expect(canOpenEmployeeProfiles(ROLES.BDM)).toBe(false)
    expect(canSeeTeamDirectory(ROLES.BDM)).toBe(false)
  })

  it('labels the role in full', () => {
    expect(roleLabel(ROLES.BDM)).toBe('Business Development Manager')
    expect(isBdm(ROLES.BDM)).toBe(true)
    expect(isBdm(ROLES.SALES_MANAGER)).toBe(false)
  })
})

describe('capabilities for the four existing roles are unchanged', () => {
  it('canCreateLead / canLogActivity match the pre-BDM nav flags', () => {
    expect(rolesWith(canCreateLead).sort()).toEqual(
      ['sales_executive', 'owner', 'sales_coordinator', 'sales_manager', 'business_development_manager'].sort()
    )
    expect(rolesWith(canLogActivity).sort()).toEqual(
      ['sales_executive', 'sales_coordinator', 'sales_manager', 'business_development_manager'].sort()
    )
    expect(rolesWith(canSeeTeamDirectory).sort()).toEqual(['owner', 'sales_manager'])
  })

  it('an unrecognised role gets no capability', () => {
    expect(canCreateLead('mystery_role')).toBe(false)
    expect(canLogActivity('mystery_role')).toBe(false)
    expect(canOpenEmployeeProfiles(undefined)).toBe(false)
  })
})

describe('architect screens', () => {
  it('gives My Architects to a BDM only', () => {
    expect(canSeeMyArchitects(ROLES.BDM)).toBe(true)
    for (const role of [ROLES.OWNER, ROLES.SALES_EXECUTIVE, ROLES.SALES_COORDINATOR, ROLES.SALES_MANAGER]) {
      expect(canSeeMyArchitects(role)).toBe(false)
    }
  })

  it('gives Architect Network to the owner only', () => {
    expect(rolesWith(canSeeArchitectNetwork)).toEqual([ROLES.OWNER])
    expect(canSeeArchitectNetwork(undefined)).toBe(false)
  })

  it('lets every role open an architect profile, and no unknown role', () => {
    expect(rolesWith(canOpenArchitectProfiles)).toHaveLength(5)
    expect(canOpenArchitectProfiles('someone_new')).toBe(false)
  })
})

describe('createActionLabel', () => {
  it('calls a BDM\'s create action "New" — it makes a lead or an architect', () => {
    expect(createActionLabel(ROLES.BDM)).toBe('New')
  })

  it('keeps "New Lead" for every other role', () => {
    for (const role of [ROLES.OWNER, ROLES.SALES_EXECUTIVE, ROLES.SALES_COORDINATOR, ROLES.SALES_MANAGER]) {
      expect(createActionLabel(role)).toBe('New Lead')
    }
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
