import { useEffect, useState } from 'react'
import { fetchLeadsList, deleteLead } from '../lib/dashboardQueries'
import { formatCurrencyCompact } from '../lib/format'

function DeleteLeadSection() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    fetchLeadsList().then(({ data, error }) => {
      if (!active) return
      setLoading(false)
      if (error) {
        setError(error.message)
      } else {
        setLeads(data ?? [])
      }
    })
    return () => {
      active = false
    }
  }, [])

  const term = search.trim().toLowerCase()
  const filtered = term
    ? leads.filter((lead) => {
        const party = lead.parties?.name?.toLowerCase() ?? ''
        const site = `${lead.sites?.nickname ?? ''} ${lead.sites?.locality ?? ''}`.toLowerCase()
        const owner = lead.employees?.name?.toLowerCase() ?? ''
        return party.includes(term) || site.includes(term) || owner.includes(term)
      })
    : leads

  async function handleDelete(id) {
    setDeleting(true)
    setError(null)

    const { error } = await deleteLead(id)

    setDeleting(false)

    if (error) {
      setError(error.message)
      return
    }

    setLeads((prev) => prev.filter((l) => l.id !== id))
    setConfirmingId(null)
  }

  return (
    <div className="vip-card">
      <div className="vip-card-title">Delete a lead</div>
      <p className="vip-form-note">
        Permanent — there's no undo. Only for genuine mistakes (duplicates, test data), not for walking back a lead
        that just went cold.
      </p>

      <input
        className="vip-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by party, site, or owner…"
      />

      {error && <p className="vip-error">{error}</p>}

      {loading ? (
        <p className="vip-empty">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="vip-empty">No leads found.</p>
      ) : (
        filtered.map((lead) => (
          <div key={lead.id} className="vip-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div className="vip-row-main">
                <div className="vip-row-title">{lead.parties?.name ?? '(no party)'}</div>
                <div className="vip-row-sub">
                  {[lead.sites?.nickname || lead.sites?.locality, lead.employees?.name].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="vip-row-value">{formatCurrencyCompact(lead.order_value)}</div>
            </div>

            {confirmingId === lead.id ? (
              <div className="vip-btn-row" style={{ alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--vip-body)', flex: 1 }}>Delete #{lead.id}?</span>
                <button
                  type="button"
                  className="vip-btn vip-btn-danger vip-btn-sm"
                  style={{ width: 'auto', flex: '0 0 auto' }}
                  onClick={() => handleDelete(lead.id)}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  className="vip-btn vip-btn-secondary vip-btn-sm"
                  style={{ width: 'auto', flex: '0 0 auto' }}
                  onClick={() => setConfirmingId(null)}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="vip-btn vip-btn-danger vip-btn-sm"
                style={{ width: 'auto', alignSelf: 'flex-start' }}
                onClick={() => setConfirmingId(lead.id)}
              >
                Delete
              </button>
            )}
          </div>
        ))
      )}
    </div>
  )
}

export default DeleteLeadSection
