import { useEffect, useState } from 'react'
import { fetchLeadsList, deleteLead } from '../lib/dashboardQueries'
import { formatCurrency } from '../lib/format'
import '../pages/Settings.css'

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function DeleteLeadSection() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    fetchLeadsList(null).then(({ data, error }) => {
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
    <section className="settings-card">
      <h2>Delete a lead</h2>
      <p className="settings-hint">
        Permanent — there's no undo. Only for genuine mistakes (duplicates, test data), not for walking back a lead
        that just went cold.
      </p>

      <label className="settings-field">
        Search
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by party, site, or owner…"
        />
      </label>

      {error && <p className="settings-error">{error}</p>}

      {loading ? (
        <p className="settings-hint">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="settings-hint">No leads found.</p>
      ) : (
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Site</th>
                <th>Owner</th>
                <th>Order value</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id}>
                  <td>{lead.parties?.name ?? '(no party)'}</td>
                  <td>{lead.sites?.nickname || lead.sites?.locality || '—'}</td>
                  <td>{lead.employees?.name ?? 'Unassigned'}</td>
                  <td>{lead.order_value ? formatCurrency(lead.order_value) : '—'}</td>
                  <td>{formatDate(lead.created_at)}</td>
                  <td>
                    {confirmingId === lead.id ? (
                      <span className="settings-confirm">
                        Delete #{lead.id}?
                        <button
                          type="button"
                          className="settings-danger"
                          onClick={() => handleDelete(lead.id)}
                          disabled={deleting}
                        >
                          {deleting ? 'Deleting…' : 'Confirm'}
                        </button>
                        <button type="button" onClick={() => setConfirmingId(null)} disabled={deleting}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="settings-danger" onClick={() => setConfirmingId(lead.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default DeleteLeadSection
