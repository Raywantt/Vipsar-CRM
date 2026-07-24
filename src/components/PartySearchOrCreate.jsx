import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { sanitizeForIlike } from '../lib/sanitizeForIlike'
import './SearchOrCreate.css'

const PARTY_TYPES = ['client', 'architect', 'builder', 'firm', 'other']
const MIN_QUERY_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 350

function PartySearchOrCreate({ label = 'Party', defaultPartyType = 'client', allowCreate = true, onSelect }) {
  const { employee } = useAuth()

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
  const [createError, setCreateError] = useState(null)
  const [saving, setSaving] = useState(false)

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
        .select('id, name, mobile, party_type')
        .or(orParts.join(','))
        .order('name')
        .limit(8)

      if (!active) return
      setSearching(false)
      if (error) {
        setSearchError(error.message)
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
    setNewPartyType(defaultPartyType)
    setCreateError(null)
  }

  async function handleCreate() {
    setCreateError(null)
    setSaving(true)

    const { data, error } = await supabase
      .from('parties')
      .insert({
        name: newName.trim(),
        mobile: newMobile.trim() || null,
        party_type: newPartyType,
        created_by: employee?.id ?? null,
      })
      .select('id, name, mobile, party_type')
      .single()

    setSaving(false)

    if (error) {
      setCreateError(error.message)
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
      <div className="search-or-create search-or-create-selected">
        <span>
          <strong>{selected.name}</strong> ({selected.party_type})
          {selected.mobile ? ` — ${selected.mobile}` : ''}
        </span>
        <button type="button" onClick={changeSelection}>
          Change
        </button>
      </div>
    )
  }

  if (creating) {
    return (
      <div className="search-or-create search-or-create-form">
        <p className="search-or-create-heading">New {label}</p>
        <label className="search-or-create-field">
          Name
          <input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label className="search-or-create-field">
          Mobile
          <input value={newMobile} onChange={(e) => setNewMobile(e.target.value)} />
        </label>
        <label className="search-or-create-field">
          Type
          <select value={newPartyType} onChange={(e) => setNewPartyType(e.target.value)}>
            {PARTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        {createError && <p className="search-or-create-error">{createError}</p>}
        <div className="search-or-create-actions">
          <button type="button" onClick={handleCreate} disabled={saving || !newName.trim()}>
            {saving ? 'Saving…' : 'Create'}
          </button>
          <button type="button" onClick={() => setCreating(false)} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="search-or-create">
      <label className="search-or-create-field">
        {label}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Search by name…"
        />
      </label>

      {name.trim().length > 0 && (
        <label className="search-or-create-field">
          Mobile number (optional)
          <input
            type="text"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="Helps confirm the right match"
          />
        </label>
      )}

      {searching && <p className="search-or-create-hint">Searching…</p>}
      {searchError && <p className="search-or-create-error">{searchError}</p>}

      {results.length > 0 && (
        <ul className="search-or-create-results">
          {results.map((party) => (
            <li key={party.id}>
              <button type="button" onClick={() => selectExisting(party)}>
                <strong>{party.name}</strong> ({party.party_type})
                {party.mobile ? ` — ${party.mobile}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}

      {allowCreate && name.trim().length >= MIN_QUERY_LENGTH && !searching && (
        <button type="button" className="search-or-create-add-new" onClick={startCreate}>
          + Add new {label.toLowerCase()} "{name.trim()}"
        </button>
      )}
    </div>
  )
}

export default PartySearchOrCreate
