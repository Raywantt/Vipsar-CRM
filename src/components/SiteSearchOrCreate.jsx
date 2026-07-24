import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { sanitizeForIlike } from '../lib/sanitizeForIlike'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import './SearchOrCreate.css'

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
          setAreasError(error.message)
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
      setCreateError(error.message)
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
      <div className="search-or-create search-or-create-selected">
        <span>
          <strong>{selected.locality || '(no locality)'}</strong>
          {selected.house_no ? `, ${selected.house_no}` : ''}
          {area ? ` — ${area.area_name}` : ''}
          {selected.site_stage ? ` (${selected.site_stage})` : ''}
        </span>
        <button type="button" onClick={changeSelection}>
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="search-or-create">
      <label className="search-or-create-field">
        Area
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">— Select area —</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.area_name}
              {area.city ? `, ${area.city}` : ''}
            </option>
          ))}
        </select>
      </label>

      {areasError && <p className="search-or-create-error">{areasError}</p>}
      {!areaId && <p className="search-or-create-prompt">Select an area to search nearby sites.</p>}

      {areaId && (
        <>
          <label className="search-or-create-field">
            Locality
            <input
              value={locality}
              onChange={(e) => setLocality(e.target.value)}
              placeholder="Colony, street, landmark…"
            />
          </label>
          <label className="search-or-create-field">
            House / Plot No.
            <input value={houseNo} onChange={(e) => setHouseNo(e.target.value)} />
          </label>

          {searching && <p className="search-or-create-hint">Searching…</p>}
          {searchError && <p className="search-or-create-error">{searchError}</p>}

          {!creating && results.length > 0 && (
            <ul className="search-or-create-results">
              {results.map((site) => (
                <li key={site.id}>
                  <button type="button" onClick={() => selectExisting(site)}>
                    <strong>{site.locality || '(no locality)'}</strong>
                    {site.house_no ? `, ${site.house_no}` : ''}
                    {site.site_stage ? ` — ${site.site_stage}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!creating && canCreate && (
            <button type="button" className="search-or-create-add-new" onClick={startCreate}>
              + Add new site
            </button>
          )}

          {creating && (
            <>
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

              {createError && <p className="search-or-create-error">{createError}</p>}

              <div className="search-or-create-actions">
                <button type="button" onClick={handleCreate} disabled={saving}>
                  {saving ? 'Saving…' : 'Create'}
                </button>
                <button type="button" onClick={() => setCreating(false)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default SiteSearchOrCreate
