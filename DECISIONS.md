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

* **No activity on a lead for `ATTENTION_DAYS` (14).** The spec asked for 10,
  which would have been a *third* staleness figure. Settled with the owner
  instead (2026-08-10) by splitting the two questions apart — see the
  staleness entry below — and the coordinator's red flag now reads the same
  `ATTENTION_DAYS` constant every other attention surface does. There is no
  10-day threshold anywhere.
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

## Phase 9 — pre-pilot audit and simulation (2026-08-12)

A full pre-pilot exercise: seed six months of realistic data, test every flow
in every role, attack the RLS isolation directly, then reconcile every number
the CRM displays against a ledger computed independently from the simulation
plan. Running log in `PHASE9_LOG.md`; that file is written so a fresh session
can resume from any phase with no other context.

### Verify against the database, not against the docs

**Adopted as a standing rule after two documentation errors surfaced in one
session.** `CLAUDE.md` marked `migration_coordinator_entry.sql` as "not yet
run against the live database" when it was in fact applied, and the Phase 9
task brief stated `areas` and `products` held preserved configuration when
both were empty. Neither error was detectable by reading; both took one API
probe to disprove.

The repo already had this rule for schema *files* ("never assume a `Schema/`
file's presence means it ran"). It now covers **prose describing live state**
as well. `phase9_verify_state.sql` exists as a read-only introspection query
over `pg_proc` / `pg_trigger` / `pg_policies` / `information_schema` — every
helper function, trigger, policy, grant and CHECK constraint the app depends
on, in one result table. Run it rather than trusting a sentence.

Corollary for anyone editing these docs: a claim about live state should
carry the date it was verified, not the date it was written.

### `plans` is vestigial, and is a redundancy candidate — not removed

Confirmed by direct search, not by reading the docs: **zero references to
`plans` anywhere in `src/`**, and no UI surface of any kind. It is schema left
over from the original sheet-replacement design, never built. It is *not*
legacy-in-the-superseded-sense — nothing ever migrated off it.

**Phase 9 seeds nothing into it** (product decision). Rows there could not be
verified in the reconciliation phase and could not appear in the independent
ledger, so seeding it would prove nothing while complicating teardown.

**Logged as a Phase 4 redundancy candidate — report only, no removal.**
Whether to drop the table is a product call, not an audit call. Note the
related trap it already caused once: the Phase 8 spec routed SC follow-up
assignment through `plans.assigned_by`, which would have written to a table no
dashboard reads. Any future plan schema must model follow-up assignment as
`follow_ups` rows for the same reason (see the `follow_ups`-not-`plans`
section above).

### A coordinator's team view follows the person, not the calendar (2026-08-12)

**Confirmed by the owner during Phase 9, and it locks in a consequence the
Phase 8 decision above implied but never spelled out.**

`employees.coordinator_id` holds current state only and no history table records
it (see the Phase 8 section — that was deliberate). The consequence, surfaced
concretely by the Phase 9 simulation: when an exec moves between coordinators,
**their entire history moves with them, retroactively.** Every lead and activity
they ever logged appears in the new coordinator's team aggregates and disappears
from the old one's — including work done months earlier under the previous
reporting line. `lead_owner_history` does not soften this; it tracks *lead*
ownership, which is a different question.

**This is intended behaviour, not a defect.** A coordinator sees their current
team's full history, full stop. Phase 7 must not report it as a mismatch, and
nothing should be "fixed" to make old team reports stable.

**Accepted limitation:** a coordinator's historical team report is not stable
over time. Re-running "South team, last quarter" after an exec transfers away
returns a smaller number than the same report gave at the time. For a business
this size, with rare transfers, that was judged not worth the cure.

**The cure, if it is ever wanted, is a real build, not a tweak** — a
`coordinator_history` table plus making every team-scoped policy and query
time-aware, on every SC-facing screen. Declined for the pilot. Don't attempt it
piecemeal: a half-migrated version where some screens are time-aware and others
aren't is worse than either consistent answer.

### "Why we lose" counts CURRENTLY-LOST leads — SETTLED (2026-08-13)

**The owner's ruling: count only leads still at `current_stage = 'lost'`, not
every loss event.** A deal that died and was later recovered is no longer
reported as a loss. Reading (B) below was chosen over (A).

Consequences, all now true:

* `Dashboard.jsx` filters the fetched rows to `leads.current_stage === 'lost'`
  **where the fetch resolves**, not inside the card. The same array feeds
  `LossReasonsCard` and `buildLossPanel`, so filtering once at the source is
  what guarantees the compact card and its drill-down cannot disagree.
* `fetchLossReasons` now embeds `leads(current_stage)` for exactly this — the
  `loss_reasons` table alone cannot tell you whether the lead is still lost.
* **The two cards are no longer expected to differ.** "Why we lose" and the
  `lost` count on Pipeline by stage should now agree. If they ever diverge
  again, that filter has been dropped.
* Verified live on the Phase 9 data: 29 `loss_reasons` rows exist, 26 leads are
  currently lost, and the card renders 26.
* **Nothing was deleted.** `loss_reasons` stays append-only; the three reopened
  leads keep their rows, they are simply no longer counted. Reading (A) remains
  recoverable at any time by removing one filter.

The original framing is kept below, because the reasoning behind both readings
is what makes the ruling legible.

### "Why we lose" and reopened leads — the question that was deferred (2026-08-12)

Marking a lead lost writes a `loss_reasons` row, and that row is append-only:
there is no DELETE grant or policy for anyone, including the owner. So when a
lost lead is **reopened** and worked again, its loss reason survives and
`LossReasonsCard` keeps counting it.

The visible symptom is a mismatch between two cards on the same dashboard —
"Why we lose" totals higher than the `lost` count on Pipeline by stage.

Two defensible readings, and **the choice is deferred to Phase 7 by decision,
not by neglect**:

* **(A) Loss events** — count every `loss_reasons` row. A deal that died on
  price and later recovered is still evidence that price is a friction point.
  This is what the app does today.
* **(B) Currently-lost leads** — count only rows whose lead is still at
  `current_stage = 'lost'`. Matches the plain reading of "how many did we lose"
  and keeps the two cards agreeing.

**Phase 6's ledger must carry both figures and must not collapse them**; Phase 7
reports the CRM against both and marks the comparison as awaiting a product
decision rather than as a defect. The owner will choose once the real numbers
are visible. Until then, **do not "fix" `LossReasonsCard` in either direction.**

### Teardown is designed up front, and is SQL-Editor-only

`phase9_teardown.sql` was written during Phase 0 rather than left to the end,
because the mechanism turned out not to be uniform (see CLAUDE.md's
`service_role` Conventions bullet for the measured grant split). Two of the
four append-only tables are unreachable from any API path, so the **entire**
teardown runs in the SQL Editor as `postgres` — one transaction, one place,
no partial state, rather than splitting across two mechanisms.

It guards on the preserved owner row (`employees.id = 3` and its
`auth_user_id`) and aborts if that baseline doesn't match, deletes in FK order,
and prints per-table row counts. Deleting `employees` rows does **not** remove
their Supabase Auth logins — that stays a deliberate manual step, never
scripted, since a bad bulk delete on `auth.users` could remove the owner's own
login. Same reasoning `DESTRUCTIVE_reset_all_data.sql` already records.

### `areas` and `products` start empty

Both were verified empty at the Phase 0 baseline, contradicting the brief. The
simulation therefore designs an area and product catalogue from scratch, and
teardown empties both completely rather than trying to preserve rows
underneath. If either table is ever treated as durable configuration, that has
to be established deliberately — right now nothing in the database says so.

## Staleness: "reads as stale" and "needs attention" are two thresholds (2026-08-10)

`attention.js` had one constant, `STALE_DAYS = 7`, doing two different jobs,
so a lead joined the Needs Attention queue on the same day it first started
looking neglected. Split, at the owner's direction:

* **`STALE_DAYS = 7`** — when a lead starts *reading* as neglected. Labels and
  colour only: `LeadsListCard`'s "Nd silent", the Lead Profile's health pill.
* **`ATTENTION_DAYS = 14`** — when a lead actually *enters the queue*. Drives
  the Needs Attention stale bucket, and with it the KPI row's "Stale leads"
  tile, Today's work queue, My Team's "Needs attn." count, EmployeeProfile's
  stale stat, and Phase 8's coordinator red flags — every one of which reads
  `computeAttentionBuckets`.

A week without contact is worth showing on the lead; it isn't yet worth
putting on someone's to-do list. **The counts on every surface listed above
drop as a result — that's the intended effect, not a regression.**

Two related inconsistencies were fixed at the same time, both pre-existing:

* The Lead Profile's health pill hardcoded 14/7 and labelled 7 days
  **"Cooling"** while the queue was calling the same lead stale. It now reads
  from the shared constants: `Active` → `Stale` (7) → `Needs attention` (14).
* The stale bucket's title was the literal string `'No activity in 7+ days'`
  while its filter read the constant, so retuning the threshold would have
  left the card stating the old number. Now templated.

`src/lib/attention.test.js` pins the invariant directly — a lead at exactly
`STALE_DAYS` must *not* be queued — so collapsing these back into one value
fails the suite rather than silently changing what every dashboard reports.

### Re-confirmed by the owner, 2026-08-12 (Phase 9)

Restated verbatim and unprompted during the Phase 9 audit: **"leads which are
not touched for 7 days are stale, leads which are not touched for 14 days fall
under needs attention."** That is exactly what `attention.js` already
implements, so **no threshold changed** — this is a confirmation, not a
revision. Recorded because the Phase 9 task brief specified a **10-day**
red-flag threshold, which does not exist anywhere in this codebase and was
retired here on 2026-08-10. **There is no 10-day rule. Do not reintroduce one
from that brief.**

The Phase 9 simulation deliberately seeds a **9–12 day negative control band**:
leads that read as stale (past `STALE_DAYS`) but must *not* appear in any Needs
Attention queue, coordinator red flag, or Today work queue. If any of them ever
does, either the constants have been collapsed back together or a 10-day rule
has crept in.

One drift hazard was found and fixed while verifying this: `EmployeeProfile.jsx`'s
`touchColor()` hardcoded `days >= 14 ? BAD : days >= 7 ? OK : GOOD` instead of
reading the constants — the same defect `LeadDetail`'s health pill had before
the 2026-08-10 pass, missed on that sweep. The values happened to agree, so
nothing rendered differently; but retuning either threshold would have left
that one screen colouring by the old numbers. It now imports `STALE_DAYS` /
`ATTENTION_DAYS`. **Any new surface that colours or labels by staleness must
import them too — never repeat the literals.**
