// Combined fetches for the screens that remember their data on the device
// (instant open — src/lib/queryClient.js, src/hooks/useCachedQuery.js).
//
// WHY THESE LIVE HERE AND NOT INSIDE THE SCREENS. Whatever a remembered query
// returns is saved as-is and painted by the NEXT build of the app too, as long
// as the files that shape that data haven't changed (the "data shape" stamp,
// scripts/dataShape.mjs). A screen that reshaped its data inline — two
// fetches merged into one object, a count turned into `data` — would change
// the saved shape without the stamp noticing. So every fetch a useCachedQuery
// call makes is a plain call to a function in a query module;
// src/lib/cachedQueryShape.test.js fails the build of any screen that doesn't.
import {
  fetchActivityCounts,
  fetchNewLeadsBySource,
  fetchClosureForecast,
  fetchLeadsList,
  resolveLeadsSearchFilter,
} from './dashboardQueries'
import { MIN_QUERY_LENGTH } from './searchQueries'
import { fetchWonStageHistory, fetchTargetsForPeriod } from './targetQueries'
import {
  countWaitingPoolLeads,
  fetchPoolLeads,
  fetchPossibleDuplicates,
  fetchBdmsArchitectMeetings,
  fetchClosedRows,
  fetchHandedOverRows,
} from './bdmQueries'
import {
  fetchPortfolioArchitects,
  fetchArchitectMeetings,
  fetchArchitect,
  fetchLeadsForArchitects,
  fetchAllPortfolioArchitects,
  fetchAllArchitects,
  fetchAllArchitectMeetings,
  fetchAllArchitectLeads,
} from './architectQueries'
import { countUnseenBdmUpdates } from './notificationQueries'
import { fetchRecentParties, searchParties, fetchLeadsForParties } from './partyQueries'
import { periodForPreset } from './targetPeriods'

// Dashboard: the date range's activities and new leads, as one answer.
export function fetchDashboardPeriod(range) {
  return Promise.all([fetchActivityCounts(range), fetchNewLeadsBySource(range)]).then(([activitiesRes, leadsRes]) => ({
    data: { activities: activitiesRes.data ?? [], leads: leadsRes.data ?? [] },
    error: activitiesRes.error ?? leadsRes.error ?? null,
  }))
}

// A rep's Today: the period's target bar and "Closing next" — won history,
// forecast and targets in one remembered answer per period.
export function fetchTargetBarBundle(period) {
  const targetPeriod = periodForPreset(period)
  return Promise.all([
    fetchWonStageHistory(),
    fetchClosureForecast(),
    targetPeriod ? fetchTargetsForPeriod(targetPeriod) : Promise.resolve({ data: [], error: null }),
  ]).then(([wonRes, forecastRes, targetsRes]) => ({
    data: { won: wonRes.data ?? [], forecast: forecastRes.data ?? [], targets: targetsRes.data ?? [] },
    error: null,
  }))
}

// BDM Today: how many of this BDM's leads wait for the owner, as `data`.
export function fetchWaitingPoolCount(bdmId) {
  return countWaitingPoolLeads(bdmId).then(({ count, error }) => ({ data: count ?? 0, error }))
}

// BDM Today: the portfolio and its meetings in one answer. Meetings stay raw
// rows (a Map can't be saved); the screen reduces them to "last met".
export async function fetchPortfolioWithMeetings(bdmId) {
  const { data, error } = await fetchPortfolioArchitects(bdmId)
  if (error) return { data: null, error }
  const meetings = await fetchArchitectMeetings(data.map((a) => a.id))
  return { data: { architects: data, meetings: meetings.data ?? [], meetingsError: meetings.error ?? null }, error: null }
}

// The owner's pool card: the pool plus possible-duplicate hints, the hints as
// entries rather than a Map. A failed duplicate lookup loses only the hints.
export async function fetchPoolWithDuplicates() {
  const pool = await fetchPoolLeads()
  if (pool.error) return pool
  const leads = pool.data ?? []
  const dupRes = leads.length ? await fetchPossibleDuplicates(leads) : { data: new Map(), error: null }
  return { data: { leads, duplicates: dupRes.error ? [] : [...dupRes.data.entries()] }, error: null }
}

// The BDM's "N updates on your leads" line, as `data`.
export function fetchUnseenBdmUpdatesCount() {
  return countUnseenBdmUpdates().then(({ count: n, error }) => ({ data: n ?? 0, error }))
}

// All Leads: one page of the filtered list. The free-text search is resolved
// to matching parties/sites/employees first (resolveLeadsSearchFilter), then
// the page is fetched — both steps unchanged from LeadsListCard's old effect.
export async function fetchLeadsListPage({ search, ...filters }) {
  const searchResult = search.trim().length >= MIN_QUERY_LENGTH ? await resolveLeadsSearchFilter(search) : null
  const { data, error, count } = await fetchLeadsList({ ...filters, searchOr: searchResult?.or ?? null })
  if (error) return { data: null, error }
  return { data: { leads: data ?? [], count: count ?? 0, searchCapped: searchResult?.capped ?? false }, error: null }
}

// Search's contacts directory: recent parties (or, from two characters, the
// parties matching the term), then the leads pointing at exactly those — one
// answer, so the leads are never a beat behind the parties on screen.
export async function fetchPartiesDirectory({ term, typeFilter }) {
  const partiesResult =
    term.trim().length >= MIN_QUERY_LENGTH
      ? await searchParties(term, typeFilter || null)
      : await fetchRecentParties(typeFilter || null).then(({ data, error }) => ({ data: data ?? [], error, capped: false }))
  if (partiesResult.error) return { data: null, error: partiesResult.error }
  const { data: leads, error: leadsError } = await fetchLeadsForParties(partiesResult.data.map((p) => p.id))
  return {
    data: { parties: partiesResult.data, capped: partiesResult.capped, leads: leadsError ? [] : leads ?? [] },
    error: null,
  }
}

// My Architects (BDM): the portfolio, its meetings and the leads credited to
// it — a BDM's own pool leads count, they're this BDM's pipeline. A failed
// meetings/leads read keeps the list and is reported as `partialError`.
export async function fetchMyArchitectsBundle(bdmId) {
  const { data, error } = await fetchPortfolioArchitects(bdmId)
  if (error) return { data: null, error }
  const ids = data.map((a) => a.id)
  const [meetingsRes, leadsRes] = await Promise.all([fetchArchitectMeetings(ids), fetchLeadsForArchitects(ids, true)])
  return {
    data: {
      architects: data,
      meetings: meetingsRes.data ?? [],
      leads: leadsRes.data ?? [],
      partialError: meetingsRes.error ?? leadsRes.error ?? null,
    },
    error: null,
  }
}

// An architect's profile: the party, then — only for an individual architect
// — their meetings and the leads naming them. `includePool` is true only for a
// BDM (pool leads are excluded from every other role's figures, poolLeads.js).
export async function fetchArchitectProfileBundle(architectId, includePool) {
  const { data: architect, error } = await fetchArchitect(architectId)
  if (error) return { data: null, error }
  if (!architect || architect.party_type !== 'architect') {
    return { data: { architect: architect ?? null, meetings: [], leads: [], partialError: null }, error: null }
  }
  const [meetingsRes, leadsRes] = await Promise.all([
    fetchArchitectMeetings([architectId]),
    fetchLeadsForArchitects([architectId], includePool),
  ])
  return {
    data: {
      architect,
      meetings: meetingsRes.data ?? [],
      leads: leadsRes.data ?? [],
      partialError: meetingsRes.error ?? leadsRes.error ?? null,
    },
    error: null,
  }
}

// Architect Network (owner), BDMs tab: every portfolio architect and their
// meetings. A failed half is reported as `partialError`, the rest still shows.
export async function fetchNetworkPortfolio() {
  const { data, error } = await fetchAllPortfolioArchitects()
  const meetings = await fetchArchitectMeetings((data ?? []).map((a) => a.id))
  return {
    data: { architects: data ?? [], meetings: meetings.data ?? [], partialError: error ?? meetings.error ?? null },
    error: null,
  }
}

// Architect Network, BDMs tab, for one date range: meetings, closed and
// handed-over rows across the given BDMs.
export async function fetchNetworkPeriod(bdmIds, range) {
  const [meetingsRes, closedRes, handedRes] = await Promise.all([
    fetchBdmsArchitectMeetings(bdmIds, range),
    fetchClosedRows(range, { taggedOnly: true }),
    fetchHandedOverRows(range),
  ])
  return {
    data: {
      meetings: meetingsRes.data ?? [],
      closed: closedRes.data ?? { stageRows: [], lossRows: [] },
      handedOver: handedRes.data ?? [],
      partialError: meetingsRes.error ?? closedRes.error ?? handedRes.error ?? null,
    },
    error: null,
  }
}

// Architect Network, Architects/Firms tabs: one read of architects, meetings
// and leads feeds both rollups.
export async function fetchArchitectDirectoryData() {
  const [architectsRes, meetingsRes, leadsRes] = await Promise.all([
    fetchAllArchitects(),
    fetchAllArchitectMeetings(),
    fetchAllArchitectLeads(),
  ])
  return {
    data: {
      architects: architectsRes.data,
      meetings: meetingsRes.data,
      leads: leadsRes.data,
      partialError: architectsRes.error ?? meetingsRes.error ?? leadsRes.error ?? null,
    },
    error: null,
  }
}
