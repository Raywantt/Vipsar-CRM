import { supabase } from './supabaseClient'
import { sanitizeForIlike } from './sanitizeForIlike'
import { applyPoolExclusion } from './poolLeads'

export const MIN_QUERY_LENGTH = 2

// Two-step: search parties/sites directly (same pattern PartySearchOrCreate/
// SiteSearchOrCreate already use), then find leads linked to whichever
// parties/sites matched via simple .in() filters on leads' own columns —
// avoids relying on embedded-relation ILIKE filtering, which has no
// precedent anywhere else in this codebase.
//
// `includePool`: a BDM pool lead is left out of the Leads results unless
// this is true (src/lib/poolLeads.js — owner's ruling that the pool card is
// the only place a waiting lead shows). Only a BDM passes true: it is their
// lead. The client/site themselves still come back under Parties and Sites.
export async function searchAll(term, { includePool = false } = {}) {
  const clean = sanitizeForIlike(term.trim())
  if (clean.length < MIN_QUERY_LENGTH) {
    return { parties: [], sites: [], leads: [] }
  }

  const [partiesRes, sitesRes] = await Promise.all([
    supabase
      .from('parties')
      .select('id, name, mobile, party_type')
      .or(`name.ilike.%${clean}%,mobile.ilike.%${clean}%`)
      .order('name')
      .limit(10),
    supabase
      .from('sites')
      .select('id, nickname, locality, house_no, area_id, areas(area_name)')
      .or(`nickname.ilike.%${clean}%,locality.ilike.%${clean}%,house_no.ilike.%${clean}%`)
      .order('locality')
      .limit(10),
  ])

  const partyIds = (partiesRes.data ?? []).map((p) => p.id)
  const siteIds = (sitesRes.data ?? []).map((s) => s.id)

  let leads = []
  if (partyIds.length || siteIds.length) {
    const orParts = []
    if (partyIds.length) orParts.push(`party_id.in.(${partyIds.join(',')})`)
    if (siteIds.length) orParts.push(`site_id.in.(${siteIds.join(',')})`)

    const { data } = await applyPoolExclusion(
      supabase
        .from('leads')
        .select('id, current_stage, bdm_employee_id, parties!party_id(name), sites(nickname, locality, house_no)')
        .or(orParts.join(','))
        .limit(20),
      includePool
    )

    leads = data ?? []
  }

  return {
    parties: partiesRes.data ?? [],
    sites: sitesRes.data ?? [],
    leads,
  }
}
