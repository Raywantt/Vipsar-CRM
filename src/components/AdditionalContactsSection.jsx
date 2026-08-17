import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import PartySearchOrCreate from './PartySearchOrCreate'
import { setPartyFirm } from '../lib/partyQueries'
import { errorMessage } from '../lib/errorMessage'

// Only an individual architect belongs to a firm — a 'firm' party already is
// one, and a client or builder doesn't have an architect practice behind them.
// Same rule Log Activity and New Lead apply.
const takesFirm = (party) => party?.party_type === 'architect'

const ROLE_OPTIONS = ['owner', 'architect', 'builder', 'project_manager', 'site_staff', 'other']

// The firm is a link to a real 'firm' party now, not a typed name — see
// setPartyFirm and Schema/migration_architect_firm_link.sql. It's written
// after the contact row so a failure there can't strand a half-made contact,
// and it comes back as a warning rather than an error: the contact itself did
// save. The old code fired an unchecked .update() with no .select(), which
// under parties' "own data or owner role" RLS could silently no-op on a party
// another rep added — the caller never knew.
async function addSiteContact(siteId, party, role, firmParty) {
  const { data, error } = await supabase
    .from('site_contacts')
    .insert({ site_id: siteId, party_id: party.id, role })
    .select('id, role, party_id')
    .single()

  if (error) return { error }

  const warning = await setPartyFirm({
    partyId: party.id,
    partyName: party.name,
    firmId: firmParty?.id ?? null,
    currentFirmId: party.firm?.id ?? null,
  })

  return { data, warning }
}

function AdditionalContactsSection({ site, otherParty, siteContacts, onContactAdded }) {
  const [addingNew, setAddingNew] = useState(false)
  const [newContactParty, setNewContactParty] = useState(null)
  const [newContactRole, setNewContactRole] = useState('')
  const [newContactFirm, setNewContactFirm] = useState(null)
  const [savingNew, setSavingNew] = useState(false)
  const [newError, setNewError] = useState(null)

  const [suggestionRole, setSuggestionRole] = useState('')
  const [suggestionFirm, setSuggestionFirm] = useState(otherParty?.firm ?? null)
  const [savingSuggestion, setSavingSuggestion] = useState(false)
  const [suggestionError, setSuggestionError] = useState(null)
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)
  const [firmWarning, setFirmWarning] = useState(null)

  const alreadyLinkedPartyIds = new Set(siteContacts.map((c) => c.party_id))
  const showSuggestion = Boolean(otherParty) && !alreadyLinkedPartyIds.has(otherParty.id) && !suggestionDismissed

  async function handleAddSuggestion() {
    setSavingSuggestion(true)
    setSuggestionError(null)

    const { data, error, warning } = await addSiteContact(site.id, otherParty, suggestionRole, suggestionFirm)

    setSavingSuggestion(false)

    if (error) {
      setSuggestionError(errorMessage(error))
      return
    }

    setFirmWarning(warning ? `Contact added, but ${warning}` : null)

    onContactAdded({
      ...data,
      parties: { name: otherParty.name, party_type: otherParty.party_type },
    })
    setSuggestionDismissed(true)
  }

  async function handleAddNew() {
    setSavingNew(true)
    setNewError(null)

    const { data, error, warning } = await addSiteContact(site.id, newContactParty, newContactRole, newContactFirm)

    setSavingNew(false)

    if (error) {
      setNewError(errorMessage(error))
      return
    }

    setFirmWarning(warning ? `Contact added, but ${warning}` : null)

    onContactAdded({
      ...data,
      parties: { name: newContactParty.name, party_type: newContactParty.party_type },
    })
    setAddingNew(false)
    setNewContactParty(null)
    setNewContactRole('')
    setNewContactFirm(null)
  }

  return (
    <div className="vip-card">
      <div className="vip-card-title">Contacts</div>

      {firmWarning && <p className="vip-error" role="alert">{firmWarning}</p>}

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
          {/* Only for an individual architect — see takesFirm. */}
          {takesFirm(otherParty) && (
            <PartySearchOrCreate
              key={otherParty.id}
              label="Firm"
              hint="optional"
              defaultPartyType="firm"
              typeOptions={['firm']}
              initialSelected={otherParty.firm ?? null}
              onSelect={setSuggestionFirm}
            />
          )}
          {suggestionError && <p className="vip-error" role="alert">{suggestionError}</p>}
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
          {takesFirm(newContactParty) && (
            <PartySearchOrCreate
              key={newContactParty.id}
              label="Firm"
              hint="optional"
              defaultPartyType="firm"
              typeOptions={['firm']}
              initialSelected={newContactParty.firm ?? null}
              onSelect={setNewContactFirm}
            />
          )}
          {newError && <p className="vip-error" role="alert">{newError}</p>}
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
