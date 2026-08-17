// site_stage is deliberately free text on the sites table (not a CHECK
// enum) — this is just the app-layer preset list shown in dropdowns, with
// an "other" escape hatch for anything not covered here.
//
// Listed in construction order (DPC first, Flooring last), so a dropdown
// reads as a sequence rather than an arbitrary set. Values double as their
// own display text — every render site prints them raw, so there's no label
// map to keep in sync.
//
// These replaced an older foundation/structure/finishing/completed list.
// No migration was needed (the column is free text) and no data was lost:
// a site still carrying an old value falls through to the "Other…" branch
// in SiteDetailsSection/ActivityLog with its stored value intact, and the
// Dashboard's "Leads by site stage" card discovers it as its own row.
export const SITE_STAGE_OPTIONS = ['DPC', 'FF Slab', 'SF Slab', 'Plaster', 'Flooring']
