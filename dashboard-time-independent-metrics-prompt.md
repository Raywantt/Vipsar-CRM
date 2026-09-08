# Prompt for Claude Code — VIPSAR CRM: time-independent dashboard metrics

Paste everything below into a Claude Code session opened in the VIPSAR CRM repo
(`Desktop\VIPSAR CRM`). This is a standalone brief — treat it as the full
context for the task; you don't need anything else to get started, but you
**do** need to read `CLAUDE.md`, `DECISIONS.md`, `PERFORMANCE.md`,
`ROW-COUNTS.md`, and `FOLLOWUPS.md` before writing any code, per this repo's
own standing rules (`CLAUDE.md`'s "ask before you build" and "every change is
a role × breakpoint matrix" sections at the top of the file are not
decorative — follow them literally here).

**Work in milestones. Stop after each one, report what you did and what you
found, and wait for explicit confirmation before starting the next.** Do not
chain milestones together even if the next step seems obvious — this task
touches new database aggregates, a new region of the busiest page in the app,
and a real role × scope matrix, and each of those deserves its own checkpoint.
This mirrors how `AREAS-PROPOSAL.md` and `DASHBOARD-AGGREGATES.md` were
handled in this repo: propose, wait, then build.

**After every milestone, write a handoff summary to a running log file in the
repo — not just to chat.** The product owner may need to hand this task to a
different Claude session (a different account, zero context) at any point,
and chat history doesn't travel with that handoff — only the repo does. This
repo already has exactly this pattern: `PHASE9_LOG.md` was explicitly
"written so a fresh session can resume from any phase with no other context."
Do the same here:

- Create `TIME-INDEPENDENT-METRICS-LOG.md` at the repo root at the start of
  Milestone 1 (once — don't recreate it on later milestones).
- After each milestone, **append** a new dated section (don't rewrite earlier
  entries — this is a running log, same append-only spirit as this repo's
  `lead_change_log`/`stage_history` tables). Each entry needs to stand
  entirely on its own for a reader with zero context from this conversation
  or any earlier milestone, covering:
  - Which milestone this was, and a one-line statement of what it
    accomplished.
  - Exact files created or changed (paths), and for any migration file:
    **whether it has actually been run against the live database or only
    written** — state this explicitly and don't let it go stale. This
    repo has been burned twice by docs claiming a migration ran when it
    hadn't (see `PHASE9_LOG.md`'s "verify against the database, not the
    docs" rule) — don't add a third instance.
  - Any decision made or confirmed during this milestone that this brief
    left open (e.g. the exact on-hold bucket cutoffs settled on, answers to
    the Milestone 1 confirmation questions) — a fresh session needs these
    decisions recorded as fact, not re-litigated.
  - Anything discovered that contradicted an assumption in this brief.
  - **Exactly what the next milestone is, and anything a fresh session
    needs to know before starting it** — pending confirmations still
    needed from the product owner, in-progress work, known-broken states
    mid-migration, etc.
  - A pointer back to this prompt file
    (`dashboard-time-independent-metrics-prompt.md`, repo root) as the
    source of truth for the overall plan, so a fresh session knows to read
    that first and this log second.

A fresh session picking this up should be able to read
`TIME-INDEPENDENT-METRICS-LOG.md` top to bottom, plus this prompt file, and
know exactly what's done, what's confirmed, and what's next — without
needing anything from the conversation that produced this brief.

---

## Background — what we're adding and why

The Dashboard today is: role toggle (manager only) → date range selector
(Today/Week/15D/Month/Quarter/Custom) → a grid of cards that are all scoped to
that date range. We're adding a second category of metric: numbers that
describe the **current state of the pipeline right now** and have no
meaningful date-range filter at all — the equivalent of "open pipeline" and
"stale leads," which already exist and are already correctly built as
point-in-time snapshots, not range-scoped.

Five new ones are being added, on top of two changes to what already exists:

1. **Open pipeline — split into Active vs. On-hold.** Already exists as one
   number; add a breakdown into "Active pipeline" and "On-hold pipeline" (use
   those exact labels — "Active" reads naturally against "On-hold").
2. **Stale leads.** Already fully built (Needs Attention's `ageing` kind).
   No changes needed — just noting it stays where it is conceptually, as part
   of this same "right now" family.
3. **On-hold pipeline insights.** New. Count, summed value, and average days
   parked for every lead at `current_stage = 'on_hold'`. Resolve "days on
   hold" from that lead's most recent `stage_history` row with
   `stage = 'on_hold'`.
4. **Lead data completeness (open leads only).** New. For every open lead
   (`current_stage` not `won`/`lost`), check 6 fields and report the % filled,
   both as one blended headline number and broken out per field:
   - **Client name** and **client number** — resolved from the client
     `parties` row linked to the lead. Resolve via `leads.party_id` when that
     party's `party_type = 'client'`; otherwise via `site_contacts` where
     `role = 'owner'` on the lead's `site_id`. If no client party resolves at
     all, both fields count as missing (this is the real, common case for a
     scanning lead where the client isn't known yet — not a bug in the
     query).
   - **Address** and **pincode** — from the lead's linked `sites` row
     (`house_no`/`locality` for address, `pincode` for pincode). Missing
     entirely if the lead has no `site_id`.
   - **Site stage** — `sites.site_stage`.
   - **Product** — `leads.product_id`.
   - Architect fields (name/number/firm) are explicitly **excluded** — this
     was discussed and dropped because not every deal involves an architect,
     and forcing it into a blended score unfairly penalizes leads that
     genuinely have none.
   - **Approved addition:** an owner-breakdown section (bar per employee,
     same visual language as the existing `ageing` kind's `ownerRows`
     section) showing each exec's average completeness % — but see the role
     rules below for when this section should render at all.
5. **Follow-up coverage gap.** New. Count (and %) of currently-open leads
   (excluding `on_hold` — those always carry a mandatory hold-review
   reminder per `FOLLOWUPS.md` Rule 8.2, so they're never gapped) where
   `next_followup_date IS NULL`. **Read `FOLLOWUPS.md` in full before
   touching this one** — Section 9 explicitly rejected a "lead has no
   follow-up" *attention flag* (a nagging work queue) because it would flag
   nearly every lead. This metric is deliberately different in kind: a
   passive dashboard count, not a queue anyone is pinged about. Don't let it
   drift into being a red-flag/notification surface — that reopens a decision
   that was made on purpose.
6. **Team workload balance.** New. Open lead count and open pipeline value
   per employee in the current scope, right now — highlighting the spread
   (busiest vs. lightest), not a report of what happened in a period. Not
   shown to a `sales_executive` at all (see role matrix below).
7. **Pipeline concentration.** New. What share of total open pipeline value
   sits in the **top 10% of open deals by value**, by lead count — not a
   fixed count of 5 or 10 (use `dealValueFor` / `sumOpenPipelineValue` from
   `src/lib/pipelineValue.js` — don't reinvent that logic, this repo has
   already been burned once by pipeline-value formulas drifting apart across
   call sites). **Settled by the product owner: fixed at top 10% for v1, no
   toggle.** Round the cutoff count up to at least 1 lead (`Math.max(1,
   Math.ceil(openLeadCount * 0.1))`) so this still means something at small
   scope sizes. In small-scope views (see role matrix) this drops the
   Top-N framing entirely and instead shows "every one of this scope's own
   open leads, ranked, with a running cumulative %" — there's no meaningful
   "top 10% of 6" figure at that scale.

All seven are point-in-time by construction — none of them has a "when" to
filter by. That's exactly why they don't belong below the date range
selector; see the placement section below.

---

## Role visibility and scoping matrix

**RLS already does the hard part.** Confirmed by reading
`Schema/rls_policies.sql` and the coordinator/manager migrations directly
(not assumed from docs, per this repo's own "verify against the database, not
the docs" rule in `DECISIONS.md`):

- `own_data_or_owner_role_select` on `leads` — the original, still-live base
  policy — returns a row when `owner_employee_id = current_employee_id()` OR
  the caller is `owner`. This applies to every role.
- `coordinator_team_select` additionally returns rows where
  `is_my_team_member(owner_employee_id)` is true. A coordinator owns no leads
  of their own (by design — see `DECISIONS.md`'s Phase 8 section), so in
  practice their visible set is exactly their team's leads.
- `manager_team_select` additionally returns rows where
  `is_my_managed_member(owner_employee_id)` is true (their direct reports
  only — verified in `Schema/migration_sales_manager.sql`, the function does
  **not** include the manager's own id). Combined with the base policy above
  (which *does* match the manager's own id, since managers carry leads too),
  a manager's RLS-visible set is "me + my reports," unioned.
- Postgres OR's multiple permissive policies together, so all of this
  composes automatically — a `SECURITY INVOKER` view or function over `leads`
  (the established pattern in this repo — see `DASHBOARD-AGGREGATES.md` and
  `PERFORMANCE.md`) inherits the correct per-role set with **zero** extra
  scoping logic in the view itself.

Given that, here's the visibility matrix. Build every one of these five new
metrics' backing query as a `SECURITY INVOKER` view/RPC, and let RLS do the
row-level scoping — do not hand-roll a second scoping layer on top:

| Role | Sees | Scope toggle |
|---|---|---|
| `sales_executive` | Open pipeline (Active/On-hold), On-hold insights, Lead completeness, Followup coverage gap, Pipeline concentration | None — always their own leads (RLS-only) |
| `sales_coordinator` | All of the above **plus** Team workload balance | None — always their team (RLS-only; they have no personal leads to toggle to) |
| `sales_manager` | All of the above, gated by the **existing** `managerScope` state (`Dashboard.jsx`) | "My numbers" / "My team" — reuse the existing toggle, don't build a second one |
| `owner` | Everything, company-wide | None needed — RLS already returns everything for `owner` |

Two derived rules, applied consistently across all five new metrics rather
than special-cased per metric:

1. **Team workload balance is hidden whenever the current scope is a single
   person** — always hidden for `sales_executive`, and hidden for
   `sales_manager` when `managerScope === 'my'` (only shows under "My team").
   It's meaningless to compare one person's workload to itself.
2. **Any owner/exec-breakdown section inside a drill-down (the completeness
   per-exec bars, the on-hold per-exec bars, the coverage-gap per-exec bars)
   only renders when the current scope contains more than one employee** —
   same condition as above. And more importantly: **do not render an
   owner-filter dropdown or any "select another exec" control at all when the
   viewer's own scope is already a single person.** A `sales_executive` (and
   a `sales_manager` in "My numbers" mode) should never see a filter control
   whose only possible value is themselves — it's dead UI, and per the
   product owner's explicit instruction, an exec must not have the *option*
   to look at another owner's numbers, not just have it return nothing
   useful.
3. **Pipeline concentration in single-person scope drops the Top-N framing
   entirely** — show every one of that scope's own open leads, ranked by
   value, with a running cumulative % (see the concentration panel spec
   below). In multi-person scope, it's a fixed **top-10%-by-lead-count**
   cutoff over the whole scope's pipeline (settled — see the Background
   section's Pipeline concentration entry for the exact rounding rule). A
   user-selectable Top-5/Top-10/Top-10% toggle was discussed and explicitly
   deferred, not built now — **add it as a new dated entry in
   `RECOMMENDATIONS.md`**, following that file's existing format (see its
   one current entry for the pattern: what/why it's worth doing
   eventually/why not now), at whichever milestone below builds this panel.
   Do not build the toggle itself in this pass.

**Confirm the following assumptions with the product owner at Milestone 1
before writing any migration SQL** — these were my best-judgment defaults
during planning, not settled decisions:

- Whether the dashboard's headline completeness %/coverage-gap count should
  update optimistically the moment an action inside that drill-down succeeds
  (mirroring how the existing `ageing` panel already removes a row from local
  state on a successful action), or whether a refetch on next visit is
  acceptable for v1.

---

## Placement and visual design

**Do not put these below the date range selector alongside the range-scoped
cards.** There's already a real precedent for exactly this kind of decision
in this codebase: the sales manager's "My numbers / My team" toggle
(`Dashboard.jsx`, around the `managerScope` state) is deliberately placed
**above** the date range, with an explicit comment explaining why — it
"decides WHOSE numbers the whole page is about, which is a bigger question
than which period they cover." The same reasoning applies here: these seven
metrics answer "what does the pipeline look like right now," which is a
different, prior question to "what happened in this period" — so visually
and structurally they belong in their own region above the date range
selector, not interleaved with it.

Design direction — **mobile and desktop deliberately differ here, this is not
a "shrink the same component" job:**

- **Mobile (< 1024px): word-only tiles, no numbers.** Small pill/tag-style
  chips carrying just the metric label ("Open Pipeline", "On-Hold",
  "Data Completeness", "Followup Gap", "Concentration", "Workload") — no
  headline figure, no secondary detail, no icon. Lay them out as a wrapping
  chip row (`flex-wrap`, not a horizontal scroll rail — at word-only length
  several fit per row, so wrapping stays genuinely compact rather than
  needing a scroll affordance). This is the "compact in the overall screen"
  requirement in its purest form: the number never renders on the dashboard
  itself on mobile, only inside the drill-down. **Tapping a tile opens its
  drill-down panel directly** — the panel's own header (`current.value`,
  `current.stats`) is where the real numbers appear, "the entire picture,"
  exactly as requested. This means on mobile these tiles carry zero query
  cost to render (no need to even fetch the headline aggregate before the
  tile is visible) — only the tapped metric's data needs to load, which is
  also a nice performance property worth calling out at Milestone 4.
- **Desktop (≥1024px): keep the fuller stat-chip treatment** — label +
  headline number + a one-line secondary detail where relevant (e.g. "On
  Hold · ₹8.2L · 6 leads · avg 19d parked" or "Data completeness · 68%"), in
  a static grid rather than a scroll rail. Desktop has the room and the
  precedent (`KpiSparkRow`'s existing tiles) for showing the number
  up-front; mobile doesn't, so don't force parity between the two — that's
  the whole point of the word-tile design.
- Give the strip its own small eyebrow label (e.g. "Right now" or "Current
  pipeline state") on both breakpoints so it visually reads as a distinct
  section, not just more KPI tiles — this repo's `DrilldownPanel` already
  uses an "eyebrow" label convention for exactly this kind of categorical
  framing, reuse that visual language for consistency.
- None of these seven need a trend line either way — `KpiSparkRow` already
  establishes "point-in-time snapshots render value-only, no sparkline" as
  the convention here, and the desktop chip's headline number should follow
  that same rule.
- Sits above the manager's `managerScope` toggle or below it — either is
  defensible; I'd put it *below* the manager toggle and *above* the date
  range, since the manager toggle answers "whose numbers" (a precondition for
  everything below it, including this new strip) and the new strip answers
  "what does that scope look like right now" (still prior to "in what
  period"). Confirm this ordering feels right once it's actually in the UI —
  it's a genuine judgment call, not load-bearing either way.

---

## Performance guardrails — this must not regress Dashboard load time

The product owner flagged this explicitly: the Dashboard already went
through a real performance crisis once (see `PERFORMANCE.md` in full — read
it before writing a single query for this feature, not just skim it). That
document's central lesson: **the bottleneck here is concurrency — the
number and weight of simultaneous requests — not the cost of any one query.**
This feature adds up to seven new metrics to the single busiest page in the
app, which is exactly the shape of change that caused the original problem.
Four concrete requirements, not suggestions:

1. **One combined snapshot RPC for the headline numbers, not five to seven
   separate ones.** `PERFORMANCE.md` Rule 3 says this directly:
   "Consolidate related figures into one RPC." Build a single
   `SECURITY INVOKER` function/view (e.g. `dashboard_snapshot_metrics`) that
   returns on-hold count/value/avg-days-parked, completeness %, coverage-gap
   count, workload spread, and concentration % in one row, one round trip.
   RLS still does the per-role scoping automatically (see the role matrix
   above) — a `sales_executive` calling this function simply gets
   single-person figures back, no separate gating logic needed for who sees
   what data, only for which *fields of the response* get rendered per role
   (workload spread, for instance, is meaningless — not wrong, just
   unrendered — for a single-person caller). This adds exactly **one** new
   request to Dashboard's mount, not five to seven.
2. **Row-level detail inside every drill-down panel stays lazy — fetched
   only when that panel is actually opened**, on both mobile and desktop.
   This is already how `NeedsAttentionCard`'s buckets work today (counts
   are eager, the row-level detail loads "once a bucket is actually
   opened" — see `DASHBOARD-AGGREGATES.md`'s description of that exact
   split) — follow the identical pattern for these five new panels rather
   than re-deriving it. On mobile, this is largely automatic given the
   word-tile design (no data fetches at all until a tile is tapped); make
   sure desktop's fuller chips don't accidentally eager-load their
   drill-down row lists just because the headline number is already
   visible there.
3. **Every one of these five metrics must be a real SQL aggregate (`COUNT`,
   `SUM`, `GROUP BY`, window functions for the concentration ranking) —
   never a client-side reduction over downloaded `leads` rows.** This isn't
   just a performance rule, it's a correctness one: `leads` is already past
   the 1,000-row PostgREST cap (1,204 rows per `ROW-COUNTS.md`), which is
   the exact bug that silently hid ₹3.16 Cr of pipeline before it was
   caught. Completeness and coverage-gap in particular need to examine
   every open lead — that examination has to happen in Postgres, not by
   paging the table into the browser to check fields there.
4. **Add an index on `leads.current_stage`** (or a composite covering
   whatever the combined RPC's WHERE clauses actually need, e.g. alongside
   `owner_employee_id` if that ends up being the more selective leading
   column — profile it, don't guess) before shipping this. Verified by
   grepping every file in `Schema/` — **no such index currently exists**,
   despite Round-1 style filters like "current_stage = 'on_hold'" or "not
   won/lost" being exactly what several of these new metrics need to run
   against the full `leads` table. `PERFORMANCE.md` Rule 4 ("every
   filtered/sorted column needs an index — and RLS counts") applies here
   directly.

**Milestone 7 (final verification) is gated on measurement, not just
functional correctness.** Before reporting this done, run the exact Resource
Timing snippet already documented in `PERFORMANCE.md` section 6, once before
this feature's migration is applied and once after, against a real logged-in
session, and report the before/after request count and load time for a cold
Dashboard load. If the new combined RPC adds meaningfully more than the
~one-request, sub-second cost it should, stop and fix it before calling this
done — don't ship a regression and note it as a known issue.

---

## Drill-down panel specs

Reuse the existing `DrilldownPanel.jsx` chrome (`panel.kind` → `BODIES` map,
`onDrill` for pushing a deeper panel onto the stack, `ShowMoreRows` for
chunked reveal, `EmployeeLink` for owner links) rather than building new
panel scaffolding. Where an existing `kind` already does almost exactly what's
needed, extend it in place rather than duplicating it.

**Open pipeline (Active/On-hold split).** Extend the existing `pipeline` kind
— it already has stage rows and a "Biggest open leads" list. Add a segmented
toggle (All · Active · On-hold) at the top of the panel that re-slices the
already-loaded lead array client-side (no new query — same pattern as
`StageLeadsBody`'s owner filter). Tapping "On-hold" here should land on the
same view the On-hold insights chip opens directly — don't build two
different UIs for the same underlying slice.

**On-hold pipeline insights.** New `kind`, modeled on the existing `ageing`
kind's shape but keyed on days-on-hold instead of days-silent: owner
breakdown (only in multi-person scope, per the rules above), then a list
sorted longest-parked-first — party, days on hold, value, owner, and (once
`leads.on_hold_reason` ships per `FOLLOWUPS.md` Rule 8.4) the hold reason and
resume date on the row. **Duration buckets — corrected by the product owner
from an initial 0–7/8–14/15–30/30+ day scheme (that was calibrated for
staleness, not hold duration) to actual observed hold lengths, which run
much longer:** `1–2 months`, `3–6 months`, `7–12 months`. Two things to
settle at Milestone 1, not to silently assume: (a) those three labels leave
gaps at the edges — nothing under 1 month and nothing over 1 year — and this
repo has legacy-imported leads with dates back to 2023 (see `CLAUDE.md`'s
`HISTORY_STARTS_AT` section), so a hold well over a year old is a realistic
case, not a hypothetical. Recommend adding `< 1 month` and `12+ months` to
make it a 5-bucket scheme so every on-hold lead has a bucket, but confirm the
exact labels/cutoffs with the product owner rather than shipping this
addition silently. (b) the three named buckets aren't contiguous as stated
(`1–2` then `3–6` skips the 2–3 month boundary) — pick exact day-count
cutoffs that close that gap and use named constants for them, the same
convention `attention.js`'s `STALE_DAYS`/`ATTENTION_DAYS` already sets in
this codebase — **do not reuse those constants themselves, this is a
genuinely different measurement** (time since entering `on_hold` via
`stage_history`, not time since last activity). Also: owner dropdown
(multi-person scope only), sort toggle (longest-parked vs. highest-value).
Keep this read-only — tap a row → lead detail. Don't add swipe actions here;
a hold is a deliberate pause, not a queue to clear, unlike the `ageing` kind
it's modeled on.

**Lead data completeness.** New `kind`. Leads with the six field-completeness
bars first (same visual as the existing Loss Reasons bars in the `loss`
kind — label / track+fill / count-equivalent), so the weak field is obvious
at a glance before any lead-level detail. Below that: field-filter chips (one
per field — tapping "Missing pincode" narrows the list to exactly those
leads), an owner dropdown (multi-person scope only), and a list where each
row shows the party name (or an explicit "No client linked yet" placeholder,
not a blank), small tags for which fields are missing, and links straight
into that lead's detail page. Include the approved owner-breakdown section
(per-exec average completeness %, `ageing` kind's `ownerRows` visual) —
multi-person scope only, per the rules above.

**Follow-up coverage gap.** Extend the `ageing` kind rather than building a
new one — it already supports a swipe-to-set-a-follow-up action per row and
a bulk "set a follow-up on all N" button, which is exactly the fix this
metric points at (`allowLogCall: false` for this instance, since "log a
call" isn't the relevant action here). Owner breakdown (multi-person scope
only) up top, list of gapped leads below (party, owner, stage, days since
last activity for context). Filters: owner dropdown (multi-person scope
only), stage filter chips (a quote-sent/negotiation lead with no follow-up
is a different urgency than a brand-new one).

**Team workload balance.** New `kind`. Headline calls out busiest vs.
lightest directly in the panel header/note (e.g. "Vishal — 42 open leads ·
Raghav — 9"). Body is the owner-breakdown bar list as primary content
(reuse the `ageing` kind's `ownerRows` visual), sortable by lead count or by
pipeline value — toggle between the two, "busiest" isn't always the same
person by both measures. Tapping an exec's row should link straight to their
existing Sales Exec Profile (`/employees/:id`) rather than building a
redundant lead-list view here — that page already shows this detail in full.
Never rendered in single-person scope (see role matrix rules above).

**Pipeline concentration.** Extend the `pipeline` kind's existing "Biggest
open leads" section rather than duplicating it — add a running cumulative-%
column next to each row (₹12L · 15% · 15% running, next row adds to 26%, and
so on). In single-person scope, drop the Top-N cutoff and list every one of
that scope's open leads this way instead of just the top few — see the role
matrix rules above for exactly when each mode applies.

---

## Suggested milestones — stop after each one

1. **Design confirmation pass, no code.** Re-read `CLAUDE.md`,
   `DECISIONS.md`, `FOLLOWUPS.md`, `PERFORMANCE.md` in full. Write back a
   short confirmation of the role/scope matrix above (verified against the
   actual current RLS policies and `managerScope` code, not just this brief),
   and get explicit answers to the three open assumptions listed in the role
   matrix section. Do not write any SQL or component code in this milestone.
2. **Migrations: the five new `SECURITY INVOKER` views/RPCs**, following the
   exact pattern `DASHBOARD-AGGREGATES.md` and `PERFORMANCE.md` already
   establish in this repo (view naming, `GRANT` hygiene, index needs). Write
   the migration file(s) and stop — do not run them against the live
   database yet.
3. **Run the migration live**, with the product owner's explicit go-ahead
   (per `CLAUDE.md`'s "ask before you build" rule) — this is a real schema
   change, same approval bar every other migration in `Schema/` has had.
   Verify with a read-only introspection query afterward (the same spirit as
   `phase9_verify_state.sql`), not just by assuming the migration ran clean.
4. **Build the "Right now" strip's placement and static chip UI** above the
   date range selector, wired to placeholder/stub numbers first — get a
   design look before wiring real data, since the exact visual treatment
   (chip density, mobile scroll behavior, eyebrow label wording) is worth a
   look-and-feel check before it's load-bearing.
5. **Wire real data + role-based visibility**, one role at a time if that's
   easier to verify: sales_executive, sales_coordinator, sales_manager (both
   `managerScope` states), owner. Confirm each one renders the right subset
   of chips with no dead filter controls, at both mobile and desktop widths —
   this is the "role × breakpoint matrix" `CLAUDE.md` warns about, treat it
   with the same care the rest of this app already does.
6. **Build each drill-down panel, one at a time**, in this order (reuse-heavy
   ones first, since they're cheapest to verify): Open pipeline
   Active/On-hold toggle → Pipeline concentration → Follow-up coverage gap →
   On-hold pipeline insights → Team workload balance → Lead data
   completeness. Stop after each panel for review before starting the next.
7. **Final verification pass.** Every role × breakpoint combination, driven
   live (not just read from code) the way Phase 9's audit did it — and a
   live data spot-check against the actual database for at least the
   completeness and coverage-gap numbers, since those are the two most likely
   to have an off-by-one in how "open" or "missing" gets defined. **Also the
   Performance guardrails measurement described above — before/after request
   count and cold-load time for Dashboard, using `PERFORMANCE.md`'s own
   Resource Timing method.** Report findings, including anything that
   contradicts an assumption made in this brief or any load-time regression
   found, before calling it done.
