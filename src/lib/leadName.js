// How a lead is NAMED, everywhere in this app. One definition, because there
// were fourteen: LeadsListCard, Search, ActivityLog, EmployeeProfile,
// AssignedLeadsCard, FollowUpList, LeadSearchSelect, LeadDetail, attention.js,
// dayReview.js and four separate spots in drilldownBuilders.js each hand-rolled
// their own, and they had already drifted into three different answers for the
// same lead (some read `parties.name ?? nickname ?? locality`, some
// `parties.name ?? (nickname || locality)`, and six read the party alone and
// printed "(no party)" for a lead that had a perfectly good address on file).
//
// THE RULE (the owner's, 2026-09-12): a lead is referenced by the most
// identifying thing known about it, and that answer MOVES as the record fills
// in. A rep who only walked past a site names it by a nickname; once an address
// is known that is worth more; a named person is worth more still; and the
// client is worth most of all. Adding a client name to a lead that has been
// reading by its nickname for a month must silently re-title it everywhere.
//
//   1. the lead's party      leads.party_id -> parties.name
//   2. the site's address    sites.locality, plus house_no when set
//   3. the site's nickname   sites.nickname
//   4. Lead #<id>
//
// WHY TIER 1 IS ONE TIER AND NOT THREE. The owner's priority names three kinds
// of person — client, then "other" party (an architect, a PMC), then referrer —
// but `leads.party_id` ALREADY resolves exactly that order: LeadQuickCapture
// sets it to the client if there is one, else the referrer, else the other
// party. So the person half of this rule is satisfied by reading one column,
// and no display query has to embed three parties to honour it. The price is
// that promoting a later-added client is a WRITE (it takes over party_id — see
// LeadDetail's handleSetClient), not a change of read order. That write is
// lossless: whatever party_id fell back to is also recorded in its own
// specific column.
//
// Every consumer passes a lead row carrying `parties` (the party_id embed) and
// `sites`. A query missing the sites embed silently loses tiers 2 and 3 and
// falls through to "Lead #id" — so when adding a lead-naming surface, embed
// `sites(nickname, locality, house_no)` rather than letting it degrade quietly.

// The address as a person would say it: locality, then the house/plot number
// when one is recorded. `locality` is the column scanning's own Address box
// writes into (it stopped writing parties.address on 2026-08-19), so a scanned
// lead's typed address is exactly this and nothing else.
export function leadAddress(site) {
  if (!site) return null
  return [site.locality, site.house_no].map((v) => v?.trim?.() ?? v).filter(Boolean).join(', ') || null
}

// Which tier answered. Exported so a surface can tell "this lead is named
// after a person" from "this lead is named after a place" without re-deriving
// the chain — LeadsListCard uses it to avoid printing the same string twice in
// one row.
export function leadNameTier(lead) {
  if (lead?.parties?.name?.trim?.()) return 'party'
  if (leadAddress(lead?.sites)) return 'address'
  if (lead?.sites?.nickname?.trim?.()) return 'nickname'
  return 'id'
}

// The lead's name. Always a string, never null — a row with nothing on it at
// all still has to be clickable, so it reads "Lead #412".
export function leadDisplayName(lead) {
  switch (leadNameTier(lead)) {
    case 'party':
      return lead.parties.name.trim()
    case 'address':
      return leadAddress(lead.sites)
    case 'nickname':
      return lead.sites.nickname.trim()
    default:
      return lead?.id != null ? `Lead #${lead.id}` : 'Lead'
  }
}

// ONE site descriptor for a row that shows one beside the name: the best one
// the NAME didn't already take. Not both joined, and not the nickname by
// default — both were tried and both read badly on real data.
//
// Joining them is the obvious version and it is wrong here, because a scanned
// lead's nickname is usually the address typed again with extra on the end.
// Lead #199 rendered "DUGRI, 450-D · 450-D, DUGRI, LUDHIANA · plot upto 200 sq
// yds" in one table cell — the same place said twice and then qualified. So
// this follows the same ranking the name does (address above nickname) and
// stops at the first one left, which is also the owner's own rule: the list
// carries the most identifying thing, the lead page carries the rest.
//
// Returns null when the name already said everything the site had to say.
export function leadSiteLabel(lead) {
  const name = leadDisplayName(lead)
  const nickname = lead?.sites?.nickname?.trim?.() || null
  return [leadAddress(lead?.sites), nickname].find((p) => p && p !== name) ?? null
}
