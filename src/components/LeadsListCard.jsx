import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchLeadsList } from '../lib/dashboardQueries'
import { stageChipClass, stageFg } from '../lib/statusColors'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { SOURCE_TYPE_OPTIONS, SOURCE_TYPE_LABELS } from '../lib/sourceTypeOptions'
import { formatCurrencyCompact } from '../lib/format'
import EmployeeLink from './EmployeeLink'

// Debounce only the two free-typed value inputs — a select/chip/segmented
// click should refetch instantly, same split PartySearchOrCreate already
// draws between debounced text search and immediate controls.
const VALUE_DEBOUNCE_MS = 400

function partyLabel(lead) {
  return lead.parties?.name ?? (lead.sites?.nickname || lead.sites?.locality) ?? '(no party)'
}

function formatShortDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function formatValueChip(min, max) {
  const hasMin = min !== '' && min != null
  const hasMax = max !== '' && max != null
  if (hasMin && hasMax) return `${formatCurrencyCompact(Number(min))}–${formatCurrencyCompact(Number(max))}`
  if (hasMin) return `${formatCurrencyCompact(Number(min))}+`
  if (hasMax) return `Up to ${formatCurrencyCompact(Number(max))}`
  return null
}

function LeadsListCard({ isOwner, employees }) {
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [minValueInput, setMinValueInput] = useState('')
  const [maxValueInput, setMaxValueInput] = useState('')
  const [minValue, setMinValue] = useState('')
  const [maxValue, setMaxValue] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState('')

  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Only the value inputs are debounced — everything else here is a
  // click/select, not free typing, so it can refetch immediately.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setMinValue(minValueInput)
      setMaxValue(maxValueInput)
    }, VALUE_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [minValueInput, maxValueInput])

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
        setError(error.message)
      } else {
        setError(null)
        setLeads(data ?? [])
      }
    })

    return () => {
      active = false
    }
  }, [employeeFilter, stageFilter, sourceFilter, statusFilter, minValue, maxValue])

  const term = search.trim().toLowerCase()
  const filtered = term
    ? leads.filter((lead) => {
        const party = lead.parties?.name?.toLowerCase() ?? ''
        const site = `${lead.sites?.nickname ?? ''} ${lead.sites?.locality ?? ''}`.toLowerCase()
        const owner = lead.employees?.name?.toLowerCase() ?? ''
        return party.includes(term) || site.includes(term) || owner.includes(term)
      })
    : leads

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
    if (isOwner && employeeFilter) {
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
  }, [isOwner, employeeFilter, employees, stageFilter, sourceFilter, statusFilter, minValueInput, maxValueInput])

  return (
    <div className="vip-card">
      <div className="vip-card-title">{isOwner ? 'All leads' : 'My leads'}</div>

      <input
        className="vip-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by party, site, or owner…"
      />

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
          {isOwner && employees.length > 0 && (
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
                  {stage}
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
              <input
                className="vip-input"
                type="number"
                min="0"
                placeholder="Min"
                value={minValueInput}
                onChange={(e) => setMinValueInput(e.target.value)}
              />
              <input
                className="vip-input"
                type="number"
                min="0"
                placeholder="Max"
                value={maxValueInput}
                onChange={(e) => setMaxValueInput(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {!loading && !error && leads.length > 0 && (
        <p className="vip-card-note">
          {filtered.length} of {leads.length} lead{leads.length === 1 ? '' : 's'}
        </p>
      )}

      {error && <p className="vip-error">{error}</p>}

      {loading ? (
        <p className="vip-empty">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="vip-empty">{leads.length === 0 ? 'No leads match these filters.' : 'No leads match your search.'}</p>
      ) : (
        filtered.map((lead) => (
          <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
            <div className="vip-row-main">
              <div className="vip-row-title">{partyLabel(lead)}</div>
              <div className="vip-row-sub">
                {lead.parties?.name && (lead.sites?.nickname || lead.sites?.locality) && (
                  <>{lead.sites?.nickname || lead.sites?.locality} · </>
                )}
                <EmployeeLink id={lead.owner_employee_id} name={lead.employees?.name} />
              </div>
              <div className="vip-row-meta">
                {SOURCE_TYPE_LABELS[lead.source_type] ?? lead.source_type ?? 'Unknown source'} · {formatShortDate(lead.created_at)}
              </div>
            </div>
            <div className="vip-row-side" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={stageChipClass(lead.current_stage ?? 'new')}>{lead.current_stage ?? 'new'}</span>
              <div className="vip-row-value">{formatCurrencyCompact(lead.order_value ?? lead.quote_value)}</div>
            </div>
          </Link>
        ))
      )}
    </div>
  )
}

export default LeadsListCard
