import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { errorMessage } from '../lib/errorMessage'
import { sanitizeForIlike } from '../lib/sanitizeForIlike'
import { stageLabel } from '../lib/leadStageOptions'

// Minimum typed characters before we hit the database, and how long we wait
// after the last keystroke — the same values searchQueries.js uses, so every
// free-typed search in this app feels the same.
export const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 350

// How many parties/sites a term may resolve to before we go looking for the
// leads attached to them. This is a company-wide lookup that then gets
// narrowed to one employee's leads, so it has to be generous: a rep searching
// a common surname whose own client sits 40 matches deep would otherwise get
// "No matching leads" for a lead they really own. Bounded only to keep the
// `.in.(...)` query string a sane length.
const LOOKUP_CAP = 150
const RESULT_CAP = 25

const LEAD_COLUMNS =
  'id, current_stage, source_type, party_id, parties!party_id(name, party_type), sites(id, nickname, locality, site_stage)'

function leadLabel(lead) {
  const who = lead.parties?.name ?? 'No client'
  const where = lead.sites?.nickname || lead.sites?.locality || 'No site'
  return `${who} — ${where} (${stageLabel(lead.current_stage ?? 'calling')})`
}

// Two-step search, the same shape searchQueries.js documents: resolve the term
// against `parties` and `sites` directly, then find the leads pointing at
// whichever ids matched, via plain `.in()` filters on leads' own columns. This
// avoids embedded-relation ILIKE filtering, which has no precedent anywhere
// else in this codebase.
//
// THIS USED TO BE A CLIENT-SIDE FILTER over a `.limit(100)` fetch, and that was
// a real, live bug: every legacy-import rep owns more than 100 leads (Vipul
// 140, Harish 155, Manohar 128), so 30-55 of each rep's leads could never be
// selected in Log Activity or on a follow-up, no matter how the name was
// typed. The imports also left `created_at` unset, so all those rows share one
// transaction timestamp and `ORDER BY created_at DESC` broke the tie
// arbitrarily — which is why the missing leads looked random rather than "just
// the oldest ones". Don't reintroduce a fetch-everything-then-filter approach
// here; it is only ever correct while a rep stays under the cap.
async function searchLeads({ term, employeeId, allLeads }) {
  const clean = sanitizeForIlike(term)
  if (clean.length < MIN_QUERY_LENGTH) return { leads: [] }

  const [partiesRes, sitesRes] = await Promise.all([
    supabase.from('parties').select('id').ilike('name', `%${clean}%`).limit(LOOKUP_CAP),
    supabase
      .from('sites')
      .select('id')
      .or(`nickname.ilike.%${clean}%,locality.ilike.%${clean}%`)
      .limit(LOOKUP_CAP),
  ])

  if (partiesRes.error) return { error: partiesRes.error }
  if (sitesRes.error) return { error: sitesRes.error }

  const partyIds = (partiesRes.data ?? []).map((p) => p.id)
  const siteIds = (sitesRes.data ?? []).map((s) => s.id)
  if (!partyIds.length && !siteIds.length) return { leads: [] }

  const orParts = []
  if (partyIds.length) orParts.push(`party_id.in.(${partyIds.join(',')})`)
  if (siteIds.length) orParts.push(`site_id.in.(${siteIds.join(',')})`)

  // `.or()` and `.eq()` combine with AND at the top level, so this stays
  // scoped to the right employee's leads.
  let request = supabase.from('leads').select(LEAD_COLUMNS).or(orParts.join(','))
  if (!allLeads) request = request.eq('owner_employee_id', employeeId)

  const { data, error } = await request.order('created_at', { ascending: false }).limit(RESULT_CAP)
  if (error) return { error }
  return { leads: data ?? [] }
}

// `employeeId` scopes which leads are searchable — defaults to the logged-in
// employee (ActivityLog's case: a rep logging against their own lead). Passed
// explicitly by FollowUpForm so an owner assigning a reminder to a rep
// searches *that rep's* leads rather than their own; RLS lets an owner read
// any lead, and a sales exec can only ever resolve to their own id anyway.
//
// `allLeads` drops the owner filter entirely (still RLS-bounded, so it only
// ever means "everything you're allowed to see"). FollowUpForm sets it when
// an owner is picking a lead for their *own* reminder — an owner works across
// the whole pipeline, so restricting them to leads they personally carry made
// the picker come back empty on a real database.
//
// `party_id` is selected (not just the embedded party name) because
// FollowUpForm stores it on the follow-up row alongside lead_id.
function LeadSearchSelect({ onSelect, employeeId, allLeads = false }) {
  const { employee } = useAuth()
  const scopedEmployeeId = employeeId ?? employee?.id

  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  // Kept purely so "you have no leads at all" stays distinguishable from
  // "nothing matched what you typed" — the old fetch-everything version got
  // that for free, a search-as-you-type one has to ask. `null` = not known
  // yet, and the empty-state message simply doesn't render until it is.
  const [hasAnyLeads, setHasAnyLeads] = useState(null)

  // Every in-flight search carries a sequence number; a response is only
  // applied if it is still the latest one asked for, so a slow reply for
  // "bhu" can't overwrite the results for "bhuvnesh".
  const seqRef = useRef(0)

  useEffect(() => {
    if (!allLeads && !scopedEmployeeId) return
    let active = true

    let request = supabase.from('leads').select('id', { count: 'exact', head: true })
    if (!allLeads) request = request.eq('owner_employee_id', scopedEmployeeId)

    request.then(({ count, error: countError }) => {
      if (!active) return
      // A failure here only costs us the empty-state wording, never the search
      // itself — treat "don't know" as "assume they have some".
      setHasAnyLeads(countError ? true : (count ?? 0) > 0)
    })

    return () => {
      active = false
    }
  }, [scopedEmployeeId, allLeads])

  const term = query.trim()

  useEffect(() => {
    if (!allLeads && !scopedEmployeeId) return
    if (term.length < MIN_QUERY_LENGTH) {
      seqRef.current += 1
      setResults([])
      setSearching(false)
      setError(null)
      return
    }

    const seq = (seqRef.current += 1)
    setSearching(true)
    setError(null)

    const timer = setTimeout(async () => {
      const { leads, error: searchError } = await searchLeads({
        term,
        employeeId: scopedEmployeeId,
        allLeads,
      })
      if (seq !== seqRef.current) return
      setSearching(false)
      if (searchError) setError(errorMessage(searchError))
      else setResults(leads)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [term, scopedEmployeeId, allLeads])

  function selectExisting(lead) {
    setSelected(lead)
    onSelect?.(lead)
  }

  function changeSelection() {
    setSelected(null)
    onSelect?.(null)
  }

  if (selected) {
    return (
      <div className="vip-row">
        <div className="vip-row-main">
          <div className="vip-row-title">{leadLabel(selected)}</div>
        </div>
        <button type="button" className="vip-btn-link" onClick={changeSelection}>
          Change
        </button>
      </div>
    )
  }

  const tooShort = term.length > 0 && term.length < MIN_QUERY_LENGTH

  return (
    <div className="vip-stack-s">
      <label className="vip-field">
        Lead
        <input
          className="vip-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your leads by client or site…"
        />
      </label>

      {error && <p className="vip-error" role="alert">{error}</p>}
      {!error && hasAnyLeads === false && <p className="vip-form-note">You don&apos;t have any leads yet.</p>}
      {!error && hasAnyLeads !== false && !term && (
        <p className="vip-form-note">Type a client or site name to find a lead.</p>
      )}
      {!error && tooShort && (
        <p className="vip-form-note">Keep typing — at least {MIN_QUERY_LENGTH} characters.</p>
      )}
      {!error && searching && !tooShort && <p className="vip-form-note">Searching…</p>}
      {!error && !searching && term.length >= MIN_QUERY_LENGTH && results.length === 0 && (
        <p className="vip-form-note">No matching leads.</p>
      )}

      {results.length > 0 && (
        <div className="vip-card">
          {results.map((lead) => (
            <div key={lead.id} className="vip-row vip-clickable" onClick={() => selectExisting(lead)}>
              <div className="vip-row-main">
                <div className="vip-row-title">{leadLabel(lead)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default LeadSearchSelect
