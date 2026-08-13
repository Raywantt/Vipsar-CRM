# PHASE 9 — Pre-Pilot Audit, Simulation & Verification

Running log. Each phase appends its own section. A fresh session with zero
prior context should be able to resume from the next phase by reading only
this file, `DECISIONS.md`, and `Schema/`.

---

## Phase 0 — Prerequisites and safety

**Status: COMPLETE except items 1 and 2 (blocked on live DB access — see Open questions).**
**Date: 2026-08-12. Branch: `phase9-audit` (created off `master` at `e8b9015`).**

### What I did

Read the full schema (`Schema/tostem_crm_schema.sql`), the RLS model
(`Schema/rls_policies.sql`), and all four migrations that layer on top of it
(`migration_lead_change_log.sql`, `migration_sales_coordinator.sql`,
`migration_coordinator_entry.sql`, plus the backlog bundle). Grepped `src/`
for every reference to `plans`, `follow_ups`, and `logged_by_employee_id`.
Probed the live REST API with the anon key. Created the working branch.

**Branch note:** `phase9-audit` was created with 11 modified files and 2
untracked files already in the working tree (the coordinator entry-on-behalf
work from 2026-08-11, uncommitted). These carried over to the branch
untouched — nothing was stashed or discarded. `Schema/production_schema_dump.sql`
is present but **empty (0 bytes)**; it is not a usable schema reference.

---

### 1. Confirm the clean state — ⚠️ BLOCKED

**Row counts could not be obtained.** The only credential in the repo is the
anon key (`.env`). Under this project's RLS, an unauthenticated anon request
resolves no `auth.uid()`, so every policy evaluates false. Confirmed live:

```
GET /rest/v1/employees  →  42501 "permission denied for table employees"
```

That is the correct and expected behaviour (a Phase 5 data point in its own
right: **the anon key alone reaches nothing**), but it means I cannot count
rows. See Open questions.

---

### 2. The employees ↔ Auth linkage — ✅ MAPPED (structure), ⚠️ value pending

**The linking column is `employees.auth_user_id`, type `UUID`, `UNIQUE`,
FK to `auth.users(id)` with `ON DELETE SET NULL`.**

`employees.id` is `SERIAL` (integer) and is what every other table's FK
points at (`leads.owner_employee_id`, `activities.employee_id`,
`employees.coordinator_id`, etc. — all `INTEGER`).

RLS never compares `auth.uid()` to a table column directly. Everything routes
through two `SECURITY DEFINER STABLE` helpers defined in `rls_policies.sql`
STEP A2:

```sql
CREATE FUNCTION current_employee_id() RETURNS integer ... AS $$
  SELECT id   FROM employees WHERE auth_user_id = auth.uid() AND is_active = true;
$$;
CREATE FUNCTION current_employee_role() RETURNS text ... AS $$
  SELECT role FROM employees WHERE auth_user_id = auth.uid() AND is_active = true;
$$;
```

Plus a third from `migration_sales_coordinator.sql` STEP 3:

```sql
CREATE FUNCTION is_my_team_member(target_employee_id integer) RETURNS boolean ... AS $$
  SELECT EXISTS (SELECT 1 FROM employees e
    WHERE e.id = target_employee_id
      AND e.coordinator_id = current_employee_id()
      AND current_employee_role() = 'sales_coordinator');
$$;
```

**Consequences for Phase 2 seeding, all load-bearing:**
- Every seeded employee needs a real `auth.users` row AND an `employees` row
  whose `auth_user_id` holds that UUID **and** `is_active = true`. Miss either
  and the account silently sees nothing (all three helpers return NULL).
- `SECURITY DEFINER` means these run as the function owner (`postgres`,
  BYPASSRLS). This is required, not an optimisation — `employees`' own SELECT
  policy calls `current_employee_role()`, which queries `employees`. Without
  DEFINER it recurses forever.
- **In the Supabase SQL Editor there is no `auth.uid()`**, so all three
  helpers return NULL and every policy is false. Any verification query run
  there reflects `postgres`/BYPASSRLS, **not** what a role actually sees. RLS
  behaviour can only be tested from a real authenticated session.

**Pending:** the owner row's actual `id` and `auth_user_id` value. Needed as
the preservation baseline for teardown.

---

### 3. `plans` vs `follow_ups` — ✅ UNAMBIGUOUS

| | `plans` | `follow_ups` |
|---|---|---|
| Code references in `src/` | **ZERO** | 6 files |
| Shape | `employee_id, plan_date, area_id, party_id, planned_work_type, remarks` | `assigned_to, created_by, party_id, lead_id, activity_type, title, notes, due_date, due_time, is_done, done_at, notified_at` |
| Purpose | Forward-looking day plan (replaced the old "Monthly Plans" sheet) | Reminders, personal + assigned |
| Assignment support | none (`employee_id` only) | `assigned_to` ≠ `created_by` |
| UI surface | **none anywhere in the app** | Today screen, Lead Profile, Sales Exec Profile, push notifications |
| RLS | own-data-or-owner (no SC branch) | own-data-or-owner **+ 3 SC team policies** |

**`follow_ups` is what the SC follow-up assignment feature writes to.** This
is explicit and deliberate, not incidental — `migration_sales_coordinator.sql`
"CORRECTION 3" records that the written Phase 8 spec asked for
`plans.assigned_by`, and that it was overruled with the product owner because
`plans` has no view for an exec to see an assignment in. No `assigned_by`
column was ever added to `plans`.

**`plans` is vestigial** — schema-only, from the original sheet-replacement
design, never built. It is **not** legacy-in-the-sense-of-superseded (nothing
migrated off it; it simply was never used).

**Recommendation for Phase 1:** seed `plans` **lightly or not at all**. It has
no UI, so seeded rows cannot be verified in Phase 7 and cannot appear in the
Phase 6 ledger. Seeding it proves nothing. Awaiting the user's call — see
Open questions.

---

### 4. `migration_coordinator_entry.sql` — ✅ RESOLVED, and one finding is urgent

**It does NOT contain the `entered_by_role` lock.** That mechanism lives in
`migration_sales_coordinator.sql` STEP 4 / 4b, which **is live** (run
2026-08-10, all 9 verification checks PASS per `CLAUDE.md`).

**So: the SC edit lock IS live and IS testable.** Exception-catalogue item 7
is in scope.

What `migration_coordinator_entry.sql` actually does — three independent
sections:

1. **`activities.logged_by_employee_id`** — new nullable FK + backfill from
   `employee_id` + a `BEFORE INSERT` trigger `stamp_activity_logger()` that
   stamps `COALESCE(supplied, current_employee_id(), employee_id)`. Mirrors
   `leads.created_by_employee_id`. A plain audit field, **no lock semantics**.
2. **`coordinator_team_update` policy on `sites`** — a genuine gap left by
   `migration_sales_coordinator.sql` (which widened `sites` SELECT but never
   added UPDATE). Reproduced live per `CLAUDE.md`: an SC setting Site stage on
   a Site Visit got a clean success message and the write **silently no-opped**.
3. **`coordinator_team_update` policy on `parties`** — same gap, same shape.

> **🔴 URGENT — this migration is NOT applied, and the app is broken without it.**
>
> The uncommitted working-tree code on this branch already `.select()`s
> `logged_by_employee_id`, in two places:
> - `src/pages/LeadDetail.jsx:160` (the lead's Activity timeline)
> - `src/lib/employeeQueries.js:99` (`fetchActivityLogForEmployee`)
>
> Selecting a non-existent column makes PostgREST return an error. Neither
> call site treats that as fatal (`data ?? []`), so nothing crashes — but
> **Lead Detail's Activity timeline renders "No activity yet." for every lead
> with real activity, for every role.** `CLAUDE.md` records this as confirmed
> live, not theoretical.
>
> **This must run before Phase 3 QA**, or QA will spend its time re-finding a
> known bug and every activity-timeline test is invalid.

**Section 2's silent-no-op is worth carrying forward as a general lesson for
Phases 3, 5, and 7:** an RLS-rejected `UPDATE` with no `.select()` returns
`{data: null, error: null}` — 0 rows matched, no exception. Any "did the write
land?" check in this audit must re-read the row, not trust the absence of an
error.

---

### 5. Owner DELETE on `stage_history` and `loss_reasons` — ✅ NEITHER EXISTS, by design

Verified at both layers:

| Table | DELETE grant to `authenticated` | DELETE policy | Deletable by owner? |
|---|---|---|---|
| `stage_history` | ❌ not in the STEP A grant list | ❌ none | **No** |
| `loss_reasons` | ❌ not in the STEP A grant list | ❌ none | **No** |
| `lead_owner_history` | ❌ not in the STEP A grant list | ❌ none | **No** |
| `lead_change_log` | ❌ explicitly `REVOKE`d | ❌ none | **No** |

This is deliberate (`rls_policies.sql` STEP G: *"that's not an oversight, it's
the point"*) — an audit trail should not be erasable by the application.

**One subtlety worth recording.** `rls_policies.sql` STEP A sets
`ALTER DEFAULT PRIVILEGES ... GRANT ... DELETE ON TABLES TO authenticated`,
which applies to tables created *afterwards*. `lead_change_log` was created
later and would have inherited a DELETE grant — `migration_lead_change_log.sql`
STEP 6 anticipated this and opens with an explicit
`REVOKE INSERT, UPDATE, DELETE ON lead_change_log FROM authenticated`. Correct.
**But any future table added to this schema inherits full DML by default and
must revoke explicitly.** Flagging for Phase 5.

**Teardown implication:** confirmed non-blocking. Teardown must run from the
Supabase SQL Editor (as `postgres`, BYPASSRLS) — the app itself can never
delete these four tables' rows. `Schema/DESTRUCTIVE_reset_all_data.sql` already
exists for exactly this and states the same reasoning. It is **not** a
migration; it must never appear in a run-in-order list.

---

### 6. Teardown manifest — ✅ ESTABLISHED

`seed_manifest.json` created at repo root with its final structure and empty
collections. Contract for Phase 2: **appending to the manifest is part of the
insert, not a step after it.** Every row (table + PK) and every Auth user
(email + UUID) gets recorded as it is created.

The preservation baseline (`preserved` block) is stubbed and **must be filled
in before the first seeded write** — it is the record of what teardown must
leave standing.

---

### 7. Browser automation — ✅ AVAILABLE (in-app browser), no Playwright/Puppeteer

- **No Playwright or Puppeteer MCP server** is connected. Neither is in
  `package.json` (deps are React 19, Vite 8, supabase-js, oxlint, vitest).
- **The in-app Browser pane MCP (`mcp__Claude_Browser__*`) is available** and
  is real browser automation: `preview_start`, `navigate`, `computer`
  (click/type/screenshot), `read_page` (accessibility tree),
  `read_console_messages`, `read_network_requests`, `resize_window`,
  multi-tab. This is what Phases 3 and 4 will use.
- `mcp__claude-in-chrome__*` also exists (the user's real Chrome, with their
  logged-in sessions) — **not** appropriate here; the in-app pane is the
  correct isolated surface.

**Multi-role testing is already solved in this repo.** `.claude/launch.json`
defines three dev-server configs on separate ports — `role-owner` (5181),
`role-coordinator` (5182), `role-exec` (5183). Separate origins mean separate
`localStorage`, which is the only way to hold three Supabase sessions at once
(same-port tabs share one login). This pattern was used for the Phase 8
verification and should be reused. **Phase 3 needs 9 concurrent logins
(1 owner + 2 SC + 6 exec) but only 3 ports exist** — either add ports to
`launch.json` or test in role batches, re-logging in per port.

**Commitment:** I will drive the real UI in Phases 3 and 4 and will state
plainly which screens I verified visually versus which I only reasoned about.
No claimed verification I did not perform.

---

### Additional findings (not asked for, but they change Phase 1 and 2)

**A. Backdating is possible for most tables, but NOT for `lead_change_log`.**
No trigger forces `now()` onto `leads.created_at`, `activities.created_at`,
`stage_history.changed_at`, `follow_ups.due_date/created_at`, or
`loss_reasons.lost_at` — all are plain `DEFAULT now()` columns and an explicit
value overrides the default. **However**, `log_lead_changes()` (an AFTER
trigger) writes `lead_change_log.changed_at` from the column's own
`DEFAULT now()` and the app cannot supply it. So:
- Every seeded lead INSERT generates a `lead_change_log` row **stamped today**,
  regardless of the lead's backdated `created_at`.
- Every seeded `quote_value` / `order_value` / `product_id` UPDATE generates a
  further row, also stamped today.
- **Consequence:** the Day Review for any historical date will show stage moves
  and (if backfilled) creations, but the change log will pile onto today. This
  is the exact "degraded mode" `migration_lead_change_log.sql` already
  documents for pre-migration dates — here it would be self-inflicted.
- **Mitigation available:** `migration_lead_change_log.sql` STEP 7 shows the
  pattern — a post-seed SQL `UPDATE lead_change_log SET changed_at = ...` run
  from the SQL Editor can correct the timestamps after seeding. Phase 1 must
  plan for this explicitly. Flagging now rather than discovering it in Phase 7.

**B. Triggers that will fire on every seeded row — Phase 2 must expect these.**
On `leads`: `stamp_lead_creator` (BEFORE INSERT), `stamp_entered_by_role`
(BEFORE INSERT/UPDATE), `owner_only_stage_change` (BEFORE UPDATE),
`enforce_coordinator_lock` (BEFORE UPDATE), `log_lead_changes_ins` (AFTER
INSERT), `log_lead_changes_upd` (AFTER UPDATE) — **six**. On `activities`:
`stamp_entered_by_role`, plus `stamp_activity_logger` once
`migration_coordinator_entry.sql` runs. On `employees`:
`validate_employee_role_assignment`.

**C. A sales executive CANNOT progress a lead's stage. This is a hard
database rule, and it dictates how Phase 2 must seed.**
`enforce_owner_only_stage_change()` raises `check_violation` unless
`current_employee_role()` is `owner` or `sales_coordinator`. Independently,
`stage_history` INSERT policy is owner-only OR the SC-team branch. So **every
stage progression and every `stage_history` row must be written while
authenticated as the owner or the owning exec's coordinator** — never as the
exec. This directly answers exception-catalogue item 12 and materially shapes
the seeding order.

**D. Promoting an employee to SC or owner must clear `coordinator_id` in the
same statement**, or `validate_employee_role_assignment()` rejects the write
("Only a sales executive can be assigned to a coordinator"). Relevant to
exception-catalogue item 3 (mid-period SC reassignment) and to Phase 3's
role-management UI testing.

**E. `entered_by_role` will be set naturally by seeding order, no special
handling needed.** The trigger stamps `'sales_executive'` only when an actor
whose role is `sales_executive` writes a row they own. So: seed as the exec →
locked; seed as the SC or owner → stays NULL. Exception-catalogue item 7 falls
out of the seeding identity for free.

---

### Files created / modified

| File | Change |
|---|---|
| `PHASE9_LOG.md` | **created** (this file) |
| `seed_manifest.json` | **created** — empty scaffold, preservation baseline stubbed |
| branch `phase9-audit` | **created** off `master` @ `e8b9015` |

No database writes. No source files modified. No commits made.

---

### Could not verify / skipped

| Item | Why |
|---|---|
| Row counts across all 16 tables | No credential that can read them (anon is denied; see item 1) |
| Owner row's `id` and `auth_user_id` value | Same |
| Whether the four "outstanding" migrations are *actually* applied live | Cannot introspect `pg_policies` / `information_schema` without DB access. `CLAUDE.md` claims the backlog, lead_change_log and sales_coordinator migrations ran; `migration_coordinator_entry.sql` is confirmed NOT run. **Trusting a doc over the live database is exactly the failure mode Conventions warns about** — this must be verified in Phase 1 or early Phase 2. |
| `Schema/production_schema_dump.sql` | File is 0 bytes — no content to read |

---

### What Phase 1 needs to know

1. **`follow_ups`, not `plans`**, is the reminder/assignment table. Seed
   `plans` minimally or not at all (pending the user's call).
2. **Stage progressions must be authored by owner or SC**, never by an exec —
   both the trigger and the `stage_history` INSERT policy enforce it.
3. **`lead_change_log` timestamps cannot be backdated through the app.** The
   plan must include a post-seed SQL correction step, or accept that the
   change log is today-only.
4. **`entered_by_role` follows from who writes the row** — plan the SC-entered
   subset by choosing the seeding identity, not by setting a column.
5. **The `migration_coordinator_entry.sql` migration must run before Phase 3**,
   and ideally before Phase 2 (so seeded activities get
   `logged_by_employee_id` stamped rather than needing a backfill).
6. **9 roles vs 3 dev-server ports** — plan the Phase 3 approach now.

---

### 🛑 Open questions — I need answers before Phase 1

**Q1 — How should I get database access?** This is the blocking one. I have
only the anon key, which reaches nothing. Three paths, and they are not
equivalent:

| Option | Unlocks | Cost / risk |
|---|---|---|
| **(a) `service_role` key** (Dashboard → Settings → API) | Everything: row counts, creating the 8 Auth users via the Admin API, Phase 5/7 verification, teardown | It is a full-bypass secret. It would enter this session's context. I would keep it in a git-ignored scratch file, never commit it, never print it — but **you should rotate it after Phase 9 regardless.** |
| **(b) Owner login email + password** | Row counts and all owner-scoped reads/writes through the real app path | Cannot create Auth users. You would create the 8 accounts by hand in the Dashboard (~10 min) and tell me their passwords. |
| **(c) I write SQL, you run it in the SQL Editor and paste results back** | Row counts, verification, teardown | Slow, and **it defeats Phase 2's core requirement** — the SQL Editor runs as `postgres` and bypasses RLS entirely, so seeding that way proves nothing about whether the app works. |

**My recommendation: (a) + (b) together.** Use `service_role` *only* for
creating the 8 Auth users and for read-only verification, and do **all** actual
seeding by signing in as each employee with the anon key — so every insert
genuinely passes through RLS, triggers, and constraints, exactly as Phase 2
requires. (b) alone also works if you would rather not hand over
`service_role`; it just costs you the manual account creation.

**Q2 — Run `migration_coordinator_entry.sql` now?** I recommend yes, before
Phase 1 finishes. It is already written, and until it runs the Activity
timeline is broken for every role — which would poison Phase 3.

**Q3 — Seed `plans` at all?** It has no UI, so nothing seeded there can be
verified in Phase 7 or appear in the Phase 6 ledger. I suggest seeding a
token handful purely to prove the table accepts writes under RLS, and
excluding it from the ledger. Say if you want it fully populated instead.

**Q4 — Should I verify the live migration state before seeding?** `CLAUDE.md`
says three migrations ran, but this repo's own Conventions warn never to trust
a schema file's presence over the live database. I would rather spend ten
minutes confirming than discover a missing trigger in Phase 7. Recommend yes.

---

## Phase 0 — ADDENDUM (after credentials supplied)

**Date: 2026-08-12. Items 1 and 2 now COMPLETE.**

User answered Q1–Q4: (a)+(b) service_role + owner login; run the migration;
**skip `plans` entirely**; verify live state first. Credentials supplied in
`.env.phase9` (git-ignored — confirmed via `git check-ignore`).

### Credentials verified

- **service_role key** — works (`HTTP 200`). Note it is the newer
  `sb_secret_...` format, not a JWT.
- **Owner login** — `POST /auth/v1/token?grant_type=password` succeeds and
  returns a working `access_token`.

### Item 1 — Clean state ✅ CONFIRMED (with one correction to the brief)

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| activities | 0 | | parties | 0 |
| **areas** | **0** ⚠️ | | plans | 0 |
| **employees** | **1** | | **products** | **0** ⚠️ |
| follow_ups | 0 | | push_subscriptions | 0 |
| lead_change_log | 0 | | site_contacts | 0 |
| lead_owner_history | 0 | | sites | 0 |
| leads | 0 | | stage_history | 0 |
| loss_reasons | 0 | | targets | 0 |

> ⚠️ **CORRECTION TO THE BRIEF: `areas` and `products` are EMPTY.** The Phase 9
> brief states they "were deliberately preserved as configuration". They were
> not — both are at zero rows, verified directly. **Phase 1 must design the
> area and product catalogues from scratch**, not "reuse existing where
> present". Teardown must delete every row in both, since nothing pre-exists
> underneath.

### Item 2 — Preservation baseline ✅ RECORDED

```
employees.id           = 3
employees.auth_user_id = 1c1c072a-51d5-4027-a592-c79e3c3d46f8
name = "Raywant"   mobile = "7042122044"   role = "owner"
coordinator_id = NULL   is_active = true   created_at = 2026-07-23T09:23:40
```

Written to `seed_manifest.json` → `preserved.employees[0]`. This row **and its
`auth.users` entry** must survive teardown.

### Item 4 (revisited) — `migration_coordinator_entry.sql` is ALREADY APPLIED

Probed the live API for every migration-added column:

| Column | Migration | Live? |
|---|---|---|
| `leads.created_by_employee_id` | lead_change_log | ✅ |
| `employees.coordinator_id` | sales_coordinator | ✅ |
| `leads.entered_by_role` | sales_coordinator | ✅ |
| `activities.entered_by_role` | sales_coordinator | ✅ |
| **`activities.logged_by_employee_id`** | **coordinator_entry** | **✅ ALREADY LIVE** |

**The urgent Phase 0 finding is resolved — no action needed.** The Activity
timeline is not broken; `logged_by_employee_id` exists, so the `.select()` in
`LeadDetail.jsx:160` and `employeeQueries.js:99` resolves fine. Either the user
ran it just now, or it had already been applied and `CLAUDE.md` is stale on
this point. **`CLAUDE.md`'s "⚠️ Not yet run against the live database" note in
the Sales Coordinator section is now out of date and should be corrected in
Phase 8's documentation pass.**

Column existence does **not** prove sections 2 and 3 (the `sites` / `parties`
`coordinator_team_update` policies) landed — policies need SQL-Editor
introspection, which is what `phase9_verify_state.sql` covers.

### NEW FINDING — `service_role` cannot read two tables

```
GET /rest/v1/lead_change_log     → 42501 "permission denied for table lead_change_log"
GET /rest/v1/lead_owner_history  → 42501 "permission denied for table lead_owner_history"
```

Both hint: `GRANT SELECT ON public.<table> TO service_role;`

This is the **`auto_expose_new_tables`** behaviour `CLAUDE.md`'s Conventions
already documents (the same class of failure that broke the follow-ups Edge
Function). Both tables were created by later migrations, and neither migration
included a `service_role` grant — only `authenticated`.

- **Impact on the app: none.** The app authenticates as `authenticated`, which
  *does* hold SELECT on both. Confirmed by reading both tables successfully
  through the owner session (0 rows each).
- **Impact on this audit: minor but real.** Any `service_role`-driven
  verification or teardown touching those two tables will fail. Both are
  append-only and undeletable via the API anyway, so teardown was always going
  to the SQL Editor for them. **Phase 5 should record this as a
  hygiene/consistency finding**, not a vulnerability — it is a missing grant,
  which fails closed.

### Item 7 (revisited) — no Playwright still, but multi-role is solvable

Unchanged from the main Phase 0 entry. Restating the constraint that matters
for Phase 3: **9 identities, 3 dev-server ports.** Options are to extend
`.claude/launch.json` with 6 more port configs, or to test in batches.
Recommend extending it — separate origins are the only way to hold concurrent
sessions, and Phase 5's cross-team attack testing wants SC-A and SC-B live
simultaneously.

### Files created / modified in this addendum

| File | Change |
|---|---|
| `.env.phase9` | **created** (git-ignored) — credentials, filled by user |
| `phase9_verify_state.sql` | **created** — read-only live-state introspection; NOT a migration |
| `seed_manifest.json` | **updated** — real baseline counts, preserved owner row, `plans` exclusion recorded |
| `PHASE9_LOG.md` | this addendum |

Still no database writes. No source files modified. No commits.

### Outstanding before Phase 1 can finish

**`phase9_verify_state.sql` needs to be run in the Supabase SQL Editor and its
result table pasted back.** It is read-only (a single `SELECT` over `pg_proc` /
`pg_trigger` / `pg_policies` / `information_schema`). It confirms the half of
the migration state that column probing cannot reach:

- all three `SECURITY DEFINER` helper functions and their definitions
- the 6 triggers on `leads`, 2 on `activities`, 1 on `employees`
- `enforce_owner_only_stage_change` really does include `sales_coordinator`
- `enforce_coordinator_lock`'s allowed-column array
- the full policy inventory for all 16 tables (including whether
  `coordinator_team_update` exists on `sites`/`parties`)
- RLS actually enabled on all 16
- DELETE grants, and the `stage_history` narrowing
- the CHECK constraints the seeder must respect
  (`architect_meeting`, `pmc`, `quarter`, `current_stage DEFAULT 'calling'`)

---

---

## Phase 0 — ADDENDUM 2 (tooling, teardown design, doc corrections)

**Date: 2026-08-12.**

### Re-reported: `plans` vs `follow_ups` (Phase 0 item 3)

Re-verified by search, not from the docs. **`plans` has zero references in
`src/`; `follow_ups` has six.** The SC follow-up feature writes to
**`follow_ups`** — an explicit overrule recorded in
`migration_sales_coordinator.sql` "CORRECTION 3", because the Phase 8 spec's
`plans.assigned_by` route had no view for an exec to see an assignment in.

**Neither table is legacy-as-superseded. `plans` is vestigial** — original
sheet-replacement schema, never built.

Two constraints accepted from the user, both now binding on later phases:
1. **Phase 1's plan schema must model follow-up assignments as `follow_ups`
   rows.** Modelling them as `plans` would make Phase 6's ledger compute
   against a table no dashboard reads — the exact failure the Phase 8 spec
   nearly shipped.
2. **`plans` is a Phase 4 redundancy candidate — report only, no removal.**
   Recorded in `DECISIONS.md`. Phase 5 still audits its RLS policies.

### Re-reported: browser automation (Phase 0 item 7)

**Neither Playwright nor Puppeteer was available.** Verified: no MCP server
for either, absent from `package.json`, absent from `node_modules`, no
config file. Only test tooling was Vitest (7 unit-test files).

**Resolved — Playwright installed as a devDependency** (user-approved).
`npm i -D playwright`, exit 0.

**Phase 3 approach is now 9 isolated `browser.newContext()` sessions against a
single dev server**, not 9 origins. Contexts isolate storage fully, so SC-A
and SC-B (and all 6 execs and the owner) hold simultaneous Supabase sessions
without 9 Vite processes. **`.claude/launch.json` stays at 3 ports**, per the
user.

Side benefit, deliberate: Phase 3 leaves behind a **re-runnable E2E suite**
rather than throwaway interactions — which is what the Phase 3 brief asks for
in the no-automation branch anyway. The in-app Browser pane MCP is still the
right tool for Phase 4's visual work (screenshots, computed styles,
responsive checks).

⚠️ `npm audit` reports **6 vulnerabilities (1 moderate, 5 high)** after the
install. **Not acted on** — dependency CVEs are Phase 5's remit. Phase 5 must
determine which pre-date the Playwright install (compare against `master`) so
a devDependency isn't mistaken for a production finding.

### Teardown design — completed early, at the user's direction

The user's assumption ("if service_role can't read those tables, assume it
can't delete either") is **correct for those two tables, but the real split is
sharper and worth recording.** Probed live:

| Table | service_role SELECT | service_role DELETE | Created by |
|---|---|---|---|
| `stage_history` | ✅ 200 | ✅ 204 | `tostem_crm_schema.sql` (original) |
| `loss_reasons` | ✅ 200 | ✅ 204 | `tostem_crm_schema.sql` (original) |
| `lead_change_log` | ❌ 42501 | ❌ 42501 | `migration_lead_change_log.sql` |
| `lead_owner_history` | ❌ 42501 | ❌ 42501 | `migration_pilot_outstanding.sql` (2026-08-09) |

**The gap tracks when a table was created, not whether it is append-only.**
Tables predating this project's move to `auto_expose_new_tables = false` kept
full service_role DML; ones created after were granted only to
`authenticated`. `lead_owner_history` is the instructive case — it is
*declared* in the base schema file but was actually created live by a later
migration, so "is it in `tostem_crm_schema.sql`?" is the wrong test.

**`phase9_teardown.sql` written.** Because two of the four are unreachable
from any API path, the whole teardown runs in the SQL Editor rather than
splitting across two mechanisms and risking partial state. It:
- aborts unless `employees.id = 3` with `auth_user_id`
  `1c1c072a-51d5-4027-a592-c79e3c3d46f8` is a present owner row
- deletes in FK order (`sites` before `parties`; `parties` before `employees`)
- prints per-table counts via `RAISE NOTICE`
- ends with a verification query that must match the Phase 0 baseline
- documents `auth.users` cleanup as a manual step, with an explicit
  do-not-delete on the owner's UUID

**Do not run it until the user explicitly confirms they are done with the
seeded data.**

### Documentation corrections applied

Standing instruction accepted: **for the rest of Phase 9, verify against the
live database rather than trusting `CLAUDE.md` / `DECISIONS.md`, and flag
every doc error found.** Two so far:

| # | Doc | Claim | Reality | Fixed |
|---|---|---|---|---|
| 1 | `CLAUDE.md` (SC section) | `migration_coordinator_entry.sql` "⚠️ Not yet run against the live database" — and the Activity timeline is broken as a result | Column `activities.logged_by_employee_id` exists live; the timeline is **not** broken | ✅ rewritten as ✅ RUN LIVE, keeping the silent-empty-data failure mode on record |
| 2 | Phase 9 task brief | `areas` and `products` "deliberately preserved as configuration" | Both **empty** (0 rows) | ✅ recorded in `DECISIONS.md` + `seed_manifest.json`; Phase 1 must build both catalogues from scratch |

Also updated:
- **`CLAUDE.md` Conventions** — the `service_role` bullet now carries the
  measured grant split above, plus a new bullet: *verify against the live
  database, not against this file*, pointing at `phase9_verify_state.sql`.
- **`CLAUDE.md`** — the SC section's "Not yet verified (blocked on the
  migration)" note corrected to "still not verified (no longer blocked)":
  the badge rendering and the `sites`/`parties` coordinator UPDATE policies
  are unexercised, but nothing blocks them now. Both in scope for Phase 3.
- **`DECISIONS.md`** — new **Phase 9** section: the verify-not-trust rule,
  `plans` as vestigial + redundancy candidate, the teardown design, and the
  empty `areas`/`products` finding.

### Files created / modified in this addendum

| File | Change |
|---|---|
| `package.json` / `package-lock.json` | **modified** — `playwright` added to devDependencies |
| `phase9_teardown.sql` | **created** — guarded, FK-ordered, SQL-Editor-only |
| `CLAUDE.md` | **modified** — 3 corrections (2 stale claims + 2 new Convention bullets) |
| `DECISIONS.md` | **modified** — new Phase 9 section |
| `PHASE9_LOG.md` | this addendum |

Still **no database writes**. No application source modified. No commits.

### 🛑 Blocking — `phase9_verify_state.sql` output not received

The user's message said "SQL output below" but **contained no output**. Not
guessed at, not inferred. Phase 1 cannot be finalised without it, because it
is the only thing that confirms:

- the 6 triggers on `leads`, 2 on `activities`, 1 on `employees`
- whether `coordinator_team_update` actually landed on `sites` / `parties`
  (columns proved the migration partly applied; policies are unproven)
- `enforce_owner_only_stage_change` really includes `sales_coordinator`
- `enforce_coordinator_lock`'s allowed-column array
- the full policy inventory across all 16 tables, and RLS enabled on each
- the CHECK constraints the seeder must respect (`architect_meeting`, `pmc`,
  `quarter`, `current_stage DEFAULT 'calling'`)

**Please re-paste it.**

---

---

## Phase 0 — ADDENDUM 3: live-state verification results

**Date: 2026-08-12. `phase9_verify_state.sql` run in the SQL Editor, 39 checks.
Phase 0 is now COMPLETE.**

### Structural state: everything the app depends on is installed ✅

- **All 3 helper functions** exist and all 3 are `SECURITY DEFINER`.
- **All 6 triggers on `leads`** — `enforce_coordinator_lock`,
  `log_lead_changes_ins`, `log_lead_changes_upd`, `owner_only_stage_change`,
  `stamp_entered_by_role`, `stamp_lead_creator`. Exact match.
- **Both triggers on `activities`** — including `stamp_activity_logger`.
- **`validate_employee_role_assignment`** on `employees`.
- **RLS enabled on all 16 tables**, none missing.
- **Policy inventory matches intent on all 16 tables**, including
  `coordinator_team_update` present on **both `sites` and `parties`**.
- `enforce_owner_only_stage_change` admits `sales_coordinator`;
  `enforce_coordinator_lock`'s allowed array is exactly
  `['current_stage','next_followup_date','order_value']`.
- `parties` SELECT is team-scoped; `stage_history` SELECT is own-leads-scoped.
- All 9 expected indexes present.
- All CHECK constraints correct: `architect_meeting` (both tables), `pmc`,
  `quarter`, `current_stage DEFAULT 'calling'`.

**Conclusion: every migration `CLAUDE.md` listed as outstanding is in fact
live.** `migration_backlog_2026_08_10.sql` was run (the doc never recorded it),
carrying the stage taxonomy rename, `migration_architect_meeting.sql`,
`migration_scope_stage_history.sql` and `migration_owner_only_stage.sql`.
`migration_coordinator_entry.sql` is fully applied — all three sections, not
just the column.

### 🔴 FINDING — append-only tables are protected by ONE layer, not two

Three grant-layer mismatches. `rls_policies.sql` STEP G states these tables are
*"permanently non-deletable at both layers, for everyone including owner, by
design"*. **The grant layer does not hold.**

| Table | Intended grant | Actual grant to `authenticated` | Extra |
|---|---|---|---|
| `stage_history` | SELECT, INSERT | `INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` | **UPDATE**, TRUNCATE |
| `lead_owner_history` | SELECT, INSERT | present in the DELETE-grant list | **DELETE** |
| `lead_change_log` | SELECT only | `REFERENCES, SELECT, TRIGGER, TRUNCATE` | **TRUNCATE** |

**Cause.** `rls_policies.sql` STEP A runs
`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLES TO authenticated`, and Supabase's own baseline adds
TRUNCATE/REFERENCES/TRIGGER. So every table created *after* that statement
arrives broadly writable, while STEP A's carefully curated
"DELETE on these ten only" list describes just the tables that already existed.
`migration_lead_change_log.sql` STEP 6 anticipated this and issued an explicit
`REVOKE INSERT, UPDATE, DELETE` — **but missed TRUNCATE**.
`migration_pilot_outstanding.sql` (which created `lead_owner_history` live)
issued no revoke at all.

**Severity: not currently exploitable, but the defence is one layer thin.**
- RLS refuses each operation because no matching policy exists — verified in
  this same run: `stage_history` has no UPDATE policy (only
  `coordinator_team_insert`, `coordinator_team_select`,
  `own_data_or_owner_role_select`, `owner_only_insert`), and
  `lead_owner_history` has no DELETE policy (only `authenticated_insert`,
  `authenticated_select`).
- **TRUNCATE bypasses RLS entirely** — but PostgREST exposes no TRUNCATE verb,
  and `authenticated` is a role assumed via JWT through PostgREST rather than a
  connectable login, so there is no path to invoke it today.
- The real risk is latent: **adding one careless permissive policy turns any of
  these grants live**, and an audit trail that can be silently rewritten is
  worth more than the rows it holds.

**Deferred to Phase 5 for severity ranking and Phase 8 for the fix, per
protocol — not fixed here.** Phase 5 must additionally *empirically* test
`UPDATE stage_history` and `DELETE lead_owner_history` from a real
authenticated session once data exists, rather than reasoning from the policy
list alone.

### Doc errors 3–6 (running total: 6)

| # | Doc | Claim | Reality |
|---|---|---|---|
| 3 | `CLAUDE.md` Conventions | Lead stage taxonomy rename "still outstanding" | Live — DEFAULT is `'calling'` |
| 4 | `CLAUDE.md` Conventions | `migration_architect_meeting.sql` "also outstanding" | Live — both CHECKs include `architect_meeting` |
| 5 | `CLAUDE.md` Conventions | `migration_scope_stage_history.sql` + `migration_owner_only_stage.sql` "are also outstanding" | Both live |
| 6 | `Schema/rls_policies.sql` STEP A/G | append-only tables "permanently non-deletable at both layers" | Grant layer does not hold (above) |

**All corrected in `CLAUDE.md`** — the stale "outstanding" wording is struck
through rather than deleted, so the original reasoning stays legible, with a
verified-on date attached. A new Conventions bullet records the grant finding.

### Phase 0 status: COMPLETE

All 7 items answered. No database writes. No application source modified.
No commits.

### What Phase 1 needs to know (consolidated)

1. **`follow_ups`, never `plans`** — model assignments there or Phase 6's
   ledger computes against a table no dashboard reads. `plans` is not seeded.
2. **`areas` and `products` are empty** — design both catalogues from scratch.
3. **Stage progressions must be authored as owner or SC**, never as an exec —
   trigger + owner-only `stage_history` INSERT both enforce it. (Confirmed
   live: the trigger exists and admits `sales_coordinator`.)
4. **`lead_change_log.changed_at` cannot be backdated through the app** — an
   AFTER trigger stamps `now()`. Plan a post-seed SQL correction step.
   Everything else (`leads`, `activities`, `stage_history`, `follow_ups`,
   `loss_reasons`) backdates normally.
5. **`entered_by_role` follows from who writes the row** — seed as the exec to
   lock, as the SC/owner to leave NULL. Exception-catalogue item 7 needs both.
6. **`enforce_coordinator_lock` allows exactly
   `current_stage`, `next_followup_date`, `order_value`** on a locked lead —
   any other column an SC touches raises `check_violation`.
7. **Promoting to SC/owner must clear `coordinator_id` in the same statement**
   or the validation trigger rejects it. Relevant to exception item 3.
8. **Phase 3 = 9 Playwright browser contexts**, one dev server, `launch.json`
   unchanged at 3 ports.
9. **CHECK values available to the seeder:** `activity_type` includes
   `architect_meeting`; `party_type` includes `pmc`; `period_type` includes
   `quarter`; `current_stage` is free text defaulting to `'calling'`.

---

**Phase 0 ends here. Awaiting approval before starting Phase 1.**

---

## Phase 1 — Architect: design the simulation

**Status: COMPLETE. Date: 2026-08-12. Branch: `phase9-audit`. No database writes.**

### Narrative summary

Six months of trading (**2026-02-12 → 2026-08-12**, 181 days) for a VIPSAR
dealership running **1 owner, 2 sales coordinators and 6 sales executives**,
split 3/3 across the two coordinators.

**Team North** — coordinator *Neha Malhotra*: Rohit Sharma (the clear top
performer — most leads, most wins, most activity), Priya Nair, Imran Qureshi.
**Team South** — coordinator *Vikram Sethi*: Ananya Deshpande, Karan Bhatia
(the clear underperformer — fewest leads, **zero** wins, a book that has gone
quiet), Sunita Rawat.

**150 leads** distributed unevenly across the six execs, worked through the
11-stage VIPSAR funnel over genuinely long cycles — the **median deep-funnel
lead takes 60 days** from creation to its last stage change, and none completes
in under a week. Activity clusters on weekdays, never falls on a Sunday, thins
on Saturdays, skips ten Indian public holidays, and varies month to month
(March is quiet, June–July run hot). Parties and sites read as plausible Delhi
NCR residential and commercial customers across 13 areas.

Everything is generated by a **deterministic script with a fixed PRNG seed**, so
the plan is reproducible byte-for-byte, and it is **fully explicit** — every one
of the ~2,700 rows is enumerated rather than described. That is a hard
requirement, not a preference: Phase 6 computes the expected ledger from this
file alone, so anything left to be improvised at seed time would break the
firewall the whole exercise depends on.

### Deliverables

| File | What it is |
|---|---|
| `simulation_plan.json` | **The deliverable.** 1.1 MB, ~2,712 insert rows + 12 update operations, every row explicit. |
| `phase9/generate_plan.mjs` | Deterministic generator (seed `20260812`). Re-running reproduces the identical file — verified by md5. |
| `phase9/validate_plan.mjs` | 90+ consistency checks over the plan. **Currently 0 failures, 0 warnings.** |

### Row counts

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| areas | 13 | | activities | 1,218 |
| products | 9 | | stage_history | 629 |
| employees (new) | 8 | | follow_ups | 78 |
| parties | 169 | | targets | 120 |
| sites | 128 | | loss_reasons | 29 |
| site_contacts | 159 | | lead_owner_history | 2 |
| leads | 150 | | **plans** | **0** (excluded by decision) |
| | | | **push_subscriptions** | **0** (see below) |

Plus **5 `exec_touches`** and **5 `sc_edits`** (UPDATEs that exercise the SC edit
lock from both sides) and **225 `lead_change_log` timestamp corrections**.

### The exception catalogue — all 12 covered, plus 3 extras

| # | Exception | Coverage |
|---|---|---|
| 1 | Site-anchored only (no party) | 12 leads, all `scanning` |
| 2 | Party-anchored only (no site) | 22 leads, lixil / referral / walk-in |
| 3 | Exec reassigned between coordinators | Imran Qureshi, South → North, narrative date 2026-06-01. **Investigated — see finding below.** |
| 3b | *(added)* Lead reassigned **across teams** | `lead_0098`, `lead_0138`: Karan → Rohit on 2026-06-20, with real `lead_owner_history` rows |
| 4 | Lost, then reopened and progressed | `lead_0002`, `lead_0090`, `lead_0121` |
| 5 | Won | 21 leads, each with a `stage_history` `won` row (the only place `won_date` is derivable) |
| 6 | Parties sharing a phone number | 3 clusters, 7 parties — a father/son, a husband/wife, and 3 architects on one firm landline |
| 7 | SC-entered on an exec's behalf | 10 leads (+ SC-logged activities); 5 later saved by the exec so the lock closes, 5 left open |
| 8 | Follow-ups assigned by an SC | 32 assigned-by-another of 78 total, across done-on-time / done-late / missed / due-today / future |
| 9 | Zero activity red flag | 48 open leads past the threshold — **plus a deliberate negative control, see below** |
| 10 | Targets spanning period boundaries | 120 targets across week + month + quarter, deliberately overlapping |
| 11 | Long stall in one stage | 4 leads |
| 12 | Stage progressions that skip stages | 6 leads. **Permitted** — nothing enforces sequence. |
| — | *(added)* `order_value` on a still-open lead | `lead_0058`, `lead_0078`, `lead_0139` — reproduces the real process gap CLAUDE.md flags |
| — | *(added)* Quote sent, nothing logged since | 11 leads — the silent-quotes bucket |

All five Needs Attention buckets are populated: stale 48 · silent quotes 11 ·
lead-overdue 19 · slipped 16 · pending RFQ 10.

### Findings

**1. The coordinator reassignment is not recoverable from the database, and
history moves with the person — retroactively.** `employees.coordinator_id`
holds current state only; `is_my_team_member()` reads only that; and
DECISIONS.md records the deliberate decision that no history table exists for
it. `lead_owner_history` does **not** change the answer — it tracks *lead*
ownership, and Imran's own leads never changed owner. So the moment Imran moves
to Team North, every lead and activity he has ever logged appears in
SC-North's aggregates and disappears from SC-South's, including the four months
of work he did while reporting to Vikram. The "2026-06-01" date is narrative
only; nothing in the database records it. **The ledger will compute SC team
aggregates from final `coordinator_id` only.** Flagged as Q-P1-2 — this is
worth confirming as intended product behaviour before Phase 6 encodes it.

Because exception 3 alone therefore leaves `lead_owner_history` completely
untested, I added **exception 3b**: two of Karan's still-live deals are handed
to Rohit across the team boundary, which *is* recorded. Activities logged before
the handover keep `employee_id = Karan`, so **activity credit and lead credit
deliberately diverge** — Phase 6 must decide, per metric, which side it falls on.

**2. The brief's 10-day red-flag threshold does not exist in the application.**
DECISIONS.md records that the separate 10-day figure was retired in favour of
the shared `ATTENTION_DAYS = 14`, and `attention.test.js` pins the invariant.
The plan therefore targets **14**, and additionally seeds a **9–12 day "cooling"
band whose only purpose is to be a negative control** — those 7 leads read as
stale (past `STALE_DAYS = 7`) but must **not** appear in any queue. If they do
in Phase 7, either the code regressed or a 10-day rule survives somewhere.
Flagged as Q-P1-1.

**3. Reopening a lost lead does not remove its loss reason.** `loss_reasons` is
append-only with no delete grant or policy for anyone, so `LossReasonsCard`
keeps counting a lead that is no longer lost. The plan seeds this deliberately
(29 loss_reason rows against 26 currently-lost leads). **The ledger will record
both candidate answers rather than silently picking one.** Flagged as Q-P1-3.

**4. `push_subscriptions` cannot be meaningfully seeded** — a row needs a real
browser push endpoint and a matching VAPID keypair. A fabricated one is
unverifiable and would make the Edge Function fail against it. Recorded as an
accepted gap, not an oversight.

### Bugs caught by the validator before any data was written

The validator was worth building; it found nine problems in the first generated
plan and four more after that, every one of which would have surfaced in Phase 7
as a phantom "CRM bug":

- **Exception sets were stacking, not spreading** — all 6 stage-skip leads sat
  inside the site-only set and all 10 SC-entered leads inside the party-only
  set, because each selection restarted from the head of the same shuffled list.
- **Two of the three shared-mobile clusters silently never existed** — the leads
  chosen for them had no client party to attach a number to.
- **122 activities and 49 stage changes were timestamped before the lead they
  belong to** — parent and child each drew an independent random hour, so a
  same-day touch could land earlier than the record it hangs off.
- **34 follow-ups were completed before they were created** — `created_at` was
  anchored to "a few days ago" while `due_date` sat months back.
- **The silent-quotes bucket was completely empty** — every lead's last activity
  was pinned to its last-touch day and the quote date derived at a fixed 75% of
  the timeline, so an activity *always* landed on or after the quote.
- **Some leads ran all eight funnel stages inside a single afternoon**, which
  contradicts the brief's multi-week-cycle requirement outright and would have
  made every days-in-stage figure meaningless.
- **RFQs dated after the quote they produced**, because the two dates were
  generated independently of the stage timeline instead of derived from it.
- **Stage history that ran backwards in time** on the reopened leads, because
  the `lost` row was appended after the funnel rather than woven into it.
- A **validator bug of my own**: `startsWith('ex1')` also matched `ex11` and
  `ex12`, which is what reported the exception sets as 100% overlapping when
  they were in fact disjoint. Worth noting that the checking tool needed
  checking too.

### Deliberate design decisions Phase 2 must not "fix"

- **`authored_by` on every row is load-bearing, not metadata.** RLS scoping,
  `entered_by_role` (the SC edit lock) and `activities.logged_by_employee_id`
  are all derived by triggers from *who writes the row*. Seeding as the wrong
  identity silently produces different data with no error.
- **Every `stage_history` row is authored by the owner or by the lead owner's
  coordinator** — never by an exec. Both `enforce_owner_only_stage_change()` and
  the `stage_history` INSERT policy reject an exec outright.
- **Leads are inserted at their FINAL `current_stage`.** The owner-only-stage
  trigger is `BEFORE UPDATE` and does not fire on INSERT, so this avoids needing
  an owner session for every stage step.
- **The two reassigned leads must be inserted as their ORIGINAL owner**
  (`original_owner_employee_ref`) and only then reassigned by the owner — an
  exec can only insert a lead they own. Their stage history is authored by the
  owner specifically to remove a hidden ordering dependency.
- **Timestamps are naive UTC wall clock**, generated as IST working hours then
  shifted −5h30m, so `parseTimestamp()` renders them back as plausible IST
  times. DATE columns are plain local dates and are **not** shifted.

### What Phase 2 needs to know

1. **Read `simulation_plan.json`, follow its `seeding_order` array.** The order
   is load-bearing in three places: coordinators before execs (the validation
   trigger rejects a `coordinator_id` pointing at a non-SC); leads before
   `exec_touches`/`sc_edits`; and stage history before the reassignment UPDATE.
2. **Create the 8 Auth users via the service_role Admin API**, then insert
   `employees` rows carrying those UUIDs in `auth_user_id`, with
   `is_active = true`. Miss either and the account silently sees nothing.
3. **Do the actual seeding by signing in as each employee**, not with
   service_role — the point is that every insert passes through RLS, triggers
   and constraints exactly as the app would. Document any exception.
4. **`lead_change_log.changed_at` cannot be backdated through the app.** An
   AFTER trigger stamps `now()`. Run the 225 corrections in
   `post_seed_corrections.lead_change_log` from the SQL Editor afterwards.
   Everything else backdates normally.
5. **Expect trigger side effects**: six triggers on `leads`, two on
   `activities`, one on `employees`. Every lead INSERT generates a
   `lead_change_log` row; every quote/order value UPDATE generates another.
6. **Record every row in `seed_manifest.json` as it is created**, ref → real id,
   plus every Auth user UUID. Appending is part of the insert.
7. **Emit a date-shift script alongside the corrections.** The `due_today` /
   `due_tomorrow` follow-ups are pinned to 2026-08-12 and will drift if the demo
   slips more than ~5 days. See `time_sensitivity` in the plan.

### A note on the firewall

**This log deliberately omits per-exec win counts, activity totals and any other
derived business figure.** Phase 6's Auditor is required to compute those from
`simulation_plan.json` alone, and the brief also requires that a fresh session
can resume by reading this log — so anything quantitative I put here would leak
straight into the ledger it is supposed to be checked against. Performance
shape is described qualitatively above; exact figures live in the plan file,
where the Auditor is meant to derive them.

### Could not verify / skipped

| Item | Why |
|---|---|
| That the plan actually seeds cleanly | Requires Phase 2. The validator checks the plan against the schema's constraints and RLS rules statically, but only a real insert proves it. |
| `push_subscriptions` | Cannot be fabricated — needs a real browser endpoint + VAPID keypair. |
| `plans` | Excluded by the Phase 0 product decision. |

### 🛑 Open questions for the user

- **Q-P1-1 — Red-flag threshold.** The brief says 10 days of no activity; the
  app uses `ATTENTION_DAYS = 14` and DECISIONS.md says the 10-day figure was
  retired. I designed for **14** and seeded a 9–12 day negative control.
  Confirm 14 is right, or say if the pilot should actually move to 10.
- **Q-P1-2 — Coordinator reassignment semantics.** Team aggregates snap
  wholesale and retroactively to the new coordinator, because nothing records
  the old reporting line. Confirm that is intended before Phase 6 encodes it as
  the expected answer rather than as a bug.
- **Q-P1-3 — Reopened leads in loss statistics.** Their `loss_reasons` row
  survives, so "Why we lose" keeps counting them. Intended, or should the report
  exclude reopened leads? The ledger will carry both answers unless you say.

**None of these block Phase 2** — the plan is seedable as designed, and all
three affect only how Phase 6 and Phase 7 interpret results.

---

**Phase 1 ends here. Awaiting approval before starting Phase 2 (Seeder).**

---

## Phase 1 — ADDENDUM: staleness thresholds confirmed by the owner

**Date: 2026-08-12. Resolves Q-P1-1. No database writes.**

### The ruling

The owner restated the rule verbatim:

> **Leads which are not touched for 7 days are stale; leads which are not
> touched for 14 days fall under needs attention.**

**This is a confirmation, not a change.** `src/lib/attention.js` already
implements exactly that (`STALE_DAYS = 7`, `ATTENTION_DAYS = 14`), and
`attention.test.js` already pins the invariant that a lead at exactly
`STALE_DAYS` must not be queued. **No threshold value was modified.**

The reason it needed recording: the Phase 9 task brief specifies a **10-day**
red-flag threshold. That figure does not exist anywhere in this codebase — it
was retired on 2026-08-10 when the two questions were split apart. **There is no
10-day rule, and it must not be reintroduced from that brief.**

### One real defect found while verifying, and fixed

Grepping every consumer of the two constants turned up a call site that did not
read them:

`src/pages/EmployeeProfile.jsx` — `touchColor()` hardcoded
`days >= 14 ? BAD : days >= 7 ? OK : GOOD`.

This is precisely the defect Lead Profile's health pill had before the
2026-08-10 pass; that sweep fixed `LeadDetail.jsx` and missed this one. The
literals happened to agree with the constants, **so nothing rendered
differently** — but retuning either threshold would have left this single screen
colouring by the old numbers, silently disagreeing with every other surface.

Fixed to import `STALE_DAYS` / `ATTENTION_DAYS`. Verified: `npm run lint` clean
(no new warnings) and `attention.test.js` passes 19/19. Behaviour is
byte-identical at today's values, which is exactly why it was worth fixing now
rather than discovering it the first time someone retunes a threshold.

**Standing rule, now written into both docs: any surface that colours or labels
by staleness imports these constants. Never repeat the literals.**

### Why this was fixed during Phase 1 rather than deferred to Phase 8

The Phase 9 protocol defers fixes to Phase 8, and that still holds for findings
from Phases 3, 4, 5 and 7. This one is different on two counts: it produces no
behavioural change at all today, and it arose directly from the owner's
instruction to make sure the rule is correctly captured — leaving it would have
meant the Phase 9 documentation claiming these thresholds are centralised while
one screen quietly ignored them. Flagged here so the decision is visible rather
than silent.

### Files modified

| File | Change |
|---|---|
| `src/pages/EmployeeProfile.jsx` | `touchColor()` now imports `STALE_DAYS`/`ATTENTION_DAYS` instead of hardcoding `14`/`7`. **The only source change in Phase 9 so far.** |
| `DECISIONS.md` | New "Re-confirmed by the owner, 2026-08-12 (Phase 9)" subsection under Staleness — the ruling, the no-10-day-rule warning, the negative-control band, and the fixed call site. |
| `CLAUDE.md` | Needs Attention bullet carries the same confirmation, the fix, and the import-don't-repeat rule. |
| `phase9/generate_plan.mjs` | Q-P1-1 marked RESOLVED with the answer and its consequence for Phases 6/7; assumptions and exception 9 restate the confirmed rule. |
| `simulation_plan.json` | Regenerated. Still deterministic; still 0 validation failures. |
| `phase9/validate_plan.mjs` | Added a standing warning when follow-ups are pinned to the reference date (demo drift). |

### Consequence for later phases

- **Phase 6 (Auditor):** compute the stale bucket at **>= 14 days**. The 7 leads
  in the **9–12 day band must be absent** from every queue, red flag and Today
  work queue, while still reading as stale on the lead itself.
- **Phase 7 (Reconciler):** any lead from that band appearing in a queue is a
  **real defect**, not a seeding artefact. Likewise a lead at 14+ days missing
  from the queue.

### Validation state after the change

`node phase9/generate_plan.mjs && node phase9/validate_plan.mjs` →
**0 failures, 1 warning** (the new demo-drift reminder about 8 follow-ups due
today and 4 tomorrow — informational, not a defect).

**Q-P1-1 is closed. Q-P1-2 (coordinator reassignment semantics) and Q-P1-3
(reopened leads in loss statistics) remain open, and still do not block Phase 2.**

---

## Phase 1 — ADDENDUM 2: Q-P1-2 resolved, Q-P1-3 deliberately deferred

**Date: 2026-08-12. No database writes. No source changes.**

### Q-P1-2 — coordinator reassignment: ✅ RESOLVED, keep current behaviour

**The owner's decision: history follows the person.** A coordinator always sees
their current team's full history, including work an exec did while reporting to
a different coordinator. **This is intended behaviour, not a defect.**

Concretely, for the seeded data: Imran Qureshi worked under Vikram Sethi
(SC-South) from February to May and now reports to Neha Malhotra (SC-North).
Every lead and activity he has ever logged — including those four months —
belongs to **SC-North's** aggregates. Nothing in the database records that the
earlier work happened under SC-South; `coordinator_id` is current state only and
no history table exists for it (a deliberate Phase 8 decision).

**Accepted limitation, stated explicitly:** a coordinator's historical team
report is not stable over time. Re-running "SC-South, last quarter" after an
exec transfers away returns a smaller number than the same report gave at the
time. Judged not worth the cure for a business this size with rare transfers.

**The cure, if ever wanted, is a real build, not a tweak** — a
`coordinator_history` table plus making every team-scoped policy and query
time-aware across every SC-facing screen. Declined for the pilot, and it must
not be attempted piecemeal: half the screens time-aware is worse than either
consistent answer.

**Binding on later phases:**
- **Phase 6** computes every SC team aggregate from **final `coordinator_id`
  only** — one answer, not two.
- **Phase 7** must **not** report Imran's pre-June history appearing under
  SC-North as a mismatch; that is the expected result. The genuine defect to
  watch for is the opposite — any of his rows still appearing under SC-South,
  which would mean the isolation helper is not reading current state.

### Q-P1-3 — reopened leads in "Why we lose": ⏸ DEFERRED to Phase 7, by decision

The owner chose to decide once the real figures are visible rather than in the
abstract. **This is a deliberate deferral, not an unanswered question**, and it
is the handling the Phase 9 brief itself prescribes for genuine ambiguity.

The situation: `loss_reasons` is append-only — no DELETE grant or policy for
anyone, including the owner — so a lead marked lost and later reopened keeps its
loss reason permanently, and `LossReasonsCard` keeps counting it. The seeded
data contains **29 `loss_reasons` rows against 26 currently-lost leads** (the
3 reopened leads are `lead_0002`, `lead_0090`, `lead_0121`).

Two defensible readings:
- **(A) Loss events** — count every `loss_reasons` row. A deal that died on
  price and later recovered is still real evidence that price is a friction
  point. **This is what the app does today.**
- **(B) Currently-lost leads** — count only rows whose lead is still at
  `current_stage = 'lost'`. Matches the plain reading of "how many did we lose",
  and keeps this card agreeing with Pipeline by stage.

**Binding on later phases:**
- **Phase 6 MUST emit both counts and MUST NOT collapse them.** Labelling them
  (A) loss-event count and (B) currently-lost-lead count.
- **Phase 7** reports the CRM's actual figure against **both**, and marks the
  comparison **"awaiting a product decision"** — not ❌ Mismatch. Reporting it as
  a mismatch would be reporting a bug that may not exist.
- **Phase 8 must not "fix" `LossReasonsCard` in either direction** until the
  owner has chosen.

The visible symptom either way, worth expecting during QA: "Why we lose" totals
3 higher than the `lost` count shown on Pipeline by stage.

### Files modified

| File | Change |
|---|---|
| `DECISIONS.md` | Two new Phase 9 subsections: the coordinator team-view ruling (with the accepted limitation and why the cure was declined), and the "Why we lose" open question with both readings and an explicit *don't fix either way yet*. |
| `CLAUDE.md` | Sales Coordinator section gains a leading bullet stating the team-view-follows-the-person rule and that it must not be "fixed". The Why-we-lose bullet in the Dashboard section now carries a ⚠️ open-product-question warning. |
| `phase9/generate_plan.mjs` | Q-P1-2 marked RESOLVED with its answer, consequence and accepted limitation; Q-P1-3 marked DEFERRED with an explicit instruction that the ledger carry both counts. Exception 3 gains a `ruling` field; exception 4 gains a `ledger_rule`. |
| `simulation_plan.json` | Regenerated. Deterministic, **0 validation failures**. |

### Open questions status

| ID | Topic | Status |
|---|---|---|
| Q-P1-1 | Staleness thresholds (7 / 14) | ✅ Resolved — confirmed, no change |
| Q-P1-2 | Coordinator reassignment semantics | ✅ Resolved — keep as-is, intended behaviour |
| Q-P1-3 | Reopened leads in loss statistics | ⏸ Deferred to Phase 7 — ledger carries both |

**No open questions block Phase 2. Phase 1 is complete and awaiting approval to
begin seeding.**

---

## Phase 2 — Seeder: write the simulation into the live database

**Status: COMPLETE — including the post-seed SQL correction, which the owner ran
and which was then independently verified (see the addendum at the end of this
section). Nothing from Phase 2 is pending.
Date: 2026-08-12. Branch: `phase9-audit`.**

**2,712 rows and 66 update operations written to the live database.** Every
single one went in through a real authenticated session over PostgREST — the
same path the app itself uses — so every insert passed RLS, every trigger
fired, and every CHECK constraint was evaluated exactly as it will be in
production. `service_role` was used for one thing only: creating the eight
`auth.users` logins, which has no anon-key equivalent.

### Deliverables

| File | What it is |
|---|---|
| `phase9/seed.mjs` | The seeder. Step-scoped (`--steps=`), resumable, `--dry-run`. |
| `phase9/verify_seed.mjs` | Read-only field-by-field comparison of the live DB against the plan. |
| `phase9/probe.mjs` | Read-only one-liner probe **as any chosen identity** — the tool Phases 5/7 need, since RLS answers differently per role. |
| `phase9/post_seed_lead_change_log.sql` | 225 timestamp corrections. **Run in the SQL Editor 2026-08-12 and verified — nothing pending.** |
| `phase9/demo_date_shift.sql` | Optional — only if the demo slips past ~5 days. |
| `seed_manifest.json` | Every ref → real id, all 8 Auth UUIDs, all 66 operations. 178 KB. |

### What was written

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| auth.users | 8 | | activities | 1,218 |
| employees | 8 | | follow_ups | 78 |
| areas | 13 | | stage_history | 629 |
| products | 9 | | loss_reasons | 29 |
| parties | 169 | | targets | 120 |
| sites | 128 | | lead_owner_history | 2 |
| site_contacts | 159 | | lead_change_log | 225 *(trigger-written)* |
| leads | 150 | | **plans / push_subscriptions** | **0** (by decision) |

Plus 54 value updates, 5 `exec_touches`, 5 `sc_edits`, 2 reassignments.

### Two seeder decisions the plan did not specify

Both are recorded in `seed_manifest.json` under `seeder_decisions` and in the
header of `seed.mjs`. Neither is a deviation from the plan; both are what the
plan implies once the triggers are taken into account.

**1. Leads carrying a value correction were written in two steps.**
`log_lead_changes()` writes a `created` row on INSERT and `quote_value` /
`order_value` rows **only on UPDATE**. The plan's correction list enumerates
150 + 54 + 21 = 225 rows, so those 75 value events have to actually happen as
updates — inserting the values inline would have left 75 corrections pointing
at rows that never existed, and every historical Day Review's "changes" block
empty. So a lead whose ref+field appears in the corrections is inserted with
that column NULL and updated immediately after. Result: **exactly 225
change-log rows, 150/54/21, an exact match to the correction list** — verified
live.

The *author* of each value update is the lead's own author, not always the
exec. That detail is load-bearing: for the five SC-entered leads the plan
requires to stay unlocked, an exec-authored update would have flipped
`entered_by_role` to `sales_executive` and silently destroyed exception 7.
The three anomaly leads that carry `order_value` while still open have no
correction and were written inline, so they produce no spurious change row.

**2. `employees.created_at` was backdated to the plan's `window_start`
(2026-02-12).** The plan does not specify it. Left at the default it would
render "with VIPSAR since 12 Aug 2026" on the Sales Exec Profile of someone
carrying six months of leads — a fake defect Phase 7 would then have to chase
down. No ledger metric reads this column.

### Findings

**F-P2-1 — `loss_reasons` cannot be inserted with a RETURNING clause by anyone
but the owner. A seeder artefact today; a live trap for the next person who
touches that insert.** The seeder failed here mid-run (`42501`, atomic — 0 rows
written, nothing to clean up). Cause: the INSERT policy is
`current_employee_role() IS NOT NULL` (any active employee) but the SELECT
policy is **owner-only**, and Postgres applies the SELECT policy to an INSERT's
RETURNING rows. The seeder asked for the row back; a coordinator is not
permitted to see it.

**This is not an app bug.** `LeadStageSection.jsx:167` inserts with no
`.select()`, so the app emits no RETURNING clause and the real lost-lead flow
works for every role that can reach it. Worth recording because the failure is
non-obvious and the fix is invisible: **adding `.select()` to that one insert
would break marking a lead lost for every non-owner.** Unlike the 0-row UPDATE
case Phase 0 flagged, this one at least fails loudly. Seeder resolution: insert
with `return=minimal` as the planned author (so the RLS grant is still genuinely
exercised), then read the ids back as the owner, keyed on `lead_id`.

**F-P2-2 — a sales coordinator has database-level stage rights and no UI path
to them.** `enforce_owner_only_stage_change()` deliberately admits
`sales_coordinator`, and `enforce_coordinator_lock()` exists *specifically* to
preserve those rights on a locked lead — the two are documented as a pair that
must not be separated. But `LeadQuickActions.jsx:102` and `:132` gate **Change
stage** on `isOwner` (`role === 'owner'`), so the control never renders for a
coordinator.

Today this is masked by a larger, already-documented gap: `LeadQuickActions`
only mounts under `canEdit = isOwner || lead.owner_employee_id === employee.id`,
which is never true for an SC, so they get no quick actions at all — `CLAUDE.md`
already records that as Phase 4 work. **The finding worth carrying forward is
that fixing `canEdit` alone will not be enough**: the `isOwner &&` gates behind
it would still hide the stage control, leaving the database grant unreachable.
It is the same "not an owner means a rep" shape `CLAUDE.md` already names as
recurring. **Not fixed — Phase 8, per protocol.** Consequence for Phase 3: an SC
cannot mark a lead won or lost through the UI, so that path can only be tested
as owner.

### Verification

**Two independent passes, both against the live database, both green.**

*Seeder pass* (`--steps=verify`) — 16 table row counts, all exact, plus the four
trigger-derived columns the whole authored-by discipline exists to produce:
`leads.entered_by_role`, `leads.created_by_employee_id`,
`activities.logged_by_employee_id`, `activities.entered_by_role`. **All four
match the plan's expectations across all 1,368 rows that carry them.**

*Field-by-field pass* (`phase9/verify_seed.mjs`) — every seeded row compared
column by column against the plan, with type-aware comparison (Postgres returns
DECIMAL as a string, and DATE/TIMESTAMP with its own formatting). **13 tables,
2,712 rows, zero missing rows, zero field mismatches.** Where an `exec_touch` or
`sc_edit` deliberately overwrote a lead's `closure_probability` /
`next_followup_date`, the patch is treated as the expected final state — it is
the last write.

Spot checks that matter for later phases, all confirmed live:

- **The SC edit lock works from both sides.** All 5 `exec_touches` flipped
  `entered_by_role` to `sales_executive`; all 5 `sc_edits` left it NULL. Both
  were asserted by the seeder at write time, not inspected afterwards.
- **Creator attribution survives reassignment.** Both cross-team leads now show
  `owner_employee_id` = the new owner while `created_by_employee_id` still
  points at the original — which is the entire reason that column exists.
- **RLS partitions the two coordinator teams exactly.** The two SCs' visible
  lead sets and activity sets each sum to the full company total with no overlap
  and no leakage in either direction. An exec's `parties` read is genuinely
  narrowed, not open. *(Figures deliberately omitted — see the firewall note.)*
- **`plans` and `push_subscriptions` are still at 0 rows**, as decided.

### ✅ The one step the app cannot do — RUN AND VERIFIED

**`phase9/post_seed_lead_change_log.sql` was run in the Supabase SQL Editor by
the owner on 2026-08-12, and its result independently verified against the live
database. Nothing is outstanding from Phase 2.** (See the addendum below for the
verification evidence.)

Why it could not be done from the seeder: `changed_at` is written by an AFTER
trigger from the column's own `DEFAULT now()`, and the table carries an explicit
`REVOKE INSERT, UPDATE, DELETE ... FROM authenticated` — append-only by design,
so no application session can correct it. Until it ran, **every historical Day
Review showed an empty "changes made to leads" block while today showed all 225
at once.** The file is idempotent (it sets absolute values), wrapped in a
transaction, and ends with a verification query reporting
`total 225, still_stamped_today 0, duplicates 0`.

`phase9/demo_date_shift.sql` is **optional** and should be left alone unless the
demo slips more than ~5 days past 2026-08-12 — it moves only open follow-ups and
future lead follow-up dates, never history. It computes its own offset from
`CURRENT_DATE`, so nothing needs editing, but it is **one-shot and not
idempotent** (it applies a delta and there is no marker column to detect a
previous run). It opens with a read-only preview query for exactly that reason.

### A note on credentials

`SEED_USER_PASSWORD` shipped blank in `.env.phase9` with an instruction to
generate one. It was generated and **appended to `.env.phase9`** (git-ignored)
rather than written into `seed_manifest.json` as that file's comment suggested:
the manifest is a plain untracked repo file likely to be committed as Phase 9
evidence, and a shared login for eight accounts should not ride along with it.
The manifest records where to find it instead. All eight seeded accounts share
that one password. **Rotate the `service_role` key when Phase 9 finishes, as
`.env.phase9` already says.**

### Files created / modified

| File | Change |
|---|---|
| `phase9/seed.mjs` | **created** — the seeder |
| `phase9/verify_seed.mjs` | **created** — field-by-field verification |
| `phase9/probe.mjs` | **created** — per-identity read-only probe |
| `phase9/post_seed_lead_change_log.sql` | **created** — 225 corrections, run in SQL Editor |
| `phase9/demo_date_shift.sql` | **created** — optional drift fix |
| `seed_manifest.json` | **updated** — full ref→id map, 8 Auth UUIDs, 66 operations, verification record |
| `.env.phase9` | **updated** — generated `SEED_USER_PASSWORD` appended |
| `PHASE9_LOG.md` | this section |

**No application source was modified in Phase 2.** No commits made.

### Could not verify / skipped

| Item | Why |
|---|---|
| That the seeded data *renders* correctly in the app | That is Phase 3/4. Phase 2 verified the database, not the UI. |
| `plans`, `push_subscriptions` | Excluded by Phase 0 decisions. |

*(`lead_change_log` timestamps were listed here until the correction SQL ran —
now verified, see the addendum below.)*

### What Phase 3 needs to know

1. **Nothing needs running first — the correction SQL is already done.** The
   Day Review's changes block reads correctly on every historical date.
2. **Nine logins exist**, the eight seeded ones sharing `.env.phase9`'s
   `SEED_USER_PASSWORD`; the owner keeps their own. Emails are
   `<first>.<last>@vipsar-sim.test`, listed in `seed_manifest.json` under
   `auth_users_created`.
3. **An SC cannot change a lead's stage through the UI** (F-P2-2). Won/Lost
   transitions are owner-only in practice. Do not log that as a new discovery.
4. **`phase9/probe.mjs <identity> "<path>"` answers "what does this role
   actually see"** in one line — cheaper than a browser session for a scoping
   question, and it is the real RLS path, not the SQL Editor's BYPASSRLS view.
5. **Re-running any seeder step is safe.** It is manifest-driven and skips every
   ref already recorded.

### A note on the firewall

Same rule as Phase 1: **this section carries table row counts only, never a
per-exec or per-team business figure.** Phase 6 computes the ledger from
`simulation_plan.json` alone, and it cannot be checked against a number this log
already handed it. Where a per-team verification is described above, the
*property* verified is stated (exact partition, no leakage) and the figures
are not.

---

**Phase 2 ends here. Awaiting approval before starting Phase 3 (QA / flows).**

---

## Phase 2 — ADDENDUM: change-log correction run and verified

**Date: 2026-08-12. Phase 2 is now COMPLETE with nothing outstanding.**

The owner ran `phase9/post_seed_lead_change_log.sql` in the Supabase SQL Editor.
Its per-field breakdown returned exactly what the file predicted:

```
field         count
created         150
order_value      21
quote_value      54
```

### Verified independently, not inferred from that output

The breakdown query proves the right rows exist; it does **not** prove the
timestamps moved. Re-ran `phase9/verify_seed.mjs` against the live database:

- **225 of 225 rows now carry their intended timestamp** (was 0 before the run).
- **0 rows still stamped at seeding time** (was 225).
- **0 rows without a matching correction.**
- All 13 other tables still verify field by field — the correction touched
  nothing it should not have.

Three further spot checks, since this is the one table whose contents the
seeder could not itself control:

- **Range is exactly the plan's window** — earliest `2026-02-12T12:55:00+00`,
  latest `2026-08-11T11:05:00+00`. No row bunched at the seeding moment.
- **Times render as plausible IST working hours.** `changed_at` is the one
  `TIMESTAMPTZ` in this schema, so `parseTimestamp()` passes it through
  untouched: the three sampled rows render as 18:25, 10:30 and 16:35 IST — all
  inside the 09:00–18:xx band the plan generates from.
- **`changed_by` is populated on all 225 rows; zero are NULL.** This matters
  more than it looks. The Day Review's team table and day sheet key the changes
  column on `changed_by`, and `log_lead_changes()` writes NULL whenever
  `current_employee_id()` cannot resolve — which is exactly what happens for
  anything written from the SQL Editor. A NULL here would mean a change that
  appears on nobody's day. That the count is zero confirms every change-log row
  was generated by a genuine authenticated session, which was the whole point of
  seeding through the app's own path rather than by direct SQL insert.

### Consequence

The Day Review is now readable for any date in the simulation window: the
"changes made to leads" block populates on historical days and the team table's
Changes column carries real per-exec counts. Phase 3 can exercise it directly.

### Files modified

| File | Change |
|---|---|
| `PHASE9_LOG.md` | Phase 2's Outstanding section rewritten as run-and-verified; "could not verify" table and the Phase 3 hand-off note updated so a resuming session is not told to run SQL that is already applied. This addendum. |
| `seed_manifest.json` | `post_seed_corrections_applied` recorded, with the verification result. |

No database writes from this session. No application source modified. No commits.

---

**Phase 2 is complete. Awaiting approval before starting Phase 3 (QA / flows).**

---

## Phase 3 — QA: drive the real UI as every role

**Status: COMPLETE for everything that can be exercised without polluting the
seed. Date: 2026-08-12. Branch: `phase9-audit`.**

**181 assertions across four suites, 177 passing. The 4 failures are two real
defects, both reported and neither fixed (Phase 8, per protocol).** Every one of
the nine identities was driven through the real UI in a real browser; nothing
below was reasoned about without being run.

### Deliverables — a re-runnable suite, not throwaway interactions

| File | What it is |
|---|---|
| `phase9/lib.mjs` | Shared env / plan / manifest access, per-identity sign-in, PostgREST wrapper. One definition of "sign in as this employee". |
| `phase9/probes.mjs` | The 23 guard-rail probes — writes that must fail, and the two that must succeed. |
| `phase9/e2e/harness.mjs` | One Chromium, N storage-isolated contexts, real-form login, console/network capture, `settle()`. |
| `phase9/e2e/layout-audit.mjs` | Generic detector for the grid defect `CLAUDE.md` calls non-negotiable. |
| `phase9/e2e/01-login-and-landing.mjs` | 38 assertions — all nine accounts sign in and land correctly. |
| `phase9/e2e/02-screens.mjs` | 101 assertions — every screen, every role, both directions of route access. |
| `phase9/e2e/03-phase8-items.mjs` | 19 assertions — the items Phase 8 shipped but never exercised. |
| `phase9/e2e/run-all.mjs` | Runs everything, then re-proves the seed is untouched. |
| `phase9/e2e/screenshots/` | 30 screenshots, captured per role per screen. |

```bash
node phase9/e2e/run-all.mjs
```

**Nine isolated `browser.newContext()` sessions against ONE dev server**, as
Phase 0 decided — `.claude/launch.json` stays at three ports. Login goes through
the real form rather than by injecting a token, so every run also re-proves that
nine real accounts can actually log in.

### Results

| Suite | Result |
|---|---|
| Guard-rail probes | **23 / 23** |
| 01 login + landing | **38 / 38** |
| 02 screens | 97 / 101 — 4 failures, both findings below |
| 03 Phase 8 items | **19 / 19** |
| Seed still plan-exact afterwards | **13 tables, 0 mismatches** |

### The guard rails are real, and measured

All 23 passed. Every probe **re-reads the row** rather than trusting the absence
of an error — an RLS-rejected UPDATE returns `{data: null, error: null}` with no
exception, so a probe that only checked the response would report a passing
guard rail on a database that had accepted the write.

Confirmed live: a sales executive cannot change a stage (`23514`, real message)
or insert `stage_history` (`42501`); a coordinator cannot edit a locked lead's
`quote_value` (`23514`) **but can still change its stage** — the pair
`CLAUDE.md` says must never be separated, now demonstrated from both sides
rather than asserted; cross-team reads return nothing and cross-team writes
affect zero rows; an exec sees exactly their own leads and no `loss_reasons` at
all.

**Phase 0's "one layer thin" finding is now empirically confirmed, and the
distinction is visible in the response itself.** `UPDATE stage_history` and
`DELETE lead_owner_history` both return **HTTP 200 with zero rows and no
error** — the grant permits them and only the absence of a policy stops them.
`DELETE lead_change_log` returns a hard **403 / 42501**, because that table has
an explicit `REVOKE`. Phase 5 should rank the severity; the empirical half it
asked for is done.

### Findings

**F-P3-1 — the Today screen's "Done today" strip leaves a third of its row
empty at desktop width.** `Home.jsx:315` renders 4 tiles into `.vip-dd-kpi-grid`,
which is `repeat(6, …)` above 1024px: **395px of an 1180px row blank**, measured
by computed style and visible in the screenshot. Affects the owner and all six
execs — it is the first thing anyone sees after logging in.

The fix already exists and is already used elsewhere: `.vip-dd-kpi-grid-4`
(theme line 2107) is applied by `DayReviewHeader.jsx:62` for its own 4-tile
strip. Home's strip, added in the same Day Review pass, missed it. One class.

**F-P3-2 — every row of the Dashboard's attainment heatmap ends in an empty
column.** `.vip-dd-heatmap-row` declares `minmax(112px, 1.3fr) repeat(7, …)` =
8 tracks, but `DashboardHeatmap.jsx:13` builds `COLS` from
`ACTIVITY_METRIC_OPTIONS` (now **4**) plus Order value and Overall = 6, plus the
name cell = **7 children**. Result: 92px of every 754px row blank, on six rows.

This is drift, and its cause is datable: Office Day, Booking Update and Offers
Sent were dropped from the targetable metric list on 2026-08-09; the component
follows that list dynamically, the stylesheet's hardcoded `repeat(7, …)` did
not. Worth fixing by deriving the track count rather than hardcoding a new
number, or the same drift recurs the next time the metric list changes.

Both are exactly the failure `CLAUDE.md`'s Design system section calls
non-negotiable and says to check "via computed `getBoundingClientRect()` during
build, not just eyeballed". **`phase9/e2e/layout-audit.mjs` now does that check
automatically on every screen, every run** — it is deliberately conservative and
reports only unambiguous single-row gaps, so a wrapped list with a ragged last
row never trips it.

### The Phase 8 items are verified — all of them

`CLAUDE.md` listed these as "still not verified (no longer blocked)". They are
now, against real seeded data:

- **"Added by sales coordinator Neha Malhotra"** renders on the Deal owner card.
- **"logged by sales coordinator Neha Malhotra"** renders in the Activity
  timeline — and the timeline is **not empty**, which is the specific silent
  failure mode `CLAUDE.md` warned a missing `logged_by_employee_id` would cause.
- **The `sites` and `parties` `coordinator_team_update` policies work.** A
  coordinator updated a team member's `site_stage` and it *stuck* — the exact
  operation that silently no-opped on 2026-08-11. Round-tripped and restored.
- **All three role-assignment guards fire**, with their real messages:
  demoting a coordinator who still has reports, pointing `coordinator_id` at a
  non-coordinator, and promoting an exec without clearing `coordinator_id`.
- **Day Review multi-exec sorting works** — clicking a column header genuinely
  reorders all six execs (previously unit-tested only; this database is the
  first with six real execs to try it on).

Route gating was asserted in **both** directions: a coordinator and an exec are
both redirected off `/team`, an exec is redirected off a colleague's profile,
and the owner is redirected off `/activity` — while every route each role
*should* reach renders with no console errors and no failed requests.

### Two traps in the test harness itself, worth recording

Neither was an app defect, and both would have been reported as one:

1. **`fullPage: true` screenshots smear `position: fixed` elements.** The first
   capture showed the sidebar as a huge dark overlay swallowing the page — it
   reads exactly like a catastrophic layout bug. It is a capture artifact;
   confirmed by comparing a viewport shot and the element's own box (68px,
   correct). The harness now takes viewport shots by default and parks the
   pointer off the sidebar first, since the sidebar hover-expands by pure CSS
   and a shot with the pointer at the default 0,0 captures it open.
2. **`networkidle` is not enough, and the app renders `Loading…` with U+2026.**
   The Day Review fires seven parallel fetches *after* the previous load has
   settled, so `networkidle` resolved against the old quiet period and three
   assertions ran against a "Loading…" screen. My first fix matched
   `Loading...` with three ASCII dots and silently never fired. `harness.settle()`
   now waits on the real character. **The Day Review settles in ~560ms and is
   not slow** — the failures were entirely mine.

### Write discipline, and the proof

Phase 3 needed real writes (the coordinator UPDATE policies, the role guards,
the coordinator stage-change probe). **Every one was round-tripped**: capture the
original, write, verify the effect by re-reading, restore, verify the restore.
Failing probes write nothing by definition.

`phase9/verify_seed.mjs` was re-run afterwards: **13 tables, 2,712 rows, zero
missing rows, zero field mismatches, and all 225 `lead_change_log` timestamps
still correct.** The database Phase 6 and Phase 7 will reconcile against is
byte-for-byte what Phase 2 left. That proof is part of `run-all.mjs`, so it
cannot be skipped on a re-run.

### Could not verify / deliberately skipped

| Item | Why |
|---|---|
| End-to-end **write** flows through the UI (submit a new lead, log an activity) | These add rows that cannot be round-tripped — an activity insert is not reversible without an owner DELETE, and a lead insert cascades a `lead_change_log` row. Running them would move the database away from `simulation_plan.json` and invalidate Phase 6/7. The forms were verified to **render and populate** correctly for every role; submitting them needs either a decision to accept the drift or a throwaway database. **Flagged for the user — see below.** |
| The Day Review **Reschedule** write path | Same reason: it mutates a seeded follow-up. |
| Mobile viewport (<1024px) | The harness supports it (`MOBILE`); this pass ran desktop only. Phase 4 is the visual/responsive phase and is the right place. |
| Push notifications | Needs a real device and a real VAPID endpoint — the accepted gap recorded in Phase 1. |
| An SC marking a lead won/lost through the UI | Impossible by F-P2-2 (already reported in Phase 2), not a new finding. |

### 🛑 One decision needed before Phase 4

**Should Phase 3 submit the create-flows for real?** Testing "New Lead" and
"Log Activity" end to end means inserting rows that will not match
`simulation_plan.json`. Three options, and they are not equivalent:

- **(a) Leave it.** The forms render correctly for all three roles, including the
  coordinator's mandatory "Who is this for?" picker. The underlying writes are
  already proven — Phase 2 performed 2,712 of them through the same RLS path.
- **(b) Submit, then delete.** Owner DELETE exists on `leads`/`activities`, and
  `lead_change_log` cascades. Cleanest coverage; small risk of leaving residue
  if a step fails midway.
- **(c) Defer to after Phase 7,** once the ledger has been reconciled and the
  data no longer needs to be plan-exact.

**My recommendation is (c)** — the flows get genuinely exercised, and nothing
that Phase 6 and Phase 7 depend on is put at risk to do it.

> **✅ RESOLVED — the owner chose (a): leave it.** The create-flows are not
> submitted, in Phase 3 or later. Rationale on the record: the forms were
> verified to render and populate correctly for every role (including the
> coordinator's mandatory "Who is this for?" picker), and the writes behind them
> are not unproven — Phase 2 performed 2,712 inserts through the identical RLS,
> trigger and constraint path, including 10 coordinator-entered leads and 20
> coordinator-logged activities. **Accepted residual risk, stated plainly: no
> test covers the browser-side submit handlers themselves** — field validation,
> the `lead_needs_an_anchor` check surfacing as a UI error, the post-submit
> reset, and `ActivityLog`'s side-effect warning path. Those remain
> pilot-discovered. **Phase 8 must not treat this as a covered area.**

### Files created / modified

| File | Change |
|---|---|
| `phase9/lib.mjs`, `phase9/probes.mjs` | **created** |
| `phase9/e2e/*` (harness, layout-audit, 01, 02, 03, run-all) | **created** |
| `phase9/e2e/screenshots/*` | **created** — 30 screenshots |
| `PHASE9_LOG.md` | this section |

**No application source was modified in Phase 3.** No commits made. Playwright's
Chromium binary was downloaded to complete the Phase 0 install (the package was
added then, the browser never was).

### A note on the firewall

Unchanged from Phases 1 and 2: **this section reports assertion counts and
defects, never a per-exec or per-team business figure.** Several such numbers
were read off screen during this pass and are deliberately not recorded here —
Phase 6 must derive them from `simulation_plan.json` alone, and Phase 7 is where
they get compared.

---

**Phase 3 ends here. Awaiting approval before starting Phase 4.**

---

## Phase 4 — Visual / responsive audit + redundancy report

**Status: COMPLETE. Date: 2026-08-12. Branch: `phase9-audit`. Read-only —
no writes, no source changes.**

**210 assertions across 3 roles × 21 screens × 2 breakpoints (390px and
1440px), 201 passing.** Phase 3 ran desktop only; this app is mobile-first for
reps working from a phone, so the 390px pass is the one that mattered and had
never been automated.

### Deliverables

| File | What it is |
|---|---|
| `phase9/e2e/visual-audit.mjs` | Four detectors, each targeting a defect class this codebase has actually shipped. |
| `phase9/e2e/04-responsive.mjs` | The sweep: every role × route × breakpoint. |
| `phase9/e2e/screenshots/04-*` | Per-role, per-breakpoint captures. |

The detectors are deliberately not a generic lint — each one exists because
`CLAUDE.md` records that exact bug being found by hand at least once, and
hand-checking does not survive the next screen nobody thinks to re-examine.

### The two things that could have been worst are clean

- **Zero horizontal overflow.** Not one screen, role, or breakpoint makes the
  page scroll sideways. For a phone-first field app that is the single most
  disruptive layout failure, and it is absent.
- **Zero visibility-cascade leaks.** `.vip-only-mobile` / `.vip-only-desktop`
  are single-class rules, so any unguarded `display` declared later at equal
  specificity leaks the hidden half through. `CLAUDE.md` records this biting
  twice (`.vip-leads-layout`, `.vip-daycards`). **It has not recurred** — every
  paired element is correctly hidden at the breakpoint that should hide it.

### Findings

**F-P4-1 — the longest stage chip overruns its column and prints on top of the
next one.** On All Leads at desktop width, a lead at the `measurements` stage
renders the chip "Measurements to be taken", which overflows the STAGE track by
**23px into SOURCE** — visibly printing over "Scanning" / "Referral (Architect)".
Reproduced for **all three roles**, and visible in
`04-desktop-emp_owner-all-leads.png` on the "Neetu Malik" row. The chip neither
wraps, truncates, nor widens its track. This is the same shape as the Quotes &
orders overlap `CLAUDE.md` already documents fixing at 390px, now at desktop
width on a different screen.

**F-P4-2 — All Leads shows ₹0 for a lead that has no value, and the canonical
rule says it must show "—".** `CLAUDE.md`'s Pipeline/deal value bullet is
explicit: *"never a fabricated `0` — a lead with neither value renders `—`, not
`₹0`"*. But `src/lib/pipelineValue.js:16` is
`if (isOpenLead(lead)) return Number(lead.quote_value ?? 0)` — it coerces "no
value known" to `0`, and every per-lead display site formats that as **₹0**.

On real data this is not a corner case: **every row visible in the All Leads
screenshot reads ₹0**, while the header correctly totals ₹3.02Cr. An
un-quoted lead reads as a deal worth nothing rather than one not yet priced.

Worth flagging carefully rather than prescribing a fix: `dealValueFor()` is used
for **both** summing (where `0` is correct and required) and per-lead display
(where `—` is required). Phase 8 cannot simply change the return to `null` —
`sumOpenPipelineValue` and the four category cards would break. It needs either a
separate display helper or null-aware callers.

**F-P4-3 — My Team's stat labels are clipped at desktop width.** "Open pipeline"
needs 74px in a 58px box; "Needs attn." needs 63px. Both truncate without an
ellipsis, so the label is simply cut. Minor, but it is on the owner's team
directory.

**F-P4-4 — the "Worked with" employee list overlaps itself on mobile Search.**
At 390px, employee names in the party directory's "Worked with" column print
over one another (measured 47–95px of overlap between name pairs). This is the
one place in Search where a variable-length list shares a row.

**F-P4-5 — Sales Exec Profile's "Leads assigned" rows overlap on mobile.** The
site name overruns the date by 20px at 390px, and the "this month, 6 metrics"
subtitle is clipped (95px into 86px).

**F-P3-1 and F-P3-2 reconfirmed** at desktop, unchanged from Phase 3 — the
Today "Done today" strip (4 tiles in 6 tracks) and every heatmap row (7 children
in 8 tracks). Both are desktop-only; neither appears at 390px, where the grids
collapse to 2 and 1 columns respectively.

### Redundancy report — report only, no removal (per DECISIONS.md)

**`plans`** — unchanged from Phase 0: the table exists, has RLS policies, has
**zero references anywhere in `src/`**, and no UI. Vestigial from the original
sheet-replacement design, never built. Not seeded, not removed.

**`src/components/SiteSearchOrCreate.jsx` has zero consumers.** `CLAUDE.md`
documents it alongside `PartySearchOrCreate` and instructs "reuse these for any
future party/site picker — don't write another search input". `PartySearchOrCreate`
is used in four places; `SiteSearchOrCreate` is imported by **nothing**. The only
other mention is a comment in `searchQueries.js`. It is dead code today — but it
is dead *reference implementation*, which is a different judgement call from dead
accidental code, so it is reported rather than recommended for deletion.

**~27 orphaned CSS classes**, all traceable to components `CLAUDE.md` records as
deliberately deleted:

| Group | Classes | Deleted with |
|---|---|---|
| `vip-board-*` | 12 | `LeadStageBoard.jsx` (Kanban, removed 2026-08-09) |
| `vip-matrix-*` | 4 | the per-exec matrices dropped in the Dashboard-v2 density pass |
| `vip-kpi-label/value/note` | 3 | Home's old KPI grid, replaced by `.vip-dd-kpi-*` |
| `vip-tile-grid`, `vip-tile-primary` | 2 | `HOME_TILES` / the Home tile grid |
| `vip-radio-row`, `vip-radio-dot` | 2 | `RecentLeadsPicker`, removed from ActivityLog |
| `vip-up`, `vip-down` | 2 | uncertain — no template-literal construction found |

**A caveat that matters more than the list.** The naive scan first reported 39
unused classes; **12 of those were false positives** — `vip-chip-<stage>` and
`vip-dd-day-tag-<type>` are built with template literals
(`` `vip-chip vip-chip-${stage}` `` in `statusColors.js:36`,
`` `vip-dd-day-tag-${type}` `` in `dayReview.js:229`), so a literal-string grep
cannot see them. **Anyone acting on this list must re-check for dynamic
construction before deleting a class**, or the stage chips lose their colours.

### A note on the tooling

The overlap detector reported **39** hits on its first run and **18** after one
fix — it had to be made positioning-aware. This app's chrome is `position: fixed`
(the bottom nav, the header, Lead Detail's sticky action bar), and all of it
legitimately floats above scrolling content. Comparing those boxes against page
content reports the intended layout as a defect. Only elements sharing a
positioning context can meaningfully overlap. Recording it because the naive
version would have shipped ~21 false findings into Phase 7.

### Could not verify / skipped

| Item | Why |
|---|---|
| Dark mode rendering | The theme has documented un-tokenised accents (heatmap tiers, sparkline tints). Worth its own pass; not attempted here rather than half-done. |
| Real device rendering (iOS Safari, Android Chrome) | Chromium at 390px is a good proxy but not the same thing — `env(safe-area-inset-*)` and iOS Safari's viewport behaviour only resolve on hardware. |
| Installed-PWA (standalone) rendering | Needs `npm run build && npm run preview` and a real install; the dev server does not register the service worker at all. |
| Create-flow submission | Owner's decision (a) — see the Phase 3 addendum. |

### Files created / modified

| File | Change |
|---|---|
| `phase9/e2e/visual-audit.mjs`, `phase9/e2e/04-responsive.mjs` | **created** |
| `phase9/e2e/screenshots/04-*` | **created** |
| `PHASE9_LOG.md` | this section |

**No application source modified. No database writes. No commits.**

### Running total of open findings for Phase 8

| ID | Severity | What |
|---|---|---|
| F-P2-1 | latent trap | `.select()` on the `loss_reasons` insert would break marking a lead lost for every non-owner |
| F-P2-2 | functional | a coordinator has DB stage rights and no UI path; fixing `canEdit` alone is not enough |
| F-P4-2 | **user-visible, wrong data** | All Leads shows ₹0 where the canonical rule requires "—" |
| F-P4-1 | user-visible | longest stage chip prints over the SOURCE column, all roles |
| F-P3-1 | cosmetic | Today's "Done today" strip: 4 tiles in a 6-track grid |
| F-P3-2 | cosmetic | heatmap rows: 7 children in an 8-track grid |
| F-P4-4 / F-P4-5 | cosmetic, mobile | overlapping text in mobile Search and Sales Exec Profile |
| F-P4-3 | cosmetic | My Team stat labels clipped |
| — | redundancy | `plans`, `SiteSearchOrCreate.jsx`, ~27 orphaned CSS classes |

**Nothing has been fixed. All of it is Phase 8, per protocol.**

---

**Phase 4 ends here. Awaiting approval before starting Phase 5 (security).**

---

## Phase 5 — Security audit

**Status: COMPLETE. Date: 2026-08-12. Branch: `phase9-audit`. Net-zero — every
write round-tripped and restored, no source changes.**

**25 security assertions, all passing.** Every one measured **empirically**
against the live database through a real authenticated session on the anon
key — the same path the app and any attacker would use. Not read off
`rls_policies.sql`, which describes intent; and not run in the SQL Editor,
which is `postgres` with BYPASSRLS and no `auth.uid()`, so every helper resolves
NULL there and the answer is meaningless.

### Deliverable

`phase9/security-audit.mjs` — a re-runnable capability matrix plus the
adversarial suite. Non-destructive by construction: it probes the **forbidden**
direction, so a correctly-refused operation writes nothing.

### What holds up — and it is most of it

**No privilege escalation is possible.** An exec cannot promote themselves to
owner; a coordinator cannot promote themselves; a coordinator cannot recruit
another team's exec by rewriting `coordinator_id`; an exec cannot steal a
colleague's lead; and a coordinator can neither assign a team lead **to
themselves** nor push one **out** to another team — the `WITH CHECK` half of the
team policy refuses both with `23514`.

**No forgery is possible.** An exec cannot log an activity attributed to a
colleague, cannot create a lead owned by one, and **nobody at all can write
`lead_change_log` directly** — the trigger really is its only writer, which is
what makes the audit trail worth having.

**Deactivation revokes access immediately, on an already-open session.** This
was tested the strong way: the deactivated employee's existing JWT was reused —
still cryptographically valid and unexpired — and the database refused it
anyway. Leads visible dropped to 0, parties to 0, writes to `42501`. Reactivating
restored access. This is the load-bearing claim behind `current_employee_id()` /
`current_employee_role()` filtering on `is_active`, and it is real.

**The anon key alone reaches nothing** — `401` on every table.

**Team isolation is exact.** The two coordinators' visible lead sets and
activity sets each partition the company total with no overlap and no gap, and
`loss_reasons` is genuinely owner-only — **both coordinators see zero**, which is
worth stating because an SC is otherwise a partial-owner in many places and is
not here.

**Secrets hygiene is clean.** Only `.env.example` is tracked; `.env` and
`.env.phase9` are both git-ignored; and **the `service_role` key does not appear
in the built bundle**. The anon key does, which is correct — that is what an
anon key is for, and RLS is what makes it safe.

### Findings

**F-P5-1 — `lead_owner_history` is readable by every active employee, unscoped.**
Its SELECT policy is `current_employee_role() IS NOT NULL`, with no own-leads and
no team branch. **Measured: all five roles tested see all rows** — an exec sees
reassignments of leads they have never owned, and each coordinator sees the
other team's.

This is the **same defect class that was already found and fixed once**. The
2026-08-10 data-isolation audit narrowed `stage_history` for exactly this reason
(`migration_scope_stage_history.sql`), and the measured matrix shows that fix
working correctly today. `lead_owner_history` was missed because it was created
a day earlier, by `migration_pilot_outstanding.sql`, and was not in that audit's
scope. The leak is lead/employee association metadata rather than commercial
values — modest, but it is precisely the metadata RLS is otherwise careful to
hide. **Fix is a one-policy change mirroring `stage_history`'s.**

**F-P5-2 — a coordinator's Day Review "Changes" column is structurally always
empty, and the decision that caused it has gone stale.** `lead_change_log`
SELECT is own-leads-or-owner with no coordinator branch. **Measured: each
coordinator sees 0 of 225 rows — zero on every date, not zero on a given day.**

This was a *correct* decision when it was made.
`migration_sales_coordinator.sql`'s own "DELIBERATELY NOT CHANGED" block says:
*"lead_change_log — SELECT stays own-leads-or-owner. The Day Review is not part
of the SC surface in this phase."* Phase 8 then built the coordinator Dashboard,
**including a team-scoped Day Review**, and the policy was never revisited. The
premise is no longer true.

Verified in the UI, and the first attempt at that check was wrong in a way worth
recording: on **today's** date the column reads "—" for the owner too, because
all 225 change rows were backdated by the post-seed correction — so today proves
nothing. Re-tested on 2026-07-14, the busiest change date: the **owner's** column
populates correctly (1 change for one exec) while the coordinator's cannot.

**F-P5-3 — append-only tables are defended by one layer, not two.** Phase 0
found this by introspection; Phase 3 confirmed it empirically, as Phase 0
required. Severity ranking, which was Phase 5's job:

**Severity: LOW today, MEDIUM as a latent risk. Not exploitable now.**
`authenticated` holds `UPDATE` on `stage_history`, `DELETE` on
`lead_owner_history` and `TRUNCATE` on `lead_change_log` through
`ALTER DEFAULT PRIVILEGES`. Every one is refused at runtime — measured, by a
real owner session — because no matching policy exists. TRUNCATE bypasses RLS
entirely but PostgREST exposes no TRUNCATE verb and `authenticated` is a JWT-
assumed role, not a connectable login, so there is no path to it today.

What makes it worth fixing rather than accepting: **the defence is a single
`CREATE POLICY` away from evaporating**, silently, in a change that would look
unrelated. An audit trail that can be rewritten is worth less than the rows in
it. The structural cause is broader than these three tables — **every table
added to this schema from now on arrives with full DML granted to
`authenticated`** and must `REVOKE` explicitly. `migration_lead_change_log.sql`
STEP 6 is the only migration that remembered, and even it missed TRUNCATE.

**F-P5-4 — one production dependency advisory, five dev-only.** Phase 0 asked
that these be split so a devDependency is not mistaken for a production finding:

| Package | Where | Advisory |
|---|---|---|
| **react-router / react-router-dom** | **`dependencies` — production** | RSC-mode CSRF bypass |
| brace-expansion, fast-uri, nanoid, postcss | devDependencies (vite / vitest / oxlint toolchain) | DoS, host confusion, infinite loop, source-map read |

**None were introduced by the Playwright install** — Playwright resolves clean.
The five dev ones ship in no artifact a user ever receives.

The production one needs a qualification rather than an alarm: **the advisory
covers React Router's RSC mode, and this app does not use it.** It is a Vite
client-side SPA — no React Server Components, no server-side action handling,
nothing to bypass. Exposure is very likely nil. Bump it on the next dependency
pass; it does not gate the pilot.

**F-P5-5 (hygiene) — `service_role` cannot read `lead_change_log` or
`lead_owner_history`.** Carried forward from Phase 0, confirmed unchanged. Both
were created after this project moved to `auto_expose_new_tables = false` and
were granted only to `authenticated`. **No impact on the app**, which
authenticates as `authenticated`; it bites only tooling reaching in with the
service_role key. It **fails closed**, which is the right direction.

### `plans` — RLS audited, as Phase 0 required

Policies exist and are the standard own-data-or-owner shape with **no coordinator
branch**. The table is empty for every role (never seeded, by decision) and has
zero references in `src/`. **No security concern: an unreachable table with
correct policies.** It stays a redundancy candidate, report-only.

### Could not verify / skipped

| Item | Why |
|---|---|
| Penetration testing of the Supabase platform itself | Out of scope and not ours to test. |
| The Edge Function's `service_role` path | Needs a real invocation with the function's own secret; the push pipeline is an accepted untested gap from Phase 1. |
| XSS / injection via user-supplied text | React escapes by default and there is no `dangerouslySetInnerHTML` anywhere in `src/`; PostgREST parameterises. Reasoned, not fuzzed. |
| Rate limiting / brute force on login | A Supabase platform control, not an application one. |

### Files created / modified

| File | Change |
|---|---|
| `phase9/security-audit.mjs` | **created** |
| `PHASE9_LOG.md` | this section |

**No application source modified. No net database changes.** No commits.

### Running total of open findings for Phase 8

| ID | Severity | What |
|---|---|---|
| F-P5-1 | **security — data leak** | `lead_owner_history` readable unscoped by every employee; same class already fixed for `stage_history` |
| F-P5-2 | **functional** | coordinator Day Review "Changes" always empty — a correct decision that went stale when Phase 8 shipped the SC dashboard |
| F-P4-2 | user-visible, wrong data | All Leads shows ₹0 where the canonical rule requires "—" |
| F-P2-2 | functional | coordinator has DB stage rights, no UI path |
| F-P4-1 | user-visible | longest stage chip prints over the SOURCE column |
| F-P5-3 | low now / medium latent | append-only tables defended by one layer; every new table inherits full DML |
| F-P2-1 | latent trap | `.select()` on the `loss_reasons` insert would break marking a lead lost for non-owners |
| F-P3-1, F-P3-2 | cosmetic | two grids with more tracks than children |
| F-P4-3/4/5 | cosmetic | clipped labels, overlapping text on two mobile screens |
| F-P5-4 | informational | one production CVE, almost certainly not applicable; five dev-only |
| F-P5-5 | hygiene | `service_role` missing SELECT on two tables; fails closed |
| — | redundancy | `plans`, `SiteSearchOrCreate.jsx`, ~27 orphaned CSS classes |

**Nothing has been fixed. All of it is Phase 8, per protocol.**

---

**Phase 5 ends here. Awaiting approval before starting Phase 6 (Auditor).**

---

## Phase 6 — The Auditor: expected_ledger.json

**Status: COMPLETE. Date: 2026-08-12. Branch: `phase9-audit`. No database
queries, no source changes, no writes of any kind.**

### Deliverables

| File | What it is |
|---|---|
| `phase9/audit.mjs` | The Auditor. Deterministic, re-runnable. |
| `expected_ledger.json` | 22.7 KB. What the CRM *should* show, for every figure Phase 7 will check. |

### The two firewalls, and why they are the whole point

**1. No database.** Nothing in `audit.mjs` touches Supabase. The ledger is
derived from `simulation_plan.json` and nothing else. If it were computed from
the same database Phase 7 reads, agreement would prove only that a number equals
itself.

**2. No importing `src/lib`.** Every business rule is **re-implemented from its
documented definition** in `CLAUDE.md` / `DECISIONS.md` — deliberately not
imported from `pipelineValue.js`, `attention.js`, `dayReview.js` or
`targetMetrics.js`. Importing them would bake any bug in those modules into the
expectation, and Phase 7 would then *confirm* the bug rather than catch it.

**The consequence has to be stated plainly, because it shapes how Phase 7 must
work: a mismatch is not automatically an app bug.** It may equally be a
misreading of the documented rule *here*. Phase 7 adjudicates each one against
the documentation rather than assuming either side is correct. This already
happened once during Phase 6 itself — see the self-check finding below.

### Set-valued, not just counts

Every bucket emits **the actual lead refs**, sorted, alongside its count. A count
mismatch tells you something is wrong; a set difference tells you *which lead*,
which is the difference between a finding someone can act on and a number
someone has to go re-derive by hand.

### What the ledger covers

Company totals and value; leads by stage / source / area / product / site stage;
activities by type; all five Needs Attention buckets with refs; per-employee
blocks for all six execs (owned, open, pipeline, won, win rate, activity mix,
follow-ups, per-bucket attention); per-coordinator-team aggregates; the loss
readings; a full closure forecast; and the Day Review for the reference date
broken down per exec across all ten of its columns.

### Rulings encoded, exactly as decided

- **Q-P1-2 — coordinator teams computed from FINAL `coordinator_id` only.** One
  answer, not two. Imran's entire history counts for SC-North including the four
  months he worked under SC-South. Phase 7 must **not** report that as a
  mismatch; the genuine defect to watch for is the opposite.
- **Q-P1-3 — both loss readings emitted, never collapsed.** `a_loss_events` (29)
  and `b_currently_lost` (26). The 3-row gap is the reopened leads keeping their
  loss reason, which is append-only by design. The ledger carries the expected
  visible symptom too: "Why we lose" totals higher than the `lost` count on
  Pipeline by stage. **Both figures are correct under their own reading — Phase 7
  marks this "awaiting a product decision", not ❌ Mismatch.**
- **Staleness — 7 reads as stale, 14 enters the queue.** No 10-day rule exists
  anywhere and none was introduced.

### One deliberate divergence from the app — and it predicts a Phase 7 mismatch

The ledger's `dealValue()` returns **null** for a lead with no value, because
`CLAUDE.md`'s canonical rule is explicit: *"never a fabricated `0` — a lead with
neither value renders `—`, not `₹0`"*. The app's own `dealValueFor()` coerces to
`0` instead — that is finding **F-P4-2** from Phase 4, and it is deliberately
**not** mirrored here.

**So Phase 7 will find a mismatch on this, and it is expected.** The ledger says
**78 of 103** open leads have no derivable value and must render "—"; the CRM
renders ₹0 for every one of them. Recording the prediction now so Phase 7
*confirms* a known finding rather than appearing to discover a new one. The
aggregate is unaffected — both sides sum a missing value as zero, so
`open_pipeline_value` should match exactly.

### The self-check caught a flaw in the Auditor, not the data

A consistency pass over the finished ledger flagged that 2 of the 7
negative-control leads appeared in the `followups_overdue` bucket — which looked
like the threshold discrimination failing.

**It was my expectation that was wrong.** The negative control exists to prove
one thing: that a lead 9–12 days silent does not enter the **silence-driven**
queue. The other four buckets key off entirely unrelated conditions — an overdue
`next_followup_date`, a slipped close date, a silent quote, a pending RFQ. A lead
can perfectly well be 10 days silent *and* carry an overdue reminder; two of them
genuinely do. Written as "must not appear in ANY queue", this would have produced
a **false finding** in Phase 7 against correct behaviour.

The ledger now scopes it precisely — `must_be_absent_from:
["needs_attention.stale"]`, with `may_legitimately_appear_in` listing the other
four and the per-lead silent-day count (11–13 days across all seven, squarely
inside the discriminating band). Re-checked: **zero control leads reach the stale
bucket**, so the split between the two constants is genuinely working.

Recording this because it is the second time in this audit that the checking
tool needed checking — Phase 1 hit the same shape with its
`startsWith('ex1')` bug, and Phase 4's overlap detector needed positioning
awareness before its output meant anything.

### Auditor self-check — all clean

Open + won + lost reconcile to the total; per-employee and per-team leads each
sum to the company total; per-employee activities sum to the company total;
stage and source breakdowns both sum to the total; every needs-attention lead is
genuinely open; loss events ≥ currently-lost; and currently-lost matches the
`lost` stage count exactly.

### Cross-team divergence, made explicit

Exception 3b's two reassigned leads are recorded with the divergence spelled
out: the leads now count for the **final** owner, while **6 and 7 activities
respectively** remain credited to the original exec who logged them. **Phase 7
must check each metric on its own terms** — lead-based figures and
activity-based figures are *supposed* to disagree here, and expecting one answer
would manufacture two findings out of correct behaviour.

### Could not verify / skipped

| Item | Why |
|---|---|
| That the ledger matches the database | That is Phase 7, by design. Checking it here would collapse the firewall. |
| Targets-vs-actuals attainment percentages | The plan carries 120 target rows and the ledger carries the actuals; the attainment *ratio* is computed by the app across period boundaries whose exact bucketing (ISO week, calendar quarter) is worth reconciling live rather than re-deriving blind. Phase 7 checks these directly on the heatmap. |
| Funnel reach counts | `stage_history` seeding plus the documented "seed every lead's reached-set with `calling` and its own `current_stage`" workaround make this a live-comparison job rather than a static one. |

### Files created / modified

| File | Change |
|---|---|
| `phase9/audit.mjs` | **created** |
| `expected_ledger.json` | **created** |
| `PHASE9_LOG.md` | this section |

**No application source modified. No database access at all.** No commits.

### What Phase 7 needs to know

1. **Diff the sets, not just the counts.** Every bucket carries its lead refs.
2. **A mismatch may be the Auditor's misreading.** Adjudicate against the
   documentation before calling anything an app bug.
3. **Three results are pre-classified and must not be reported as new defects:**
   the ₹0-vs-"—" divergence (F-P4-2, expected, 78 leads), the loss-reason gap
   (awaiting a product decision), and Imran's history counting for SC-North.
4. **The coordinator's Day Review "Changes" column will read empty** — that is
   F-P5-2 from Phase 5, already known, not a ledger disagreement.

---

**Phase 6 ends here. Awaiting approval before starting Phase 7 (Reconciler).**

---

## Phase 7 — The Reconciler

**Status: COMPLETE. Date: 2026-08-13. Branch: `phase9-audit`. Read-only —
no writes, no source changes.**

**The CRM reconciles against the expected ledger.** Every aggregate matches
exactly, four of the five Needs Attention buckets match **by lead set**, and the
one remaining difference is a real, reproducible defect that this reconciliation
exists to find.

### Deliverable

`phase9/reconcile.mjs` — compares three ways so a difference can be *attributed*
rather than merely observed: **LEDGER** (Phase 6's independent calculation),
**APP** (`attention.js`'s logic run against the live rows), and **UI** (what the
Dashboard actually renders). Comparison is by set, so every difference names the
specific lead.

### Aggregates — exact agreement

| Figure | Result |
|---|---|
| Open lead count | 103 = 103 ✅ |
| Won / lost counts | 21 = 21, 26 = 26 ✅ |
| Activity count | 1,218 = 1,218 ✅ |
| **Open pipeline value** | **₹30,244,000 = ₹30,244,000 ✅** |

The pipeline figure matching to the rupee is the strongest single result here:
it is computed by two completely independent implementations over 103 leads,
one from the plan and one from the database.

### 🔴 F-P7-1 — a follow-up due TODAY is reported as OVERDUE, for ~18½ hours of every day

The one genuine mismatch. `lead_0003` carries `next_followup_date = 2026-08-13`
— today. The ledger excludes it, because the documented rule is *"overdue
follow-ups (`next_followup_date` **in the past**)"* and today is not the past.
The app counts it.

**Root cause, `src/lib/attention.js:111`:**

```js
if (lead.next_followup_date && new Date(lead.next_followup_date).getTime() < today)
```

`new Date('2026-08-13')` parses a **date-only** string as **UTC midnight** —
which is **05:30 IST**. `today` is `Date.now()`, a real instant. So from 05:30
IST until midnight, a follow-up due *today* satisfies "is in the past". Measured
live at 09:20 IST: the expression returns `true`.

**Impact.** Every lead whose follow-up falls due today appears in the
"Follow-ups overdue" queue for essentially the whole working day. A rep opening
Today sees work that is due *now* presented as already late — which is precisely
the signal that queue exists to make trustworthy. It is wrong on every day of
the year, not just this one; it happened to be exposed here because the plan
deliberately seeds a follow-up at `REFERENCE_DATE + 1`.

**It is latent in a second bucket.** `attention.js:115` applies the identical
expression to `estimated_close_date` for the "Close date slipped" bucket. There
is no lead with an estimated close of today in the seeded data (confirmed: zero
rows), so it does not fire right now — but the defect is the same and will
surface the first time a close date lands on today.

This is a **distinct instance** of the timestamp family `CLAUDE.md` already flags
as unfixed, not a duplicate of it: the documented one concerns naive
**TIMESTAMP** columns being compared after a UTC/local misparse. This one is a
**DATE**-only column compared against an instant. Same root cause, different
column type, and it needs its own fix.

### Drift, correctly separated from defects — and the method that made it possible

The first reconciliation run reported **two** mismatches, including a
negative-control lead (`lead_0111`) appearing in the stale queue — which by
Phase 1's design is the signature of a collapsed threshold or a resurrected
10-day rule. **It was neither.**

The audit had simply crossed midnight: the ledger targets `REFERENCE_DATE`
2026-08-12 and the clock had rolled to 2026-08-13. `lead_0111`'s last touch is
30 July — 13 days on the 12th, 14 days on the 13th. It aged into the queue
overnight, exactly as it should.

Rather than argue about it, the Auditor was given a `PHASE9_REF` override and
the ledger re-derived at today's date (written to a separate file so Phase 6's
deliverable stays intact). Re-reconciled: **stale matches 49/49 by set**, and
only `lead_0003` remains. That single change moved one result from "alarming
regression" to "working as designed" and left the genuine defect standing alone.

**This is why the plan's `time_sensitivity` section and `demo_date_shift.sql`
exist**, and it is the concrete demonstration that they were needed.

### A bug in the Reconciler itself, caught before it produced findings

The first run's attribution output listed `prod_sliding_d`, `tgt_2165`,
`sh_0667` and `loss_1569` as members of a *lead* bucket. They are products,
targets, stage-history and loss-reason refs.

Cause: the reverse `id → ref` map was built across the whole manifest, but every
table has its own SERIAL sequence — lead #5, target #5 and product #5 all exist,
so the map resolved a lead id to whichever table was written last. Scoped to
`rows_created.leads` and the diffs became meaningful.

**Fourth time in this audit the checking tool needed checking** (after Phase 1's
`startsWith('ex1')`, Phase 4's positioning-blind overlap detector, and Phase 6's
over-broad negative control). Worth stating as a pattern rather than four
isolated embarrassments: **every verification tool in this audit produced
plausible-looking wrong answers on its first run.** The findings survived because
each one was checked against a second source before being believed.

### Pre-classified results — confirmed, not rediscovered

All three behaved exactly as Phase 6 predicted:

- **F-P4-2 (₹0 vs "—")** — **78 of 103** open leads have no derivable value.
  Ledger and app agree on the *count*; they disagree on the *display*. Confirmed
  as the known Phase 4 finding. The aggregate is unaffected, which is why
  open pipeline still matches to the rupee.
- **Q-P1-3 (loss reasons)** — loss **events 29**, **currently-lost 26**, both
  matching the ledger. Reported as **⏸ awaiting a product decision**, *not* a
  mismatch. The visible symptom (the card totalling 3 higher than the `lost`
  count on Pipeline by stage) is expected under reading (A).
- **Imran's history under SC-North** — the team partition holds exactly, and no
  row of his appears under SC-South. That is the intended behaviour per Q-P1-2,
  and the genuine defect to watch for would have been the opposite.

### The negative control did its job

Seven leads seeded at 11–13 days of silence. At the ledger's own reference date,
**none reach the stale queue** — confirming the `STALE_DAYS` / `ATTENTION_DAYS`
split is genuinely two thresholds and that no 10-day rule survives anywhere. The
one that crossed into the queue did so only by ageing a real day.

### Could not verify / skipped

| Item | Why |
|---|---|
| Targets-vs-actuals attainment percentages | Deferred from Phase 6 for the same reason: period bucketing (ISO week, calendar quarter) is worth checking on the heatmap directly. Not reached this pass. |
| Funnel reach counts | Same — depends on the documented `stage_history` seeding workaround. |
| Per-employee and Day Review figures against the UI | The ledger carries them; this pass reconciled company-level aggregates and all five attention buckets. The per-exec comparison is the obvious next increment. |

### Files created / modified

| File | Change |
|---|---|
| `phase9/reconcile.mjs` | **created** |
| `phase9/audit.mjs` | **modified** — `PHASE9_REF` override, writing to a separate file |
| `expected_ledger_at_2026-08-13.json` | **created** — drift-adjusted, for comparison only |
| `PHASE9_LOG.md` | this section |

**No application source modified. No database writes.** No commits.

### Running total of open findings for Phase 8

| ID | Severity | What |
|---|---|---|
| F-P5-1 | **security — data leak** | `lead_owner_history` readable unscoped by every employee |
| **F-P7-1** | **functional — wrong data daily** | a follow-up due today is reported overdue from 05:30 IST; latent in "Close date slipped" too |
| F-P5-2 | functional | coordinator Day Review "Changes" always empty |
| F-P4-2 | user-visible, wrong data | All Leads shows ₹0 where the rule requires "—" (78 leads) |
| F-P2-2 | functional | coordinator has DB stage rights, no UI path |
| F-P4-1 | user-visible | longest stage chip prints over the SOURCE column |
| F-P5-3 | low now / medium latent | append-only tables defended by one layer |
| F-P2-1 | latent trap | `.select()` on the `loss_reasons` insert breaks marking lost for non-owners |
| F-P3-1, F-P3-2 | cosmetic | two grids with more tracks than children |
| F-P4-3/4/5 | cosmetic | clipped labels, overlapping text on two mobile screens |
| F-P5-4, F-P5-5 | informational / hygiene | one non-applicable production CVE; two missing service_role grants |
| Q-P1-3 | ⏸ product decision | loss-event vs currently-lost counting |
| — | redundancy | `plans`, `SiteSearchOrCreate.jsx`, ~27 orphaned CSS classes |

**Nothing has been fixed. All of it is Phase 8, per protocol.**

---

**Phase 7 ends here. Awaiting approval before starting Phase 8 (fixes).**

---

## Phase 8 — Fixes

**Status: COMPLETE. Date: 2026-08-13. Branch: `phase9-audit`.**

Scope confirmed by the owner: fix all code-level defects; defer F-P2-2 to the SC
team-screen build; write both RLS migrations for them to run. Q-P1-3 untouched
(their decision), redundancy report-only (per DECISIONS.md).

### Fixed

**F-P7-1 — a follow-up due today reported as overdue.** Fixed in **three**
places, not one. The audit found it in `attention.js`; grepping for the pattern
turned up the identical expression in `EmployeeProfile.jsx:394` (the same
follow-up question) and `LeadDetail.jsx:320` (the Deal progress stepper's
"slipped" label). All three compared a **DATE** column against an instant, and
all three now compare `col < todayISO()` — both sides `YYYY-MM-DD`, so string
order is date order with no timezone to get wrong.

The latent second bucket is fixed too: `attention.js`'s "Close date slipped"
used the same expression on `estimated_close_date` and would have misfired the
first time a close date landed on today.

**F-P4-2 — ₹0 where the rule requires "—".** Added `dealValueOrNull()` beside
`dealValueFor()` in `pipelineValue.js`, and pointed the two per-lead display
sites in `LeadsListCard` at a small `formatLeadValue` helper. **The group and
header totals still use `dealValueFor`** — changing that function to return null
was the obvious-looking fix and the wrong one, because `sumOpenPipelineValue`
and the four category cards add its result and null would silently poison every
total. Both functions now carry comments saying which is which.

**F-P3-1 — Today's "Done today" strip.** Added the `vip-dd-kpi-grid-4` modifier
that already existed and was already used by `DayReviewHeader`'s own four-tile
strip.

**F-P3-2 — heatmap rows ending in an empty column.** Rather than swapping the
hardcoded `repeat(7)` for a hardcoded `repeat(6)` — which would drift again the
next time the metric list changes — `DashboardHeatmap` now publishes
`--vip-heatmap-cols` from `COLS.length` and the stylesheet reads it. The
component and the grid can no longer disagree.

**F-P4-1 — longest stage chip printing over the SOURCE column.** The stage cell
holds a pill, not text, so it never inherited the truncation the other columns
have. Grid children default to `min-width: auto`, so the cell had to be allowed
to shrink before the chip could be clipped; both rules added.

**F-P4-3 — My Team's clipped stat labels.** "Open pipeline" needs 74px in a 58px
box. Now wraps instead of being cut mid-word — the honest answer, since the
label genuinely does not fit on one line.

**F-P2-1 — the `loss_reasons` trap.** Nothing to fix; a comment now sits on the
insert explaining why `.select()` must never be added there and what breaks if
it is.

### Migrations written — for the owner to run

`Schema/migration_phase9_rls_fixes.sql`. Safe to re-run, with verification
queries. **Not yet run.**

- **STEP 1 (F-P5-1)** scopes `lead_owner_history` SELECT to own-leads-or-owner
  plus a coordinator team branch, mirroring the shape `stage_history` already
  has so the two read the same way to anyone auditing later.
- **STEP 2 (F-P5-2)** adds the coordinator team branch to `lead_change_log`, so
  the Day Review's Changes column works for an SC. The file records *why* the
  original decision was right when made and why it is not now.
- **STEP 3 (F-P5-5)** grants `service_role` SELECT on both tables — hygiene, and
  it fails closed either way.

No INSERT/UPDATE/DELETE policy is added anywhere; both tables stay append-only
with the trigger as `lead_change_log`'s only writer.

### Two "findings" that were not defects — and the changes I reverted

**F-P4-4 and F-P4-5's overlaps were measurement artifacts.** After fixing
everything else the detector still reported five overlaps, so I inspected the
DOM rather than fixing again. "Karan Bhatia" was reporting a **200px-wide box
for a 12-character name** — `getBoundingClientRect()` on a *wrapped inline*
element returns the union of its line boxes, so a two-line name appears to
overlap every sibling on its first line. The EmployeeProfile one was a child of
an `overflow: hidden` parent that visually clips it; the child's own rect
ignores the clip.

**I had already written CSS for both on a wrong diagnosis, and reverted it** —
`overflow-wrap: anywhere` on `.vip-row-meta` and truncation rules on
`.vip-dd-age-row`. Neither fixed anything (the counts did not move), and both
would have been unexplained changes sitting in the diff forever. The detector
now skips wrapped inlines and intersects each box with its clipping ancestor
before comparing.

**Fifth time in this audit the checking tool needed checking.** The pattern is
now consistent enough to state as a conclusion rather than an anecdote: every
verification tool built here produced plausible-looking wrong answers on its
first run, and the only thing that caught them was checking against a second
source before believing the first.

### Verification — all green

| Suite | Before | After |
|---|---|---|
| 04 responsive (3 roles × 21 screens × 2 breakpoints) | 201/210 | **210/210** |
| — grid gaps / overlaps / cascade / overflow | 11 / 18 / 0 / 0 | **0 / 0 / 0 / 0** |
| 02 screens | 97/101 | **101/101** |
| 01 login + landing | 38/38 | 38/38 |
| 03 Phase 8 items | 19/19 | 19/19 |
| Guard-rail probes | 23/23 | 23/23 |
| Unit tests | 96 | 96 |
| Seed still plan-exact | ✅ | **✅** |

`npm run lint` clean (only the pre-existing fast-refresh warnings). The seed is
still byte-for-byte what Phase 2 left, so Phase 6's ledger and Phase 7's
reconciliation remain valid.

One test was date-fragile and was fixed, not worked around: the Day Review
sorting check assumed the current day has differentiating data. Once the clock
passed the seeded window every exec tied at zero, a stable sort preserved order,
and it failed for a reason unrelated to sorting. It now pins to the plan's
reference date.

### Not fixed, by decision

| Item | Why |
|---|---|
| **F-P2-2** — coordinator stage rights unreachable in the UI | Owner's call: defer to the SC team-screen build. `LeadQuickActions` does not mount for a coordinator at all, so this needs the `canEdit` product change, not an audit patch. |
| **Q-P1-3** — loss events vs currently-lost | The owner's decision, still open. Must not be "fixed" in either direction. |
| **F-P5-4** — react-router advisory | Covers RSC mode; this is a Vite client SPA with no server components. Bump on the next dependency pass. |
| **Redundancy** — `plans`, `SiteSearchOrCreate.jsx`, ~27 orphaned CSS classes | Report-only per DECISIONS.md. Note the 12 false positives in that list: `vip-chip-*` and `vip-dd-day-tag-*` are built with template literals. |
| One clipped label — "this month, 6 metrics" on mobile Sales Exec Profile | Genuinely clipped, cosmetic, and I chose not to attempt a third speculative CSS fix on a 9px label after the two reverts above. Left on the record. |

### Files modified

| File | Change |
|---|---|
| `src/lib/attention.js` | calendar comparison for both date buckets |
| `src/pages/EmployeeProfile.jsx`, `src/pages/LeadDetail.jsx` | same fix, two more sites |
| `src/lib/pipelineValue.js` | `dealValueOrNull()` added |
| `src/components/LeadsListCard.jsx` | per-lead display shows "—" |
| `src/components/DashboardHeatmap.jsx` | publishes `--vip-heatmap-cols` |
| `src/components/LeadStageSection.jsx` | F-P2-1 guard comment |
| `src/pages/Home.jsx` | `vip-dd-kpi-grid-4` |
| `src/vipsar-theme.css` | heatmap track count, chip truncation, team label wrap |
| `Schema/migration_phase9_rls_fixes.sql` | **created** — not yet run |
| `CLAUDE.md` | two new Conventions bullets (DATE comparison; sum-vs-display value) |
| `phase9/e2e/visual-audit.mjs` | clip-aware and wrapped-inline-aware |
| `phase9/e2e/03-phase8-items.mjs` | sorting test pinned to a date with data |

### 🛑 Outstanding

**`Schema/migration_phase9_rls_fixes.sql` needs running in the SQL Editor.**
Until it does, F-P5-1 (the `lead_owner_history` read leak) and F-P5-2 (the
coordinator's empty Changes column) are unfixed. Afterwards, re-run
`node phase9/security-audit.mjs` — the SQL Editor cannot verify either one,
because it runs as `postgres` with BYPASSRLS and no `auth.uid()`.

---

**Phase 8 ends here.**

---

## Phase 8 — ADDENDUM: migration run and verified

**Date: 2026-08-13. `Schema/migration_phase9_rls_fixes.sql` run by the owner in
the Supabase SQL Editor. Nothing from Phase 8 is outstanding.**

The owner pasted verification query 3 (the `service_role` grants), which
confirms STEP 3. The other two steps were verified the only way they can be —
from real authenticated sessions, since the SQL Editor runs as `postgres` with
BYPASSRLS and no `auth.uid()`, so every policy there evaluates false regardless.

### F-P5-1 — `lead_owner_history` is scoped now

`lead_owner_history` row visibility, before → after:

| | owner | SC-North | SC-South | ex_rohit | ex_karan |
|---|---|---|---|---|---|
| before | 2 | 2 | 2 | 2 | 2 |
| after | 2 | 2 | **0** | 2 | **0** |

Both reassigned leads now belong to an SC-North exec, so **SC-South sees none** —
the cross-team leak is closed. And **their former owner sees none either**, which
is the more interesting half: Karan can no longer read the history of leads that
were taken off him, because he does not own them any more.

### F-P5-2 — the coordinator Day Review works

`lead_change_log` visibility went from **0 of 225** for both coordinators to
**140 (SC-North) + 85 (SC-South) = 225 exactly** — a clean partition with no
overlap and no gap. Exec scoping is unchanged, as intended. The Day Review's
"Changes" column will now populate for a coordinator instead of being
structurally empty on every date.

### Pinned so they cannot regress

Three assertions added to `phase9/security-audit.mjs`, including the exact
partition check. **Security audit: 28/28 passed** (was 25/25).

### Full regression, after the migration

| Suite | Result |
|---|---|
| Guard-rail probes | 23/23 |
| 01 login + landing | 38/38 |
| 02 screens | 101/101 |
| 03 Phase 8 items | 19/19 |
| 04 responsive | 210/210 |
| Security audit | **28/28** |
| Seed still plan-exact | ✅ |

Every Phase 9 finding that was in scope to fix is now fixed and verified. The
remaining open items are the ones deliberately left: **F-P2-2** (deferred to the
SC team-screen build), **Q-P1-3** (the owner's product decision), the
react-router advisory (RSC-only, not applicable to this SPA), the redundancy
report (report-only by decision), and one clipped 9px label on mobile Sales Exec
Profile.

---

**Phase 8 is complete.**

---

## Phase 8 — ADDENDUM 2: owner's decisions applied

**Date: 2026-08-13.** Four items closed at the owner's direction.

### 1. Q-P1-3 SETTLED — "Why we lose" counts currently-lost leads

**Reading (B) chosen.** A recovered deal is no longer reported as a loss.

The filter lives in `Dashboard.jsx` where the fetch resolves, **not inside the
card** — the same array feeds `LossReasonsCard` and `buildLossPanel`, so
filtering once at the source is what stops the compact card and its drill-down
ever disagreeing. `fetchLossReasons` now embeds `leads(current_stage)`, because
`loss_reasons` alone cannot tell you whether the lead is still lost.

**Verified in the rendered UI**, not just in the query: 29 loss-reason rows
exist, 26 leads are currently lost, and the card sums to **26** — the three
reopened leads correctly excluded. The long-standing symptom (this card
totalling higher than the `lost` count on Pipeline by stage) is gone, and
**the two are now expected to agree** — a future divergence means the filter
was dropped.

Nothing was deleted. `loss_reasons` stays append-only; reading (A) is
recoverable by removing one filter.

### 2 + 3. F-P2-2 and F-P5-3 recorded as TODOs

`CLAUDE.md` gained an **Open TODOs** section before the Roadmap, carrying four
items with enough detail that none needs re-investigating: the coordinator
stage-rights gap (including the warning that fixing `canEdit` alone is not
enough — the `isOwner &&` gates behind it would still hide the control), the
append-only grant layer, the untested create-flow submit handlers, and the
deferred device/PWA/push verification gaps.

### 4. react-router bumped — zero production vulnerabilities remain

`react-router-dom` 7.18.1 → **7.18.2**. Both `react-router` entries are gone
from `npm audit`; total 6 → 4, and **all four remaining are dev-only toolchain**
(`brace-expansion`, `fast-uri`, `nanoid`, `postcss`) that ship in no artifact a
user receives.

Verified after the bump, since a router upgrade is exactly the kind of change
that breaks routing silently: 96 unit tests pass, the production build succeeds
(20 precache entries, service worker generated), **login + landing 38/38** and
**all screens 101/101**.

### 5. The ledger sections Phase 7 had not reached — now reconciled

`phase9/reconcile-detail.mjs`, **19/19 passed**:

- **Per-employee, all six execs** — leads owned, open leads, open pipeline
  value, won, lost, leads created, activities, follow-ups assigned/done (54
  figures), plus the full activity mix by type for each.
- **Day Review for 2026-08-12, all six execs** — activities, calls, visits,
  leads touched, leads created, quotes sent, follow-ups due/done, and tomorrow.
- **Sales funnel reach across all 11 stages** — reimplementing the documented
  workaround (seed every lead's reached-set with `calling` and its own
  `current_stage`, then widen with `stage_history`) rather than importing it.

Per-employee totals are not date-dependent, so the canonical ledger is the
correct comparison. The Day Review is compared for **the ledger's own reference
date**, which is what keeps it valid now the clock has moved past it.

**Attainment percentages remain the one unreconciled section** — they depend on
ISO-week and calendar-quarter target bucketing, and are visible directly on the
heatmap. Recorded rather than quietly dropped.

### State after this addendum

| Suite | Result |
|---|---|
| Guard-rail probes · login · screens · Phase-8 items | 23/23 · 38/38 · 101/101 · 19/19 |
| 04 responsive | 210/210 |
| Security audit | 28/28 |
| Reconciler (buckets + aggregates) | matches |
| **Reconciler detail (per-exec, Day Review, funnel)** | **19/19** |
| Unit tests · production build | 96 pass · succeeds |
| Seed still plan-exact | ✅ |

---

**Phase 9 is complete. Remaining items are the ones deliberately deferred, all
recorded in CLAUDE.md's Open TODOs.**
