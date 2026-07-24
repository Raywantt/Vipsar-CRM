import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './SearchOrCreate.css'

function ClientDetailsSection({ party, onSaved }) {
  const [mobile, setMobile] = useState(party.mobile ?? '')
  const [address, setAddress] = useState(party.address ?? '')
  const [city, setCity] = useState(party.city ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSavedAt(null)

    const { data, error } = await supabase
      .from('parties')
      .update({
        mobile: mobile.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
      })
      .eq('id', party.id)
      .select()
      .single()

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    setSavedAt(Date.now())
    onSaved(data)
  }

  return (
    <section className="lead-section">
      <h2>Client details</h2>
      <p className="lead-section-subhead">
        {party.name} ({party.party_type})
      </p>

      <label className="search-or-create-field">
        Mobile
        <input value={mobile} onChange={(e) => setMobile(e.target.value)} />
      </label>

      <label className="search-or-create-field">
        Address
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>

      <label className="search-or-create-field">
        City
        <input value={city} onChange={(e) => setCity(e.target.value)} />
      </label>

      {error && <p className="search-or-create-error">{error}</p>}
      {savedAt && !error && <p className="lead-section-success">Saved.</p>}

      <button type="button" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save client details'}
      </button>
    </section>
  )
}

export default ClientDetailsSection
