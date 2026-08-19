import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { sanitizeForIlike } from '../lib/sanitizeForIlike'
import { partyTypeLabel } from '../lib/partyTypeOptions'
import { PARTY_COLUMNS, attachFirms } from '../lib/partyQueries'
import { errorMessage } from '../lib/errorMessage'

const DEFAULT_PARTY_TYPES = ['client', 'architect', 'builder', 'firm', 'other', 'pmc']

// One place decides how a party's firm reads, so a linked firm and a legacy
// text one can't render differently in different lists.
//
// The fallback is load-bearing but also a trap worth knowing: it masked a real
// bug while the firm embed was silently returning nothing, because the legacy
// firm_name happened to match. Any future change to how .firm is resolved must
// be re-verified against an architect whose firm_name and linked firm DIFFER —
// equal values cannot tell the two sources apart.
export function firmLabel(party) {
  return party?.firm?.name ?? party?.firm_name ?? null
}
const MIN_QUERY_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 350

// typeOptions lets a caller narrow which party_type values are offered in
// the create form (e.g. "Other's name" excludes client/firm, adds pmc). A
// single-value list hides the Type field entirely and uses that value
// directly — the Client name field doesn't need to ask, it's always 'client'.
//
// createdByEmployeeId overrides whose id is written to parties.created_by —
// defaults to the logged-in employee. A sales_coordinator entering a lead on
// behalf of an exec (LeadQuickCapture, ActivityLog's Architect Meeting) passes
// the picked exec's id here instead, so created_by lines up with who the
// record is actually for. This matters beyond attribution: parties UPDATE is
// "own data (created_by) or owner role", so if this stayed the coordinator's
// own id, the exec would have no standing edit rights on a party the
// coordinator created for them.
//
// required only draws the " *" marker every other required field on a form
// uses — it enforces nothing itself (the caller's own Save gate does that).
// It's a separate prop rather than something the caller appends to `label`
// because `label` is also spoken in two other places, where an asterisk reads
// as a typo: the create form's "New {label}" heading and the
// "+ Add new {label.toLowerCase()} …" button.
//
// initialSelected seeds the picker with a party already chosen, for the case
// one screen's field is derived from another's — Log Activity and New Lead
// both pre-fill a Firm picker from the architect's own firm_party_id. It's a
// seed, not a controlled value: pass a `key` that changes when the source
// changes (e.g. the architect's id) so the picker re-seeds, which is the same
// remount-on-change pattern New Lead already uses on its referrer field.
//
// The old showFirmName prop is GONE. It revealed a "Firm name" text box inside
// the create form, writing parties.firm_name — which only ever worked for a
// party being created here, and wrote a free-text label rather than a link.
// Firms are real 'firm' parties now (see Schema/migration_architect_firm_link
// .sql), so every caller that wants one renders its own Firm picker beside
// this field instead, which works for existing architects too.
//
// deferCreate: when true, "Create" no longer writes to parties at all — it
// hands onSelect a local draft object (`_isNewPartyDraft: true`, real name/
// mobile/party_type, `id: null`) instead of an inserted row. Use this
// whenever the caller has its own later, explicit commit step (a form's own
// Save/Add button) — real incident that made this necessary: a party created
// the instant "Create" was clicked stayed in the database forever even when
// the surrounding form (e.g. Lead Detail's Add contact) was abandoned right
// after, with no undo. The caller is then responsible for turning the draft
// into a real row (materializePartyDraft in src/lib/partyQueries.js) at the
// moment it actually commits — never earlier. Selecting an EXISTING party via
// search is unaffected either way; it was never a write.
function PartySearchOrCreate({
  label = 'Party',
  defaultPartyType = 'client',
  allowCreate = true,
  required = false,
  hint = null,
  typeOptions = DEFAULT_PARTY_TYPES,
  initialSelected = null,
  onSelect,
  createdByEmployeeId,
  deferCreate = false,
}) {
  const { employee } = useAuth()
  const effectiveCreatedBy = createdByEmployeeId ?? employee?.id ?? null

  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [selected, setSelected] = useState(initialSelected)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [newPartyType, setNewPartyType] = useState(defaultPartyType)
  const [createError, setCreateError] = useState(null)
  const [saving, setSaving] = useState(false)

  // Keep the chosen type inside the offered list. typeOptions can change while
  // this form is open — New Lead swaps the "Other's name" list when the source
  // changes, since 'firm' is scanning-only — and a <select> whose value has no
  // matching <option> displays the FIRST option while React's state keeps the
  // old value. Verified in the browser: picking "architect firm" on a scanning
  // lead and then switching to Lixil showed "architect" but would have inserted
  // party_type = 'firm', bypassing the gate and lying about it on screen.
  //
  // Keyed on the joined list, not the array: callers pass array literals
  // (typeOptions={['client']}), which are a fresh identity every render.
  const typeOptionsKey = typeOptions.join(',')
  useEffect(() => {
    const allowed = typeOptionsKey.split(',')
    // Functional update so this doesn't need newPartyType as a dependency —
    // it would re-run on every type change and fight the user's own choice.
    setNewPartyType((current) => {
      if (allowed.includes(current)) return current
      return allowed.includes(defaultPartyType) ? defaultPartyType : allowed[0]
    })
  }, [typeOptionsKey, defaultPartyType])

  useEffect(() => {
    const nameTerm = name.trim()
    const mobileTerm = mobile.trim()

    if (nameTerm.length < MIN_QUERY_LENGTH) {
      setResults([])
      setSearchError(null)
      setSearching(false)
      return
    }

    let active = true
    setSearching(true)

    const timeout = setTimeout(async () => {
      const orParts = [`name.ilike.%${sanitizeForIlike(nameTerm)}%`]
      if (mobileTerm.length >= MIN_QUERY_LENGTH) {
        orParts.push(`mobile.ilike.%${sanitizeForIlike(mobileTerm)}%`)
      }

      const { data, error } = await supabase
        .from('parties')
        .select(PARTY_COLUMNS)
        .or(orParts.join(','))
        .order('name')
        .limit(8)

      if (error) {
        if (!active) return
        setSearching(false)
        setSearchError(errorMessage(error))
        setResults([])
        return
      }

      const withFirms = await attachFirms(data)
      if (!active) return
      setSearching(false)
      setSearchError(null)
      setResults(withFirms)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [name, mobile])

  function selectExisting(party) {
    setSelected(party)
    setResults([])
    setName('')
    setMobile('')
    onSelect?.(party)
  }

  function startCreate() {
    // deferCreate with only one possible type means there's nothing left to
    // ask — name/mobile are already typed into the search box above, and
    // party_type isn't a real choice when typeOptions has just one value. A
    // second "confirm these same details" screen with its own Continue button
    // would just be re-asking what's already on screen, so skip straight to
    // the finalized draft instead (the same shape handleCreate's deferCreate
    // branch produces). Whenever there IS a real type to pick (typeOptions
    // has more than one value — e.g. Architect Meeting's architect/firm
    // choice), the sub-form below still opens to ask it.
    if (deferCreate && typeOptions.length <= 1) {
      const draft = {
        id: null,
        name: name.trim(),
        mobile: mobile.trim() || null,
        party_type: typeOptions[0] ?? defaultPartyType,
        firm: null,
        _isNewPartyDraft: true,
      }
      setSelected(draft)
      setResults([])
      setName('')
      setMobile('')
      onSelect?.(draft)
      return
    }

    setCreating(true)
    setNewName(name.trim())
    setNewMobile(mobile.trim())
    setNewPartyType(typeOptions.includes(defaultPartyType) ? defaultPartyType : typeOptions[0])
    setCreateError(null)
  }

  async function handleCreate() {
    setCreateError(null)

    if (deferCreate) {
      if (!newName.trim()) return
      const draft = {
        id: null,
        name: newName.trim(),
        mobile: newMobile.trim() || null,
        party_type: newPartyType,
        firm: null,
        _isNewPartyDraft: true,
      }
      setCreating(false)
      setSelected(draft)
      setResults([])
      setName('')
      setMobile('')
      onSelect?.(draft)
      return
    }

    setSaving(true)

    // No firm here — a firm is its own party now, linked afterwards by
    // whichever screen asked for one (see this file's header comment).
    const { data, error } = await supabase
      .from('parties')
      .insert({
        name: newName.trim(),
        mobile: newMobile.trim() || null,
        party_type: newPartyType,
        created_by: effectiveCreatedBy,
      })
      // A brand-new party has no firm yet, so there's nothing to attach —
      // firm is set to null explicitly rather than left undefined, so callers
      // reading `.firm` see the same shape they get from a search result.
      .select(PARTY_COLUMNS)
      .single()

    setSaving(false)

    if (error) {
      setCreateError(errorMessage(error))
      return
    }

    const created = { ...data, firm: null }
    setCreating(false)
    setSelected(created)
    setResults([])
    setName('')
    setMobile('')
    onSelect?.(created)
  }

  function changeSelection() {
    setSelected(null)
    onSelect?.(null)
  }

  if (selected) {
    return (
      <div className="vip-row">
        <div className="vip-row-main">
          <div className="vip-row-title">{selected.name}</div>
          <div className="vip-row-sub">
            {partyTypeLabel(selected.party_type)}
            {firmLabel(selected) ? ` · ${firmLabel(selected)}` : ''}
            {selected.mobile ? ` · ${selected.mobile}` : ''}
          </div>
        </div>
        <button type="button" className="vip-btn-link" onClick={changeSelection}>
          Change
        </button>
      </div>
    )
  }

  if (creating) {
    return (
      <div className="vip-form vip-section-split">
        <div style={{ fontFamily: 'var(--vip-display)', fontWeight: 700, color: 'var(--vip-ink)' }}>New {label}</div>
        <label className="vip-field">
          Name
          <input className="vip-input" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label className="vip-field">
          Mobile
          <input className="vip-input" value={newMobile} onChange={(e) => setNewMobile(e.target.value)} />
        </label>
        {typeOptions.length > 1 && (
          <label className="vip-field">
            Type
            <select className="vip-select" value={newPartyType} onChange={(e) => setNewPartyType(e.target.value)}>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {partyTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
        )}
        {createError && <p className="vip-error" role="alert">{createError}</p>}
        <div className="vip-btn-row">
          <button
            type="button"
            className="vip-btn vip-btn-secondary vip-btn-sm"
            onClick={handleCreate}
            disabled={saving || !newName.trim()}
          >
            {deferCreate ? 'Continue' : saving ? 'Saving…' : 'Create'}
          </button>
          <button
            type="button"
            className="vip-btn vip-btn-secondary vip-btn-sm"
            onClick={() => setCreating(false)}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="vip-stack-s">
      <label className="vip-field">
        {required ? `${label} *` : label}
        {hint && <span className="vip-field-hint">{hint}</span>}
        <input
          className="vip-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Search or create"
        />
      </label>

      {name.trim().length > 0 && (
        <label className="vip-field">
          Mobile number <span className="vip-field-hint">optional, helps confirm the right match</span>
          <input className="vip-input" type="text" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </label>
      )}

      {searching && <p className="vip-form-note">Searching…</p>}
      {searchError && <p className="vip-error" role="alert">{searchError}</p>}

      {results.length > 0 && (
        <div className="vip-card">
          {results.map((party) => (
            <div key={party.id} className="vip-row vip-clickable" onClick={() => selectExisting(party)}>
              <div className="vip-row-main">
                <div className="vip-row-title">{party.name}</div>
                <div className="vip-row-sub">
                  {partyTypeLabel(party.party_type)}
                  {firmLabel(party) ? ` · ${firmLabel(party)}` : ''}
                  {party.mobile ? ` · ${party.mobile}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {allowCreate && name.trim().length >= MIN_QUERY_LENGTH && !searching && (
        <button type="button" className="vip-btn-link" onClick={startCreate}>
          + Add new {label.toLowerCase()} "{name.trim()}"
        </button>
      )}
    </div>
  )
}

export default PartySearchOrCreate
