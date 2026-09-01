import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import { searchAll, MIN_QUERY_LENGTH } from '../lib/searchQueries'
import { stageChipClass } from '../lib/statusColors'
import { stageLabel } from '../lib/leadStageOptions'
import { fetchRecentParties, searchParties, fetchLeadsForParties, mostRecentLeadByParty } from '../lib/partyQueries'
import { errorMessage } from '../lib/errorMessage'
import EmployeeLink from '../components/EmployeeLink'

const SEARCH_DEBOUNCE_MS = 350

const PARTY_TYPE_LABELS = {
  client: 'Client',
  architect: 'Architect',
  builder: 'Builder',
  firm: 'Firm',
  other: 'Other',
  pmc: 'PMC',
}

// party_type is a fixed 6-value DB CHECK constraint (see
// Schema/tostem_crm_schema.sql) — a static list now that the filter no
// longer has a full downloaded directory to discover values from.
const PARTY_TYPE_OPTIONS = Object.keys(PARTY_TYPE_LABELS)

// Map<partyId, Map<employeeId, employeeName>> — keyed by id (not just a Set
// of names) so the "Worked with" list can link each name to /employees/:id.
function buildEmployeeMap(links) {
  const map = new Map()
  links.forEach((lead) => {
    const employeeId = lead.owner_employee_id
    const employeeName = lead.employees?.name
    if (!employeeId || !employeeName) return
    ;[lead.party_id, lead.other_party_id, lead.referred_by_party_id].forEach((partyId) => {
      if (!partyId) return
      if (!map.has(partyId)) map.set(partyId, new Map())
      map.get(partyId).set(employeeId, employeeName)
    })
  })
  return map
}

function leadTitle(lead) {
  return lead.parties?.name ?? (lead.sites?.nickname || lead.sites?.locality) ?? `Lead #${lead.id}`
}

// Persisted across a "click into a result, then Back" round trip, reset on
// a fresh nav-link visit — see usePersistedFilterState's own header comment.
const FILTERS_STORAGE_KEY = 'vip-filters:search'

function Search() {
  const [term, setTerm] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'term', '')
  const [results, setResults] = useState({ sites: [], leads: [] })
  const [searching, setSearching] = useState(false)

  // Server-side now — see fetchRecentParties/searchParties in
  // partyQueries.js. `parties` holds whichever of the two is currently
  // showing (recent, below MIN_QUERY_LENGTH; search results, at or above
  // it) — there's no more client-side filtering over a fully-downloaded
  // directory. `leadsDirectory` is scoped to just those parties' ids
  // (fetchLeadsForParties), not a full unbounded `leads` scan.
  const [parties, setParties] = useState([])
  const [partiesLoading, setPartiesLoading] = useState(true)
  const [partiesError, setPartiesError] = useState(null)
  const [partiesCapped, setPartiesCapped] = useState(false)
  const [leadsDirectory, setLeadsDirectory] = useState([])
  const [typeFilter, setTypeFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'typeFilter', '')
  const [filtersOpen, setFiltersOpen] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'filtersOpen', false)
  // Mobile-only — desktop always stacks all three sections (see
  // .vip-search-hide-mobile, only active below 1024px).
  const [mobileTab, setMobileTab] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'mobileTab', 'parties')

  // Not persisted — derived from `term` via the debounce effect below.
  // Seeded from term's own restored value so a POP-navigation round trip
  // doesn't wait out a debounce delay before showing the right results
  // again. Same pattern LeadsListCard.jsx uses for its own search box.
  const [debouncedTerm, setDebouncedTerm] = useState(term)

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [term])

  const hasPartySearch = debouncedTerm.trim().length >= MIN_QUERY_LENGTH

  // Parties: recent-or-search, then the leads scoped to whichever parties
  // came back — one combined effect (not two separate ones) so the leads
  // fetch is never a beat behind which parties are actually on screen.
  useEffect(() => {
    let active = true
    setPartiesLoading(true)
    setPartiesError(null)

    async function run() {
      const partiesResult = hasPartySearch
        ? await searchParties(debouncedTerm, typeFilter || null)
        : await fetchRecentParties(typeFilter || null).then(({ data, error }) => ({
            data: data ?? [],
            error,
            capped: false,
          }))
      if (!active) return

      if (partiesResult.error) {
        setPartiesError(errorMessage(partiesResult.error))
        setParties([])
        setPartiesCapped(false)
        setLeadsDirectory([])
        setPartiesLoading(false)
        return
      }

      setParties(partiesResult.data)
      setPartiesCapped(partiesResult.capped)

      const partyIds = partiesResult.data.map((p) => p.id)
      const { data: leadsData, error: leadsError } = await fetchLeadsForParties(partyIds)
      if (!active) return
      setLeadsDirectory(leadsError ? [] : leadsData ?? [])
      setPartiesLoading(false)
    }

    run()

    return () => {
      active = false
    }
  }, [debouncedTerm, typeFilter, hasPartySearch])

  // Leads/Sites results — unchanged: still its own debounced DB round-trip
  // via searchAll, gated on the raw (not debounced) term with its own
  // internal 350ms timer, same as before this pass.
  useEffect(() => {
    if (term.trim().length < MIN_QUERY_LENGTH) {
      setResults({ sites: [], leads: [] })
      setSearching(false)
      return
    }

    let active = true
    setSearching(true)

    const timeout = setTimeout(() => {
      searchAll(term).then((res) => {
        if (!active) return
        setResults({ sites: res.sites, leads: res.leads })
        setSearching(false)
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [term])

  const employeeMap = useMemo(() => buildEmployeeMap(leadsDirectory), [leadsDirectory])
  const partyLeadMap = useMemo(() => mostRecentLeadByParty(leadsDirectory), [leadsDirectory])

  const hasQuery = term.trim().length >= MIN_QUERY_LENGTH
  const noLeadsOrSites = hasQuery && !searching && results.leads.length === 0 && results.sites.length === 0

  const activeChips = typeFilter
    ? [{ key: 'type', label: `Type: ${PARTY_TYPE_LABELS[typeFilter] ?? typeFilter}`, onRemove: () => setTypeFilter('') }]
    : []

  return (
    <div className="vip-narrow vip-pad-fab-overhang">
      <input
        className="vip-input"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Name, mobile, locality"
        autoFocus
      />

      <div className="vip-seg vip-only-mobile" role="group" aria-label="Result type">
        {[
          { value: 'parties', label: 'Parties' },
          { value: 'leads', label: 'Leads' },
          { value: 'sites', label: 'Sites' },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={mobileTab === opt.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => setMobileTab(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {hasQuery && searching && <p className="vip-empty">Searching leads &amp; sites…</p>}

      {hasQuery && results.leads.length > 0 && (
        <div className={mobileTab === 'leads' ? 'vip-card' : 'vip-card vip-search-hide-mobile'}>
          <div className="vip-card-title">Leads · {results.leads.length}</div>
          {results.leads.map((lead) => (
            <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
              <div className="vip-row-main">
                <div className="vip-row-title">{leadTitle(lead)}</div>
              </div>
              <span className={stageChipClass(lead.current_stage ?? 'calling')}>{stageLabel(lead.current_stage ?? 'calling')}</span>
            </Link>
          ))}
        </div>
      )}

      <div className={mobileTab === 'parties' ? 'vip-card' : 'vip-card vip-search-hide-mobile'}>
        <div className="vip-card-title">Parties</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="vip-btn vip-btn-secondary vip-btn-sm"
            style={{ width: 'auto' }}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {filtersOpen ? 'Hide filters' : activeChips.length > 0 ? `Filters (${activeChips.length})` : 'Filters'}
          </button>
          {activeChips.length > 0 && (
            <button type="button" className="vip-action-close" onClick={() => setTypeFilter('')}>
              Clear all
            </button>
          )}
        </div>

        {!filtersOpen && activeChips.length > 0 && (
          <div className="vip-chip-wrap">
            {activeChips.map((chip) => (
              <button key={chip.key} type="button" className="vip-filter-chip" onClick={chip.onRemove}>
                {chip.label}
                <span className="vip-filter-chip-x" aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}

        {filtersOpen && (
          <div className="vip-stack-s" style={{ paddingTop: 10, borderTop: '1px solid var(--vip-line-soft)' }}>
            <div className="vip-stack-s" style={{ gap: 6 }}>
              <div className="vip-fact-label">Type</div>
              <div className="vip-chip-wrap">
                <button
                  type="button"
                  className="vip-chip-select"
                  aria-pressed={typeFilter === ''}
                  onClick={() => setTypeFilter('')}
                >
                  All
                </button>
                {PARTY_TYPE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="vip-chip-select"
                    aria-pressed={typeFilter === t}
                    onClick={() => setTypeFilter(t)}
                  >
                    {PARTY_TYPE_LABELS[t] ?? t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!partiesLoading && !partiesError && (
          <p className="vip-card-note">
            {hasPartySearch
              ? `${parties.length} matching part${parties.length === 1 ? 'y' : 'ies'}`
              : `${parties.length} most recently added`}
          </p>
        )}
        {partiesCapped && (
          <p className="vip-form-note">
            Showing the first 50 matching parties — refine your search for a complete list.
          </p>
        )}
        {partiesError && <p className="vip-error" role="alert">{partiesError}</p>}

        {partiesLoading ? (
          <p className="vip-empty">{hasPartySearch ? 'Searching…' : 'Loading…'}</p>
        ) : partiesError ? null : parties.length === 0 ? (
          <p className="vip-empty">{hasPartySearch ? 'No parties found.' : 'No parties yet.'}</p>
        ) : (
          parties.map((party) => {
            const leadId = partyLeadMap.get(party.id)
            const employees = employeeMap.has(party.id) ? [...employeeMap.get(party.id).entries()] : []
            const rowContent = (
              <>
                <div className="vip-row-main">
                  <div className="vip-row-title">{party.name}</div>
                  <div className="vip-row-sub">
                    {[PARTY_TYPE_LABELS[party.party_type] ?? party.party_type, party.mobile].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="vip-row-meta">
                  {employees.length === 0
                    ? '—'
                    : employees.map(([empId, empName], i) => (
                        <span key={empId}>
                          <EmployeeLink id={empId} name={empName} />
                          {i < employees.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                </div>
              </>
            )
            return leadId ? (
              <Link key={party.id} to={`/leads/${leadId}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
                {rowContent}
              </Link>
            ) : (
              <div key={party.id} className="vip-row">
                {rowContent}
              </div>
            )
          })
        )}
      </div>

      {hasQuery && results.sites.length > 0 && (
        <div className={mobileTab === 'sites' ? 'vip-card' : 'vip-card vip-search-hide-mobile'}>
          <div className="vip-card-title">Sites · {results.sites.length}</div>
          {results.sites.map((site) => (
            <div key={site.id} className="vip-row">
              <div className="vip-row-main">
                <div className="vip-row-title">{site.nickname || site.locality || `Site #${site.id}`}</div>
                <div className="vip-row-sub">
                  {[site.locality, site.house_no, site.areas?.area_name].filter(Boolean).join(', ') || '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {noLeadsOrSites && <p className="vip-empty">No matching leads or sites.</p>}
    </div>
  )
}

export default Search
