import { describe, it, expect } from 'vitest'
import { leadAddress, leadDisplayName, leadNameTier, leadSiteLabel } from './leadName'

const site = (s) => ({ nickname: null, locality: null, house_no: null, ...s })

describe('leadAddress', () => {
  it('joins locality and house number when both are set', () => {
    expect(leadAddress(site({ locality: 'Model Town', house_no: '42' }))).toBe('Model Town, 42')
  })

  it('is the locality alone when there is no house number', () => {
    expect(leadAddress(site({ locality: 'Model Town' }))).toBe('Model Town')
  })

  it('is the house number alone when that is all there is', () => {
    expect(leadAddress(site({ house_no: '42' }))).toBe('42')
  })

  it('is null for no site, an empty site, or whitespace-only fields', () => {
    expect(leadAddress(null)).toBe(null)
    expect(leadAddress(site({}))).toBe(null)
    expect(leadAddress(site({ locality: '   ' }))).toBe(null)
  })
})

describe('leadDisplayName', () => {
  it('prefers the party over everything else on the lead', () => {
    const lead = { id: 7, parties: { name: 'Ritika Joshi' }, sites: site({ nickname: 'green gate', locality: 'Model Town', house_no: '42' }) }
    expect(leadDisplayName(lead)).toBe('Ritika Joshi')
    expect(leadNameTier(lead)).toBe('party')
  })

  // The whole point of the 2026-09-12 rule: an address outranks a nickname,
  // which is the REVERSE of what every hand-rolled copy did before it.
  it('prefers the address over the nickname when there is no party', () => {
    const lead = { id: 7, parties: null, sites: site({ nickname: 'green gate', locality: 'Model Town' }) }
    expect(leadDisplayName(lead)).toBe('Model Town')
    expect(leadNameTier(lead)).toBe('address')
  })

  it('falls back to the nickname when no address is recorded', () => {
    const lead = { id: 7, parties: null, sites: site({ nickname: 'green gate' }) }
    expect(leadDisplayName(lead)).toBe('green gate')
    expect(leadNameTier(lead)).toBe('nickname')
  })

  it('falls back to the id when the lead carries nothing identifying at all', () => {
    expect(leadDisplayName({ id: 412, parties: null, sites: null })).toBe('Lead #412')
    expect(leadNameTier({ id: 412 })).toBe('id')
  })

  it('never returns null, even for an id-less row', () => {
    expect(leadDisplayName({})).toBe('Lead')
    expect(leadDisplayName(null)).toBe('Lead')
  })

  // A party row whose name is blank must not win its tier and leave the lead
  // rendering an empty string — it falls through like any other missing value.
  it('ignores a blank or whitespace party name', () => {
    const lead = { id: 7, parties: { name: '  ' }, sites: site({ locality: 'Model Town' }) }
    expect(leadDisplayName(lead)).toBe('Model Town')
  })

  // This is the behaviour the owner described: the name MOVES as the record
  // fills in, with no per-lead setting anywhere deciding it.
  it('re-titles itself as better information arrives', () => {
    const sites = site({ nickname: 'green gate' })
    expect(leadDisplayName({ id: 7, sites })).toBe('green gate')
    sites.locality = 'Model Town'
    expect(leadDisplayName({ id: 7, sites })).toBe('Model Town')
    expect(leadDisplayName({ id: 7, sites, parties: { name: 'Ar Kapoor' } })).toBe('Ar Kapoor')
    expect(leadDisplayName({ id: 7, sites, parties: { name: 'Ritika Joshi' } })).toBe('Ritika Joshi')
  })
})

describe('leadSiteLabel', () => {
  // ONE descriptor, ranked the same way the name is — never both joined. A
  // scanned lead's nickname is usually its address typed again with extra on
  // the end, so joining them printed the same place twice in one table cell.
  it('gives the address when the name came from the party', () => {
    const lead = { id: 7, parties: { name: 'Ritika Joshi' }, sites: site({ nickname: 'green gate', locality: 'Model Town' }) }
    expect(leadSiteLabel(lead)).toBe('Model Town')
  })

  it('falls back to the nickname when the party is named and there is no address', () => {
    const lead = { id: 7, parties: { name: 'Ritika Joshi' }, sites: site({ nickname: 'green gate' }) }
    expect(leadSiteLabel(lead)).toBe('green gate')
  })

  // Without this subtraction a lead named after its address printed that
  // address twice, side by side, in one row.
  it('drops the descriptor the name already used', () => {
    expect(leadSiteLabel({ id: 7, sites: site({ nickname: 'green gate', locality: 'Model Town' }) })).toBe('green gate')
    expect(leadSiteLabel({ id: 7, sites: site({ locality: 'Model Town' }) })).toBe(null)
    expect(leadSiteLabel({ id: 7, sites: site({ nickname: 'green gate' }) })).toBe(null)
  })

  it('is null when there is no site at all', () => {
    expect(leadSiteLabel({ id: 7, parties: { name: 'Ritika Joshi' }, sites: null })).toBe(null)
  })
})
