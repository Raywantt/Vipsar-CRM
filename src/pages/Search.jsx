import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { searchAll, MIN_QUERY_LENGTH } from '../lib/searchQueries'
import { stageChipClass } from '../lib/statusColors'
import { fetchAllParties, fetchLeadsByParty, fetchPartyEmployeeLinks, mostRecentLeadByParty } from '../lib/partyQueries'
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

function Search() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState({ sites: [], leads: [] })
  const [searching, setSearching] = useState(false)

  // The party directory is loaded once, in full, and filtered client-side —
  // same "own data or owner role" un-gated shape PartiesCard used to fetch
  // for the Dashboard's Parties tab, now living here since that tab is gone
  // (this screen is the one place to find/browse a party). Leads/Sites stay
  // a debounced DB round-trip via searchAll, unlike Parties there's no
  // existing directory page for either of those to fold in.
  const [parties, setParties] = useState([])
  const [employeeLinks, setEmployeeLinks] = useState([])
  const [leadsByParty, setLeadsByParty] = useState([])
  const [typeFilter, setTypeFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    let active = true
    fetchAllParties().then(({ data, error }) => {
      if (!active) return
      if (!error) setParties(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchPartyEmployeeLinks().then(({ data, error }) => {
      if (!active) return
      if (!error) setEmployeeLinks(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchLeadsByParty().then(({ data, error }) => {
      if (!active) return
      if (!error) setLeadsByParty(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

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

  const employeeMap = useMemo(() => buildEmployeeMap(employeeLinks), [employeeLinks])
  const partyLeadMap = useMemo(() => mostRecentLeadByParty(leadsByParty), [leadsByParty])
  const partyTypes = useMemo(() => [...new Set(parties.map((p) => p.party_type))].sort(), [parties])

  const termLower = term.trim().toLowerCase()
  const filteredParties = parties.filter((p) => {
    if (typeFilter && p.party_type !== typeFilter) return false
    if (termLower && !p.name.toLowerCase().includes(termLower) && !(p.mobile ?? '').includes(term.trim())) return false
    return true
  })

  const hasQuery = term.trim().length >= MIN_QUERY_LENGTH
  const noLeadsOrSites = hasQuery && !searching && results.leads.length === 0 && results.sites.length === 0

  const activeChips = typeFilter
    ? [{ key: 'type', label: `Type: ${PARTY_TYPE_LABELS[typeFilter] ?? typeFilter}`, onRemove: () => setTypeFilter('') }]
    : []

  return (
    <div className="vip-narrow">
      <input
        className="vip-input"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Name, mobile, locality"
        autoFocus
      />

      {hasQuery && searching && <p className="vip-empty">Searching leads &amp; sites…</p>}

      {hasQuery && results.leads.length > 0 && (
        <div className="vip-card">
          <div className="vip-card-title">Leads · {results.leads.length}</div>
          {results.leads.map((lead) => (
            <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
              <div className="vip-row-main">
                <div className="vip-row-title">{leadTitle(lead)}</div>
              </div>
              <span className={stageChipClass(lead.current_stage ?? 'new')}>{lead.current_stage ?? 'new'}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="vip-card">
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
                {partyTypes.map((t) => (
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

        {parties.length > 0 && (
          <p className="vip-card-note">
            {filteredParties.length} of {parties.length} part{parties.length === 1 ? 'y' : 'ies'}
          </p>
        )}

        {filteredParties.length === 0 ? (
          <p className="vip-empty">No parties found.</p>
        ) : (
          filteredParties.map((party) => {
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
        <div className="vip-card">
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
