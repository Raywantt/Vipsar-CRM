import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import PartySearchOrCreate from './PartySearchOrCreate'

const ROLE_OPTIONS = ['owner', 'architect', 'builder', 'project_manager', 'site_staff', 'other']

async function addSiteContact(siteId, partyId, role, firmName) {
  const { data, error } = await supabase
    .from('site_contacts')
    .insert({ site_id: siteId, party_id: partyId, role })
    .select('id, role, party_id')
    .single()

  if (error) return { error }

  if (firmName.trim()) {
    await supabase.from('parties').update({ firm_name: firmName.trim() }).eq('id', partyId)
  }

  return { data }
}

function AdditionalContactsSection({ site, otherParty, siteContacts, onContactAdded }) {
  const [addingNew, setAddingNew] = useState(false)
  const [newContactParty, setNewContactParty] = useState(null)
  const [newContactRole, setNewContactRole] = useState('')
  const [newContactFirm, setNewContactFirm] = useState('')
  const [savingNew, setSavingNew] = useState(false)
  const [newError, setNewError] = useState(null)

  const [suggestionRole, setSuggestionRole] = useState('')
  const [suggestionFirm, setSuggestionFirm] = useState('')
  const [savingSuggestion, setSavingSuggestion] = useState(false)
  const [suggestionError, setSuggestionError] = useState(null)
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)

  const alreadyLinkedPartyIds = new Set(siteContacts.map((c) => c.party_id))
  const showSuggestion = Boolean(otherParty) && !alreadyLinkedPartyIds.has(otherParty.id) && !suggestionDismissed

  async function handleAddSuggestion() {
    setSavingSuggestion(true)
    setSuggestionError(null)

    const { data, error } = await addSiteContact(site.id, otherParty.id, suggestionRole, suggestionFirm)

    setSavingSuggestion(false)

    if (error) {
      setSuggestionError(error.message)
      return
    }

    onContactAdded({
      ...data,
      parties: { name: otherParty.name, party_type: otherParty.party_type },
    })
    setSuggestionDismissed(true)
  }

  async function handleAddNew() {
    setSavingNew(true)
    setNewError(null)

    const { data, error } = await addSiteContact(site.id, newContactParty.id, newContactRole, newContactFirm)

    setSavingNew(false)

    if (error) {
      setNewError(error.message)
      return
    }

    onContactAdded({
      ...data,
      parties: { name: newContactParty.name, party_type: newContactParty.party_type },
    })
    setAddingNew(false)
    setNewContactParty(null)
    setNewContactRole('')
    setNewContactFirm('')
  }

  return (
    <div className="vip-card">
      <div className="vip-card-title">Contacts</div>

      {siteContacts.map((c) => (
        <div key={c.id} className="vip-row">
          <div className="vip-row-main">
            <div className="vip-row-title">{c.parties?.name}</div>
            <div className="vip-row-sub">
              {[c.parties?.party_type, c.role].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      ))}

      {showSuggestion && (
        <div className="vip-section-split vip-stack-s">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--vip-body)' }}>
            <strong>{otherParty.name}</strong> was mentioned during intake — add as a site contact?
          </p>
          <select className="vip-select" value={suggestionRole} onChange={(e) => setSuggestionRole(e.target.value)}>
            <option value="">— Select role —</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <input
            className="vip-input"
            value={suggestionFirm}
            onChange={(e) => setSuggestionFirm(e.target.value)}
            placeholder="Firm name (optional)"
          />
          {suggestionError && <p className="vip-error">{suggestionError}</p>}
          <div className="vip-btn-row">
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              onClick={handleAddSuggestion}
              disabled={!suggestionRole || savingSuggestion}
            >
              {savingSuggestion ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              onClick={() => setSuggestionDismissed(true)}
              disabled={savingSuggestion}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {addingNew ? (
        <div className="vip-section-split vip-stack-s">
          <PartySearchOrCreate label="Contact" defaultPartyType="other" onSelect={setNewContactParty} />
          <select className="vip-select" value={newContactRole} onChange={(e) => setNewContactRole(e.target.value)}>
            <option value="">— Select role —</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <input
            className="vip-input"
            value={newContactFirm}
            onChange={(e) => setNewContactFirm(e.target.value)}
            placeholder="Firm name (optional)"
          />
          {newError && <p className="vip-error">{newError}</p>}
          <div className="vip-btn-row">
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              onClick={handleAddNew}
              disabled={!newContactParty || !newContactRole || savingNew}
            >
              {savingNew ? 'Adding…' : 'Add contact'}
            </button>
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              onClick={() => setAddingNew(false)}
              disabled={savingNew}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={() => setAddingNew(true)}>
          + Add contact
        </button>
      )}
    </div>
  )
}

export default AdditionalContactsSection
