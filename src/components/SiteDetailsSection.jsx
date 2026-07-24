import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import './SearchOrCreate.css'

function SiteDetailsSection({ site, areas, onSaved }) {
  const [areaId, setAreaId] = useState(site.area_id ?? '')
  const [locality, setLocality] = useState(site.locality ?? '')
  const [houseNo, setHouseNo] = useState(site.house_no ?? '')
  const [pincode, setPincode] = useState(site.pincode ?? '')
  const [siteStage, setSiteStage] = useState(
    site.site_stage && SITE_STAGE_OPTIONS.includes(site.site_stage) ? site.site_stage : site.site_stage ? 'other' : ''
  )
  const [customStage, setCustomStage] = useState(
    site.site_stage && !SITE_STAGE_OPTIONS.includes(site.site_stage) ? site.site_stage : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSavedAt(null)

    const resolvedStage = siteStage === 'other' ? customStage.trim() || null : siteStage || null

    const { data, error } = await supabase
      .from('sites')
      .update({
        area_id: areaId || null,
        locality: locality.trim() || null,
        house_no: houseNo.trim() || null,
        pincode: pincode.trim() || null,
        site_stage: resolvedStage,
      })
      .eq('id', site.id)
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
      <h2>Site details</h2>

      <label className="search-or-create-field">
        Area
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">— Not specified —</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.area_name}
              {area.city ? `, ${area.city}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="search-or-create-field">
        Locality
        <input value={locality} onChange={(e) => setLocality(e.target.value)} />
      </label>

      <label className="search-or-create-field">
        House / Plot No.
        <input value={houseNo} onChange={(e) => setHouseNo(e.target.value)} />
      </label>

      <label className="search-or-create-field">
        Pincode
        <input value={pincode} onChange={(e) => setPincode(e.target.value)} />
      </label>

      <label className="search-or-create-field">
        Site stage
        <select value={siteStage} onChange={(e) => setSiteStage(e.target.value)}>
          <option value="">— Not specified —</option>
          {SITE_STAGE_OPTIONS.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
          <option value="other">Other…</option>
        </select>
      </label>
      {siteStage === 'other' && (
        <label className="search-or-create-field">
          Describe stage
          <input value={customStage} onChange={(e) => setCustomStage(e.target.value)} />
        </label>
      )}

      {error && <p className="search-or-create-error">{error}</p>}
      {savedAt && !error && <p className="lead-section-success">Saved.</p>}

      <button type="button" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save site details'}
      </button>
    </section>
  )
}

export default SiteDetailsSection
