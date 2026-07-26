import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { searchAll, MIN_QUERY_LENGTH } from '../lib/searchQueries'
import './Search.css'

const SEARCH_DEBOUNCE_MS = 350

function leadTitle(lead) {
  return lead.parties?.name ?? (lead.sites?.nickname || lead.sites?.locality) ?? `Lead #${lead.id}`
}

function Search() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState({ parties: [], sites: [], leads: [] })
  const [searching, setSearching] = useState(false)

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
  const hasResults = results.parties.length > 0 || results.sites.length > 0 || results.leads.length > 0

  return (
    <main className="search">
      <div className="search-header">
        <h1>Search</h1>
        <p>Find a party, site, or lead by name, mobile, or locality.</p>
      </div>

      <input
        className="search-input"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search name, mobile, locality…"
        autoFocus
      />

      {!hasQuery && <p className="search-empty">Type at least {MIN_QUERY_LENGTH} characters to search.</p>}
      {hasQuery && searching && <p className="search-empty">Searching…</p>}
      {hasQuery && !searching && !hasResults && <p className="search-empty">No matches found.</p>}

      {results.leads.length > 0 && (
        <section className="search-section">
          <h2>Leads</h2>
          <ul className="search-results">
            {results.leads.map((lead) => (
              <li key={lead.id}>
                <Link to={`/leads/${lead.id}`} className="search-result">
                  <span className="search-result-title">{leadTitle(lead)}</span>
                  <span className="search-result-meta">{lead.current_stage ?? 'new'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results.parties.length > 0 && (
        <section className="search-section">
          <h2>Parties</h2>
          <ul className="search-results">
            {results.parties.map((party) => (
              <li key={party.id} className="search-result search-result-static">
                <span className="search-result-title">{party.name}</span>
                <span className="search-result-meta">
                  {party.party_type}
                  {party.mobile ? ` — ${party.mobile}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results.sites.length > 0 && (
        <section className="search-section">
          <h2>Sites</h2>
          <ul className="search-results">
            {results.sites.map((site) => (
              <li key={site.id} className="search-result search-result-static">
                <span className="search-result-title">{site.nickname || site.locality || `Site #${site.id}`}</span>
                <span className="search-result-meta">
                  {[site.locality, site.house_no, site.areas?.area_name].filter(Boolean).join(', ') || '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

export default Search
