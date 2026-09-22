// Display labels for parties.party_type — kept in sync with its CHECK
// constraint in Schema/tostem_crm_schema.sql.
//
// Exists because two of the six stored values don't read as themselves: 'firm'
// is specifically an *architect* firm in this dealership's language (the
// schema's own comment on parties.firm_name says "architects often work under
// a firm"), and a bare "firm" in a dropdown next to "architect" and "builder"
// invites a rep to file a builder's company under it. Every other value is
// already its own label.
//
// Lowercase on purpose — this matches how party_type has always rendered in
// PartySearchOrCreate's selected row and search results, so introducing these
// labels doesn't change the case of anything already on screen.
export const PARTY_TYPE_LABELS = {
  client: 'client',
  architect: 'architect',
  firm: 'architect firm',
  builder: 'builder',
  pmc: 'pmc',
  other: 'other',
}

export function partyTypeLabel(value) {
  return PARTY_TYPE_LABELS[value] ?? value
}

// A party's role AT A SITE (site_contacts.role, kept in sync with its CHECK) —
// a different question from its party_type. Lead Detail's Contacts picker
// offers these, and the All Leads Excel export labels contacts with them.
export const SITE_CONTACT_ROLE_OPTIONS = ['owner', 'architect', 'builder', 'project_manager', 'site_staff', 'other']
export const SITE_CONTACT_ROLE_LABELS = {
  owner: 'Owner',
  architect: 'Architect',
  builder: 'Builder',
  project_manager: 'Project manager',
  site_staff: 'Site staff',
  other: 'Other',
}
