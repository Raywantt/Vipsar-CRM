// The BDM pool — leads a business development manager sent to the owner,
// waiting for the owner to assign them (BDM.md §3, Step 3).
//
// ONE definition, read by every surface that has to tell a pool lead apart:
// the owner's pool card, the lead queries that keep pool leads out of company
// figures, and (in SQL) the dashboard RPCs in Schema/migration_bdm_handoff.sql,
// which carry the identical condition. Change one, change the other.
//
// A pool lead is ownerless AND carries a BDM tag. An ownerless lead with no
// tag is not a pool lead — it keeps reading "Unassigned", as it always has.
export function isPoolLead(lead) {
  return lead != null && lead.owner_employee_id == null && lead.bdm_employee_id != null
}

// The same rule as a PostgREST `.or()` filter that KEEPS everything that is
// not a pool lead. Safe beside another `.or()` on the same query (All Leads'
// search adds one) — PostgREST ANDs repeated `or` parameters; checked live
// 2026-09-15 against a query whose answer was known.
export const NOT_POOL_LEAD_FILTER = 'owner_employee_id.not.is.null,bdm_employee_id.is.null'

// Owner's ruling (BDM.md Step 2, answer 3): pool leads are left out of every
// company figure until assigned. The BDM who brought one in is the exception —
// it is their pipeline — so lead fetchers take `includePool` and only a BDM's
// screens pass true. Under RLS no other role can see a pool lead at all, so
// this only ever changes what the owner sees.
export function applyPoolExclusion(query, includePool = false) {
  return includePool ? query : query.or(NOT_POOL_LEAD_FILTER)
}

// For rows that EMBED their lead (stage_history, loss_reasons) — PostgREST
// can't filter a parent on an embed without !inner, and !inner would also
// drop the rows an exec gets back with `leads: null`, which every consumer
// already handles itself. The embed must select owner_employee_id and
// bdm_employee_id.
export function withoutPoolLeadRows(result) {
  if (!result?.data) return result
  return { ...result, data: result.data.filter((row) => !isPoolLead(row.leads)) }
}

// The owner's 24-hour nudge threshold. The push itself is sent by the Edge
// Function (supabase/functions/send-followup-reminders), which can't import
// this file — its POOL_NUDGE_HOURS must match.
export const POOL_NUDGE_HOURS = 24

// Which architect a lead came through, for "via Architect {name}": the
// referrer when that party is an architect, else the "other" party when it
// is. A BDM can pick any of the five sources (owner's ruling, Step 3), so the
// architect is not always the referrer — and on a lead with none, this is
// null and the caller says "Sourced by {BDM}" alone.
export function sourcingArchitect(referrer, otherParty) {
  if (referrer?.party_type === 'architect') return referrer
  if (otherParty?.party_type === 'architect') return otherParty
  return null
}

// Last 10 digits, the shape every phone field in this app saves
// (NumPadInput strips everything else). Legacy rows can carry "+91" or
// spaces, which this normalises away so they still compare equal.
export function normaliseMobile(mobile) {
  const digits = String(mobile ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

// The possible-duplicate hint (owner's ruling, Step 3: same client mobile).
// `poolLeads` embed `parties` (the lead's party); `candidates` are other
// leads whose party is a client sharing one of those mobiles — any lead, pool
// or not, except the pool lead itself. Only a CLIENT counts on either side:
// a pool lead with no client falls back to the architect in party_id, and an
// architect's number is on every lead they ever referred.
//
// Returns Map(poolLeadId -> candidate leads), newest first as given.
export function findPossibleDuplicates(poolLeads, candidates) {
  const byMobile = new Map()
  for (const c of candidates ?? []) {
    if (c.parties?.party_type !== 'client') continue
    const key = normaliseMobile(c.parties.mobile)
    if (!key) continue
    if (!byMobile.has(key)) byMobile.set(key, [])
    byMobile.get(key).push(c)
  }

  const result = new Map()
  for (const lead of poolLeads ?? []) {
    if (lead.parties?.party_type !== 'client') continue
    const key = normaliseMobile(lead.parties.mobile)
    if (!key) continue
    const matches = (byMobile.get(key) ?? []).filter((c) => c.id !== lead.id)
    if (matches.length) result.set(lead.id, matches)
  }
  return result
}

// "3h" / "2d" — how long a pool lead has waited. `createdAt` must already be
// a Date (parse naive timestamps with dbTime.js's parseTimestamp first).
export function waitingLabel(createdAt, now = new Date()) {
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null
  const minutes = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
