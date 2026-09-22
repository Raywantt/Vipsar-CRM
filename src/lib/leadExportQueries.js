import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'
import {
  applyLeadsListFilters,
  fetchLastActivityPerLead,
  leadsListSitesEmbed,
  resolveLeadsSearchFilter,
} from './dashboardQueries'
import { MIN_QUERY_LENGTH } from './searchQueries'
import { attachFirms, PARTY_COLUMNS } from './partyQueries'

// All Leads' "Download Excel" (owner only, desktop only — roles.js's
// canExportLeads). Reads EVERY lead matching the filters on screen, not the 50
// the screen shows, plus whatever the chosen columns need. Runs only when the
// owner presses Download, never on mount, and nothing here is cached or
// remembered on the device: a spreadsheet of client phone numbers should be
// fetched fresh and then forgotten.

// Smaller than fetchAllRows' 1,000 because every row here carries three party
// embeds, the site with its contacts, and three employee names — a lighter
// response per request under the 8s statement timeout.
const EXPORT_PAGE_SIZE = 500

// How many lead ids go into one `.in()` for the per-lead extras (remarks,
// activity notes). 400 ids is ~2KB of URL, well clear of proxy limits; the
// chunks run one after another, so a big export is a short queue of requests
// rather than a burst (see CLAUDE.md's 25P02 note). Measured 2026-09-22 on
// all 1,338 leads with every column: 200 made 14 extra requests and ~7.5s.
const ID_CHUNK = 400

const EXPORT_SITE_COLUMNS = `id, nickname, locality, house_no, pincode, site_stage, areas(area_name), site_contacts(role, parties(${PARTY_COLUMNS}))`

// Every lead's three party slots are embedded: the architect can sit in any of
// them (referrer on an architect referral, the "other party" from capture, or
// party_id itself on an imported lead), or on the site as a contact.
function exportSelect(siteStage) {
  return [
    'id, current_stage, source_type, office_territory, order_value, quote_value, closure_probability, estimated_close_date, next_followup_date, rfq_raised_at, quote_sent_at, created_at, owner_employee_id, bdm_employee_id',
    `parties!party_id(${PARTY_COLUMNS})`,
    `referrer:parties!referred_by_party_id(${PARTY_COLUMNS})`,
    `other_party:parties!other_party_id(${PARTY_COLUMNS})`,
    'referrer_employee:employees!referred_by_employee_id(name)',
    'bdm:employees!bdm_employee_id(name)',
    'employees!owner_employee_id(name)',
    'products!product_id(name)',
    leadsListSitesEmbed(siteStage, EXPORT_SITE_COLUMNS),
  ].join(', ')
}

// The leads themselves, newest first — the list's own order. `filters` is the
// exact object LeadsListCard fetches its page with (page number ignored), run
// through the same applyLeadsListFilters, so the file matches the screen.
export async function fetchLeadsForExport({ search = '', siteStage, ...filters }) {
  const searchResult = search.trim().length >= MIN_QUERY_LENGTH ? await resolveLeadsSearchFilter(search) : null
  const result = await fetchAllRows(
    () =>
      applyLeadsListFilters(supabase.from('leads').select(exportSelect(siteStage), { count: 'exact' }), {
        ...filters,
        siteStage,
        searchOr: searchResult?.or ?? null,
      }).order('created_at', { ascending: false }),
    { ascending: false, pageSize: EXPORT_PAGE_SIZE }
  )
  if (result.error) return { data: null, error: result.error }
  return { data: { leads: result.data ?? [], searchCapped: searchResult?.capped ?? false }, error: null }
}

function chunk(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK))
  return out
}

// "First row per lead wins" over a newest-first read, chunk by chunk.
// `fetchChunk(ids)` returns a fetchAllRows() result for one chunk of ids.
async function latestPerLead(leadIds, fetchChunk) {
  const byLead = new Map()
  for (const ids of chunk(leadIds)) {
    const { data, error } = await fetchChunk(ids)
    if (error) return { data: null, error }
    for (const row of data ?? []) if (!byLead.has(row.lead_id)) byLead.set(row.lead_id, row)
  }
  return { data: byLead, error: null }
}

// Descending id tiebreaker for both: rows sharing a timestamp still hand the
// later-inserted one to "first row per lead wins" (see fetchAllRows.js).
function fetchLatestRemarks(leadIds) {
  return latestPerLead(leadIds, (ids) =>
    fetchAllRows(
      () =>
        supabase
          .from('lead_remarks')
          .select('lead_id, body, created_at, employees(name)', { count: 'exact' })
          .in('lead_id', ids)
          .order('created_at', { ascending: false }),
      { ascending: false }
    )
  )
}

// The most recent activity that says something — an activity logged with no
// note is skipped rather than reported as the latest (blank) one.
function fetchLatestActivityNotes(leadIds) {
  return latestPerLead(leadIds, (ids) =>
    fetchAllRows(
      () =>
        supabase
          .from('activities')
          .select('lead_id, activity_type, notes, created_at', { count: 'exact' })
          .in('lead_id', ids)
          .not('notes', 'is', null)
          .neq('notes', '')
          .order('created_at', { ascending: false }),
      { ascending: false }
    )
  )
}

// Map(lead_id -> latest activity timestamp), from the same cached source All
// Leads' own "Last touch" column reads.
async function fetchLastActivityMap() {
  const { data, error } = await fetchLastActivityPerLead()
  if (error) return { data: null, error }
  const map = new Map()
  for (const row of data ?? []) {
    const existing = map.get(row.lead_id)
    if (!existing || new Date(row.created_at) > new Date(existing)) map.set(row.lead_id, row.created_at)
  }
  return { data: map, error: null }
}

// Map(firm party id -> firm) for every architect on these leads that links to
// one. attachFirms is the two-query resolver (a self-referencing FK can't be
// embedded — see partyQueries.js).
async function fetchFirms(leads) {
  const parties = new Map()
  const add = (p) => {
    if (p?.firm_party_id) parties.set(p.id, p)
  }
  for (const lead of leads) {
    add(lead.parties)
    add(lead.referrer)
    add(lead.other_party)
    for (const c of lead.sites?.site_contacts ?? []) add(c.parties)
  }
  if (parties.size === 0) return { data: new Map(), error: null }
  const withFirms = await attachFirms([...parties.values()])
  const firms = new Map()
  for (const p of withFirms) if (p.firm) firms.set(p.firm_party_id, p.firm)
  return { data: firms, error: null }
}

// The extras a column set needs, fetched one after another and each failing
// SOFT: a failed remark read leaves that column blank and says so in the file,
// rather than losing the whole export. `needs` is leadExport.js's
// extrasNeededFor(columnIds); `onStep(label)` is told which read is running,
// so the panel can say what it's actually waiting on.
export async function fetchExportExtras(leads, needs, onStep = () => {}) {
  const ids = leads.map((l) => l.id)
  const extras = { lastTouch: new Map(), remarks: new Map(), notes: new Map(), firms: new Map() }
  const failed = []

  const steps = [
    ['firms', 'architect firms', () => fetchFirms(leads)],
    ['lastTouch', 'last touch dates', fetchLastActivityMap],
    ['remarks', 'latest remarks', () => fetchLatestRemarks(ids)],
    ['notes', 'activity notes', () => fetchLatestActivityNotes(ids)],
  ]
  for (const [key, label, run] of steps) {
    if (!needs[key] || ids.length === 0) continue
    onStep(label)
    try {
      const { data, error } = await run()
      if (error) failed.push(label)
      else extras[key] = data
    } catch {
      failed.push(label)
    }
  }
  return { ...extras, failed }
}
