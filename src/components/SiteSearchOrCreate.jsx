import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { sanitizeForIlike } from '../lib/sanitizeForIlike'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { errorMessage } from '../lib/errorMessage'

const MIN_QUERY_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 350

function SiteSearchOrCreate({ discoveredVia = null, onSelect }) {
  const { employee } = useAuth()

  const [areas, setAreas] = useState([])
  const [areasError, setAreasError] = useState(null)
  const [areaId, setAreaId] = useState('')

  const [locality, setLocality] = useState('')
  const [houseNo, setHouseNo] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [selected, setSelected] = useState(null)

  const [creating, setCreating] = useState(false)
  const [siteStage, setSiteStage] = useState('')
  const [customStage, setCustomStage] = useState('')
  const [createError, setCreateError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    supabase
      .from('areas')
      .select('id, area_name, city')
      .order('area_name')
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setAreasError(errorMessage(error))
        } else {
          setAreas(data)
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const localityTerm = locality.trim()
    const houseTerm = houseNo.trim()

    if (!areaId || (localityTerm.length < MIN_QUERY_LENGTH && houseTerm.length < MIN_QUERY_LENGTH)) {
      setResults([])
      setSearchError(null)
      setSearching(false)
      return
    }

    let active = true
    setSearching(true)

    const timeout = setTimeout(async () => {
      const orParts = []
      if (localityTerm.length >= MIN_QUERY_LENGTH) {
        orParts.push(`locality.ilike.%${sanitizeForIlike(localityTerm)}%`)
      }
      if (houseTerm.length >= MIN_QUERY_LENGTH) {
        orParts.push(`house_no.ilike.%${sanitizeForIlike(houseTerm)}%`)
      }

      const { data, error } = await supabase
        .from('sites')
        .select('id, area_id, locality, house_no, site_stage, pincode')
        .eq('area_id', areaId)
        .or(orParts.join(','))
        .order('locality')
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
  }, [areaId, locality, houseNo])

  const canCreate =
    areaId && (locality.trim().length >= MIN_QUERY_LENGTH || houseNo.trim().length >= MIN_QUERY_LENGTH) && !searching

  function selectExisting(site) {
    setSelected(site)
    setResults([])
    onSelect?.(site)
  }

  function startCreate() {
    setCreating(true)
    setSiteStage('')
    setCustomStage('')
    setCreateError(null)
  }

  async function handleCreate() {
    setCreateError(null)
    setSaving(true)

    const resolvedStage = siteStage === 'other' ? customStage.trim() || null : siteStage || null

    const { data, error } = await supabase
      .from('sites')
      .insert({
        area_id: areaId,
        locality: locality.trim() || null,
        house_no: houseNo.trim() || null,
        site_stage: resolvedStage,
        discovered_via: discoveredVia,
        discovered_by: employee?.id ?? null,
      })
      .select('id, area_id, locality, house_no, site_stage, pincode')
      .single()

    setSaving(false)

    if (error) {
      setCreateError(errorMessage(error))
      return
    }

    setCreating(false)
    setSelected(data)
    setResults([])
    onSelect?.(data)
  }

  function changeSelection() {
    setSelected(null)
    onSelect?.(null)
  }

  if (selected) {
    const area = areas.find((a) => String(a.id) === String(selected.area_id))
    return (
      <div className="vip-row">
        <div className="vip-row-main">
          <div className="vip-row-title">
            {selected.locality || '(no locality)'}
            {selected.house_no ? `, ${selected.house_no}` : ''}
          </div>
          <div className="vip-row-sub">
            {[area?.area_name, selected.site_stage].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button type="button" className="vip-btn-link" onClick={changeSelection}>
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="vip-stack-s">
      <label className="vip-field">
        Area
        <select className="vip-select" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">— Select area —</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.area_name}
              {area.city ? `, ${area.city}` : ''}
            </option>
          ))}
        </select>
      </label>

      {areasError && <p className="vip-error">{areasError}</p>}
      {!areaId && <p className="vip-form-note">Select an area to search nearby sites.</p>}

      {areaId && (
        <>
          <div className="vip-grid-2">
            <label className="vip-field">
              Locality
              <input
                className="vip-input"
                value={locality}
                onChange={(e) => setLocality(e.target.value)}
                placeholder="Colony, street, landmark…"
              />
            </label>
            <label className="vip-field">
              House / Plot No.
              <input className="vip-input" value={houseNo} onChange={(e) => setHouseNo(e.target.value)} />
            </label>
          </div>

          {searching && <p className="vip-form-note">Searching…</p>}
          {searchError && <p className="vip-error">{searchError}</p>}

          {!creating && results.length > 0 && (
            <div className="vip-card">
              {results.map((site) => (
                <div key={site.id} className="vip-row vip-clickable" onClick={() => selectExisting(site)}>
                  <div className="vip-row-main">
                    <div className="vip-row-title">
                      {site.locality || '(no locality)'}
                      {site.house_no ? `, ${site.house_no}` : ''}
                    </div>
                    {site.site_stage && <div className="vip-row-sub">{site.site_stage}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!creating && canCreate && (
            <button type="button" className="vip-btn-link" onClick={startCreate}>
              + Add new site
            </button>
          )}

          {creating && (
            <div className="vip-form vip-section-split">
              <label className="vip-field">
                Site stage
                <select className="vip-select" value={siteStage} onChange={(e) => setSiteStage(e.target.value)}>
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
                <label className="vip-field">
                  Describe stage
                  <input className="vip-input" value={customStage} onChange={(e) => setCustomStage(e.target.value)} />
                </label>
              )}

              {createError && <p className="vip-error">{createError}</p>}

              <div className="vip-btn-row">
                <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={handleCreate} disabled={saving}>
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
          )}
        </>
      )}
    </div>
  )
}

export default SiteSearchOrCreate
