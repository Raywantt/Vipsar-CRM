import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { sanitizeForIlike } from '../lib/sanitizeForIlike'
import { partyTypeLabel } from '../lib/partyTypeOptions'
import { errorMessage } from '../lib/errorMessage'

const DEFAULT_PARTY_TYPES = ['client', 'architect', 'builder', 'firm', 'other', 'pmc']
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
// showFirmName reveals a "Firm name" box (parties.firm_name) in the create
// form, but only while the chosen Type is 'architect' — an architect is a
// person who works under a firm, so both are worth having. It stays hidden for
// the 'firm' type itself, where the party already *is* the firm and a second
// firm field would just be the name typed twice.
function PartySearchOrCreate({
  label = 'Party',
  defaultPartyType = 'client',
  allowCreate = true,
  typeOptions = DEFAULT_PARTY_TYPES,
  showFirmName = false,
  onSelect,
  createdByEmployeeId,
}) {
  const { employee } = useAuth()
  const effectiveCreatedBy = createdByEmployeeId ?? employee?.id ?? null

  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [selected, setSelected] = useState(null)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMobile, setNewMobile] = useState('')
  const [newPartyType, setNewPartyType] = useState(defaultPartyType)
  const [newFirmName, setNewFirmName] = useState('')
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
        .select('id, name, mobile, party_type, firm_name')
        .or(orParts.join(','))
        .order('name')
        .limit(8)

      if (!active) return
      setSearching(false)
      if (error) {
        setSearchError(errorMessage(error))
        setResults([])
      } else {
        setSearchError(null)
        setResults(data)
      }
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
    setCreating(true)
    setNewName(name.trim())
    setNewMobile(mobile.trim())
    setNewPartyType(typeOptions.includes(defaultPartyType) ? defaultPartyType : typeOptions[0])
    setNewFirmName('')
    setCreateError(null)
  }

  async function handleCreate() {
    setCreateError(null)
    setSaving(true)

    // firm_name only goes along when the box was actually on screen — a rep
    // who typed a firm and then switched Type to 'builder' shouldn't have that
    // stale value silently saved against a party the field never applied to.
    const { data, error } = await supabase
      .from('parties')
      .insert({
        name: newName.trim(),
        mobile: newMobile.trim() || null,
        party_type: newPartyType,
        firm_name: showFirmName && newPartyType === 'architect' ? newFirmName.trim() || null : null,
        created_by: effectiveCreatedBy,
      })
      .select('id, name, mobile, party_type, firm_name')
      .single()

    setSaving(false)

    if (error) {
      setCreateError(errorMessage(error))
      return
    }

    setCreating(false)
    setSelected(data)
    setResults([])
    setName('')
    setMobile('')
    onSelect?.(data)
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
            {selected.firm_name ? ` · ${selected.firm_name}` : ''}
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
        {showFirmName && newPartyType === 'architect' && (
          <label className="vip-field">
            Firm name <span className="vip-field-hint">optional, the firm this architect works under</span>
            <input className="vip-input" value={newFirmName} onChange={(e) => setNewFirmName(e.target.value)} />
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
            {saving ? 'Saving…' : 'Create'}
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
        {label}
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
                  {party.firm_name ? ` · ${party.firm_name}` : ''}
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
