import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import './SearchOrCreate.css'

function leadLabel(lead) {
  const who = lead.parties?.name ?? 'No client'
  const where = lead.sites?.nickname || lead.sites?.locality || 'No site'
  return `${who} — ${where} (${lead.current_stage ?? 'new'})`
}

function LeadSearchSelect({ onSelect }) {
  const { employee } = useAuth()

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!employee?.id) return
    let active = true

    supabase
      .from('leads')
      .select('id, current_stage, source_type, parties!party_id(name, party_type), sites(nickname, locality)')
      .eq('owner_employee_id', employee.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!active) return
        setLoading(false)
        if (error) {
          setError(error.message)
        } else {
          setLeads(data)
        }
      })

    return () => {
      active = false
    }
  }, [employee?.id])

  const term = query.trim().toLowerCase()
  const filtered = term
    ? leads.filter((lead) => {
        const who = lead.parties?.name?.toLowerCase() ?? ''
        const where = `${lead.sites?.nickname ?? ''} ${lead.sites?.locality ?? ''}`.toLowerCase()
        return who.includes(term) || where.includes(term)
      })
    : leads

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
      <div className="search-or-create search-or-create-selected">
        <span>Lead: {leadLabel(selected)}</span>
        <button type="button" onClick={changeSelection}>
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="search-or-create">
      <label className="search-or-create-field">
        Lead
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your leads by client or site…"
        />
      </label>

      {loading && <p className="search-or-create-hint">Loading your leads…</p>}
      {error && <p className="search-or-create-error">{error}</p>}
      {!loading && !error && leads.length === 0 && (
        <p className="search-or-create-hint">You don't have any leads yet.</p>
      )}

      {filtered.length > 0 && (
        <ul className="search-or-create-results">
          {filtered.map((lead) => (
            <li key={lead.id}>
              <button type="button" onClick={() => selectExisting(lead)}>
                {leadLabel(lead)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default LeadSearchSelect
