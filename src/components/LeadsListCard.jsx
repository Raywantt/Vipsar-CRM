import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import {
  fetchLeadsList,
  fetchLastActivityPerLead,
  resolveLeadsSearchFilter,
  LEADS_PAGE_SIZE,
  SITE_STAGE_UNSET,
} from '../lib/dashboardQueries'
import { MIN_QUERY_LENGTH } from '../lib/searchQueries'
import { stageChipClass } from '../lib/statusColors'
import { STALE_DAYS, staleGateDays } from '../lib/attention'
import { LEAD_STAGE_OPTIONS, stageLabel } from '../lib/leadStageOptions'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { SOURCE_TYPE_OPTIONS, SOURCE_TYPE_LABELS } from '../lib/sourceTypeOptions'
import { formatCurrencyCompact } from '../lib/format'
import NumPadInput from './NumPadInput'
import { dealValueOrNull } from '../lib/pipelineValue'
import EmployeeLink from './EmployeeLink'
import { errorMessage } from '../lib/errorMessage'

// "touched today" / "Nd ago", turning "Nd silent" + red past STALE_DAYS —
// same threshold attention.js already uses elsewhere, not a second
// definition of staleness.
//
// Real bug fixed here: a lead with no logged activity AND a null
// created_at (confirmed live on lead #402/"VINAY") used to fall through to
// new Date(null) — epoch, 1970 — rendering as "20687d silent". lastAt can
// genuinely be null now that both sources of it can be missing, so it's
// checked before doing date math instead of assumed present the way
// attention.js's daysSince already treats the same fallback chain.
function recencyInfo(lead, lastActivityByLead) {
  const lastAt = lastActivityByLead.get(lead.id) ?? lead.created_at
  if (!lastAt) return { label: 'no activity on record', isStale: false }
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000)
  // Gate on the floored age, label with the real one — see HISTORY_STARTS_AT
  // in attention.js. Without this a legacy lead reads a red "847d silent"
  // here while Needs Attention correctly reports nothing to do.
  const gate = staleGateDays(lastActivityByLead.get(lead.id) ?? null, lead.created_at, lead)
  const isStale = gate != null && gate >= STALE_DAYS
  return { label: isStale ? `${days}d silent` : days <= 0 ? 'touched today' : `${days}d ago`, isStale }
}

// Debounce the two free-typed value inputs and the search box — a
// select/chip/segmented click should refetch instantly, same split
// PartySearchOrCreate already draws between debounced text search and
// immediate controls. Search now hits the database (resolveLeadsSearchFilter
// below), so it needs the same debounce discipline the value inputs already
// have — same 350ms searchQueries.js/PartySearchOrCreate use elsewhere.
const VALUE_DEBOUNCE_MS = 400
const SEARCH_DEBOUNCE_MS = 350

function partyLabel(lead) {
  return lead.parties?.name ?? (lead.sites?.nickname || lead.sites?.locality) ?? '(no party)'
}

// Desktop's dedicated Site column, now that Party/Site render separately
// there instead of falling back into one combined line the way the mobile
// list's single row still does.
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
// '—' rather than ₹0 — see pipelineValue.js.
function formatLeadValue(lead) {
  const v = dealValueOrNull(lead)
  return v == null ? '—' : formatCurrencyCompact(v)
}

// Persisted across a "click into a lead, then Back" round trip, reset on a
// fresh nav-link visit — see usePersistedFilterState's own header comment.
const FILTERS_STORAGE_KEY = 'vip-filters:leads-list'

function LeadsListCard({ showOwnerFilter, employees, title, ownerScopeIds, managerScope, onManagerScopeChange }) {
  const [employeeFilter, setEmployeeFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'employeeFilter', '')
  const [stageFilter, setStageFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'stageFilter', '')
  const [siteStageFilter, setSiteStageFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'siteStageFilter', '')
  const [sourceFilter, setSourceFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'sourceFilter', '')
  const [statusFilter, setStatusFilter] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'statusFilter', '')
  const [minValueInput, setMinValueInput] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'minValueInput', '')
  const [maxValueInput, setMaxValueInput] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'maxValueInput', '')
  const [minValue, setMinValue] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'minValue', '')
  const [maxValue, setMaxValue] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'maxValue', '')
  const [filtersOpen, setFiltersOpen] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'filtersOpen', false)
  const [search, setSearch] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'search', '')
  const [page, setPage] = usePersistedFilterState(FILTERS_STORAGE_KEY, 'page', 0)

  // Not persisted — derived from `search` (which is) via the debounce effect
  // below. Seeded from search's own restored value so a POP-navigation
  // round trip doesn't wait out a debounce delay before showing the right
  // page again.
  const [debouncedSearch, setDebouncedSearch] = useState(search)

  const [leads, setLeads] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())
  // True when the current search term matched more parties/sites/employees
  // than resolveLeadsSearchFilter's per-table cap (50) — the results below
  // are then only a subset of everything that actually matches, and saying
  // so beats letting a partial list look like the complete answer.
  const [searchCapped, setSearchCapped] = useState(false)

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
    const timeout = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [search])

  // Any real change to a filter or the search term invalidates whatever page
  // we were on — a page number that made sense against the old result set
  // can easily be past the end of (or just wrong for) the new one. This is
  // computed and used INLINE in the same effect that fetches, not as a
  // separate effect that calls setPage(0) — two effects both reacting to a
  // filter change is a real race: the fetch effect could still run once with
  // the OLD page number against the NEW (smaller) filtered set, requesting a
  // .range() past the end and getting a PostgREST 416 (reproduced live while
  // building this — going to page 2, then applying a filter, occasionally
  // sent `range=50-99` against an 11-row result). Comparing a `filtersKey`
  // inside this one effect means the corrected page is used for the very
  // fetch that detects the change, not a follow-up one. `null` on the first
  // run (not "the empty-string combination") is what makes a POP-restored
  // page survive a Back navigation instead of being reset to 0 the instant
  // this mounts.
  const lastFiltersKeyRef = useRef(null)

  // ownerScopeIds (a sales manager's My-leads/Team-leads toggle, see
  // Dashboard.jsx) restricts the query to a SET of owners rather than the
  // single one `employeeFilter`'s dropdown picks — RLS alone can't express
  // "just my own" vs "just my team's" for a manager, since both are
  // legitimately visible to them. A scope of exactly one id (My leads) always
  // wins over whatever `employeeFilter` happens to hold — there's nothing
  // else it could mean. A wider scope (Team leads) only applies when no
  // specific team member is picked; picking one narrows further, the same
  // way an owner's or coordinator's employeeFilter always has.
  const singleOwnerScope = ownerScopeIds && ownerScopeIds.length === 1
  const effectiveEmployeeId = singleOwnerScope ? ownerScopeIds[0] : employeeFilter || null
  const effectiveEmployeeIds = !singleOwnerScope && ownerScopeIds && !employeeFilter ? ownerScopeIds : null

  useEffect(() => {
    let active = true
    setLoading(true)

    const filtersKey = JSON.stringify([
      effectiveEmployeeId,
      effectiveEmployeeIds,
      stageFilter,
      siteStageFilter,
      sourceFilter,
      statusFilter,
      minValue,
      maxValue,
      debouncedSearch,
    ])
    const filtersChanged = lastFiltersKeyRef.current !== null && lastFiltersKeyRef.current !== filtersKey
    lastFiltersKeyRef.current = filtersKey
    const effectivePage = filtersChanged ? 0 : page
    if (filtersChanged && page !== 0) setPage(0)

    async function run() {
      const searchResult =
        debouncedSearch.trim().length >= MIN_QUERY_LENGTH ? await resolveLeadsSearchFilter(debouncedSearch) : null
      if (!active) return
      setSearchCapped(searchResult?.capped ?? false)

      const { data, error, count } = await fetchLeadsList({
        employeeId: effectiveEmployeeId,
        employeeIds: effectiveEmployeeIds,
        stage: stageFilter || null,
        siteStage: siteStageFilter || null,
        source: sourceFilter || null,
        status: statusFilter || null,
        minValue: minValue !== '' ? Number(minValue) : null,
        maxValue: maxValue !== '' ? Number(maxValue) : null,
        searchOr: searchResult?.or ?? null,
        page: effectivePage,
      })
      if (!active) return
      setLoading(false)
      if (error) {
        setError(errorMessage(error))
      } else {
        setError(null)
        setLeads(data ?? [])
        setTotalCount(count ?? 0)
      }
    }

    run()

    return () => {
      active = false
    }
    // setPage comes from usePersistedFilterState, which wraps useState —
    // stable across renders same as any useState setter, listed for the
    // linter only.
  }, [
    effectiveEmployeeId,
    effectiveEmployeeIds,
    stageFilter,
    siteStageFilter,
    sourceFilter,
    statusFilter,
    minValue,
    maxValue,
    debouncedSearch,
    page,
    setPage,
  ])

  // Powers the "last touch" / recency line — independent of the filters
  // above (last-activity data doesn't change per filter), so fetched once
  // rather than refetched alongside leads.
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

  // `leads` is already server-filtered, server-searched (resolveLeadsSearchFilter)
  // and server-paginated by the fetch effect above — no client-side
  // re-filtering, and no client-side grouping either: the mobile list is a
  // flat, one-row-per-lead list now (the owner's call, 2026-09-09). The old
  // grouped-by-stage view spent a full sticky header on every stage present
  // in the page, which on a mixed page meant more header than list; the
  // stage is a chip on the row itself instead.

  function clearAllFilters() {
    setEmployeeFilter('')
    setStageFilter('')
    setSiteStageFilter('')
    setSourceFilter('')
    setMinValueInput('')
    setMaxValueInput('')
  }

  // Status is deliberately NOT one of these — it's a permanently visible
  // segmented control in the toolbar at both widths, so a chip restating it
  // would be duplicate chrome. These chips only ever summarise facets that
  // are hidden behind the mobile disclosure.
  const activeChips = useMemo(() => {
    const chips = []
    if (showOwnerFilter && employeeFilter) {
      const emp = employees.find((e) => String(e.id) === employeeFilter)
      if (emp) chips.push({ key: 'owner', label: `Owner: ${emp.name.split(' ')[0]}`, onRemove: () => setEmployeeFilter('') })
    }
    if (stageFilter) chips.push({ key: 'stage', label: `Stage: ${stageLabel(stageFilter)}`, onRemove: () => setStageFilter('') })
    if (siteStageFilter) {
      chips.push({
        key: 'siteStage',
        label: `Site: ${siteStageFilter === SITE_STAGE_UNSET ? 'Not set' : siteStageFilter}`,
        onRemove: () => setSiteStageFilter(''),
      })
    }
    if (sourceFilter) {
      chips.push({
        key: 'source',
        label: `Source: ${SOURCE_TYPE_LABELS[sourceFilter] ?? sourceFilter}`,
        onRemove: () => setSourceFilter(''),
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
    siteStageFilter,
    sourceFilter,
    minValueInput,
    maxValueInput,
    setEmployeeFilter,
    setStageFilter,
    setSiteStageFilter,
    setSourceFilter,
    setMinValueInput,
    setMaxValueInput,
  ])

  // Each facet is defined ONCE here and composed into two arrangements
  // below — a permanently-visible horizontal toolbar at >=1024px, and a
  // disclosure panel on a phone (where six controls in a row is not a
  // layout). Same "one definition, two placements" rule the previous
  // rail/panel split already followed, just per-field instead of one
  // monolithic block, so a field can move between the two arrangements
  // without being duplicated.
  //
  // managerScope/onManagerScopeChange are only ever passed for a sales
  // manager — RLS alone can't say "just my own" vs "just my team's" for
  // that role, since both are legitimately visible to them (see
  // ownerScopeIds above).
  const isTeamScope = managerScope === 'team'

  const scopeField = onManagerScopeChange && (
    <div className="vip-filter-field">
      <span className="vip-fact-label">Whose leads</span>
      <div className="vip-seg vip-seg-outline">
        <button
          type="button"
          className={managerScope === 'my' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
          onClick={() => onManagerScopeChange('my')}
        >
          Mine
        </button>
        <button
          type="button"
          className={isTeamScope ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
          onClick={() => onManagerScopeChange('team')}
        >
          Team
        </button>
      </div>
    </div>
  )

  // Owner is a plain dropdown at every team size now. It used to switch to
  // segmented buttons for a team of <=4, which read as a different KIND of
  // control sitting among five dropdowns; one shape for one job is what
  // makes a filter row scannable.
  const ownerField = showOwnerFilter && employees.length > 0 && (
    <div className="vip-filter-field">
      <span className="vip-fact-label">Owner</span>
      <select className="vip-select" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
        <option value="">All owners</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  )

  // Was a wrap of nine tappable stage chips — the tallest thing in the old
  // filter rail by a wide margin, and the specific complaint that started
  // this redesign. One dropdown, same nine options.
  const stageField = (
    <div className="vip-filter-field">
      <span className="vip-fact-label">Lead stage</span>
      <select className="vip-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
        <option value="">All stages</option>
        {LEAD_STAGE_OPTIONS.map((stage) => (
          <option key={stage} value={stage}>
            {stageLabel(stage)}
          </option>
        ))}
      </select>
    </div>
  )

  const siteStageField = (
    <div className="vip-filter-field">
      <span className="vip-fact-label">Site stage</span>
      <select className="vip-select" value={siteStageFilter} onChange={(e) => setSiteStageFilter(e.target.value)}>
        <option value="">All site stages</option>
        {SITE_STAGE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        <option value={SITE_STAGE_UNSET}>Not set</option>
      </select>
    </div>
  )

  const sourceField = (
    <div className="vip-filter-field">
      <span className="vip-fact-label">Source</span>
      <select className="vip-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
        <option value="">All sources</option>
        {SOURCE_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )

  const valueField = (
    <div className="vip-filter-field vip-filter-field-wide">
      <span className="vip-fact-label">Quote value (₹)</span>
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
  )

  // "Which slice of the pipeline am I looking at" is the one question asked
  // on nearly every visit, so it sits in the toolbar's top row at BOTH
  // widths rather than behind the mobile disclosure with the rest.
  // "Inactive" was renamed "Closed" — it always meant won-or-lost, and
  // "inactive" reads like a dormant lead, which is what the Stale label
  // elsewhere in this app actually means.
  const statusField = (
    <div className="vip-seg vip-seg-outline vip-leads-status">
      {[
        ['', 'All'],
        ['active', 'Active'],
        ['inactive', 'Closed'],
      ].map(([value, label]) => (
        <button
          key={label}
          type="button"
          className={statusFilter === value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
          onClick={() => setStatusFilter(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const hiddenFacets = (
    <>
      {scopeField}
      {ownerField}
      {stageField}
      {siteStageField}
      {sourceField}
      {valueField}
    </>
  )

  // True total from the server (`count: 'exact'`, computed after every
  // filter/search but before .range()) — not leads.length, which is only
  // ever at most one page's worth. This is the fix for the old "X of 100"
  // readout that could never say how many leads actually existed.
  const rangeStart = totalCount === 0 ? 0 : page * LEADS_PAGE_SIZE + 1
  const rangeEnd = page * LEADS_PAGE_SIZE + leads.length
  const totalPages = Math.max(1, Math.ceil(totalCount / LEADS_PAGE_SIZE))

  const listStatus = (
    <>
      {!loading && !error && (
        <p className="vip-card-note">
          {totalCount === 0
            ? 'No leads'
            : `${rangeStart}–${rangeEnd} of ${totalCount} lead${totalCount === 1 ? '' : 's'}`}
        </p>
      )}
      {error && <p className="vip-error" role="alert">{error}</p>}
    </>
  )

  // Plainest functional pagination — Prev/Next + a page count, existing
  // vip-btn classes only. Only shown once there's a second page to go to.
  const paginationBar = totalPages > 1 && (
    <div className="vip-btn-row" style={{ marginTop: 10 }}>
      <button
        type="button"
        className="vip-btn vip-btn-secondary vip-btn-sm"
        disabled={page <= 0}
        onClick={() => setPage(page - 1)}
      >
        ‹ Prev
      </button>
      <span className="vip-card-note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Page {page + 1} of {totalPages}
      </span>
      <button
        type="button"
        className="vip-btn vip-btn-secondary vip-btn-sm"
        disabled={page + 1 >= totalPages}
        onClick={() => setPage(page + 1)}
      >
        Next ›
      </button>
    </div>
  )

  const emptyOrLoading = loading ? (
    <p className="vip-empty">Loading…</p>
  ) : leads.length === 0 ? (
    <p className="vip-empty">No leads match these filters.</p>
  ) : null

  return (
    <div className="vip-card">
      <div className="vip-card-title">{title}</div>

      {/* One toolbar, both widths: search + status always visible, the
          remaining facets laid out beneath it (desktop) or folded behind a
          Filters toggle (mobile). This replaced a 240px sticky left rail —
          eight columns need the width far more than six permanently
          on-screen dropdowns do. */}
      <div className="vip-leads-toolbar">
        <div className="vip-leads-toolbar-top">
          <input
            className="vip-input vip-leads-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by party, site, or owner…"
          />
          {statusField}
        </div>

        {/* Desktop: every remaining facet, permanently visible in one row. */}
        <div className="vip-only-desktop vip-leads-filterbar">
          {hiddenFacets}
          {activeChips.length > 0 && (
            <button type="button" className="vip-action-close vip-leads-clear" onClick={clearAllFilters}>
              Clear filters
            </button>
          )}
        </div>

        {/* Mobile: the same facets behind a toggle, with the active ones
            summarised as removable chips while it's closed. */}
        <div className="vip-only-mobile vip-stack-s">
          <div className="vip-leads-toolbar-mobile">
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

          {filtersOpen && <div className="vip-leads-filterpanel">{hiddenFacets}</div>}
        </div>
      </div>

      {searchCapped && (
        <p className="vip-form-note">
          Showing the first 50 matches per category — refine your search for a complete list.
        </p>
      )}

      {listStatus}

      {/* Mobile: one flat row per lead. The stage rides along as a chip on
          the row rather than as a section header above a group of them. */}
      <div className="vip-only-mobile">
        {emptyOrLoading ?? (
          <>
            <div className="vip-lead-list">
              {leads.map((lead) => {
                const recency = recencyInfo(lead, lastActivityByLead)
                const stage = lead.current_stage ?? 'calling'
                return (
                  <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-lead-row">
                    <div className="vip-lead-row-main">
                      <div className="vip-lead-row-party">{partyLabel(lead)}</div>
                      {/* Both stages ride as tags, matching the two stage
                          columns on desktop — the site stage was originally
                          folded into the text line below, where a long site
                          name (a full address, routinely 300px+) truncated
                          it away on exactly the rows it was added for. A tag
                          can't be truncated out by its neighbour's length. */}
                      <div className="vip-lead-row-meta">
                        <span className={stageChipClass(stage)}>{stageLabel(stage)}</span>
                        {lead.sites?.site_stage && (
                          <span className="vip-sitestage-tag">{lead.sites.site_stage}</span>
                        )}
                        <span className="vip-lead-row-sub">
                          {[
                            lead.sites?.nickname || lead.sites?.locality,
                            SOURCE_TYPE_LABELS[lead.source_type] ?? lead.source_type,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                    </div>
                    <div className="vip-lead-row-side">
                      <div className="vip-lead-row-value">{formatLeadValue(lead)}</div>
                      <div className={recency.isStale ? 'vip-lead-row-recency vip-stale' : 'vip-lead-row-recency'}>
                        {recency.label}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
            {paginationBar}
          </>
        )}
      </div>

      {/* Desktop: eight real columns across the card's full width. */}
      <div className="vip-only-desktop vip-leads-main">
        {emptyOrLoading ?? (
          <>
            <div className="vip-leadrow-head">
              <span>Party</span>
              <span>Site</span>
              <span>Owner</span>
              <span>Stage</span>
              <span>Site stage</span>
              <span>Source</span>
              <span className="vip-leadrow-num">Value</span>
              <span className="vip-leadrow-num">Last touch</span>
            </div>
            {leads.map((lead) => {
              const recency = recencyInfo(lead, lastActivityByLead)
              const siteStage = lead.sites?.site_stage
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
                  {/* A neutral tag, never a coloured one: the lead stage
                      beside it is the row's one colour-carrying signal, and
                      a second tinted pill is exactly the noise this redesign
                      set out to remove. */}
                  <span className="vip-leadrow-cell">
                    {siteStage ? <span className="vip-sitestage-tag">{siteStage}</span> : '—'}
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
            {paginationBar}
          </>
        )}
      </div>
    </div>
  )
}

export default LeadsListCard
