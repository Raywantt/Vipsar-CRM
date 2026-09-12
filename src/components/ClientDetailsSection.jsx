import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'
import { partyTypeLabel } from '../lib/partyTypeOptions'
import PartySearchOrCreate from './PartySearchOrCreate'
import NumPadInput from './NumPadInput'

// The lead's CLIENT. Three states, and the two that aren't "a client is on
// file" are the reason this card was rewritten (2026-09-12, reported by the
// owner): it used to render only when the lead already had a party, so a
// scanning lead captured without a client name had NO path to one, ever — the
// same dead end "+ Add site details" fixed for a site. A rep who took a lead
// down as a site nickname and learned the client's name a week later had
// nowhere to put it.
//
// It also could not edit the client's NAME even when one existed, only their
// mobile and city — so a typo in the one field the whole app names the lead by
// was uncorrectable.
//
// WHY A NON-CLIENT PARTY GETS ITS OWN STATE. leads.party_id is not "the
// client" — LeadQuickCapture resolves it to the client if there is one, ELSE
// the referrer, else the "other" party. So this card was routinely showing an
// architect under the heading "Client details", which is simply a false label.
// It now says what that party actually is and still offers to add the client.
function ClientDetailsSection({ party, canEdit = true, onSaved, onSetClient }) {
  const isClient = party?.party_type === 'client'

  const [name, setName] = useState(party?.name ?? '')
  const [mobile, setMobile] = useState(party?.mobile ?? '')
  const [city, setCity] = useState(party?.city ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState(null)
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSavedAt(null)

    // A blank name would leave the lead with nothing to be called, since the
    // whole app names it from here — so it is required once a client exists,
    // unlike mobile and city which are honestly optional.
    if (!name.trim()) {
      setSaving(false)
      setError('A client needs a name.')
      return
    }

    const { data, error } = await supabase
      .from('parties')
      .update({
        name: name.trim(),
        mobile: mobile.trim() || null,
        city: city.trim() || null,
      })
      .eq('id', party.id)
      .select()
      .single()

    setSaving(false)

    if (error) {
      setError(errorMessage(error))
      return
    }

    setSavedAt(Date.now())
    onSaved(data)
  }

  async function handleLink() {
    if (!picked) return
    setLinking(true)
    setLinkError(null)

    const result = await onSetClient(picked)

    setLinking(false)
    if (result?.error) {
      setLinkError(result.error)
      return
    }
    // The parent has swapped the lead's party, so this component remounts with
    // the new one (LeadDetail keys it on the party's id) — no local reset needed.
    setPicking(false)
    setPicked(null)
  }

  // Shared by the "no client yet" state and the "change client" reveal. Locked
  // to 'client', so the Type field never shows and a name typed here can only
  // ever be created as a client — same treatment New Lead's own Client name
  // field gets. deferCreate means nothing is written to parties until Save
  // below, so a name typed and then abandoned leaves no permanent row.
  const clientPicker = (
    <>
      <PartySearchOrCreate
        label="Client name"
        typeOptions={['client']}
        deferCreate
        onSelect={setPicked}
        hint="Search for an existing client, or type a new name to create one."
      />
      {/* PartySearchOrCreate's typeOptions narrows the CREATE form only — its
          search returns parties of every type (true of every caller, New Lead's
          own Client name field included). So a rep can pick an architect here,
          and without this note the save would look like it did nothing: the card
          would come back reading "no client name on file yet" with that
          architect named as the identifier. Warn and allow rather than block —
          an architect really can be the buyer on their own house. */}
      {picked?.party_type && picked.party_type !== 'client' && (
        <p className="vip-form-note">
          {picked.name}&rsquo;s type on file is {partyTypeLabel(picked.party_type)}, not client. Saving
          will make the lead read by their name, but it will still show as having no client.
        </p>
      )}
      {linkError && (
        <p className="vip-error" role="alert">
          {linkError}
        </p>
      )}
      <div className="vip-btn-row">
        <button
          type="button"
          className="vip-btn vip-btn-secondary vip-btn-sm"
          onClick={handleLink}
          disabled={!picked || linking}
        >
          {linking ? 'Saving…' : 'Save client'}
        </button>
        {isClient && (
          <button
            type="button"
            className="vip-btn vip-btn-secondary vip-btn-sm"
            style={{ width: 'auto', flex: '0 0 auto' }}
            onClick={() => {
              setPicking(false)
              setPicked(null)
              setLinkError(null)
            }}
            disabled={linking}
          >
            Cancel
          </button>
        )}
      </div>
    </>
  )

  if (!isClient) {
    return (
      <div className="vip-card">
        <div className="vip-card-title">Client</div>
        {party ? (
          <p className="vip-empty">
            No client name on file yet. This lead is currently identified by{' '}
            <b>{party.name}</b> ({partyTypeLabel(party.party_type)}), who stays on the lead as a
            contact.
          </p>
        ) : (
          <p className="vip-empty">No client name on file yet.</p>
        )}
        {canEdit ? clientPicker : null}
      </div>
    )
  }

  return (
    <div className="vip-card">
      <div className="vip-card-title">Client details</div>

      <label className="vip-field">
        Name
        <input className="vip-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="vip-field-hint">
        This is the name the lead is listed under everywhere. Editing it renames this client on
        every lead they appear on — to point this lead at a different person, use Change client.
      </p>

      <div className="vip-grid-2">
        <label className="vip-field">
          Mobile
          <NumPadInput
            variant="integer"
            type="text"
            maxLength={10}
            label="Mobile"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
        </label>
        <label className="vip-field">
          City
          <input className="vip-input" value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
      </div>

      {error && <p className="vip-error" role="alert">{error}</p>}
      {savedAt && !error && <p className="vip-success" role="status" aria-live="polite">Saved.</p>}

      <div className="vip-btn-row">
        <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save client details'}
        </button>
        {canEdit && !picking && (
          <button type="button" className="vip-btn-link" onClick={() => setPicking(true)}>
            Change client
          </button>
        )}
      </div>

      {picking && canEdit && <div className="vip-section-split">{clientPicker}</div>}
    </div>
  )
}

export default ClientDetailsSection
