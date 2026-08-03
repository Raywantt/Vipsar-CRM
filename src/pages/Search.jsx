import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { searchAll, MIN_QUERY_LENGTH } from '../lib/searchQueries'
import { stageChipClass } from '../lib/statusColors'

const SEARCH_DEBOUNCE_MS = 350

const PARTY_TYPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'client', label: 'Client' },
  { value: 'architect', label: 'Architect' },
  { value: 'firm', label: 'Firm' },
]

function leadTitle(lead) {
  return lead.parties?.name ?? (lead.sites?.nickname || lead.sites?.locality) ?? `Lead #${lead.id}`
}

function Search() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState({ parties: [], sites: [], leads: [] })
  const [searching, setSearching] = useState(false)
  // Only Parties has a real party_type to filter by — Leads/Sites sections
  // are unaffected, same as the underlying searchAll() query shape.
  const [partyTypeFilter, setPartyTypeFilter] = useState('')

  useEffect(() => {
    if (term.trim().length < MIN_QUERY_LENGTH) {
      setResults({ parties: [], sites: [], leads: [] })
      setSearching(false)
      return
    }

    let active = true
    setSearching(true)

    const timeout = setTimeout(() => {
      searchAll(term).then((res) => {
        if (!active) return
        setResults(res)
        setSearching(false)
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [term])

  const hasQuery = term.trim().length >= MIN_QUERY_LENGTH
  const parties = partyTypeFilter ? results.parties.filter((p) => p.party_type === partyTypeFilter) : results.parties
  const hasResults = parties.length > 0 || results.sites.length > 0 || results.leads.length > 0

  return (
    <>
      <input
        className="vip-input"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Name, mobile, locality"
        autoFocus
      />

      <div className="vip-seg vip-seg-outline">
        {PARTY_TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={partyTypeFilter === f.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => setPartyTypeFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!hasQuery && <p className="vip-empty">Type at least {MIN_QUERY_LENGTH} characters to search.</p>}
      {hasQuery && searching && <p className="vip-empty">Searching…</p>}
      {hasQuery && !searching && !hasResults && <p className="vip-empty">No matches found.</p>}

      {results.leads.length > 0 && (
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

      {parties.length > 0 && (
        <div className="vip-card">
          <div className="vip-card-title">Parties · {parties.length}</div>
          {parties.map((party) => (
            <div key={party.id} className="vip-row">
              <div className="vip-row-main">
                <div className="vip-row-title">{party.name}</div>
                <div className="vip-row-sub">
                  {party.party_type}
                  {party.mobile ? ` · ${party.mobile}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.sites.length > 0 && (
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
    </>
  )
}

export default Search
