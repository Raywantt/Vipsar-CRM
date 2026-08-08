import { useEffect, useState } from 'react'
import { fetchAllParties, deleteParty } from '../lib/partyQueries'
import { errorMessage } from '../lib/errorMessage'

const PARTY_TYPE_LABELS = {
  client: 'Client',
  architect: 'Architect',
  builder: 'Builder',
  firm: 'Firm',
  other: 'Other',
  pmc: 'PMC',
}

// Postgres foreign_key_violation — leads.party_id/activities.party_id/
// site_contacts.party_id all RESTRICT (no cascade, see CLAUDE.md's Profile
// section), so this is the expected result for a party who's actually
// someone's client, not a mistaken entry. The constraint name says which
// table is still pointing at them; translated into plain language instead
// of showing the raw Postgres message.
const BLOCKING_TABLE_BY_CONSTRAINT = {
  leads_party_id_fkey: 'a lead',
  activities_party_id_fkey: 'a logged activity',
  site_contacts_party_id_fkey: 'a site contact',
}

function friendlyDeleteError(error, partyName) {
  if (error.code !== '23503') return errorMessage(error)
  const constraint = Object.keys(BLOCKING_TABLE_BY_CONSTRAINT).find((c) => error.message?.includes(c))
  const linkedTo = constraint ? BLOCKING_TABLE_BY_CONSTRAINT[constraint] : 'a lead, activity, or site contact'
  return `${partyName} can't be deleted — still linked to ${linkedTo}. This tool is for a mistaken entry (a wrongly added architect, PMC, or other contact), not a party who already has real history.`
}

function DeletePartySection() {
  const [parties, setParties] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let active = true
    fetchAllParties().then(({ data, error }) => {
      if (!active) return
      setLoading(false)
      if (error) {
        setError(errorMessage(error))
      } else {
        setParties(data ?? [])
      }
    })
    return () => {
      active = false
    }
  }, [])

  const term = search.trim().toLowerCase()
  const matches = term
    ? parties.filter((party) => {
        const name = party.name?.toLowerCase() ?? ''
        const mobile = party.mobile?.toLowerCase() ?? ''
        return name.includes(term) || mobile.includes(term)
      })
    : []

  async function handleDelete(party) {
    setDeleting(true)
    setError(null)

    const { error } = await deleteParty(party.id)

    setDeleting(false)

    if (error) {
      setError(friendlyDeleteError(error, party.name))
      return
    }

    setParties((prev) => prev.filter((p) => p.id !== party.id))
    setConfirmingId(null)
  }

  return (
    <div className="vip-card">
      <div className="vip-card-title">Delete a party</div>
      <p className="vip-form-note">
        Permanent — there's no undo. For a wrongly added architect, PMC, or other contact — not for a real client
        with leads on record. A party still linked to any lead, activity, or site contact can't be deleted until
        those links are cleared; the error from Supabase will say which.
      </p>

      <input
        className="vip-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or mobile…"
      />

      {error && <p className="vip-error">{error}</p>}

      {loading ? (
        <p className="vip-empty">Loading…</p>
      ) : !term ? (
        <p className="vip-empty">Type a name or mobile number to search.</p>
      ) : matches.length === 0 ? (
        <p className="vip-empty">No parties found.</p>
      ) : (
        matches.map((party) => (
          <div key={party.id} className="vip-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div className="vip-row-main">
                <div className="vip-row-title">{party.name}</div>
                <div className="vip-row-sub">
                  {[PARTY_TYPE_LABELS[party.party_type] ?? party.party_type, party.mobile].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>

            {confirmingId === party.id ? (
              <div className="vip-btn-row" style={{ alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--vip-body)', flex: 1 }}>Delete {party.name}?</span>
                <button
                  type="button"
                  className="vip-btn vip-btn-danger vip-btn-sm"
                  style={{ width: 'auto', flex: '0 0 auto' }}
                  onClick={() => handleDelete(party)}
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
                onClick={() => setConfirmingId(party.id)}
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

export default DeletePartySection
