// The Office filter every dashboard popup carries.
//
// A popup (DrilldownPanel) is built by a pure `build*Panel` function out of
// rows the screen already holds: leads, stage changes, activities, loss rows,
// RPC detail rows. None of those rows carries the lead's office except the
// leads themselves, so a popup cannot filter its own rows by office — and
// picking an office has to change EVERY figure in it (header, stat tiles,
// charts, breakdowns, lists), not only the list, so the panel has to be built
// again from narrower rows.
//
// That is what this file does, in three parts:
//
//   1. A DIRECTORY — lead id → office, one tiny lookup (`fetchLeadOffices`)
//      shared by every screen — so a stage-history row, an activity or an RPC
//      row (all of which know their lead's id and nothing else) can be placed.
//   2. A SCOPE — "keep only the rows whose lead is in this office", built from
//      a chosen key and the directory. Builders' adapters call it.
//   3. `officeAware(build, adapter)` — wraps one `build*Panel` so the panel it
//      returns carries `panel.office`, a description of how to build the same
//      panel again for a chosen office. DrilldownPanel reads that and draws the
//      Office chips; no screen that opens a popup has to know any of this.
//
// An office is one of TERRITORY_OPTIONS' values, or OFFICE_NONE ("Not set" —
// the column is nullable, so every lead created before it existed has none).
import { TERRITORY_OPTIONS, territoryLabel } from './territoryOptions'

export const OFFICE_ALL = ''
// Same word the Orders booked / New leads popups use for a lead with no office.
export const OFFICE_NONE = 'none'

export const officeChipLabel = (key) => (key === OFFICE_NONE ? 'Not set' : territoryLabel(key))

// rows: [{ id, office_territory }] → Map<String(id), territory | null>.
// Ids are numbers in the rows and strings once they have been through a
// <select> or a Map key, so the directory is keyed by String(id) throughout.
export function buildOfficeDirectory(rows) {
  const directory = new Map()
  ;(rows ?? []).forEach((r) => directory.set(String(r.id), r.office_territory ?? null))
  return directory
}

// The office key a lead belongs to. A lead the directory has never heard of
// (the viewer can't read it, or it arrived after the directory loaded) counts
// as "Not set" — it has no office we can name, and dropping it silently would
// make a filtered total quietly smaller than the rows it was built from.
function officeKeyOf(directory, leadId) {
  return directory.get(String(leadId)) ?? OFFICE_NONE
}

// `rows(list, idOf)` is the one operation adapters need: keep the rows whose
// lead is in the chosen office. A row with NO lead (an Office Day, an
// architect meeting) belongs to no office, so it is kept only while no office
// is chosen — it never appears under "Not set", which means "a lead with no
// office", not "no lead".
export function createOfficeScope(key, directory) {
  const active = key !== OFFICE_ALL
  const keep = (leadId) => !active || (leadId != null && officeKeyOf(directory, leadId) === key)
  return {
    key,
    active,
    keep,
    rows: (list, idOf) => (active ? (list ?? []).filter((r) => keep(idOf(r))) : (list ?? [])),
    leads: (list) => (active ? (list ?? []).filter((l) => keep(l.id)) : (list ?? [])),
  }
}

// The chips for a popup: only the offices that actually appear among the lead
// ids the popup is made of, in the app's fixed office order, "Not set" last.
export function officeChoices(leadIds, directory) {
  const seen = new Set()
  for (const id of leadIds) if (id != null) seen.add(officeKeyOf(directory, id))
  const choices = TERRITORY_OPTIONS.filter((t) => seen.has(t.value)).map((t) => ({ key: t.value, label: t.label }))
  if (seen.has(OFFICE_NONE)) choices.push({ key: OFFICE_NONE, label: 'Not set' })
  return choices
}

// Wraps one panel builder.
//
//   build       the builder, unchanged — called with the caller's arguments.
//   leadIds     (...args) → the lead ids the popup is made of; decides which
//               office chips are offered.
//   narrow      (scope, ...args) → the SAME argument list with every lead-bearing
//               input cut down to the chosen office. Pure.
//   available   (...args) → false when this call can't be narrowed (the extra
//               input it needs wasn't passed); the panel then has no Office chips.
//   hidesTargets  true when the builder is told to drop its targets while an
//               office is chosen. Targets are set per person across every
//               office, so "12 of 40" for one office would be a lie; the popup
//               says so under the chips.
//
// The wrapped builder returns exactly what the original did, plus `panel.office`.
export function officeAware(build, { leadIds, narrow, available = () => true, hidesTargets = false }) {
  return function buildWithOffice(...args) {
    const panel = build(...args)
    if (!panel || !available(...args)) return panel
    panel.office = {
      leadIds: () => leadIds(...args),
      hidesTargets,
      rebuild: (scope) => build(...narrow(scope, ...args)),
    }
    return panel
  }
}
