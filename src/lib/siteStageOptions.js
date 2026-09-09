// The CLOSED list of construction stages a site can be at.
//
// ⚠️ TWO-SIDED: this list is mirrored by `sites_site_stage_check` in
// Schema/migration_site_stage_check.sql. Adding or renaming a stage needs
// BOTH changed — app only, and every save of the new stage fails live with an
// opaque Postgres 23514; CHECK only, and nobody can pick it.
// siteStageClosedList.test.js fails if the two drift.
//
// It was free text with an "Other…" escape hatch on four screens until
// 2026-09-09 (the owner's ruling: "i do not want any other site stage other
// than the standard 5 that we are providing"). That was not a hypothetical
// tidy-up — free text fragmented the column badly enough that Dashboard's
// "Leads by site stage" card reported Plaster as 20 leads when it was really
// 88, split across PLASTER/Plaster/PLASTERING (see
// Schema/migration_normalize_site_stage.sql). Don't reintroduce an escape
// hatch here or in any consumer.
//
// Listed in construction order (DPC first, Flooring last), so a dropdown
// reads as a sequence rather than an arbitrary set. Values double as their
// own display text — every render site prints them raw, so there's no label
// map to keep in sync.
//
// These replaced an older foundation/structure/finishing/completed list on
// 2026-08-17. That swap needed no migration at the time, because the column
// was free text and an old value simply fell through to the "Other…" branch
// with its stored value intact. THAT IS NO LONGER THE FALLBACK — the hatch is
// gone, so a non-canonical stored value now renders as "— Not specified —"
// and would be nulled on the next save. Nothing relies on that today: the
// column was audited to zero off-list rows before the CHECK went on (the last
// straggler, one 'Finishing' row, was folded into 'Flooring' on 2026-09-09),
// and the constraint is what keeps it at zero. But if this list is ever
// changed again, MIGRATE THE DATA — a rename is no longer self-healing.
export const SITE_STAGE_OPTIONS = ['DPC', 'FF Slab', 'SF Slab', 'Plaster', 'Flooring']
