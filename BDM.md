# BDM.md — Business Development Manager role (Phase 11)

The single source of truth for adding the **Business Development Manager**
(BDM), the app's fifth role. Written 2026-09-15 at the end of a full Q&A with
the owner. **A new session must be able to resume from this file alone** —
nothing here depends on chat history or on per-account memory.

---

## 0. How to resume (read this first)

1. Read `CLAUDE.md` (project rules), then this file top to bottom.
2. Look at **§1 Progress** — find the first step not marked ✅.
3. **At the start of that step:** ask the owner every question listed under
   that step's *Confirm before building* (use `AskUserQuestion`). Do not guess
   UI — `CLAUDE.md`'s "ask before you build" rule applies in full.
4. Build **only that step.** Verify it (see §9 for the role × breakpoint matrix).
5. **Update this file** — tick the step in §1, record anything learned or
   decided in §10 *Session log*, and fix any part of the plan that turned out
   wrong.
6. **STOP.** Report to the owner what was done and what they must do (run SQL,
   deploy a function, create a login). Wait for an explicit go-ahead before the
   next step. **The owner asked for a hard stop after every major step.**

Standing rules that apply to every step:

- **Never commit or push unless the owner asks in that same turn.**
- **Schema changes are handed to the owner as SQL** to run in the Supabase SQL
  Editor — the app's anon key cannot run DDL. Explain the steps plainly; the
  owner is new to backend work.
- **A migration that adds columns new code SELECTs must run BEFORE that code
  is deployed** (a missing column fails the whole query, for every role).
- **Verify RLS as a real logged-in session of the role, never from the SQL
  Editor** (it runs as `postgres` with BYPASSRLS and no `auth.uid()`).
- **Verify as the role with the FEWEST rows** (the BDM), not as the owner.
- Claude cannot type passwords. The owner logs in once per dev-server port.
- Clean up your own test rows at the end of a live trial (see `CLAUDE.md`
  "Cleaning up test data"); only from an owner session.

---

## 1. Progress

| Step | What | State |
|---|---|---|
| 0 | Planning, decisions, this file | ✅ 2026-09-15 |
| 1 | Database: role, BDM tags, joinery, pool inserts, visibility, triggers, notifications | ✅ 2026-09-15 — migration live, BDM test login created, `verify_bdm_role.sql` 0 failed |
| 2 | Role plumbing: `roles.js` capabilities, routes, nav, Today/Dashboard switch, BDM test port | ✅ 2026-09-15 — all five roles verified at both widths |
| 3 | The handoff loop: `+ New` (lead + architect), owner's pool card, assign, notifications, "Sourced by BDM" | ✅ 2026-09-15 — `migration_bdm_handoff.sql` live (8/8), Edge Function redeployed, full loop driven live, test rows cleaned up |
| 4 | BDM daily screens: Today, My Leads, My Architects, Architect profile, Follow-ups, Search, Lead Detail rules | ✅ 2026-09-15 — built, driven live for all five roles at both widths, test rows cleaned up (no SQL, no deploy) |
| 5 | BDM Dashboard + BDM targets | ✅ 2026-09-15 — built, figures cross-checked against test rows for every period, all five roles at both widths, test rows cleaned up (no SQL, no deploy) |
| 6 | Owner's **Architect Network** screen | ✅ 2026-09-15 — built, figures cross-checked against test rows and real architects, targets + portfolio move written through the UI, all five roles at both widths, test rows cleaned up (no SQL, no deploy) |
| 7 | Meetings: schedule, agenda, richer Architect Meeting log, "Not logged" | ⬜ |
| 8 | Docs + cleanup: fold this into `CLAUDE.md`, final full matrix pass | ⬜ |

Mark a step ✅ with the date only once its verification passed. Use 🟡 for
"built, awaiting the owner's SQL run / deploy / sign-off".

---

## 2. What a BDM is

The **architect relationship person.** They line up meetings with architects,
build the relationship, and get those architects to hand over qualified leads
(client name at minimum, usually with the joinery drawings already). The BDM
enters each lead and pushes it to the owner; the owner assigns it to a sales
executive. The BDM then follows how their leads progress, but does not work
them. Nobody reports to a BDM. There is **one BDM for now**; design for more
(store *which* BDM, never a yes/no).

The architects are **split before this feature ships**: a BDM's architects are
the premium/good ones and deal **only** with the BDM, never with an exec. Not
every architect is a BDM's.

---

## 3. Decisions (locked — don't reverse without asking the owner)

### Identity
- Role value **`business_development_manager`**, label **"Business
  Development Manager"**, short badge **"BDM"**.
- The BDM is **NOT** added to `CARRIES_OWN_LEADS` (`src/lib/roles.js`). If they
  were, they would appear in the owner's Reassign dropdown, the heatmap, Day
  Review and exec ranking, and a pool lead could be handed back to them by
  accident.
- Nobody reports to a BDM; a BDM has no `coordinator_id`/`manager_id`.
- A BDM **cannot be deactivated or demoted while they still hold architects**
  (hard block, like a manager with reports).

### The BDM tag (the owner's own idea, agreed)
- **`leads.bdm_employee_id`** — which BDM brought this lead in. Stamped **by a
  database trigger** whenever a BDM inserts a lead. Survives assignment and "I'll
  work this myself". **Every** BDM rule reads this one field: visibility, pool,
  My Leads, targets, Dashboard, Top 5, "Sourced by", Architect Network.
- Why a frozen tag instead of deriving from `created_by_employee_id` + the
  creator's *current* role: a derived answer silently changes the day that
  person changes role or leaves. Same reasoning as Client Meeting's frozen
  old/new bucket.
- **`parties.bdm_employee_id`** (+ `parties.bdm_since`) — the same tag on an
  **architect**: this architect is in that BDM's portfolio. Stamped when a BDM
  creates an architect; set by the owner's legacy import for existing ones.
- Neither tag can be changed from the app **except by the owner**; admin SQL
  (no `auth.uid()`) may set them, which is how imports work.

### Leads
- **"Their leads" = leads they entered** (`leads.bdm_employee_id = me`).
- BDM's lead capture adds three things:
  1. **Joinery received?** yes/no — trusted as the BDM enters it.
  2. **A remark box** for context from the architect meeting — written as the
     lead's first `lead_remarks` row. **Capture only**: after assignment the BDM
     can read remarks but not add them.
  3. **Send to owner / I'll work this myself.**
- **Joinery received = Yes → the lead is created at `joinery_follow_up`**
  (at capture, not at assignment). No → `calling` as usual.
- **Send to owner** → `owner_employee_id` stays **NULL**. The lead is in the
  **pool**: `owner_employee_id IS NULL AND bdm_employee_id IS NOT NULL`.
  Every active owner is notified.
- **I'll work this myself** → `owner_employee_id` = the BDM. It never enters the
  pool; the BDM works it like an exec (forward-only stages).
- The **BDM may edit a pool lead until it is assigned**; after assignment it is
  **view only** for them — but they can read the exec's activities, remarks,
  stage history and the **loss reason**.
- **No Reject** on the pool — architects only give qualified leads.

### Architects
- **All architects/firms are visible to every role, company-wide** (search and
  pickers), tagged *Yours* / the BDM's name where relevant.
- **My Architects** = architects with `parties.bdm_employee_id = me`.
- **New architect:** name **required**, mobile **required** (10 digits; if the
  number already exists, show that architect instead of creating a duplicate),
  **firm optional**, **firm address optional**. One firm → many architects,
  via the existing `parties.firm_party_id` link (`attachFirms`/`setPartyFirm` in
  `partyQueries.js`). The firm address is the firm party's own
  `parties.address`.

### Targets (BDM only)
1. **Architect meetings** — `activities.activity_type = 'architect_meeting'`
   logged by the BDM. BDM-only; unrelated to any exec.
2. **Joineries received** — BDM-tagged leads created in the period with
   `joinery_received = true`.
3. **Leads generated** — BDM-tagged leads created in the period (pool and own).

Execs must **not** get Architect Meeting back as a target (removed 2026-09-08).
So metric lists become role-scoped; the exec list is unchanged.

### Screens
- **BDM:** Today · `+ New` (Lead / Architect toggle) · Log Activity · Dashboard ·
  My Leads · My Architects · Architect profile · Follow-ups · Search.
- **`+ New` with the Lead / Architect toggle is BDM only.** Every other role
  keeps today's New Lead screen unchanged.
- **Owner:** a pool card on their Today screen + a new screen named
  **Architect Network** (everything about BDMs and architects).
- **Exec's Lead Detail** shows **"Sourced by {BDM} via Architect {name}"**.
- **To-dos = follow-ups.** No second task system.
- **Dashboard cards are NOT merged**, even if sparse.
- **Top 5 architects is for the chosen period.**

### Accepted extras
- Pool card: waiting age, possible-duplicate hint, 24-hour nudge.
- Notify the BDM when their lead is **assigned, won, lost** (with reason).
- Architect Meeting log gains an **outcome**, an **upcoming projects** note and a
  **next meeting** (which schedules the next one). The owner said "not sure, go
  ahead, can change later" — build it, keep it easy to adjust.
- A scheduled architect meeting whose date passes without being logged shows
  **"Not logged"**; logging it closes the scheduled one.
- Needs attention (Today): **one rule — a portfolio architect with no meeting in
  14 days.** Imported architects start their clock at `bdm_since` (the import
  date), so they don't all flood in on day one.

---

## 4. Corrections found during planning (don't repeat these mistakes)

- **A Follow-ups screen already exists** — `/dashboard?tab=followups`
  (`FollowUpsCard`), for **every** role including the owner, with a sidebar link
  and a mobile tile. `CLAUDE.md`'s "deliberately not built: standalone
  Follow-ups page" line is stale. The owner answered "every role except owner"
  believing it didn't exist → **ask at Step 4** (see there).
- **`FOLLOWUPS.md`'s "build not started" header is stale** — the rebuild shipped
  (commit `d484c58`); rescheduling now re-arms push via a trigger.
- **Exec activities are NOT visible to a non-owner today.** `activities` SELECT
  is own-or-owner (+ coordinator/manager team policies). A BDM needs a new
  read branch for tagged leads — the owner assumed it already works.
- **After handoff a BDM would see a nameless lead** — `parties`/`sites`/
  `stage_history` SELECT key on `owner_employee_id = me`. Needs BDM branches.
- **`leads` INSERT requires `owner_employee_id = me` or the owner role** —
  an ownerless pool lead can't be inserted by anyone but the owner today.
- **`enforce_owner_only_stage_change()` raises for any role not in its
  hard-coded list** (`migration_retire_measurements_design_discussion.sql`,
  the latest copy). A BDM couldn't change stage even on their own lead until
  the role is added there.
- **`created_by_employee_id` is forgeable**: `stamp_lead_creator()` keeps a
  client-supplied value (COALESCE) and nothing freezes it on UPDATE. Owner
  agreed to lock it (Step 1), even though BDM logic reads the tag instead.
- **`Today.jsx` falls through to the exec `Home` for any unrecognised role**;
  about 120 role checks across 24 files (36 in `Dashboard.jsx`) would treat a
  BDM as an exec by default.
- **Owner-facing name lookups built from `fetchActiveSalesExecs()` will label a
  BDM-owned lead "Unassigned"** (e.g. `drilldownBuilders.js`'s `nameFor`).
  Decide at Step 2 how the owner's reports label BDM-owned and pool leads.
- **Dev-server ports:** `role-manager` already uses **5184** (CLAUDE.md only
  lists 5181–5183). The BDM port is **5185**.
- `targets.metric_name` has **no DB CHECK** (closed list is JS-only,
  `src/lib/targetMetrics.js`) — BDM metrics need no migration. Re-verify live.
- The Dashboard's time-independent RPCs (`leads_followup_gap_detail`,
  `leads_completeness_detail`, …) are **SECURITY INVOKER** and take an optional
  `p_owner_ids`. For a BDM, calling them with `p_owner_ids = null` should return
  exactly their RLS-visible leads (tagged + own) once Step 1's policies exist.
  The follow-up gap reads `leads.next_followup_date` (derived), so it needs no
  `follow_ups` read access. Verify at Step 5.

### Working tree at planning time (2026-09-15)
Uncommitted, **not part of this feature**: an in-progress UI redesign in
`src/components/BottomNav.jsx` (brand block markup), `src/pages/Login.jsx`,
`src/vipsar-theme.css`, plus untracked `design-trials/`,
`public/vipsar-mark.png`, `public/vipsar-wordmark.png`, and four junk-looking
untracked files named `(prev`, `,`, `40`, `{,+` (probably from a mistyped shell
command). **Don't delete or commit any of them without asking the owner.**
*(2026-09-15: the junk files — actually made by an edit hook, see the session
log — were deleted at the owner's request; the rest still stands.)*
Step 2 edits `BottomNav.jsx` — keep those redesign edits intact.

---

## 5. Data model changes

All in **`Schema/migration_bdm_role.sql`** (Step 1) unless noted. Additive and
backward-compatible: the current build ignores every new column, so it can run
before any app change is deployed.

| Change | Detail |
|---|---|
| `employees.role` CHECK | add `'business_development_manager'` (replace the constraint from `migration_sales_manager.sql`) |
| `leads.bdm_employee_id` | `INTEGER REFERENCES employees(id)`, nullable, indexed `(bdm_employee_id, created_at DESC)` |
| `leads.joinery_received` | `BOOLEAN`, nullable — NULL = never asked (every non-BDM lead) |
| `parties.bdm_employee_id` | `INTEGER REFERENCES employees(id)`, nullable, indexed |
| `parties.bdm_since` | `TIMESTAMP` — when the architect entered the portfolio; the 14-day clock floor |
| `notifications.kind` CHECK | add `'bdm_pool_lead'` (→ each active owner), `'bdm_lead_assigned'`, `'bdm_lead_won'`, `'bdm_lead_lost'` (→ the BDM) |
| Step 7: `Schema/migration_bdm_meetings.sql` | `activities.meeting_outcome` (closed-list CHECK, values confirmed at Step 7), `activities.upcoming_projects TEXT` |

End every migration with `NOTIFY pgrst, 'reload schema';`.

---

## 6. Triggers and RLS (Step 1)

> **Implemented in `Schema/migration_bdm_role.sql`** — its STEP comments are
> now the authoritative spec; this section is the plan it was built from.
> Behavioural test: `Schema/verify_bdm_role.sql` (impersonates the real BDM,
> exec and owner logins inside one DO block that deliberately ends in an error,
> so nothing is saved — the error text IS the PASS/FAIL report).
>
> **Differences from the plan below, decided/found while building (2026-09-15):**
> - Owner confirmed: **the owner (and admin SQL) may change both tags**; no
>   one else, ever. Other sessions' values are forced NULL on insert and
>   silently reverted on update.
> - Owner confirmed: **a BDM can never change `owner_employee_id`** — not even
>   to pull a pool lead to themselves. Enforced by a RAISE in
>   `bdm_leads_before_write()`, because RLS OR's WITH CHECK clauses across
>   policies and `own_data_or_owner_role_update` would otherwise allow
>   `owner = me`.
> - **Client + site hand-over on assignment** (new): pool leads' client/site
>   are created by the BDM, and `parties`/`sites` UPDATE is creator-or-owner,
>   so the exec couldn't edit them. `bdm_leads_after_write()` moves
>   `sites.discovered_by` and the client/other party's `created_by` to the new
>   owner when a pool lead is first assigned. Architects/firms stay with the BDM.
> - **Stage history:** the trigger writes history only for stage changes the
>   DATABASE makes (capture at joinery, pool joinery toggle). A stage change the
>   BDM makes in the app on a pool lead is recorded by the app as usual, via
>   the new `bdm_pool_insert` policy on `stage_history` (requires
>   `changed_by = me`). Capture history rows are real-session only (imports
>   supply their own).
> - `parties_bdm_tag_architect_only` CHECK: only `party_type = 'architect'` can
>   carry a portfolio tag (not firms, not clients).
> - A tag must point at a `business_development_manager` employee — checked
>   only when the value is being set, so a lead whose BDM later left still saves.
> - `lead_change_log` and `follow_ups` got no BDM read branch (no BDM screen
>   reads them; follow-up gap reads `leads.next_followup_date`).
> - The migration re-installs `enforce_owner_only_stage_change()` with the
>   6-stage funnel, which settles CLAUDE.md's outstanding "was the retire
>   migration's trigger half deployed?" question.
> - **Layering hazard:** re-running `migration_coordinator_can_manage_manager.sql`,
>   `migration_lead_change_log.sql`,
>   `migration_retire_measurements_design_discussion.sql` or
>   `migration_lead_remarks_and_lixil_notify.sql` after this file strips the
>   BDM lines — re-run `migration_bdm_role.sql` afterwards. Add it to
>   CLAUDE.md's migration-order list at Step 8.
>
> **App obligations this creates (for Steps 3–4):**
> - LeadQuickCapture for a BDM pool lead must pass **the BDM's id** as
>   `sites.discovered_by` and as `createdByEmployeeId`/`materializePartyDraft`'s
>   creator — today it passes `ownerEmployeeId`, which is NULL for a pool lead,
>   and the `.insert().select()` would then return nothing (RETURNING is
>   subject to SELECT RLS).
> - The app never sends `bdm_employee_id` or `created_by_employee_id`.
> - The app may send `current_stage: 'joinery_follow_up'` or leave it; the
>   trigger derives it from `joinery_received` either way.
> - Only the owner's Assign writes `lead_owner_history`; the BDM's UI must not
>   offer Reassign or any owner change.

**Before writing any policy, grep every file in `Schema/` that has EVER touched
that table's policies** (the layered-migration hazard in `CLAUDE.md`). Latest
copies at planning time: `leads`/`stage_history` →
`migration_rls_performance_leads_stage_history.sql`; `parties`/`sites`/
`activities` → `migration_rls_performance_parties_sites_activities.sql` +
`migration_architects_universal_visibility.sql`; `lead_owner_history`/
`lead_change_log` → `migration_phase9_rls_fixes.sql`, `migration_sales_manager.sql`;
`loss_reasons` → `rls_policies.sql`, `migration_sales_manager.sql`;
`lead_remarks` → `migration_lead_remarks_and_lixil_notify.sql`.

**Prerequisite check** (owner runs, read-only): confirm
`architect_firm_universal_select` exists on `parties` — that migration was
still listed as outstanding in `CLAUDE.md`:
```sql
SELECT policyname FROM pg_policies
 WHERE tablename = 'parties' AND policyname = 'architect_firm_universal_select';
```
If missing, run `migration_architects_universal_visibility.sql` first.

Every new policy is a **separate, additive, role-guarded** policy
(`(SELECT current_employee_role()) = 'business_development_manager' AND …`),
never an edit to the existing `own_data_or_owner_role_*` / `coordinator_team_*`
/ `manager_team_*` ones — so owner/exec/coordinator/manager behaviour is
byte-for-byte unchanged. Use the `(SELECT …)` hoisted form for performance.

### Triggers
1. **`stamp_bdm_lead_tag`** — BEFORE INSERT OR UPDATE on `leads`.
   INSERT: real session + BDM role → `bdm_employee_id := current_employee_id()`;
   real session + any other role → force NULL (can't be forged). No `auth.uid()`
   (admin SQL/import) → keep the supplied value. UPDATE: freeze
   (`NEW := OLD` value) unless owner role or no `auth.uid()`.
2. **`stamp_bdm_architect_tag`** — same on `parties`, only for
   `party_type = 'architect'`; also sets `bdm_since := now()` when the tag is
   first set.
3. **Joinery at capture** — AFTER INSERT on `leads`, SECURITY DEFINER: if
   `bdm_employee_id IS NOT NULL AND current_stage = 'joinery_follow_up'`, insert
   one `stage_history` row (the BDM can't insert one under RLS; without it the
   stepper and funnel have no dated entry). The app sends
   `current_stage = 'joinery_follow_up'` when Joinery = Yes.
   Pool edits toggling Joinery: sync `current_stage` `calling` ↔
   `joinery_follow_up` and write the history row, only while the lead is
   ownerless.
4. **`enforce_owner_only_stage_change()`** — add the BDM role: any direction on a
   pool lead they tagged (ownerless), forward-only on a lead they own (same
   branch as `sales_executive`). Re-create from the **latest** copy only.
5. **Lock `created_by_employee_id`** — `stamp_lead_creator()`: a real session
   always stamps `current_employee_id()`; freeze on UPDATE unless no
   `auth.uid()`. (Coordinator entry-on-behalf still stamps the coordinator —
   unchanged meaning.)
6. **`validate_employee_role_assignment()`** (latest:
   `migration_coordinator_can_manage_manager.sql`) — BDM can't carry
   `coordinator_id`/`manager_id`; block deactivating or demoting a BDM while any
   `parties.bdm_employee_id` points at them.
7. **Notifications** (respect `app.skip_assignment_notifications`):
   - AFTER INSERT on `leads`: pool lead (owner NULL, tag set) → one
     `bdm_pool_lead` row per **active owner**.
   - AFTER UPDATE OF `owner_employee_id`: NULL → someone on a tagged lead →
     `bdm_lead_assigned` to the BDM. (The exec's own `lead_assigned` already
     fires from `migration_lead_assignment_notifications.sql`.)
   - AFTER UPDATE OF `current_stage` → `won` / `lost` on a tagged lead →
     `bdm_lead_won` / `bdm_lead_lost` to the BDM (skip if the BDM made the change).

### Policies (all additive, BDM-guarded)
| Table | Policy |
|---|---|
| `leads` SELECT | `bdm_employee_id = me` |
| `leads` INSERT | `owner_employee_id IS NULL OR owner_employee_id = me` — never anyone else (so a BDM can't assign) |
| `leads` UPDATE | USING + WITH CHECK: `bdm_employee_id = me AND owner_employee_id IS NULL` (pool edits only; can't assign) |
| `stage_history` SELECT | EXISTS tagged lead |
| `activities` SELECT | `lead_id` is a tagged lead (read the exec's work) |
| `lead_owner_history` SELECT | EXISTS tagged lead |
| `loss_reasons` SELECT | EXISTS tagged lead |
| `parties` SELECT | party referenced by a tagged lead (`party_id`/`referred_by_party_id`/`other_party_id`) or a `site_contacts` row on a tagged lead's site |
| `sites` SELECT | `id` is a tagged lead's `site_id` |
| `lead_remarks` INSERT | `employee_id = me AND` lead tagged me `AND owner_employee_id IS NULL` (capture/pool only) |

`lead_remarks` SELECT already inherits lead visibility (EXISTS on `leads`) — no
change. `follow_ups`, `targets`, `notifications`, `push_subscriptions`,
`employee_preferences` are own-row and cover the BDM with no change.

LeadQuickCapture must write `sites.discovered_by` and `parties.created_by` =
**the BDM** for a pool lead (today it uses `ownerEmployeeId`, which would be
NULL), or the BDM can't edit that client/site while the lead waits.

### Step 1 verification (as a real BDM session)
- Can read: own tagged pool lead, its client/site/remarks; every architect.
- Cannot read: an exec's own scanning lead; its client; its activities.
- Can insert an ownerless lead; **cannot** insert one owned by an exec.
- Can edit a pool lead; **cannot** set its `owner_employee_id` (0 rows / error).
- After the owner assigns it: BDM update returns **0 rows** (use `.select()`),
  but reads still work incl. the exec's activities and loss reason.
- A supplied `bdm_employee_id` / `created_by_employee_id` from an exec session
  is overwritten.
- Owner receives `bdm_pool_lead`; BDM receives assigned/won/lost.
- Existing roles unchanged: re-run a quick read check as exec and coordinator.

Note: until Step 2 admits the role in `ProtectedRoute`, test through the
browser console on the `/login` page of the BDM port:
`const { supabase } = await import('/src/lib/supabaseClient.js')`.

**Owner tasks in Step 1:** run the prerequisite check; run the migration;
create the BDM **test** login — Supabase dashboard → Authentication → Add
user (auto-confirm), copy its UUID, then in the SQL Editor
`INSERT INTO employees (auth_user_id, name, role) VALUES ('<uuid>', 'Test BDM',
'business_development_manager');` (Profile → Add employee can't offer the role
until Step 2); record it in `.claude/test-logins.local.md` (git-ignored).
Note: the verify script leaves a real architect row un-created (rollback), so
the test BDM holds no architects afterwards and can still be deactivated.

---

## 7. Screens by role

### BDM
- **Nav (mobile + desktop, one capability flag each):** Today · My Leads ·
  Dashboard · Search + FAB (`+ New`, Log Activity). Desktop sidebar adds
  `+ New`, Log Activity, Dashboard, My Leads, My Architects, Follow-ups.
  My Architects' mobile path → confirm at Step 2.
- **Today (`BdmToday.jsx`):** `TodayGreetingHeader` (keeps `AssignedLeadsCard`;
  BDM notifications surface here too — mount inside the header, never per
  screen) → today's follow-ups/to-dos (`FollowUpList`) → **Needs attention:
  architects not met in 14 days** → overdue follow-ups.
- **`+ New`:** seg toggle Lead / Architect. Lead = the existing capture form
  + Joinery received? + Remark box + Send to owner / I'll work this myself.
- **Log Activity:** unchanged form; Architect Meeting extended in Step 7.
- **Dashboard (`BdmDashboard`):** see Step 5.
- **My Leads:** All Leads (`LeadsListCard`) RLS-scoped to their tagged + own
  leads; pool leads read "Awaiting assignment".
- **My Architects (`/architects`):** firm → architects, with last meeting,
  leads referred, open pipeline.
- **Architect profile (`/architects/:id`):** identity, firm, portfolio,
  meetings (logged + scheduled), referred leads with stage/owner, win rate, won
  value.
- **Follow-ups:** the existing `/dashboard?tab=followups`.
- **Search:** existing `Search.jsx`; RLS already limits leads/clients to theirs;
  architects company-wide, tagged *Yours*.
- **Lead Detail:** editable while pooled & tagged to them (or owned by them);
  view-only after handoff; sees activities, remarks (read), stage history,
  loss reason; no quick actions / Log activity on someone else's lead.

### Owner
- **Today:** new **BDM pool card** — each pool lead: name, architect, BDM,
  joinery badge, waiting age, possible-duplicate hint, **Assign** (exec picker
  → writes `owner_employee_id` + `lead_owner_history`, reusing the Reassign
  owner write path).
- **Architect Network (`/network`, owner only):** see Step 6.

### Exec / coordinator / manager
- Lead Detail rail: **"Sourced by {BDM} via Architect {name}"** on tagged leads.
- New Lead unchanged. Architects visible company-wide (already the case once
  the universal-visibility migration is live).

---

## 8. Build plan — one step per session is fine; STOP after each

### Step 1 — Database
**Build:** `Schema/migration_bdm_role.sql` implementing §5 + §6, with a VERIFY
block (read-only queries + the behavioural checklist). Plain-language run
instructions for the owner.
**Confirm before building:** nothing new — all decided. Only re-confirm the
owner may change the two tags from the app (planned: yes, owner only, no UI yet).
**Exit:** owner ran it; §6 verification passes as a BDM session; exec and
coordinator spot-checks unchanged.
**STOP.**

### Step 2 — Role plumbing
**Build:**
- `src/lib/roles.js`: `ROLES.BDM`, label, `ROLE_OPTIONS` entry; **named
  capability helpers** (`canCreateLead`, `canLogActivity`, `canSeeTeamDirectory`,
  `isBdm`, `canAssignPool`, `canSeeArchitectNetwork`, `canSeeMyArchitects`) read
  by `BottomNav` (FAB + sidebar) and `FabSheet` — one flag per capability.
- `App.jsx` `allowedRoles`: add BDM to `/`, `/dashboard`, `/leads/new`,
  `/leads/:id`, `/activity`, `/profile`, `/search`. Not `/team`. `/employees/:id`
  → confirm.
- `Today.jsx`: explicit BDM branch; **replace the silent fall-through to `Home`
  with an explicit `sales_executive` branch** and a safe empty state for an
  unknown role.
- `Dashboard.jsx`: thin wrapper choosing `BdmDashboard` (placeholder for now)
  for the BDM, keeping `?tab=leads` / `?tab=followups` working.
- `ManageEmployeesSection`/`AddEmployeeForm`: BDM selectable; no
  coordinator/manager dropdown for it.
- `.claude/launch.json`: add `role-bdm` on port **5185**.
**Confirm before building:** BDM mobile tab bar contents and where My
Architects lives on mobile; whether a BDM may open their own
`/employees/:id` (it is exec-shaped); how owner reports label BDM-owned leads
and pool leads (and whether pool leads count in company open pipeline).
**Exit:** BDM logs in on 5185 and lands on a placeholder Today with the right
nav at both widths; all four existing roles' nav identical to before.
**STOP.**

### Step 3 — The handoff loop
**Build:** `+ New` toggle (BDM only) with the lead additions and the New
Architect form; pool card on `OwnerToday`; Assign from the card; notification
copy in `supabase/functions/send-followup-reminders/index.ts`
(`drainAssignments` `.in('kind', …)` + payload text; **do not rename the
function**) and `notificationQueries.js`; "Sourced by BDM via Architect" on
Lead Detail.
**Also Step 3 (owner's ruling at Step 2): exclude pool leads
(`owner_employee_id IS NULL AND bdm_employee_id IS NOT NULL`) from every owner
company figure until assigned** — the pool card is the only place they show.
Surfaces to cover (grep for more before building): Dashboard's
`fetchLeadsForBreakdown` consumers (open pipeline, category cards, pipeline by
stage, funnel), `fetchLeadsList` (All Leads), `fetchClosureForecast`, the
`leads_needing_attention` / `leads_category_breakdown` /
`dashboard_snapshot_metrics` / time-independent RPCs (SQL — needs a
migration), `OwnerToday`'s attention buckets, `MyTeam` per-card stats, Search.
Prefer ONE shared predicate (a JS helper + the same condition in SQL) over a
per-card filter. Pre-existing ownerless non-BDM leads are NOT pool leads and
keep showing as "Unassigned" — check the live count first.
**Confirm before building:** which sources the BDM's lead form offers (only
Architect referral, or all five?) and whether Send to owner applies to all;
possible-duplicate rule (same client mobile? same site locality?); 24-hour
nudge = push reminder or just a red age label; what the BDM sees on their
Today when their lead is assigned/won/lost (card wording); whether other
pre-existing ownerless leads (not BDM) should also appear in the pool — check
the live count first.
**Owner tasks:** run `Schema/migration_bdm_handoff.sql`, THEN redeploy the
Edge Function (`supabase functions deploy send-followup-reminders`) — the
function writes the `bdm_pool_nudge` kind the migration allows.
**Answers (2026-09-15):** all five sources for a BDM, Send to owner on all;
pool card top of owner Today, full width, hidden when empty; duplicate = another
lead whose CLIENT has the same 10-digit mobile; 24-hour nudge = a one-time push
to every active owner (no red label); save choice = two footer buttons
("Work it myself" / "Send to owner"); Joinery received = required yes/no, no
default; BDM's in-app updates = two period-scoped Dashboard cards ("Handed
over", "Closed") plus a one-line "N updates on your leads ›" on Today; the
owner's new-pool-lead alert is push-only in-app (the pool card is enough). No
pre-existing ownerless non-BDM leads exist (0 of 1,265), so that question was
moot.
**Exit:** full loop driven live — BDM creates pool lead with joinery + remark →
owner notified → owner assigns → exec notified → BDM notified → exec marks
won/lost → BDM notified; at both widths for BDM, owner, exec. Test rows cleaned
up.
**STOP.**

### Step 4 — BDM daily screens
**Build:** `BdmToday`, My Leads scoping/labels, `/architects` (My Architects),
`/architects/:id` (profile), Lead Detail permission rules for BDM, Search tags.
**Confirm before building:** Follow-ups screen — it **already exists for every
role including the owner**; remove it from the owner, or leave it? Who may open
an architect profile (BDM + owner only, or everyone since architects are
universal)? Today layout order and whether to show "N of your leads awaiting
assignment".
**Answers (2026-09-15):** Follow-ups screen stays for the owner (no change).
Architect profile opens for **every role** (each sees only what their RLS
allows). BDM Today = greeting (+ updates line) → a small "N of your leads are
waiting for the owner to assign ›" line → **Follow-ups due** (overdue first,
then today, one card) → **Architects to meet** (portfolio, no meeting 14+
days). My Architects = **grouped by firm** ("No firm" last). Profile = the
planned set: header (name, mobile, firm, portfolio), 4 stats (leads referred,
open pipeline, won value, win rate), Meetings (logged) + Referred leads.
Handed-off lead for the BDM = read-only WITH the Deal owner card and a "now with
{exec}" line; no Log activity, no quick actions. Loss reason shown on Lead
Detail to **everyone allowed to read it** (owner, a manager's team, the BDM —
RLS decides; exec/coordinator see nothing new).
**Exit:** every BDM screen verified at both widths; exec/coordinator/manager
Lead Detail unchanged.
**STOP.**

### Step 5 — BDM Dashboard + targets
**Build:** `BdmDashboard` cards, each separate (owner: don't merge):
| Card | Definition | Period? |
|---|---|---|
| Open pipeline brought | open tagged leads: count + `sumOpenPipelineValue` | snapshot |
| Stale architect meetings | portfolio architects with no BDM meeting in 14 days (floor `bdm_since`) | snapshot |
| Data completeness | `leads_completeness_detail(null)` under BDM RLS | snapshot |
| Follow-up gap | `leads_followup_gap_detail(null)` under BDM RLS | snapshot |
| Pipeline closed | tagged leads whose latest `won` row falls in the period: value + count (reuse `computeOrderValueActuals`) | period |
| Targets vs actuals | the 3 BDM metrics (§3) | period |
| Closure forecast | tagged leads owned by execs (`ClosureForecastCard` shape) | snapshot |
| Pipeline by stage | tagged leads | snapshot |
| Top 5 architects | rank by joineries in period; cols: joineries, visits (BDM meetings with that architect in period), open pipeline contribution (snapshot) | period |
Plus role-scoped target metrics in `targetMetrics.js` (`BDM_METRIC_OPTIONS`),
actual computations, and `SetTargetForm` able to target the BDM.
**Confirm before building:** "monthly visits" label when the period is a week
(planned: "Visits" = meetings in the chosen period); whether Pipeline closed
also shows lost; where the owner sets BDM targets (planned: Architect Network).
**Answers (2026-09-15):** layout = **"Right now" tiles on top** (the owner's
own Dashboard shape: Open pipeline · Architects to meet · Data completeness ·
Follow-up gap, each opening its detail list; numbers shown on a phone too, 2×2)
→ date range → Targets vs. actuals | Pipeline closed → Top 5 architects (full
width) → Handed over | Closed → Closure forecast → Pipeline by stage.
**Pipeline closed = won value + won count, then "N lost · X% win rate".** Top 5's
column is **"Meetings", counted in the chosen period.** **BDM targets are set
only in Architect Network (Step 6)** — Step 5 has no set-target form anywhere.
**Exit:** figures cross-checked against raw rows for the test BDM; exec
Dashboard unchanged.
**STOP.**

### Step 6 — Owner's Architect Network (`/network`)
**Planned content (confirm first):** per-BDM summary (3 targets vs actuals,
pool waiting / assigned, leads generated, won value from BDM leads, stale
architects); company-wide architect directory by firm with portfolio owner
("With {BDM}" / "Not with a BDM"), last meeting, leads referred, open pipeline,
won; Top architects for the period; link to each architect profile; set BDM
targets; optionally move an architect into/out of a BDM portfolio.
**Carried from Step 5 (must build here):** the owner's only way to set a BDM's
targets. `SetTargetForm.jsx` offers `METRIC_OPTIONS` (exec metrics) only and its
"Already set for" list is filtered to the exec roster it is handed — a BDM form
needs `BDM_METRIC_OPTIONS` (`bdm_architect_meetings`, `bdm_joineries_received`,
`bdm_leads_generated`, `src/lib/targetMetrics.js`) and the BDM as the employee.
The per-BDM actuals already exist: `computeBdmTargetActuals`,
`summariseClosedRows`, `topArchitects` (`src/lib/bdmDashboard.js`) and
`fetchBdmDashboardLeads(bdmId)` / `fetchBdmArchitectMeetings(bdmId, range)`
(filtered on the tag, so they work from an owner session too). Keep BDMs out
of the exec heatmap / `blendedAttainmentFor` (both read `METRIC_OPTIONS`).
**Confirm before building:** all of the above, desktop vs mobile layout, sidebar
placement, and whether the owner can move architects between portfolios.
**Answers (2026-09-15):** all four parts (per-BDM summary, set BDM targets, Top
architects, architect directory). **Two tabs — BDMs | Architects.** BDMs tab =
the BDM Dashboard's own `DateRangeSelector` (Today/Week/15D/Month/Quarter/
Custom; targets only for Week/Month/Quarter) → one card per BDM (3 targets vs
actuals, pool waiting / assigned, leads generated, won value, architects not
met in 14 days, **"+ Set targets"**) → Top 5 architects company-wide.
**Set targets = all 3 at once:** Week/Month/Quarter + the ‹ period › stepper,
three number boxes prefilled with what's set, one Save, "Already set for
{period}"; a blank box leaves that target alone. Architects tab = **a table
with search + a With BDM / Not with a BDM filter, firm as a column, sortable;
all-time figures (no date picker):** leads referred ever, open pipeline now, won
ever, last met; a row opens the profile; two-line rows on a phone.
**Moving architects: yes, one at a time**, an owner-only "Portfolio" control on
the architect profile (moving resets the 14-day clock via `bdm_since`).
**Nav:** desktop sidebar link next to My Team; phone = a tile at the top of the
owner's Dashboard beside My Team / Team follow-ups.
**Exit:** verified at both widths as owner; no other role can reach it.
**STOP.**

### Step 7 — Meetings
**Build:** `Schema/migration_bdm_meetings.sql` (outcome + upcoming projects —
owner runs **before** deploy); schedule an architect meeting = a `follow_ups`
row (`activity_type = 'architect_meeting'`, `party_id` = architect, due
date/time, push) — `FollowUpForm` needs an architect anchor; agenda (upcoming +
past) on My Architects / profile; Architect Meeting log gains outcome, upcoming
projects, next meeting (creates the next scheduled one); logging closes the
matching open scheduled meeting via `follow_ups.completed_by_activity_id`;
open scheduled meeting with `due_date < todayISO()` shows **"Not logged"**.
**Confirm before building:** the outcome list (proposed: Intro, Presentation,
Project discussion, Joinery collected, Site visit together, Other); where the
agenda lives; whether "Not logged" also appears on Today.
**Exit:** schedule → push → log → closes → target count increments; unlogged
past meeting shows "Not logged".
**STOP.**

### Step 8 — Docs + final pass
Fold a condensed "Business Development Manager" section into `CLAUDE.md`
(Roles, Routing, RLS, Screens, dev ports incl. 5184/5185), fix the stale
Follow-ups and `FOLLOWUPS.md` status lines, mark this file as historical, run
`npm run lint` + `npm test`, and walk the full matrix in §9 once more.
**STOP.**

---

## 9. Verification matrix (every step that touches UI)

Check at **mobile (<1024px) and desktop (≥1024px)** for each role the step
can affect. Key off the rendered role in `.vip-sidebar-foot-role`, not the
port name — a port's session may not match its label.

| Port | Launch config | Intended session |
|---|---|---|
| 5181 | `role-owner` | owner |
| 5182 | `role-coordinator` | sales_coordinator |
| 5183 | `role-exec` | sales_executive |
| 5184 | `role-manager` | sales_manager |
| 5185 | `role-bdm` (add in Step 2) | business_development_manager |

Leak checks that must hold after every step: BDM never sees an exec's own
lead/client/activity; BDM never assigns; BDM can't edit after handoff; exec
can't forge a BDM tag; existing roles' screens and figures unchanged.

---

## 10. Session log (append-only — newest last)

- **2026-09-15 — Step 0.** Q&A with the owner; all decisions in §3. Codebase
  facts in §4 verified by reading `Schema/` and `src/`. No code or SQL
  written yet. Next: Step 1.
- **2026-09-15 — Step 1 (SQL written, not yet run).** Owner confirmed: owner
  may change both tags; a BDM can never change a lead's owner. Wrote
  `Schema/migration_bdm_role.sql` (single transaction, prerequisite guard on
  the architect universal-visibility policy) and `Schema/verify_bdm_role.sql`
  (26 behavioural checks, auto-rollback). Found and handled while building:
  WITH CHECK OR-ing would let a BDM self-assign; exec couldn't edit a handed-off
  pool lead's client/site (hand-over trigger added). See §6's callout for all
  deltas. **Waiting on the owner:** (1) run the migration, (2) create the BDM
  test login, (3) run the verify script and paste the report. If every line is
  PASS, mark Step 1 ✅ and STOP before Step 2. If anything FAILs, fix the
  migration (it is re-runnable) and re-verify.
- **2026-09-15 — Step 1 ✅.** Owner ran `migration_bdm_role.sql`, created a
  BDM test login ("Test BDM", role `business_development_manager`) and ran
  `verify_bdm_role.sql`: **0 failed** (41 PASS, 1 INFO). First verify run hit a
  bug in the script itself (`text[] || 'literal'` parses the literal as an
  array) — fixed by using `array_append`; the migration was never at fault.
  3 active owners exist, all notified. **Not covered by the script, carry into
  Step 2's matrix:** (a) T08/T09 pass on ANY error, so they don't prove which
  layer refused (trigger vs RLS) — acceptable, both exist; (b) a
  `sales_coordinator` and `sales_manager` session were not impersonated — spot-
  check both roles' Today/All Leads/Lead Detail are unchanged in Step 2;
  (c) BDM reading `lead_owner_history` is untested until the app's Assign
  writes a history row (Step 3). Next: Step 2 — ask its *Confirm before
  building* questions first.
- **2026-09-15 — Step 2 (built; existing-role check pending).** Owner's
  answers: (1) **My Architects on mobile = a tile at the top of the BDM's
  Dashboard** (same pattern as Follow-ups/My Team) — added at Step 4 when the
  route exists, not before (no dead links); desktop gets a sidebar link then
  too. (2) **A BDM cannot open any `/employees/:id`** (exec-shaped page).
  (3) **Pool leads are EXCLUDED from the owner's company figures until
  assigned** — the pool card is the only place they show (overrides my
  recommendation). Moved into **Step 3** (untestable before pool leads can be
  created); see Step 3's list. (4) **A BDM-owned lead shows the BDM's name**
  in owner reports, never "Unassigned".
  Built: `roles.js` gained `ROLES.BDM`, the label, and one function per
  capability (`canCreateLead`, `canLogActivity`, `canSeeTeamDirectory`,
  `canOpenEmployeeProfiles`, `isBdm`) plus `rolesWith(capability)`, which
  `App.jsx`'s `allowedRoles` now derive from — so a nav link and its route
  can't disagree. `BottomNav` reads those functions (desktop "All Leads" reads
  "My Leads" for a BDM). `Today.jsx` names every role and no longer falls
  through to the exec `Home`; an unknown role gets a message. New
  `DashboardRoute.jsx` sends a BDM to new `BdmDashboard.jsx` (reports =
  placeholder until Step 5; `?tab=leads` = RLS-scoped `LeadsListCard`;
  `?tab=followups` = `FollowUpsCard`). New placeholder `BdmToday.jsx` (Step 4
  replaces it). `RANGE_LABELS` moved to `dateRanges.js` (shared).
  `fetchDecidedStageHistory` embeds the owner's name and `buildWinRatePanel`
  uses it as a fallback (the only owner-report place that printed
  "Unassigned" for a non-exec owner; every other one already reads an embed).
  `role-bdm` launch config on 5185. Tests: `roles.test.js` + a win-rate test
  added; suite 363/364 — the one failure is pre-existing
  (`leadRemarksQueries.js` unpaged, from commit 39ffe25, flagged as a separate
  task, not part of this work). Lint: no errors.
  **Verified as the BDM** (the session was on port **5184**, not 5185):
  desktop sidebar = Today, New Lead, Activity Log, Dashboard, My Leads,
  Follow-ups, Search, no My Team; mobile tabs = Today · Leads · + · Dashboard ·
  Search, FAB sheet = New lead + Log activity; `/employees/1` and `/team`
  redirect to `/`; `/activity`, `/leads/new`, all three Dashboard tabs render;
  no console errors; no horizontal scroll at 375px; the new win-rate embed
  runs without a PostgREST error.
  **Still to verify before ✅:** owner, coordinator, exec, manager — nav at
  both widths identical to before, Today renders their own screen, Dashboard
  renders the shared page, owner's win-rate panel opens.
  **Known, deliberately left for Step 4:** a BDM on My Leads/Lead Detail can
  click an exec's name (`EmployeeLink`) and get bounced to `/` — Step 4 must
  render names as plain text wherever `canOpenEmployeeProfiles` is false. A
  BDM visiting `/leads/new` today still gets the exec form (lead owned by
  themselves) — Step 3 replaces it with `+ New`.
- **2026-09-15 — Step 2 ✅.** Existing roles verified as real sessions
  (sessions this time: owner 5181, coordinator 5182, exec 5183, **manager
  5185, BDM 5184** — ports swapped vs the launch-config names; always key off
  `.vip-sidebar-foot-role`). Desktop sidebars: owner = Today, New Lead,
  Dashboard, All Leads, Follow-ups, My Team, Search; coordinator and exec =
  Today, New Lead, Activity Log, Dashboard, All Leads, Follow-ups, Search;
  manager = the same + My Team. Mobile (375px) for all four: Today · Leads · + ·
  Dashboard · Search, no horizontal scroll; FAB sheet = New lead only for the
  owner, New lead + Log activity for the other three; Dashboard tiles = owner
  Team follow-ups + My Team, coordinator Team follow-ups, exec My follow-ups,
  manager My follow-ups + My Team. Today renders each role's own screen
  (OwnerToday / CoordinatorToday / Home / ManagerToday with My day·My team).
  Shared Dashboard renders its full card set for all four with no console
  errors; the owner's win-rate panel opens with real exec names. Route gates
  unchanged: owner `/activity` → `/`, exec `/team` → `/`, manager `/team` ok,
  coordinator `/activity` ok, owner `/employees/41` ok. Next: Step 3 — ask its
  *Confirm before building* questions first.
- **2026-09-15 — Step 3 (built; new account/session).** Answers are recorded
  under Step 3 in §8. Built:
  - **`src/lib/poolLeads.js`** — THE pool rule (`isPoolLead`,
    `NOT_POOL_LEAD_FILTER`, `applyPoolExclusion`, `withoutPoolLeadRows`), plus
    `sourcingArchitect`, `findPossibleDuplicates`, `waitingLabel`. Every lead
    fetcher that feeds a company figure now takes `includePool` (default
    false): `fetchLeadsForBreakdown`, `fetchLeadsList`, `fetchClosureForecast`,
    `fetchNewLeadsBySource`, `fetchDecidedStageHistory`,
    `fetchStageHistoryForFunnel`, `fetchLossReasons`, `fetchWonStageHistory`,
    Search's `searchAll`. Only BDM screens pass true (My Leads; Search when the
    viewer is a BDM). Checked live: two `.or()` filters on one query AND
    correctly.
  - **`Schema/migration_bdm_handoff.sql`** — `notifications.kind` +
    `bdm_pool_nudge`; the same pool rule inside all 8 dashboard RPCs
    (`leads_needing_attention`, `leads_category_breakdown`,
    `dashboard_snapshot_metrics`, `leads_on_hold_detail`,
    `leads_completeness_detail`, `leads_followup_gap_detail`,
    `leads_workload_by_owner`, `leads_open_deal_ranking`). Generated by script
    from each function's latest file, one predicate added, nothing else
    changed. The predicate is role-aware — a BDM still counts their own pool
    leads (Step 5 reads these RPCs under BDM RLS). **Layering:** re-running
    `migration_time_independent_dashboard_metrics.sql`,
    `migration_leads_category_breakdown_rpc.sql` or
    `migration_stale_7day_tile.sql` after it puts pool leads back into owner
    figures.
  - **`+ New`** — `NewRoute.jsx` picks `BdmNew.jsx` (Lead / Architect seg
    toggle; both forms stay mounted so switching doesn't wipe a half-filled
    lead) for a BDM, `LeadQuickCapture` for everyone else. `LeadQuickCapture`
    gained a BDM mode (Joinery required, Remark → first `lead_remarks` row,
    two save buttons; Enter never saves for a BDM) and now keeps
    `creatorEmployeeId` (sites.discovered_by / parties.created_by) separate
    from the lead's owner — the §6 app obligation. New
    `components/NewArchitectForm.jsx` (name + 10-digit mobile required; the
    number is checked as the tenth digit lands and an existing ARCHITECT with
    it blocks Save — another party type with the number only warns; firm
    optional; firm address only for a firm created right there).
    `createActionLabel(role)` in `roles.js` names the action "New" for a BDM in
    the sidebar, FAB sheet and header button.
  - **Owner:** `components/BdmPoolCard.jsx` at the top of `OwnerToday` (hidden
    when empty; joinery tag, plain waiting age, duplicate hint, two-tap
    Assign). Assign and Lead Detail's Reassign now share ONE write,
    `assignLeadOwner()` in `leadOwnerHistory.js`; the pool card passes
    `requireUnassigned` so a second owner's click can't silently re-assign a
    lead the first just handed out. Assign lists `fetchActiveSalesExecs()`
    (execs + managers), same as Reassign.
  - **BDM:** `BdmUpdatesLine` mounted in `TodayGreetingHeader` (renders
    nothing for other roles, no request); `BdmLeadUpdateCards.jsx` (Handed over
    = first assignment out of the pool in the period; Closed = latest won/lost
    in the period, dropped if reopened since; exec names plain text) on the BDM
    Dashboard under a `DateRangeSelector`; opening that Dashboard marks the
    updates seen. Pure builders in `lib/bdmLeadUpdates.js`, fetches in
    `lib/bdmQueries.js`.
  - **Lead Detail:** "Sourced by {BDM | you} via Architect {name}" in the Deal
    owner card for every role (architect = referrer if an architect, else the
    other party if one); a pool lead's owner reads "Not assigned yet — waiting
    for the owner."
  - **Edge Function:** pushes all four bdm_* kinds plus `bdm_pool_nudge`
    (`assignmentPayload`), skips (and stamps) a pool push whose lead was
    assigned meanwhile, and `queuePoolNudges()` (scheduled runs only) writes
    the one-time 24-hour nudge rows.
  - Theme section 30. Tests: `poolLeads.test.js`, `bdmLeadUpdates.test.js`,
    `createActionLabel` in `roles.test.js` — suite 394/394; lint 0 errors.
  **Verified (render, no writes):** BDM `+ New` at 1100px and 375px (toggle,
  field order, two footer buttons fit at 375), Architect tab duplicate check
  against a real architect's number (blocked, "Not with a BDM"), FAB sheet
  reads "New — A lead from an architect, or a new architect", BDM Dashboard
  cards an even pair (478px × 2, no gap) with empty states, no console errors.
  Owner Today / Dashboard (all cards) / All Leads (1,265) / Lead Detail;
  exec, coordinator, manager New Lead unchanged (one Save lead; coordinator
  keeps "Who is this for?"), their Today and Dashboard error-free. Caught and
  fixed during this pass: `targetQueries.js` used `withoutPoolLeadRows`
  without importing it (lint doesn't flag undefined names in this config).
  **Not yet verified — the live loop** (needs the SQL + deploy first): BDM
  creates a pool lead with joinery + remark → owner's pool card and push →
  assign to the TEST exec ("exec", so no real rep's phone buzzes) → exec
  push + BDM "Handed over" row + Today line → exec marks won/lost → BDM Closed
  row + push → (the 24-hour nudge only fires on a lead a day old, so it is
  checked by reading the function's `poolNudges` result, not waited for) → clean up
  the test lead (`delete_lead_totally`) and test parties from the owner port.
  Also unexercised: Assign's "already assigned by another owner" path.
  **Found, not this step's:** `SiteSearchOrCreate.jsx:106` calls an undefined
  `setCustomStage` — the component isn't imported anywhere today.
  **Working-tree junk explained:** an edit hook (the ruflo `hook-handler.cjs`
  wired in `.claude/settings.json`) is creating 0-byte files named after code
  that follows `=>` in edited files — this session added `(includePool`,
  `,-`, `l.owner_employee_id`, `n.kind`, `src/c.id`, `{,-` at the minutes
  those edits happened. Nothing deleted; the owner decides.
- **2026-09-15 — Step 3 ✅.** Owner ran `migration_bdm_handoff.sql` (check
  query: 8 rows, all `has_pool_rule = true`) and redeployed the Edge Function
  with `npx supabase functions deploy send-followup-reminders` (no global CLI
  on this machine — `npx` works, the project is already linked; the "Docker is
  not running" warning is harmless). Invoked the function in
  `only: 'assignments'` mode right after: no error, so the new embeds are
  valid. Owner OK'd the other two owners receiving test pushes.
  **Live loop (sessions: owner 5181, exec 5183, BDM 5185 — matched names):**
  BDM created #1465 (Architect referral, new client + new architect, Joinery
  Yes, remark, Send to owner) and #1466 (Walk-in, same client, Joinery No) through
  the real form. DB: owner NULL, tag 46, stage derived to joinery_follow_up
  with a stage_history row, remark saved, architect tagged into the portfolio
  with `bdm_since`, client/site created by the BDM. Owner figures unchanged
  while pooled (category RPC 1,265, snapshot/workload 797, All Leads 1,265;
  `includePool` shows 1,267; Search finds the client but not the pooled leads).
  **Gotcha for future tests:** a tab loaded before a code edit serves the OLD
  module to `await import('/src/…')` — reload before testing query changes
  from the console, or the result is meaningless. Owner pushes stamped
  `notified_at` ~4s after each insert. Pool card correct at 504px and 1100px
  (first on the page, joinery tag, correct waiting age, duplicate hint on both).
  Owner assigned #1465 → test exec via the card. BDM: `bdm_lead_assigned` row,
  Today "1 update" line → Dashboard "Handed over", marked seen; an UPDATE on
  the handed-off lead now matches 0 rows; `lead_owner_history` readable (Step 1
  gap (c) closed). Exec: "A lead was assigned to you", Lead Detail "Sourced by
  Test BDM via Architect ZZ Test Architect BDM" + the BDM's remark; marked Won
  ₹4,20,000 from the mobile quick-actions sheet (**opened by a real tap —
  CLAUDE.md Open TODO #4 can be closed at Step 8**). BDM: `bdm_lead_won`,
  Closed "Won · ₹4.2L · exec". Concurrency: #1466 assigned in the background,
  then the stale card's Assign clicked (target: test manager) — nothing
  written, one history row, row left the card. Hand-over trigger: both sites and
  the client moved to the exec only once no pool lead still held the client;
  architect stayed with the BDM. Exec marked #1466 Lost (Price): BDM reads the
  reason, `bdm_lead_lost`, Closed "Lost — Price · exec". Owner figures then
  1,267. Cleanup from the owner port: `delete_lead_totally` ×2 + parties
  1681/1682 — leads, parties, sites, site contact, remarks, history, loss
  reason, notifications all 0; total back to 1,265.
  **Fixed after the loop (code only — not re-shown, it would need another round
  of owner pushes):** the pool card kept a stale "(also waiting here)" hint
  about a lead it had just assigned, and a stale-click "already assigned"
  vanished silently; it now rewrites the hint and says "already assigned by
  another owner — nothing changed".
  **Not exercised:** the 24-hour nudge (needs a day-old pool lead; the next
  real one will show it), and a push actually arriving on a BDM or exec phone
  (the test accounts have no subscribed device, so their rows stay
  un-notified by design). Next: Step 4 — ask its *Confirm before building*
  questions first.
- **2026-09-15 — Step 4 ✅ (no SQL, no deploy needed).** Answers recorded under
  Step 4 in §8. Built:
  - **`lib/architectStats.js`** (pure, tested): `ARCHITECT_MEETING_DAYS` (14,
    deliberately NOT attention.js's ATTENTION_DAYS), `architectsToMeet` (clock
    = later of last meeting and `bdm_since`), `architectIdForLead` (= Lead
    Detail's "via Architect" attribution, referrer first), 
    `summariseArchitectLeads` (win rate won/(won+lost), null until decided;
    open pipeline via `sumOpenPipelineValue`, i.e. on-hold excluded like the
    Dashboard tile), `groupArchitectsByFirm`, `portfolioTag`, `lastMetLabel`.
    **`lib/architectQueries.js`**: portfolio, one architect, architect
    meetings (activities.party_id), leads for architects (pool rule applies).
    `lib/firmLabel.js` — moved out of PartySearchOrCreate.jsx so pure modules
    can use it.
  - **`roles.js`**: `canSeeMyArchitects` (BDM) and `canOpenArchitectProfiles`
    (all five), read by the routes, the sidebar link and the Dashboard tile.
  - **`BdmToday.jsx`** (replaces the placeholder): waiting-count line →
    Follow-ups due (FollowUpList + "+ Add reminder", same handlers as Home) |
    Architects to meet (5 rows + "more · My Architects").
  - **`MyArchitects.jsx`** `/architects` (BDM): search + firm-card grid
    (auto-fill); sidebar "My Architects" (IconArchitect) + mobile tile on the
    BDM Dashboard. **`ArchitectProfile.jsx`** `/architects/:id` (every role):
    band with portfolio pill, 4 stats, Meetings + Referred leads, a "counts
    only what you can access" note for anyone but the owner.
  - **Links to the profile:** Search architect rows (instead of their most
    recent lead), Lead Detail "via Architect {name}" and Contact rows, My
    Architects, Today. Search + party pickers show "Yours" / "With {BDM}".
  - **Lead Detail:** `isMyPoolLead` → canEdit (and may move stage back);
    `isMyHandedOffLead` → read-only page WITH the rail and a teal "now with
    {exec}" note; Log activity only on a lead the BDM owns (not on pool leads —
    it would land on the exec's lead credited to the BDM). Loss reason line
    for a lost lead, fetched per lead; RLS decides who sees it.
  - **Names for a BDM viewer:** `EmployeeLink` and new `EmployeeNameLink`
    render plain text when `canOpenEmployeeProfiles` is false — used by
    LeadActivityTimeline, FollowUpList, Lead Detail's owner card, All Leads,
    Search "Worked with", the profile. (Closes Step 2's known issue.)
  - My Leads: a pool lead's owner reads "Awaiting assignment" (desktop cell
    and mobile row). Theme section 31. Tests 409/409 (+15), lint 0 errors.
  **Verified live:** real architect AR Jaswant (#609) as owner — 13 referred,
  ₹14.2L open, ₹31.5L won, 67% — cross-checked against raw rows, exact; the
  same page as exec and BDM shows 0 with the scope note (no leak). Test data
  (no push to any real person — lead created "work myself", moved to the pool
  by the owner, which fires no notification): New Architect form end to end
  with a new firm + address (Step 3's untested path) — tagged, `bdm_since`,
  firm linked. BDM Today: waiting line, Arch Two flagged (back-dated
  `bdm_since` 20d), Arch One (met today) not. My Architects: 2 firm groups;
  profile: pill, meeting, "Awaiting assignment" lead; My Leads label; Search
  "Yours" (owner: "With Test BDM"), rows open the profile. Pool lead Lead
  Detail as BDM: 4 editors + Change stage/Set follow-up, no Log activity/
  Reassign/Delete; RLS accepted site edit, stage moved BACK, history row,
  remark. After assignment: handed-off view with rail, owner not a link, no
  actions. Lost (Price, competitor): reason shown to owner, manager (sm) and
  BDM; not to exec or coordinator. Exec's own ordinary lead unchanged. All at
  1100px and 375px, no console errors, no horizontal scroll. Cleanup: lead,
  site, meeting, 4 parties deleted; total 1,265.
  **Known, deliberately left:** a BDM's "Set follow-up" on a pool lead
  creates their own reminder linked to the lead, which (via the
  next_followup_date trigger) still counts on that lead after it's handed to
  an exec. FollowUpForm's lead picker for a BDM still lists only leads they
  own (not their pool/handed-off ones) — unchanged on purpose for the same
  reason. The real BDM's portfolio is empty until the owner's architect
  import runs. An older "ZZ Test Client Remarks" party (#1664, not from these
  sessions) exists — owner to decide. Next: Step 5 — ask its *Confirm before
  building* questions first.
- **2026-09-15 — housekeeping (owner's request, between steps).** Deleted the
  15 zero-byte untracked junk files the edit hook had created (`(includePool`,
  `(prev`, `,`, `,-`, `40`, `` ` ``, `l.owner_employee_id`, `migration's`,
  `n.kind`, `o.value).filter(capability),+},+,`, `offer`, `src/c.id`, `{,`,
  `{,+`, `{,-`) — only files of 0 bytes, every other untracked file untouched.
  The hook itself is unchanged, so more may appear after future edits. Fixed
  `SiteSearchOrCreate.jsx`'s stray `setCustomStage('')` (a leftover from the
  "Other…" stage removal that would have crashed "+ Add new site"; the
  component is still unmounted). `siteStageClosedList.test.js`'s custom-stage
  guard missed it — `/\bcustomStage\b/` can't see `setCustomStage` — so it is
  now `/custom(Site)?Stage\b/i`. 409/409 tests, lint 0 errors. Step 5 still
  waits for the owner's go-ahead.
- **2026-09-15 — Step 5 ✅ (no SQL, no deploy needed).** Answers recorded under
  Step 5 in §8. Built:
  - **`lib/bdmDashboard.js`** (pure, tested): `inRange` (naive timestamps via
    `parseTimestamp`), `computeBdmTargetActuals` (meetings = the BDM's
    architect_meeting activities in the period, any party; joineries / leads
    generated = the BDM's tagged leads CREATED in the period, pool and own),
    `summariseClosedRows`, `topArchitects` (period joineries → period meetings
    → open pipeline → name; only architects with a joinery or a meeting in the
    period qualify; attribution = `sourcingArchitect`, a firm meeting credits
    nobody; open pipeline is a snapshot via `sumOpenPipelineValue`).
  - **`targetMetrics.js`**: `BDM_METRIC_OPTIONS` with a `bdm_` prefix so no
    legacy exec `metric_name` (e.g. `architect_meeting`) can ever read as a BDM
    target. Confirmed live: `targets` has no CHECK on metric_name (inserts OK).
  - **`pipelineValue.js`**: `countOpenPipelineLeads`, `stageRowsFromLeads` —
    the shared Dashboard's fallback now calls both instead of inline copies.
  - **Queries** (`bdmQueries.js`): `fetchBdmDashboardLeads(bdmId)` (the
    Dashboard's own exported `BREAKDOWN_LEAD_COLUMNS` + `joinery_received` +
    named referrer/other embeds, filtered on the tag), 
    `fetchBdmArchitectMeetings(bdmId, range)`. Everything else is reused under
    BDM RLS: `fetchClosureForecast(true)`, `fetchDashboardSnapshotMetrics(null)`,
    `fetchCompletenessDetail/FollowupGapDetail(null)`,
    `fetchStageHistoryForFunnel(true)`, `fetchTargetsForPeriod` — §4's "verify
    at Step 5" item holds: the gap reads `leads.next_followup_date` only, and
    all of them return exactly the BDM's tagged leads (5 of 5, own pool lead
    included via the role-aware predicate).
  - **Components**: `BdmRightNow` (reuses `.vip-rightnow-grid` +
    `.vip-dd-kpi-tile`), `BdmTargetsCard` (reuses the now-exported `TargetRow`),
    `BdmTopArchitectsCard` (one DOM: a table ≥1024px, two-line rows with unit
    words below), `BdmPipelineClosedCard` in `BdmLeadUpdateCards.jsx`,
    `PipelineByStageCard` (moved out of `Dashboard.jsx`, used by both pages),
    `hooks/useBdmPeriodRows.js` (`useClosedRows` — ONE fetch feeds Closed and
    Pipeline closed). Drill-down kind `architects`
    (`buildArchitectsToMeetPanel` + `ArchitectsBody`, Today's `.vip-arch-row`).
    Theme section 32. `BdmDashboard.jsx` rebuilt; Reports fetches start only on
    the Reports view (not `?tab=leads/followups`).
  **Decided while building (not asked — technical, recorded):** (1) Pipeline
  closed reduces the Closed card's own rows (`buildClosedRows`: latest won/lost
  in the period, dropped if reopened since) rather than
  `computeOrderValueActuals` as §8 planned — the figure and the list on one page
  must not disagree; the only difference is a lead won then reopened. (2)
  Closure forecast = every one of the BDM's leads with a quote sent or a
  probability (their own worked and pool leads included), not "exec-owned
  only" — consistent with the rest of the page, which is "every lead you
  brought in". (3) The gap drill-down's swipe actions are OFF for a BDM ("Set
  date" would create a reminder for the exec who owns the lead). (4) Owner name
  on the BDM's own pool leads reads "Awaiting assignment" in the drill-downs and
  forecast (display-only relabel), matching My Leads. (5) Targets card hidden for
  Today/15D/Custom like the shared card; Pipeline closed then spans the row.
  **Verified live** (test rows — no push to any real person: leads created
  "work myself", moved to the pool by the owner, assigned to the test exec, so
  only the test exec/BDM got notifications): 2 portfolio architects (Alpha
  back-dated `bdm_since` 20d), 5 clients, 5 leads (joinery Y/Y/N/Y/N, L4
  back-dated 40d), 4 architect meetings (2 today, 1 at -5d, 1 at -20d); owner
  pooled + assigned L1–L4 (history rows), L1 RFQ ₹5L 60%, L2 won ₹3L, L3 lost
  (Price), L4 quote ₹2L; L5 left in the pool; month targets 5/4/6. Expected vs
  shown, all exact: Right now ₹7.0L · 3 leads / 1 architect / 33% / gap 3
  (100%); Week targets "no target set" + note, Top 5 Alpha 2·0·₹5.0L, Beta
  0·2·₹2.0L; Month targets 3/5, 2/4, 4/6, Beta meetings 3; Quarter Alpha 2·1,
  Beta 1·3; 15D no targets card, Pipeline closed full width; Pipeline closed
  ₹3.0L won · 1 lead, 1 lost · 50%; Handed over 4; Closed Won ₹3.0L / Lost —
  Price (ZZ S5 Rival); forecast 2 leads, weighted ₹3.0L; Pipeline by stage
  calling 1 / RFQ 1 ₹5L / quote 1 ₹2L / won 1 ₹3L / lost 1. All four tile
  panels, both Details links, the architects panel (full-screen at 375px). BDM
  at 1280 and 375: grid pairs aligned (560+560), 4 equal tiles / 2×2, no
  horizontal scroll, no console errors after reload; My leads and My follow-ups
  views unchanged. Owner Dashboard: Pipeline by stage identical (sum 1,269 =
  1,265 + the 4 assigned test leads — the pool lead still excluded), paired with
  the funnel, Details opens. Exec, coordinator and manager Dashboards render the
  same cards at both widths; the manager's "My team" (client-side
  `stageRowsFromLeads` path) matches the exec's RPC-path rows exactly. Cleanup
  from the owner port: `delete_lead_totally` ×5, 4 activities, 3 targets, 7
  parties; sites/history/loss reasons/follow-ups all 0; leads back to 1,265.
  **Known, deliberately left:** the real BDM (none exists yet — only Test BDM)
  sees every card empty until the architect import and real leads; with no
  targets set, the targets card shows no actual counts at all (the shared
  card's behaviour) — Step 6 gives the owner a way to set them. Next: Step 6 —
  ask its *Confirm before building* questions first.
- **2026-09-15 — Step 6 ✅ (no SQL, no deploy needed).** Answers recorded under
  Step 6 in §8. Live counts before building: 214 architects, 26 firms (13
  architects firm-linked, 21 legacy `firm_name` only), 177 leads with a
  referrer, 24 architect meetings (9 naming an architect), 1 BDM (Test BDM), 0
  portfolio architects — which is what settled "table, not firm cards". Built:
  - **`/network` → `pages/ArchitectNetwork.jsx`**, owner only via new
    `canSeeArchitectNetwork` (`roles.js`), read by the route, the sidebar link
    (after My Team, `IconArchitect`) and a mobile tile on the owner's Dashboard
    (after My Team). Tabs in the URL (`?tab=architects`) so Back from a profile
    lands on the right tab. `AppNav` header "Architect Network".
  - **`lib/architectNetwork.js`** (pure, tested): `summariseBdm` (reuses
    `computeBdmTargetActuals`, `buildClosedRows`, `buildHandedOverRows`,
    `architectsToMeet` — each input may be null while loading),
    `buildDirectoryRows` / `filterDirectoryRows` / `sortDirectoryRows`,
    `targetInputsFrom` / `targetWrites` (blank = leave alone, unchanged = not
    written, non-integer = refused).
  - **`topArchitects` takes `bdmIds`** as well as `bdmId` — the owner's Top 5 is
    the BDM's own rule over every BDM; an exec's architect meeting never counts.
  - **Queries:** `fetchAllBdmLeads`, `fetchActiveBdms`,
    `fetchBdmsArchitectMeetings(ids, range)` (the old single-BDM call wraps it),
    `fetchClosedRows(range, { taggedOnly })` (an `!inner` embed so the owner
    doesn't download every company won/lost), `fetchAllPortfolioArchitects`,
    `fetchAllArchitects`, `fetchAllArchitectMeetings` / `fetchAllArchitectLeads`
    (no id lists in the URL — the directory grows), `updateArchitectPortfolio`
    (`.select()` + checks the tag really changed: RLS 0 rows and the trigger's
    silent revert both surface as an error).
  - **Components:** `BdmNetworkCard` (targets | 6 figures, side by side ≥1024px;
    "Architects to meet" opens the existing `architects` drill-down),
    `BdmTargetsForm`, `ArchitectDirectory` (one DOM: 7-column sortable grid ≥1024px,
    wrapped rows + a sort dropdown below), `PeriodPicker` — **extracted from
    `SetTargetForm`**, which now uses it (type / ‹ range › / Jump to current).
    `TargetRow` gained `showActualWithoutTarget` (off everywhere else);
    `BdmTopArchitectsCard` gained `emptyText`. Owner-only "Change" portfolio
    control on `ArchitectProfile` (select + Save; "restarts the 14-day clock").
    Theme section 33. Tests 431/431 (+22), lint 0 errors.
  **Decided while building (not asked — recorded):** (1) Directory default sort
  = leads referred, high to low; each column has one fixed direction. (2)
  Directory "Last meeting" = anyone's (matches the profile's Meetings card),
  while a BDM card's "architects to meet" counts only that BDM's own meetings
  (matches what the BDM sees). (3) Pool leads stay out of the directory's lead
  figures (app-wide owner rule) — so an architect's pool lead shows on the BDM
  card but not in the directory until assigned. (4) Tile set: Open pipeline ·
  Waiting in pool · Handed over · Won · Win rate · Architects to meet; "leads
  generated" is already a target row, so not repeated. (5) BDM names are plain
  text (a BDM has no `/employees/:id`). (6) Only active BDMs get a card (a BDM
  holding architects can't be deactivated).
  **Verified live** (owner 5181, coordinator 5182, exec 5183, manager 5184,
  BDM 5185 — matched names). Real data, no writes: AR Jaswant (#609) 13 leads /
  ₹14.2L open / ₹31.5L won — same as his profile; SAHIL 4 / ₹68.5L = raw rows
  (₹22L + ₹46.5L); "Ar Kamaljeet Singh · last met 3d ago" = his 11 Sep meeting;
  Last-meeting sort lists the 8 met architects most recent first. Test rows (no
  push to a real person: leads "work myself", pooled by the owner, assigned to
  the test exec): architects Alpha/Beta, 3 leads (joinery Y/Y/N), 1 BDM meeting
  with Alpha, 2 assigned, 1 won ₹3L, Beta `bdm_since` back-dated 20d. Expected vs
  shown, all exact: targets actuals 1/2/3 with "no target set"; ₹5.0L · 2 open;
  pool 1; handed over 2; won ₹3.0L · 1; 100%; architects to meet 1 (panel: Beta
  20d); Top 5 = Alpha 2·1·₹5.0L — and the BDM's own Dashboard showed the same
  figures and Top 5. **Set targets through the form:** week 5/4/6 → card 1/5,
  2/4, 3/6, boxes re-read, Save greys out; next week meetings 7 → saved as W39,
  card unchanged, "The card is showing 14 – 20 Sep 2026, so it won't appear
  there." **Move through the profile:** Beta out (tag + `bdm_since` NULL) and
  back (since = today) → card's architects to meet 1 → 0. Negative: Test BDM
  (Beta's creator) → "The move didn't save…", exec → "The architect wasn't
  updated…", DB unchanged. `/network` as coordinator, exec, manager, BDM →
  redirected to `/`, no link; their sidebars as recorded at Step 2. Directory
  shows both test architects "With Test BDM" (Alpha 1 lead — its pool lead
  excluded). Desktop 1280: halves 543+543, stats 3 columns, directory tracks fit
  (no row overflow), no horizontal scroll. Phone 375: tile on owner Dashboard,
  card stacked, 2×3 figures, directory two-line rows, targets form and
  portfolio form fit, no overflow. Exec `SetTargetForm` after the extraction:
  owner (desktop) and coordinator (phone) — step, Jump to current, Week→Month,
  6 exec metrics only. Owner console clean. **Caught and fixed while looking:**
  the figures grid stopped short of the card edge on a phone (`align-self:
  start` in a flex column — now desktop-only); the phone sort dropdown truncated
  "Sort: Leads referred" (labels shortened, measured to fit 122px).
  Cleanup from the owner port: `delete_lead_totally` ×3, 1 activity, 4 targets,
  5 parties; sites / stage & owner history / notifications / follow-ups all 0;
  leads 1,265, architects 214.
  **Known, deliberately left:** the portfolio filter reads "With {BDM name}", so
  a long real BDM name may truncate in the phone's half-width dropdown; the
  real BDM's card is empty until the architect import; dark mode not looked at
  (section 33 is tokens only). 5 new zero-byte junk files from the edit hook
  (`({,`, `,`, `,+`, `,-`, `{,+`) — not deleted, owner to decide. Next: Step 7 —
  ask its *Confirm before building* questions first.
