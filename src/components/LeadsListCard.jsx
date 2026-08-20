import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import { fetchLeadsList, fetchLastActivityPerLead } from '../lib/dashboardQueries'
import { stageChipClass, stageFg } from '../lib/statusColors'
import { STALE_DAYS } from '../lib/attention'
import { LEAD_STAGE_OPTIONS, stageLabel } from '../lib/leadStageOptions'
import { SOURCE_TYPE_OPTIONS, SOURCE_TYPE_LABELS } from '../lib/sourceTypeOptions'
import { formatCurrencyCompact } from '../lib/format'
import NumPadInput from './NumPadInput'
import { dealValueFor, dealValueOrNull } from '../lib/pipelineValue'
import EmployeeLink from './EmployeeLink'
import { errorMessage } from '../lib/errorMessage'

// "touched today" / "Nd ago", turning "Nd silent" + red past STALE_DAYS —
// same threshold attention.js already uses elsewhere, not a second
// definition of staleness.
function recencyInfo(lead, lastActivityByLead) {
  const lastAt = lastActivityByLead.get(lead.id) ?? lead.created_at
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000)
  const isStale = days >= STALE_DAYS
  return { label: isStale ? `${days}d silent` : days <= 0 ? 'touched today' : `${days}d ago`, isStale }
}

// Debounce only the two free-typed value inputs — a select/chip/segmented
// click should refetch instantly, same split PartySearchOrCreate already
// draws between debounced text search and immediate controls.
const VALUE_DEBOUNCE_MS = 400

function partyLabel(lead) {
  return lead.parties?.name ?? (lead.sites?.nickname || lead.sites?.locality) ?? '(no party)'
}

// Desktop's dedicated Site column, now that Party/Site render separately
// there instead of falling back into one combined line the way the mobile
// grouped view's single-line row still does.
function siteLabel(lead) {
  return lead.sites?.nickname || lead.sites?.locality || '—'
}

function formatValueChip(min, max) {
  const hasMin = min !== '' && min != null
  const hasMax = max !== '' && max != null
  if (hasMin && hasMax) return `${formatCurrencyCompact(Number(min))}–${formatCurrencyCompact(Number(max))}`
  if (hasMin) return `${formatCurrencyCompact(Number(min))}+`
  if (hasMax) return `Up to ${formatCurrencyCompact(Number(max))}`
  return null
}

// showOwnerFilter: does this viewer oversee more than one person? True for an
// owner and for a sales coordinator (whose `employees` is pre-narrowed to
// their own team by Dashboard). It was named `isOwner`, which read as a role
// check and so silently denied a coordinator the owner facet.
// `title` is passed in rather than derived here, so this card and AppNav's
// header can't end up calling the same list two different things.
// A single lead's value for DISPLAY. dealValueOrNull returns null when the lead
// carries neither a quote nor an order value, and an unpriced deal must read
// '—' rather than ₹0 — see pipelineValue.js. Group and header totals keep using
// dealValueFor, because summing genuinely does treat an unknown value as zero.
function formatLeadValue(lead) {
  const v = dealValueOrNull(lead)
  return v == null ? '—' : formatCurrencyCompact(v)
}

// Persisted across a "click into a lead, then Back" round trip, reset on a
// fresh nav-link visit — see usePersistedFilterState's own header comment.
const FILTERS_STORAGE_KEY = 'vip-filters:leads-list'

function LeadsListCard({ showOwnerFilter, employees, title }) {
  const [employeeFilter, setEmployeeFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'employeeFilter', '')
  const [stageFilter, setStageFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'stageFilter', '')
  const [sourceFilter, setSourceFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'sourceFilter', '')
  const [statusFilter, setStatusFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'statusFilter', '')
  const [minValueInput, setMinValueInput] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'minValueInput', '')
  const [maxValueInput, setMaxValueInput] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'maxValueInput', '')
  const [minValue, setMinValue] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'minValue', '')
  const [maxValue, setMaxValue] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'maxValue', '')
  const [filtersOpen, setFiltersOpen] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'filtersOpen', false)
  const [search, setSearch] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'search', '')

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())

  // Only the value inputs are debounced — everything else here is a
  // click/select, not free typing, so it can refetch immediately.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setMinValue(minValueInput)
      setMaxValue(maxValueInput)
    }, VALUE_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
    // setMinValue/setMaxValue come from usePersistedFilterState, which wraps
    // useState — stable across renders same as any useState setter, so
    // listing them is just satisfying the linter, not a behavior change.
  }, [minValueInput, maxValueInput, setMinValue, setMaxValue])

  useEffect(() => {
    let active = true
    setLoading(true)

    fetchLeadsList({
      employeeId: employeeFilter || null,
      stage: stageFilter || null,
      source: sourceFilter || null,
      status: statusFilter || null,
      minValue: minValue !== '' ? Number(minValue) : null,
      maxValue: maxValue !== '' ? Number(maxValue) : null,
    }).then(({ data, error }) => {
      if (!active) return
      setLoading(false)
      if (error) {
        setError(errorMessage(error))
      } else {
        setError(null)
        setLeads(data ?? [])
      }
    })

    return () => {
      active = false
    }
  }, [employeeFilter, stageFilter, sourceFilter, statusFilter, minValue, maxValue])

  // Powers the mobile grouped view's recency line ("touched today"/"Nd
  // silent") — independent of the filters above (last-activity data doesn't
  // change per filter), so fetched once rather than refetched alongside leads.
  useEffect(() => {
    let active = true
    fetchLastActivityPerLead().then(({ data, error }) => {
      if (!active) return
      if (error) return
      const map = new Map()
      ;(data ?? []).forEach((row) => {
        const existing = map.get(row.lead_id)
        if (!existing || new Date(row.created_at) > new Date(existing)) map.set(row.lead_id, row.created_at)
      })
      setLastActivityByLead(map)
    })
    return () => {
      active = false
    }
  }, [])

  const term = search.trim().toLowerCase()
  const filtered = term
    ? leads.filter((lead) => {
        const party = lead.parties?.name?.toLowerCase() ?? ''
        const site = `${lead.sites?.nickname ?? ''} ${lead.sites?.locality ?? ''}`.toLowerCase()
        const owner = lead.employees?.name?.toLowerCase() ?? ''
        return party.includes(term) || site.includes(term) || owner.includes(term)
      })
    : leads

  // Mobile's grouped-by-stage default (LEAD_STAGE_OPTIONS order first, then
  // any free-text "Other…" stage present in the data) — desktop keeps the
  // flat list below unchanged.
  const groups = useMemo(() => {
    const byStage = new Map()
    filtered.forEach((lead) => {
      const stage = lead.current_stage ?? 'calling'
      if (!byStage.has(stage)) byStage.set(stage, [])
      byStage.get(stage).push(lead)
    })
    const order = [...LEAD_STAGE_OPTIONS, ...[...byStage.keys()].filter((s) => !LEAD_STAGE_OPTIONS.includes(s))]
    return order
      .filter((stage) => byStage.has(stage))
      .map((stage) => {
        const rows = byStage.get(stage)
        return { stage, rows, value: rows.reduce((s, l) => s + dealValueFor(l), 0) }
      })
  }, [filtered])

  function clearAllFilters() {
    setEmployeeFilter('')
    setStageFilter('')
    setSourceFilter('')
    setStatusFilter('')
    setMinValueInput('')
    setMaxValueInput('')
  }

  const activeChips = useMemo(() => {
    const chips = []
    if (showOwnerFilter && employeeFilter) {
      const emp = employees.find((e) => String(e.id) === employeeFilter)
      if (emp) chips.push({ key: 'owner', label: `Owner: ${emp.name.split(' ')[0]}`, onRemove: () => setEmployeeFilter('') })
    }
    if (stageFilter) chips.push({ key: 'stage', label: `Stage: ${stageFilter}`, onRemove: () => setStageFilter('') })
    if (sourceFilter) {
      chips.push({
        key: 'source',
        label: `Source: ${SOURCE_TYPE_LABELS[sourceFilter] ?? sourceFilter}`,
        onRemove: () => setSourceFilter(''),
      })
    }
    if (statusFilter) {
      chips.push({
        key: 'status',
        label: statusFilter === 'active' ? 'Active only' : 'Won or lost only',
        onRemove: () => setStatusFilter(''),
      })
    }
    const valueLabel = formatValueChip(minValueInput, maxValueInput)
    if (valueLabel) {
      chips.push({
        key: 'value',
        label: `Quote ${valueLabel}`,
        onRemove: () => {
          setMinValueInput('')
          setMaxValueInput('')
        },
      })
    }
    return chips
    // The setters come from usePersistedFilterState (wraps useState) — stable
    // across renders same as any useState setter, listed only for the linter.
  }, [
    showOwnerFilter,
    employeeFilter,
    employees,
    stageFilter,
    sourceFilter,
    statusFilter,
    minValueInput,
    maxValueInput,
    setEmployeeFilter,
    setStageFilter,
    setSourceFilter,
    setStatusFilter,
    setMinValueInput,
    setMaxValueInput,
  ])

  // The five facets, shared verbatim between mobile's disclosure panel and
  // desktop's persistent rail (see the two render blocks below) — one set
  // of controls, two places it can appear, so they can't drift apart.
  const filterFields = (
    <>
      {showOwnerFilter && employees.length > 0 && (
        <div className="vip-stack-s" style={{ gap: 6 }}>
          <div className="vip-fact-label">Owner</div>
          {employees.length <= 4 ? (
            <div className="vip-seg vip-seg-outline">
              <button
                type="button"
                className={employeeFilter === '' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                onClick={() => setEmployeeFilter('')}
              >
                All
              </button>
              {employees.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={employeeFilter === String(e.id) ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                  onClick={() => setEmployeeFilter(String(e.id))}
                >
                  {e.name.split(' ')[0]}
                </button>
              ))}
            </div>
          ) : (
            <select className="vip-select" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
              <option value="">— All employees —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="vip-stack-s" style={{ gap: 6 }}>
        <div className="vip-fact-label">Stage</div>
        <div className="vip-chip-wrap">
          <button
            type="button"
            className="vip-chip-select"
            aria-pressed={stageFilter === ''}
            onClick={() => setStageFilter('')}
          >
            All
          </button>
          {LEAD_STAGE_OPTIONS.map((stage) => (
            <button
              key={stage}
              type="button"
              className="vip-chip-select"
              style={{ color: stageFg(stage) }}
              aria-pressed={stageFilter === stage}
              onClick={() => setStageFilter(stage)}
            >
              {stageLabel(stage)}
            </button>
          ))}
        </div>
      </div>

      <div className="vip-stack-s" style={{ gap: 6 }}>
        <div className="vip-fact-label">Source</div>
        <select className="vip-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          {SOURCE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="vip-stack-s" style={{ gap: 6 }}>
        <div className="vip-fact-label">Status</div>
        <div className="vip-seg vip-seg-outline">
          <button
            type="button"
            className={statusFilter === '' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => setStatusFilter('')}
          >
            All
          </button>
          <button
            type="button"
            className={statusFilter === 'active' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => setStatusFilter('active')}
          >
            Active
          </button>
          <button
            type="button"
            className={statusFilter === 'inactive' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => setStatusFilter('inactive')}
          >
            Inactive
          </button>
        </div>
      </div>

      <div className="vip-stack-s" style={{ gap: 6 }}>
        <div className="vip-fact-label">Quote value (₹)</div>
        <div className="vip-grid-2">
          <NumPadInput
            variant="decimal"
            label="Min quote value"
            type="number"
            min="0"
            placeholder="Min"
            value={minValueInput}
            onChange={(e) => setMinValueInput(e.target.value)}
          />
          <NumPadInput
            variant="decimal"
            label="Max quote value"
            type="number"
            min="0"
            placeholder="Max"
            value={maxValueInput}
            onChange={(e) => setMaxValueInput(e.target.value)}
          />
        </div>
      </div>
    </>
  )

  const listStatus = (
    <>
      {!loading && !error && leads.length > 0 && (
        <p className="vip-card-note">
          {filtered.length} of {leads.length} lead{leads.length === 1 ? '' : 's'}
        </p>
      )}
      {error && <p className="vip-error" role="alert">{error}</p>}
    </>
  )

  return (
    <div className="vip-card">
      <div className="vip-card-title">{title}</div>

      <input
        className="vip-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by party, site, or owner…"
      />

      {/* Mobile: filters stay a disclosure panel behind a toggle — screen
          real estate is too tight for a persistent rail at phone width. */}
      <div className="vip-only-mobile vip-stack-s">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="vip-btn vip-btn-secondary vip-btn-sm"
            style={{ width: 'auto' }}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {filtersOpen ? 'Hide filters' : activeChips.length > 0 ? `Filters (${activeChips.length})` : 'Filters'}
          </button>
          {activeChips.length > 0 && (
            <button type="button" className="vip-action-close" onClick={clearAllFilters}>
              Clear all
            </button>
          )}
        </div>

        {!filtersOpen && activeChips.length > 0 && (
          <div className="vip-chip-wrap">
            {activeChips.map((chip) => (
              <button key={chip.key} type="button" className="vip-filter-chip" onClick={chip.onRemove}>
                {chip.label}
                <span className="vip-filter-chip-x" aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}

        {filtersOpen && (
          <div className="vip-stack-s" style={{ paddingTop: 10, borderTop: '1px solid var(--vip-line-soft)' }}>
            {filterFields}
          </div>
        )}

        {listStatus}

        {loading ? (
          <p className="vip-empty">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="vip-empty">{leads.length === 0 ? 'No leads match these filters.' : 'No leads match your search.'}</p>
        ) : (
          <div className="vip-lead-groups">
            {groups.map((group) => (
              <div key={group.stage}>
                <div className="vip-lead-group-head">
                  <span className="vip-lead-group-swatch" style={{ background: stageFg(group.stage) }} />
                  <span className="vip-lead-group-name">{stageLabel(group.stage)}</span>
                  <span className="vip-lead-group-count">{group.rows.length}</span>
                  <span className="vip-lead-group-value">{formatCurrencyCompact(group.value)}</span>
                </div>
                {group.rows.map((lead) => {
                  const recency = recencyInfo(lead, lastActivityByLead)
                  return (
                    <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-lead-row">
                      <div className="vip-lead-row-main">
                        <div className="vip-lead-row-party">{partyLabel(lead)}</div>
                        <div className="vip-lead-row-sub">
                          {[lead.sites?.nickname || lead.sites?.locality, SOURCE_TYPE_LABELS[lead.source_type] ?? lead.source_type]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <div className="vip-lead-row-side">
                        <div className="vip-lead-row-value">{formatLeadValue(lead)}</div>
                        <div className={recency.isStale ? 'vip-lead-row-recency vip-stale' : 'vip-lead-row-recency'}>{recency.label}</div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: a persistent filter rail (not a disclosure — there's room
          to just show every facet) beside a real-columned list (party · site
          · owner · stage · source · value · last touch), replacing the old
          three-line-per-row layout that used to sit in a 700px .vip-narrow
          column with ~340px of empty gutter on each side at desktop width. */}
      <div className="vip-only-desktop vip-leads-layout">
        <aside className="vip-leads-rail">
          <div className="vip-leads-rail-head">
            <span className="vip-fact-label">Filters</span>
            {activeChips.length > 0 && (
              <button type="button" className="vip-action-close" onClick={clearAllFilters}>
                Clear all
              </button>
            )}
          </div>
          {filterFields}
        </aside>

        <div className="vip-leads-main">
          {listStatus}

          {loading ? (
            <p className="vip-empty">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="vip-empty">{leads.length === 0 ? 'No leads match these filters.' : 'No leads match your search.'}</p>
          ) : (
            <>
              <div className="vip-leadrow-head">
                <span>Party</span>
                <span>Site</span>
                <span>Owner</span>
                <span>Stage</span>
                <span>Source</span>
                <span className="vip-leadrow-num">Value</span>
                <span className="vip-leadrow-num">Last touch</span>
              </div>
              {filtered.map((lead) => {
                const recency = recencyInfo(lead, lastActivityByLead)
                return (
                  <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-leadrow vip-clickable">
                    <span className="vip-leadrow-cell vip-leadrow-party">{lead.parties?.name ?? '(no party)'}</span>
                    <span className="vip-leadrow-cell">{siteLabel(lead)}</span>
                    <span className="vip-leadrow-cell">
                      <EmployeeLink id={lead.owner_employee_id} name={lead.employees?.name} />
                    </span>
                    <span>
                      <span className={stageChipClass(lead.current_stage ?? 'calling')}>
                        {stageLabel(lead.current_stage ?? 'calling')}
                      </span>
                    </span>
                    <span className="vip-leadrow-cell">
                      {SOURCE_TYPE_LABELS[lead.source_type] ?? lead.source_type ?? '—'}
                    </span>
                    <span className="vip-leadrow-num">{formatLeadValue(lead)}</span>
                    <span className={recency.isStale ? 'vip-leadrow-recency vip-stale' : 'vip-leadrow-recency'}>
                      {recency.label}
                    </span>
                  </Link>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default LeadsListCard
