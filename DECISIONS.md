# DECISIONS.md

Domain model, lead-sourcing logic, and locked-in design decisions for VIPSAR CRM — split out of CLAUDE.md to keep that file lean. See CLAUDE.md for stack/structure/commands/conventions.

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

* No GPS, no geocoding API, no fuzzy-matching database extension (pg_trgm). Deliberately dropped as unnecessary/costly for v1. Duplicate-checking is a "search before create" UI pattern (search parties by name/mobile, search sites by locality/plot number before creating a new row) — a human decides, the database doesn't auto-merge or block. **Partially superseded 2026-08-10** — the pattern still stands, but it no longer sees company-wide data for a sales executive; see the Phase 8 section below.
* No UNIQUE constraint on `parties.mobile`. Shared household/family numbers are common; a hard constraint would reject valid entries.
* `current_stage` and `site_stage` are free text, not a CHECK enum. The dealer's own stage vocabulary is specific and still evolving — standardize the list at the application layer, not the database layer.
* Marking a lead `lost` requires a `loss_reasons` entry — no "skip for now" escape hatch. A rep must always account for why a lead was lost; don't reintroduce a skip option without checking with the user first.
* Budget constraint: stay on free tiers as long as possible (Supabase free tier, Vercel free tier). Don't reach for a paid API/service to solve a problem that a simpler free approach already covers.
* `leads.order_value` has no timestamp of its own, so the Phase 5 "targets vs. actuals" dashboard approximates a period's actual order value via `stage_history`: sum `order_value` for leads whose *most recent* `stage_history` row with `stage = 'won'` falls inside the selected period. Known inaccuracy: editing `order_value` after a lead is already won won't shift which period it counts toward. Accepted as good enough for now — don't add a dedicated order-value-achieved timestamp column to fix this unless it turns out to be a real problem in practice, not a hypothetical one.
* `targets.metric_name` is treated as a closed list at the app layer (the five `activities.activity_type` values plus `order_value` — see `src/lib/targetMetrics.js`), not free text like `current_stage`/`site_stage`. The dashboard can only compute an "actual" for a metric it knows how to measure, so widening this list means adding a matching actual-value computation, not just adding an option to a dropdown.

## Phase 8 — the Sales Coordinator role (2026-08-10)

A third role, `sales_coordinator` (SC): an oversight tier between the owner
and the sales executives. Schema + RLS live in
`Schema/migration_sales_coordinator.sql`; this section is the *why*.

### The role model

* Exactly one role per employee — `owner` / `sales_executive` /
  `sales_coordinator` are mutually exclusive, enforced by the existing
  single `employees.role` column, unchanged in shape.
* **An SC owns no leads, activities or plans of their own.** This is
  enforced at the database, not just by the UI never offering it: the
  `WITH CHECK` on every SC write policy calls `is_my_team_member()`, which
  is false for the SC's own id (an SC has no `coordinator_id`), so an SC
  literally cannot insert or reassign a lead to themselves.
* Each exec reports to exactly one SC via `employees.coordinator_id`.
  Reassignment is a plain `UPDATE` by the owner at any time — nothing about
  it is permanent, and no history table records it. That's deliberate:
  `lead_owner_history` exists because *lead* ownership drives credit and
  reporting, whereas an exec's reporting line only ever affects who can see
  what *right now*. If a coordinator-assignment audit trail is ever wanted,
  it's a new table, not a retrofit of this column.
* SCs are fully isolated from each other. Every team-scoped policy goes
  through one helper, `is_my_team_member(employee_id)`, so "SC-A cannot see
  SC-B's team" is one function to audit rather than a predicate repeated
  across ~15 policies where the first typo is a silent cross-team leak.

### `coordinator_id` is INTEGER and validated by a trigger

The written spec asked for `coordinator_id uuid references employees(id)`.
That could never work: `employees.id` is `SERIAL`. The same mistake ran
through the spec's RLS predicates as `employees.coordinator_id = auth.uid()`
— comparing an `employees.id` to a Supabase Auth UUID, which never matches.
Everything uses `current_employee_id()` instead, the existing helper that
resolves `auth.uid()` to an active employee row.

The rule "`coordinator_id` may only point at an employee whose role is
`sales_coordinator`" is a **trigger**, not a CHECK constraint — a CHECK
cannot reference another row, and this rule is inherently cross-row. Same
mechanism the repo already uses for `owner_only_stage_change` and
`stamp_lead_creator`.

Demoting an SC who still has reports is a **hard block**, deliberately
unlike demoting an exec who still holds leads (which only warns — the
owner's call, per product decision). The difference: an exec's leads stay
valid and readable after a role change, but a `coordinator_id` left pointing
at a non-SC silently breaks `is_my_team_member()` for that entire team. One
is a judgement call, the other is a data-integrity break.

### `entered_by_role` — the SC edit lock (new pattern, don't "fix" it)

**This column is a lock flag, not an audit field**, and it is the only one
of its kind in this schema. On `leads` and `activities`:

* `NULL` — the assigned exec has never saved this record. The SC who
  entered it may still edit it.
* `'sales_executive'` — the exec has saved it at least once. The record is
  now theirs; the SC drops to view-only on it.

The problem it solves: an SC enters leads and activities on behalf of their
team (a call comes in, the SC logs it against the right exec). That entry
should stay correctable while it's still effectively a placeholder — but the
moment the exec who actually owns the work touches it, the exec's version
wins. Without the flag the only options are "SC can always overwrite the
exec" or "SC can never fix their own typo", both worse.

Written **only by the `stamp_entered_by_role()` trigger**, never by app
code — identical reasoning to `lead_change_log`: there is no single
lead-update service in this app (`leads` is written from four LeadDetail
sections, `LeadStageSection`, `LeadQuickActions` and three side-effect paths
in `ActivityLog.jsx`), so a JS helper would need calling from all of them and
the first missed call site leaves a record SC-editable forever.

Only `'sales_executive'` is ever written today. The CHECK admits all three
role values so the column reads sensibly and can widen later; an
owner-created or SC-created record stays `NULL` on purpose, since neither is
"the exec has taken ownership", which is the only thing the lock encodes.

**Existing rows were deliberately NOT backfilled.** Every record predating
the migration keeps a `NULL` flag, so a newly appointed SC starts *with*
edit rights over their team's existing leads and activities, losing them
per-record as each exec next saves. The safer-looking alternative — stamping
the whole back catalogue closed on day one — was considered and rejected:
completing half-filled records is part of why the role exists, and locking
everything would leave a new SC unable to touch anything real until the team
happened to re-save it. The reversal SQL is in the migration file if this
turns out wrong in practice.

**The lock is column-level on `leads`, row-level on `activities`.** This is
the one genuinely awkward part of the design and it exists for a specific
reason. An SC keeps stage rights permanently (below), but RLS restricts
*rows*, never *columns* — so a row-level lock would have taken the stage
away again the instant the exec touched the lead, leaving SCs able to change
stage only on leads they typed in themselves. That is not oversight in any
useful sense. So `leads`' UPDATE policy allows the whole team row and
`enforce_coordinator_lock()` draws the line inside it: once locked, an SC
may change `current_stage`, `next_followup_date` and `order_value` and
nothing else. `activities` has no stage concept, so its lock stays in the
policy where it belongs and needs no trigger.

Those last two columns ride along because this app's own stage flows write
them in the *same statement* as the stage: On Hold requires a resume date
(`next_followup_date`), and the Won prompt requires a value before it will
write the stage (`order_value`) — excluding the latter would let an SC close
a deal only when the value happened to already be set, and a Won lead with
no value contributes zero to every booked-value metric, which an earlier
code review already flagged. The trigger compares by *value*, not by which
columns the statement mentioned, so re-sending an unchanged column is always
fine — that's what keeps ordinary app saves working.

### SCs can change lead stages; sales executives still cannot

`migration_owner_only_stage.sql` (2026-08-10, earlier the same day) made
stage changes owner-only, at the user's request — "a sales executive cannot
change stage of a lead", explicitly including Won/Lost. Phase 8 widens that
trigger to `('owner','sales_coordinator')`. A rep still cannot close their
own deal; their coordinator now can, for their own team's leads only.

Note this is a genuine widening of who can mark a deal Won or Lost, and it
was confirmed as intentional rather than inferred from the spec — the spec
listed `stage_history` INSERT for SCs, which contradicted the day-old
owner-only rule, and the conflict was resolved in the SC's favour.

This grant and the column-level lock above are a **pair**. The trigger
widening alone would be nearly inert, because the row-level lock would have
revoked the stage the moment an exec touched the lead. Removing either piece
silently guts the other — don't treat `enforce_coordinator_lock()` as an
independent safety net that can be simplified away.

The `COALESCE(current_employee_role(), '')` in that trigger is load-bearing:
the original used `IS DISTINCT FROM 'owner'`, NULL-safe by construction,
but a multi-value `NOT IN (...)` returns NULL — falsy — for the NULL role a
*deactivated* employee resolves to, which would have let them through.

### `parties`/`sites` read narrows for execs — dedup trade-off accepted

**This reverses an earlier decision recorded above.** `parties` was
deliberately moved out of the "own data or owner role" group and given open
company-wide SELECT *specifically* so search-before-create would work across
reps — Rep B needs to find the party Rep A already created, or duplicate
checking silently fails. `sites` had the same treatment.

Phase 8 narrows both for `sales_executive` only. Scope confirmed with the
product owner as **own leads only**, not team-wide: two execs under the same
coordinator will not see each other's parties. `owner` and
`sales_coordinator` keep full company-wide read.

**Accepted consequence: company-wide dedup is no longer guaranteed.**
Duplicate party and site rows across different teams are now an expected
outcome, not a bug to be fixed at the point of creation. Automated
re-solving of duplicates created after this change is explicitly out of
scope. The search-before-create *pattern* is unchanged — it just sees less.

The predicate keeps a `created_by`/`discovered_by` branch, and this is
**not optional**. `PartySearchOrCreate` does `.insert(...).select().single()`,
and Postgres applies the SELECT policy to `INSERT ... RETURNING` rows. A
party is created *before* the lead that references it (LeadQuickCapture
creates party → site → lead), so at the moment of creation it is tied to no
lead at all. Without that branch the insert returns nothing and New Lead
breaks for every sales executive. Two further branches cover an architect
party an exec logged a meeting against that never became a lead, and
contacts at a site the exec's own lead sits on.

Performance note: `parties` SELECT now runs up to four `EXISTS` subqueries
per row, where it used to be a constant-false-or-true role check. Backing
indexes were added (`idx_parties_created_by`, `idx_sites_discovered_by`,
`idx_leads_referred_by`, `idx_leads_other_party`). Fine at pilot volume;
worth re-measuring against `Search.jsx`'s full-directory load before full
rollout.

### SC follow-up assignment uses `follow_ups`, not `plans`

The spec routed SC-assigned follow-ups through a new `plans.assigned_by`
column, with the exec seeing them "in their existing plans view". **There is
no plans view** — `plans` has zero code references anywhere in `src/`, and
CLAUDE.md lists a plans screen as deliberately not built. The spec also
enumerated 12 tables when the schema has 16, omitting `follow_ups`, so it
appears to have been written without knowing the real reminder system
exists.

Confirmed with the product owner: assignment uses `follow_ups`, the table
that already carries `assigned_to`/`created_by`, already renders
"Assigned by {name}" in `FollowUpList` whenever those differ, already
appears on the exec's Today screen, and already fires a real push
notification via the Edge Function. `plans` stays untouched and unused; no
`assigned_by` column was added to it.

### Role admin lives in Profile, not a new screen

The spec asked for a new owner-only screen. The app already had two employee
surfaces — Profile → Manage employees (search, edit role, toggle active) and
`/team` (a read-only card grid) — so a third would have been the second place
that edits a role. Coordinator assignment was added to Manage employees
instead, as a "Reports to" dropdown beside the role dropdown, shown only for
an employee whose *saved* role is `sales_executive` (offering it mid-way
through an unsaved promotion would only produce a rejected write).

That card was moved **out of Profile's `.vip-only-desktop` block**. Add
employee and Delete a party stay desktop-only — both are sit-down tasks (one
needs a UUID pasted from the Supabase dashboard, the other is destructive) —
but reshuffling who reports to whom is a normal thing to do from a phone, and
leaving it desktop-only would have made a laptop the only route to it.

`src/lib/roles.js` is new and canonical, same pattern as `activityTypes.js`.
Adding the third role found the role-label table hand-rolled in four separate
files, two of which listed only owner/sales_executive — a coordinator would
have rendered with the raw `sales_coordinator` column value as their label in
My Team, and been unselectable in both role dropdowns.

**`updateEmployeeRole()` clears `coordinator_id` in the same statement** when
the new role isn't `sales_executive`. The validation trigger rejects any
non-exec still carrying one, so a plain `update({ role })` fails with a
confusing "Only a sales executive can be assigned to a coordinator" on what
looks like an ordinary promotion.

### Nav gates on capabilities, not on "not an owner"

`BottomNav`/`FabSheet` used `role !== 'owner'` to mean "is a rep". The third
role broke that: a coordinator was offered the Activity Log link and the FAB's
Log Activity row, both routing to `/activity`, which is `sales_executive`-only
and bounces them straight back to Home. Replaced with explicit
`canLogActivity` / `canCreateOwnLead` flags.

A coordinator gets **no FAB at all** for now rather than one opening an empty
sheet — `/leads/new` assigns the lead to whoever is filling it in, and the RLS
insert policy rejects that for a coordinator (`is_my_team_member()` is false
for yourself). Creating records on a team member's behalf is Phase 4 and needs
an exec picker the form doesn't have. `/leads/new` stays closed to
coordinators at the route level until then. The `.vip-fab-slot` div still
renders empty, because it's the reserved 76px gap the four tabs are laid out
around — removing it would reflow the whole bar.

### Red-flag thresholds (dashboard-only)

For the SC's team overview, defined as constants at the app layer alongside
the existing ones in `src/lib/attention.js` rather than as new DB state:

* **No activity on a lead for 10+ days.** Note this is a *third* staleness
  threshold in the app — `attention.js` already uses 7 days ("stale") and
  14 days ("at risk" / the Lead Profile's health pill). 10 was specified for
  the SC view; it is not reconciled with the other two, and the three should
  probably be unified before full rollout.
* **A follow-up whose due date has passed and is not done** ("missed
  follow-up"). Same condition the exec's own overdue list already uses, so
  the SC and the exec are never looking at different definitions.
* **"Lost lead without a reason" is deliberately NOT a flag** — it cannot
  occur. Marking a lead lost already requires a `loss_reasons` entry with no
  skip-for-now escape hatch (see the rule above), so a flag for it would be
  permanently empty.

Red flags are **dashboard indicators only**. No push notifications, even
though the push pipeline exists and would be easy to reuse — explicitly out
of scope, per product decision.
