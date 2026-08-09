import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { errorMessage } from '../lib/errorMessage'
import { stageLabel } from '../lib/leadStageOptions'

function leadLabel(lead) {
  const who = lead.parties?.name ?? 'No client'
  const where = lead.sites?.nickname || lead.sites?.locality || 'No site'
  return `${who} — ${where} (${stageLabel(lead.current_stage ?? 'calling')})`
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
      .select('id, current_stage, source_type, parties!party_id(name, party_type), sites(id, nickname, locality, site_stage)')
      .eq('owner_employee_id', employee.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!active) return
        setLoading(false)
        if (error) {
          setError(errorMessage(error))
        } else {
          setLeads(data)
        }
      })

    return () => {
      active = false
    }
  }, [employee?.id])

  const term = query.trim().toLowerCase()
  // Nothing renders below the box until you actually type — with a large
  // lead count, dumping the full fetched list here just recreates the
  // "scroll through everything" problem this component exists to avoid.
  const filtered = term
    ? leads.filter((lead) => {
        const who = lead.parties?.name?.toLowerCase() ?? ''
        const where = `${lead.sites?.nickname ?? ''} ${lead.sites?.locality ?? ''}`.toLowerCase()
        return who.includes(term) || where.includes(term)
      })
    : []

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

      {loading && <p className="vip-form-note">Loading your leads…</p>}
      {error && <p className="vip-error" role="alert">{error}</p>}
      {!loading && !error && leads.length === 0 && <p className="vip-form-note">You don't have any leads yet.</p>}
      {!loading && !error && leads.length > 0 && !term && (
        <p className="vip-form-note">Type a client or site name to find a lead.</p>
      )}
      {!loading && term && filtered.length === 0 && <p className="vip-form-note">No matching leads.</p>}

      {filtered.length > 0 && (
        <div className="vip-card">
          {filtered.map((lead) => (
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
