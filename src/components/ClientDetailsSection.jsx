import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'

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
      setError(errorMessage(error))
      return
    }

    setSavedAt(Date.now())
    onSaved(data)
  }

  return (
    <div className="vip-card">
      <div className="vip-card-title">Client details</div>
      <p className="vip-row-sub">
        {party.name} ({party.party_type})
      </p>

      <div className="vip-grid-2">
        <label className="vip-field">
          Mobile
          <input className="vip-input" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </label>
        <label className="vip-field">
          City
          <input className="vip-input" value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
      </div>

      <label className="vip-field">
        Address
        <input className="vip-input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>

      {error && <p className="vip-error">{error}</p>}
      {savedAt && !error && <p className="vip-success">Saved.</p>}

      <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save client details'}
      </button>
    </div>
  )
}

export default ClientDetailsSection
