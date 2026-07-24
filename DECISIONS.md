# DECISIONS.md

Domain model, lead-sourcing logic, and locked-in design decisions for the Tostem CRM — split out of CLAUDE.md to keep that file lean. See CLAUDE.md for stack/structure/commands/conventions.

## Domain model

Four core entities, all independent, linked by foreign keys — never by retyping names or addresses:

* `parties` — every person/firm we deal with (client, architect, builder, firm). One row per person, ever.
* `sites` — a physical property/project. Independent of parties; can exist with zero known contacts (e.g. a plot spotted while scanning, owner unknown).
* `site_contacts` — many-to-many join between sites and parties, with a role (owner/architect/builder/project_manager/site_staff/other). Fills in progressively as contacts are discovered — this is how "unknown until later" gets resolved.
* `leads` — one row per opportunity. Requires EITHER `site_id` OR `party_id`, never both mandatory. Which one is known first depends on the lead source (see below).

Full schema and comments: `Schema/tostem_crm_schema.sql`.

### Why leads can start with just a site OR just a party

Three lead sources, each surfaces different information first:

* Scanning (sales exec finds a plot in person) → site known, party usually unknown at first.
* Lixil-provided leads → only a client name (sometimes a number) — party known, no site yet.
* Architect referrals → architect's details + client's name — party known (often two parties), no site yet.

`leads.source_type` records which of these it was. Never make `site_id` or `party_id` NOT NULL on `leads` — both must stay optional, enforced instead by the `lead_needs_an_anchor` CHECK constraint (at least one required).

## Design decisions — don't reverse these without discussion

* No GPS, no geocoding API, no fuzzy-matching database extension (pg_trgm). Deliberately dropped as unnecessary/costly for v1. Duplicate-checking is a "search before create" UI pattern (search parties by name/mobile, search sites by locality/plot number before creating a new row) — a human decides, the database doesn't auto-merge or block.
* No UNIQUE constraint on `parties.mobile`. Shared household/family numbers are common; a hard constraint would reject valid entries.
* `current_stage` and `site_stage` are free text, not a CHECK enum. The dealer's own stage vocabulary is specific and still evolving — standardize the list at the application layer, not the database layer.
* Marking a lead `lost` requires a `loss_reasons` entry — no "skip for now" escape hatch. A rep must always account for why a lead was lost; don't reintroduce a skip option without checking with the user first.
* Budget constraint: stay on free tiers as long as possible (Supabase free tier, Vercel free tier). Don't reach for a paid API/service to solve a problem that a simpler free approach already covers.
* `leads.order_value` has no timestamp of its own, so the Phase 5 "targets vs. actuals" dashboard approximates a period's actual order value via `stage_history`: sum `order_value` for leads whose *most recent* `stage_history` row with `stage = 'won'` falls inside the selected period. Known inaccuracy: editing `order_value` after a lead is already won won't shift which period it counts toward. Accepted as good enough for now — don't add a dedicated order-value-achieved timestamp column to fix this unless it turns out to be a real problem in practice, not a hypothetical one.
* `targets.metric_name` is treated as a closed list at the app layer (the five `activities.activity_type` values plus `order_value` — see `src/lib/targetMetrics.js`), not free text like `current_stage`/`site_stage`. The dashboard can only compute an "actual" for a metric it knows how to measure, so widening this list means adding a matching actual-value computation, not just adding an option to a dropdown.
