import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import PartySearchOrCreate from './PartySearchOrCreate'
import { firmLabel } from '../lib/firmLabel'
import NumPadInput from './NumPadInput'
import { PARTY_COLUMNS, attachFirms, materializePartyDraft } from '../lib/partyQueries'
import { partyTypeLabel } from '../lib/partyTypeOptions'
import { errorMessage } from '../lib/errorMessage'

// The Architect half of a business development manager's "+ New" (BDM.md §3
// Architects). Owner's rulings:
//   * Name and mobile are required; mobile is exactly 10 digits.
//   * If that number already belongs to an architect, show that architect
//     instead of creating a duplicate — there is no "add anyway".
//   * Firm optional (one firm, many architects — the existing
//     parties.firm_party_id link); firm address optional.
//
// The architect lands in the BDM's portfolio without this form saying so in
// the write: the database stamps parties.bdm_employee_id for an architect a
// BDM creates (Schema/migration_bdm_role.sql STEP 6).
//
// Deliberately NOT built on PartySearchOrCreate for the architect itself.
// That component searches by name first and treats mobile as an optional
// hint; this form's duplicate rule is the reverse — the number decides.

// How the duplicate check describes who an existing architect belongs to.
function portfolioLabel(party, viewerId) {
  if (party.bdm_employee_id == null) return 'Not with a BDM'
  if (party.bdm_employee_id === viewerId) return 'Already in your portfolio'
  return party.bdm?.name ? `With ${party.bdm.name}` : 'With another BDM'
}

function NewArchitectForm() {
  const { employee } = useAuth()

  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [firm, setFirm] = useState(null)
  // Remounts the firm picker on "Add another architect" — it's uncontrolled.
  const [firmPickerKey, setFirmPickerKey] = useState(0)
  const [firmAddress, setFirmAddress] = useState('')

  // { digits, matches } for the number the check last finished for. Keyed on
  // the digits so a stale answer for a number since edited can't unlock Save.
  const [mobileCheck, setMobileCheck] = useState(null)
  const [checkError, setCheckError] = useState(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [created, setCreated] = useState(null)

  const digits = mobile.replace(/\D/g, '')
  const mobileComplete = digits.length === 10

  // The duplicate check runs the moment the tenth digit lands. Every visible
  // party with that number comes back — architects and firms are visible to
  // every role company-wide, so an existing architect can't hide from it.
  useEffect(() => {
    if (!mobileComplete) return
    let active = true
    setCheckError(null)
    supabase
      .from('parties')
      .select(`${PARTY_COLUMNS}, bdm_employee_id, bdm:employees!bdm_employee_id(name)`)
      .ilike('mobile', `%${digits}`)
      .order('name')
      .limit(10)
      .then(async ({ data, error }) => {
        if (!active) return
        if (error) {
          setCheckError(errorMessage(error))
          return
        }
        const withFirms = await attachFirms(data ?? [])
        if (active) setMobileCheck({ digits, matches: withFirms })
      })
    return () => {
      active = false
    }
  }, [digits, mobileComplete])

  const checkDone = mobileComplete && mobileCheck?.digits === digits
  const matches = checkDone ? mobileCheck.matches : []
  const architectMatches = matches.filter((p) => p.party_type === 'architect')
  const otherMatches = matches.filter((p) => p.party_type !== 'architect')

  const firmIsNew = Boolean(firm?._isNewPartyDraft)
  const canSave = Boolean(name.trim()) && checkDone && architectMatches.length === 0 && !saving

  async function handleSave(event) {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    setSaveError(null)

    const firmResult = await materializePartyDraft(
      firm,
      employee?.id,
      firmIsNew && firmAddress.trim() ? { address: firmAddress.trim() } : {}
    )
    if (firmResult.error) {
      setSaving(false)
      setSaveError(`Couldn't save the firm: ${errorMessage(firmResult.error)}`)
      return
    }
    const savedFirm = firmResult.data ?? null

    const { data, error } = await supabase
      .from('parties')
      .insert({
        name: name.trim(),
        mobile: digits,
        party_type: 'architect',
        created_by: employee?.id ?? null,
        firm_party_id: savedFirm?.id ?? null,
      })
      .select(`${PARTY_COLUMNS}, bdm_employee_id`)
      .single()

    setSaving(false)
    if (error) {
      setSaveError(
        firmIsNew && savedFirm
          ? `The firm ${savedFirm.name} was saved, but the architect wasn't: ${errorMessage(error)}`
          : `Couldn't save the architect: ${errorMessage(error)}`
      )
      return
    }
    setCreated({ ...data, firm: savedFirm })
  }

  function resetForm() {
    setName('')
    setMobile('')
    setFirm(null)
    setFirmAddress('')
    setFirmPickerKey((k) => k + 1)
    setMobileCheck(null)
    setSaveError(null)
    setCreated(null)
  }

  if (created) {
    return (
      <div className="vip-card">
        <p className="vip-success" role="status" aria-live="polite" style={{ fontSize: 15, fontWeight: 600 }}>
          {created.bdm_employee_id === employee?.id ? 'Architect added to your portfolio.' : 'Architect added.'}
        </p>
        <div className="vip-facts" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div>
            <div className="vip-fact-label">Name</div>
            <div className="vip-fact-value">{created.name}</div>
          </div>
          <div>
            <div className="vip-fact-label">Mobile</div>
            <div className="vip-fact-value vip-mono">{created.mobile}</div>
          </div>
          <div>
            <div className="vip-fact-label">Firm</div>
            <div className="vip-fact-value">{created.firm?.name ?? '—'}</div>
          </div>
        </div>
        <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={resetForm}>
          Add another architect
        </button>
      </div>
    )
  }

  return (
    <form className="vip-form vip-pad-sticky-footer" onSubmit={handleSave}>
      <label className="vip-field">
        Architect name *
        <input
          className="vip-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          placeholder="e.g. Ar. Rohit Mehta"
        />
      </label>

      <label className="vip-field">
        Mobile *
        <NumPadInput
          variant="integer"
          label="Mobile"
          type="text"
          maxLength={10}
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
      </label>
      {mobile && !mobileComplete && <p className="vip-form-note vip-arch-note">A mobile number is 10 digits.</p>}
      {mobileComplete && !checkDone && !checkError && <p className="vip-form-note vip-arch-note">Checking this number…</p>}
      {checkError && (
        <p className="vip-error" role="alert">
          Couldn't check this number: {checkError}
        </p>
      )}

      {architectMatches.length > 0 && (
        <div className="vip-arch-exists" role="alert">
          <div className="vip-arch-exists-title">This architect is already in the CRM</div>
          {architectMatches.map((p) => (
            <div key={p.id} className="vip-arch-exists-row">
              <span className="vip-arch-exists-name">{p.name}</span>
              <span className="vip-arch-exists-meta">
                {[firmLabel(p), p.mobile, portfolioLabel(p, employee?.id)].filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
          <p className="vip-form-note" style={{ margin: 0 }}>
            Use this record when you enter their leads — the same number can't be added twice.
          </p>
        </div>
      )}
      {architectMatches.length === 0 && otherMatches.length > 0 && (
        <p className="vip-form-note vip-arch-note">
          This number is also saved for{' '}
          {otherMatches.map((p) => `${p.name} (${partyTypeLabel(p.party_type)})`).join(', ')}. You can still add the
          architect.
        </p>
      )}

      <PartySearchOrCreate
        key={firmPickerKey}
        label="Firm"
        hint="optional — the practice they work under"
        defaultPartyType="firm"
        typeOptions={['firm']}
        deferCreate
        onSelect={(party) => {
          setFirm(party)
          if (!party?._isNewPartyDraft) setFirmAddress('')
        }}
        createdByEmployeeId={employee?.id}
      />

      {/* Only for a firm being created here. An existing firm's address is
          that firm's own record, usually someone else's to edit. */}
      {firmIsNew && (
        <label className="vip-field">
          Firm address <span className="vip-field-hint">optional</span>
          <input
            className="vip-input"
            value={firmAddress}
            onChange={(e) => setFirmAddress(e.target.value)}
            placeholder="e.g. SCO 12, Feroze Gandhi Market, Ludhiana"
          />
        </label>
      )}

      {saveError && (
        <p className="vip-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="vip-sticky-footer">
        <button className="vip-btn" type="submit" disabled={!canSave}>
          {saving ? 'Saving…' : 'Save architect'}
        </button>
      </div>
    </form>
  )
}

export default NewArchitectForm
