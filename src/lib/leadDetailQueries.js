// Everything Lead Detail (/leads/:id) reads about ONE lead, as a single
// answer the page can remember on the device (instant open — see
// src/lib/queryClient.js). Moved out of LeadDetail.jsx's load effect
// unchanged, minus two things that don't belong in a remembered answer:
//   * the shared lookups (active execs, areas, products) — each is its own
//     remembered query, so opening fifty leads doesn't store fifty copies;
//   * the "heal unlinked site contacts" write — the page runs that itself,
//     once, after the fresh copy arrives. A fetch must never write.
//
// Only the lead read itself can fail the answer. Every other part falls back
// to empty exactly as the page always did (a missing site reads as "no site",
// a failed history read as an empty timeline).
import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'
import { fetchLeadOwnerHistory } from './leadOwnerHistory'
import { fetchFollowUpsForLead } from './followUpQueries'
import { attachFirms } from './partyQueries'

const NONE = { data: null, error: null }

// created_by is aliased separately from the owner embed — a lead created by a
// sales_coordinator on an exec's behalf has created_by_employee_id !=
// owner_employee_id (the stamp_lead_creator trigger always stamps the real
// actor); the Deal owner card's "Added by coordinator" note reads it.
// bdm: which business development manager brought the lead in — the Deal
// owner card's "Sourced by" line.
const LEAD_SELECT =
  '*, employees!owner_employee_id(name, office_location), created_by:employees!created_by_employee_id(name, role), bdm:employees!bdm_employee_id(name)'

export async function fetchLeadDetail(id) {
  const { data: lead, error } = await supabase.from('leads').select(LEAD_SELECT).eq('id', id).single()
  if (error) return { data: null, error }

  const [partyRes, otherPartyRes, referrerRes, siteRes, contactsRes, stageHistoryRes, activitiesRes, ownerHistoryRes, followUpsRes] =
    await Promise.all([
      lead.party_id ? supabase.from('parties').select('*').eq('id', lead.party_id).single() : Promise.resolve(NONE),
      lead.other_party_id ? supabase.from('parties').select('*').eq('id', lead.other_party_id).single() : Promise.resolve(NONE),
      // The referrer (New Lead's "Referral from") is as much a party captured
      // at intake as other_party_id.
      lead.referred_by_party_id
        ? supabase.from('parties').select('*').eq('id', lead.referred_by_party_id).single()
        : Promise.resolve(NONE),
      lead.site_id ? supabase.from('sites').select('*').eq('id', lead.site_id).single() : Promise.resolve(NONE),
      lead.site_id
        ? fetchAllRows(() =>
            supabase
              .from('site_contacts')
              .select('id, role, party_id, parties(name, party_type)', { count: 'exact' })
              .eq('site_id', lead.site_id)
          )
        : Promise.resolve({ data: [], error: null }),
      fetchAllRows(() =>
        supabase
          .from('stage_history')
          .select('id, stage, changed_at, changed_by, employees(name)', { count: 'exact' })
          .eq('lead_id', lead.id)
          .order('changed_at', { ascending: true })
      ),
      fetchAllRows(() =>
        supabase
          .from('activities')
          .select(
            'id, activity_type, rfq_kind, notes, created_at, employee_id, employees!employee_id(name), accompanied_by_employee:employees!accompanied_by(name), logged_by_employee_id, logged_by:employees!logged_by_employee_id(name, role)',
            { count: 'exact' }
          )
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
      ),
      fetchLeadOwnerHistory(lead.id),
      // Every follow-up on this lead, any status (FOLLOWUPS.md Rule 3.1).
      fetchFollowUpsForLead(lead.id),
    ])

  // .firm is resolved separately, not embedded — see attachFirms. The
  // Contacts card reads it to pre-fill an architect's existing firm. One call
  // for both parties.
  const withFirms = await attachFirms([otherPartyRes.data, referrerRes.data].filter(Boolean))
  const byId = new Map(withFirms.map((p) => [p.id, p]))

  return {
    data: {
      lead,
      party: partyRes.data ?? null,
      otherParty: otherPartyRes.data ? (byId.get(otherPartyRes.data.id) ?? otherPartyRes.data) : null,
      referrerParty: referrerRes.data ? (byId.get(referrerRes.data.id) ?? referrerRes.data) : null,
      site: siteRes.data ?? null,
      siteContacts: contactsRes.data ?? [],
      stageHistory: stageHistoryRes.data ?? [],
      activities: activitiesRes.data ?? [],
      ownerHistory: ownerHistoryRes.data ?? [],
      followUps: followUpsRes.data ?? [],
    },
    error: null,
  }
}
