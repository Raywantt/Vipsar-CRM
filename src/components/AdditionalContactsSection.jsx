import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import PartySearchOrCreate from './PartySearchOrCreate'
import { materializePartyDraft, setPartyFirm } from '../lib/partyQueries'
import { errorMessage } from '../lib/errorMessage'

// Only an individual architect belongs to a firm — a 'firm' party already is
// one, and a client or builder doesn't have an architect practice behind them.
// Same rule Log Activity and New Lead apply.
const takesFirm = (party) => party?.party_type === 'architect'

// Role at this site — the one thing the rep is actually being asked here.
// This form used to also ask for the new contact's party Type (client/
// architect/builder/firm/other/pmc) as a separate step inside the create
// dialog, right before this — which read as the same question twice, since
// the two lists overlap (architect/builder/other appear in both). A brand-new
// contact's party_type is now derived from the Role picked here instead (see
// ROLE_TO_PARTY_TYPE), so it's asked exactly once. An existing party found via
// search keeps whatever type it already has — this mapping only ever applies
// to a party being created fresh from this form.
const ROLE_OPTIONS = ['owner', 'architect', 'builder', 'project_manager', 'site_staff', 'other']
const ROLE_LABELS = {
  owner: 'Owner',
  architect: 'Architect',
  builder: 'Builder',
  project_manager: 'Project manager',
  site_staff: 'Site staff',
  other: 'Other',
}
// 'project_manager' has no matching party_type of its own — 'pmc' (project
// management company) is the closest existing classification, the same one
// New Lead's "Other's name" field offers for the same kind of contact.
// 'owner' maps to 'other' rather than 'client' — an owner added as a site
// contact here is someone beyond the lead's own client party (that party is
// linked separately, elsewhere), so it shouldn't masquerade as one.
const ROLE_TO_PARTY_TYPE = {
  owner: 'other',
  architect: 'architect',
  builder: 'builder',
  project_manager: 'pmc',
  site_staff: 'other',
  other: 'other',
}

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

// There is deliberately NO "this party was mentioned at intake — add them?"
// prompt here any more. A party the rep named on the New Lead form is a
// contact on the lead, full stop, and is linked as one at capture time (see
// linkPartiesAsSiteContacts, called from LeadQuickCapture, and the same call
// in LeadDetail's loader that heals leads captured before that). Asking again
// here re-posed a question the rep had already answered at intake — the same
// duplication ROLE_TO_PARTY_TYPE above removed from the "+ Add contact" form.
// This card now just lists what's on the site and lets a rep add someone new.
function AdditionalContactsSection({ site, siteContacts, onContactAdded }) {
  const { employee } = useAuth()

  const [addingNew, setAddingNew] = useState(false)
  const [newContactRole, setNewContactRole] = useState('')
  const [newContactParty, setNewContactParty] = useState(null)
  const [newContactFirm, setNewContactFirm] = useState(null)
  const [savingNew, setSavingNew] = useState(false)
  const [newError, setNewError] = useState(null)

  const [firmWarning, setFirmWarning] = useState(null)

  function resetNewContact() {
    setAddingNew(false)
    setNewContactRole('')
    setNewContactParty(null)
    setNewContactFirm(null)
    setNewError(null)
  }

  // A party (real or still a draft) picked under the old role isn't
  // guaranteed to match the new one's derived type — same "clear rather than
  // leave resolved-away" call New Lead's selectSource makes when its own
  // typeOptions shift underneath an already-chosen party.
  function selectNewContactRole(role) {
    setNewContactRole(role)
    setNewContactParty(null)
    setNewContactFirm(null)
  }

  async function handleAddNew() {
    setSavingNew(true)
    setNewError(null)

    // Nothing reaches the database until this click. The contact and (if
    // picked) their firm may still be unsaved drafts from
    // PartySearchOrCreate's deferCreate mode, turned into real rows only now
    // that the whole contact is actually being confirmed — the fix for a real
    // incident where someone filling this in by mistake still left a real,
    // permanent party behind after backing out without saving.
    const { data: contact, error: contactError } = await materializePartyDraft(newContactParty, employee?.id)
    if (contactError) {
      setSavingNew(false)
      setNewError(errorMessage(contactError))
      return
    }

    const { data: firm, error: firmError } = await materializePartyDraft(newContactFirm, employee?.id)
    if (firmError) {
      setSavingNew(false)
      setNewError(errorMessage(firmError))
      return
    }

    const { data, error, warning } = await addSiteContact(site.id, contact, newContactRole, firm)

    setSavingNew(false)

    if (error) {
      setNewError(errorMessage(error))
      return
    }

    setFirmWarning(warning ? `Contact added, but ${warning}` : null)

    onContactAdded({
      ...data,
      parties: { name: contact.name, party_type: contact.party_type },
    })
    resetNewContact()
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

      {siteContacts.length === 0 && !addingNew && <p className="vip-empty">No contacts on this site yet.</p>}

      {addingNew ? (
        <div className="vip-section-split vip-stack-s">
          {/* Role first — it's what decides which kind of party gets created
              below, so "what is this person" is never asked twice. */}
          <select
            className="vip-select"
            value={newContactRole}
            onChange={(e) => selectNewContactRole(e.target.value)}
          >
            <option value="">— Select role —</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>

          {newContactRole && (
            <PartySearchOrCreate
              key={newContactRole}
              label="Contact"
              defaultPartyType={ROLE_TO_PARTY_TYPE[newContactRole]}
              typeOptions={[ROLE_TO_PARTY_TYPE[newContactRole]]}
              deferCreate
              onSelect={setNewContactParty}
            />
          )}

          {takesFirm(newContactParty) && (
            <PartySearchOrCreate
              key={newContactParty.id ?? newContactParty.name}
              label="Firm"
              hint="optional"
              defaultPartyType="firm"
              typeOptions={['firm']}
              deferCreate
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
              onClick={resetNewContact}
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
