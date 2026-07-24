import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import PartySearchOrCreate from './PartySearchOrCreate'
import './SearchOrCreate.css'

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
    <section className="lead-section">
      <h2>Additional contacts</h2>

      {siteContacts.length > 0 && (
        <ul className="lead-detail-contacts">
          {siteContacts.map((c) => (
            <li key={c.id}>
              {c.parties?.name} ({c.parties?.party_type}) — {c.role}
            </li>
          ))}
        </ul>
      )}

      {showSuggestion && (
        <div className="lead-section-suggestion">
          <p>
            <strong>{otherParty.name}</strong> was mentioned during intake — add as a site contact?
          </p>
          <label className="search-or-create-field">
            Role
            <select value={suggestionRole} onChange={(e) => setSuggestionRole(e.target.value)}>
              <option value="">— Select role —</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label className="search-or-create-field">
            Firm name (optional)
            <input value={suggestionFirm} onChange={(e) => setSuggestionFirm(e.target.value)} />
          </label>
          {suggestionError && <p className="search-or-create-error">{suggestionError}</p>}
          <div className="search-or-create-actions">
            <button type="button" onClick={handleAddSuggestion} disabled={!suggestionRole || savingSuggestion}>
              {savingSuggestion ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setSuggestionDismissed(true)} disabled={savingSuggestion}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {addingNew ? (
        <div className="lead-section-suggestion">
          <PartySearchOrCreate label="Contact" defaultPartyType="other" onSelect={setNewContactParty} />
          <label className="search-or-create-field">
            Role
            <select value={newContactRole} onChange={(e) => setNewContactRole(e.target.value)}>
              <option value="">— Select role —</option>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label className="search-or-create-field">
            Firm name (optional)
            <input value={newContactFirm} onChange={(e) => setNewContactFirm(e.target.value)} />
          </label>
          {newError && <p className="search-or-create-error">{newError}</p>}
          <div className="search-or-create-actions">
            <button
              type="button"
              onClick={handleAddNew}
              disabled={!newContactParty || !newContactRole || savingNew}
            >
              {savingNew ? 'Adding…' : 'Add contact'}
            </button>
            <button type="button" onClick={() => setAddingNew(false)} disabled={savingNew}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="search-or-create-add-new" onClick={() => setAddingNew(true)}>
          + Add another contact
        </button>
      )}
    </section>
  )
}

export default AdditionalContactsSection
