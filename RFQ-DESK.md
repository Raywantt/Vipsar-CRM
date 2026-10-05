# RFQ-DESK.md — back-office RFQ roles (Phase 12, PLANNING)

> **📝 PLANNING ONLY — nothing is built.** Written 2026-10-05 after four
> rounds of questions with the owner. The owner said explicitly: *discuss and
> plan first, then implement.* Don't start Step 1 until the owner says go.

Adds the two people who sit **after** a sales exec's RFQ: **Harjot**
(technical check) and **Harpreet** (estimation + Lixil quote). Today their work
lives in two Excel workbooks and the RFQ itself travels by email. Modelled on
`BDM.md`: decisions are locked in §3, the build is split into steps with a hard
stop after each (§8), and every step that touches UI is checked across every
role at both widths (§9).

Standing rules (same as `BDM.md` §0): never commit unless asked in that turn;
schema changes are handed to the owner as SQL; a migration whose columns new
code SELECTs runs **before** the deploy; verify RLS as a real logged-in
session of the role, never from the SQL Editor; verify as the role with the
**fewest** rows; clean up your own test rows from an owner session.

**Pronouns:** none were given for Harjot or Harpreet — write names or "they".

---

## 1. Progress

| Step | What | State |
|---|---|---|
| 0 | Planning, decisions, this file | ✅ 2026-10-05 |
| 1 | Database: `rfqs` + `rfq_events`, triggers, RLS, notifications | — (role values done early, see below) |
| 2 | Role plumbing: `roles.js`, routes, nav, Today switch, two test ports | — (placeholder gating done early, see below) |
| 3 | Exec side: RFQ Raised form, RFQ status on Lead Detail, sent-back / quote-ready | — |
| 4 | Production Executive: review queue (approve / send back) | — |
| 5 | Estimation Executive: estimation queue, Lixil step, quote, send back, price revision | — |
| 6 | Reporting changes: RFQ target on approval, Needs Attention rework | — |
| 7 | Owner's **RFQ Desk** screen | — |
| 8 | Launch day + docs (`CLAUDE.md`) | — |

**Done ahead of the steps (2026-10-05, at the owner's request so the people
can be added now):** `Schema/migration_rfq_desk_roles.sql` (role CHECK only);
both roles in `roles.js` `ROLE_OPTIONS`; `canSeeSalesDashboard` / `canSearch`
/ `canOpenLeads` gate `/dashboard`, `/search`, `/leads/:id` and their nav
links to the five sales roles; `Today.jsx` gives both desk roles a "being set
up" screen. Step 2 opens Search and Lead Detail to them by flipping
`canSearch` / `canOpenLeads`, not the routes.

**Steps 3–6 go live together on a chosen launch day**, not one at a time.
Shipping the exec side alone would stack RFQs up with nobody able to approve
them, and every exec's RFQ target would freeze (it counts on approval — §3).

---

## 2. What they do today (from the two workbooks)

Source files: `HARJOT CRM 2026 .xlsx`, `HARPREET CRM 2026 .xlsx` (owner's
Downloads, 2026-10-05).

**The loop as the owner described it:** the exec emails the RFQ to Harjot,
who checks it against Lixil's technical limits. If it's wrong, it goes back to
the exec for a revision. If it's right, it goes to Harpreet, who checks it
again and raises it with Lixil. Lixil's quote comes back with a price, and
Harpreet forwards it to the exec.

**What the data says (Apr–Sep 2026):**
- **Volume:** ~490 RFQs, 60–105 a month. About 60% are fresh; the rest are
  revisions (R1 up to R6). About a third of RFQ numbers were revised at
  least once.
- **Turnaround** (exec raises RFQ → quote date): median **3 days**, p75 5, p90
  7, max 40. 14 rows have the quote dated before the RFQ (typing slips).
- **Send-backs are recorded nowhere.** Every one of Harjot's ~500 rows reads
  "CHECKED & RAISED", so how often an RFQ bounces, why and whose is unknown
  today. The CRM will capture this for the first time.
- **Harpreet's sheet is mostly Harjot's sheet retyped**, plus quote date,
  Lixil quote ref (`R26-…`, `H26-…`), value **without GST**, a case category
  A–D, Won/Lost/Ongoing and a remark ("budget issue"…). The last three are
  facts the CRM already knows from the lead.
- **The RFQ number** (`L318`, `J12`) is a per-office project id that stays the
  same across revisions. **Dropped** at the owner's ruling (§3).
- **Product segment** column values: Windows, Giesta, IN16, Skylight, Facade,
  Wrapping bars (plus combinations such as "Windows + IN16").
- **~20 "price revised" rows** are re-quotes that happen when Lixil changes its
  prices. They start in the back office, not with a sales exec.
- **Out of scope for v1, but in the same workbooks: their post-booking job.**
  - Harjot keeps a *Production Docket*: approval date, who measured, file
    complete, colour, TTC/QuickShip, window count, "Jot to KK", go-ahead,
    production papers, MS, glass sheet, CO number and reason for delay.
  - Harpreet tracks *Lixil order status*: in production → expected at
    Chennai/Garhi → dispatched → at warehouse, plus when dispatch can happen.
  - There are also sheets for spare-part reorders, big projects (Vipin sir)
    and IN16 partition pricing.
  - All of this is **phase 2** (§10).

---

## 3. Decisions (locked — don't reverse without asking the owner)

### Roles
- **Two roles**, not one shared "operations" role. Each acts only on their own
  step, so every step is credited to the right person.
  - **Production Executive** (Harjot) — `production_executive`. The owner's
    choice (2026-10-05) over the suggested "Production Executive".
  - **Estimation Executive** (Harpreet) — `estimation_executive`.
  - **Both role values are LIVE in the code** (2026-10-05, ahead of Step 1)
    so the owner can add the people from Profile. Until the desk is built
    they sign in to a "being set up" Today and Profile only (`CLAUDE.md` →
    Roles → Production Executive / Estimation Executive).
- **The owner can act on either queue** to cover leave. There's no other
  backup.
- Neither role owns leads, logs activities or carries sales targets. They are
  **not** in `CARRIES_OWN_LEADS`. If they were, they'd appear in Reassign
  dropdowns, the heatmap, Day Review and exec ranking — the same reasoning as
  the BDM.

### Scope
- **v1 is the RFQ → quote loop only.** Post-booking production, reorders,
  big projects and IN16 pricing stay in Excel (§10).
- **Files stay on email.** The CRM tracks status, dates, quote ref and value.
  It stores no design sheets or quote PDFs, so no Supabase Storage is needed.
- **Start fresh, no import.** Only RFQs logged after launch day enter the
  desk. RFQs already in flight are finished in Excel.

### The loop
```
Exec logs "RFQ Raised" (+ windows, segment)
   └─► WITH TECHNICAL (Harjot)
         ├─ Send back (optional note) ──► exec revises ──► next revision re-enters here
         └─ Approve ──► WITH ESTIMATION (Harpreet)
                          ├─ Send back (optional note) ──► exec revises ──► re-enters at Harjot
                          │     └─ + Harjot is told an RFQ they approved was bounced
                          └─ Raised with Lixil ──► WITH LIXIL
                                                    └─ Quote received (ref, value w/o GST, date)
                                                         ──► QUOTED → exec told
```
- **Harpreet can send back**, to the **exec** (it comes back in through Harjot
  as the next revision). When that happens, **Harjot is notified** that an RFQ
  Harjot approved was bounced at estimation. That makes misses at the
  technical check visible.
- **A send-back carries an OPTIONAL free-text note** — nothing else in v1
  (owner, 2026-10-05: "skip the reasons for now"). The exec may need to check
  email for the details. The fixed reason list is parked in §10 *For later*.
- **No RFQ number.** An RFQ is identified by its lead plus its revision
  (Fresh, R1, R2…), which the CRM's existing Fresh/Revised classification
  (`rfqKind.js`) already produces.
- **"Raised with Lixil" is its own step**, with one tap before "Quote
  received". This separates Lixil's own time from the desk's time.
- **Price revisions** (Lixil changed its prices) are **started by Harpreet** on
  any lead that already has a quote. They skip the technical check. The new
  value replaces the lead's quote value and the exec gets the quote-ready
  push. They don't count toward anyone's RFQ target.

### What it changes for sales
- **The RFQ Raised form asks for two new things:** number of windows
  (required) and product segment (pick one or more). The list comes from §2,
  to be confirmed.
- **An RFQ counts toward the exec's RFQ Raised target only once Harjot
  APPROVES it**, dated by the approval. A bounced RFQ counts once its corrected
  revision passes. The fresh-only rule still applies.
- **The lead moves to the "RFQ Raised" stage on approval, not on logging.**
  Today `ActivityLog` advances it the moment the exec logs a fresh RFQ.
- **Harpreet's quote value (without GST) becomes the lead's `quote_value`
  automatically**, and the exec no longer types it. Each new quote (revision
  or price revision) replaces the value.
- "Quote received from Lixil and forwarded to the exec" is **not** "quote
  submitted to the client". `quote_sent` / `quote_sent_at` and the Quote
  submission stage stay the exec's to record.

### Visibility
- Both roles read **only leads that have ever had an RFQ**: the client, site,
  contacts, stage history, RFQ history and which exec owns it. They can't edit
  the lead and can't see other leads or the sales dashboards.

### Notifications (push + an in-app line, since iPhone push needs the installed app)
| Event | Goes to |
|---|---|
| New RFQ logged | every active Production Executive |
| Approved | every active Estimation Executive |
| Sent back (either step) | lead owner **+ whoever logged it**, if different (a coordinator logging on the exec's behalf) |
| Bounced at estimation after approval | the Production Executive who approved it |
| Quote ready | lead owner **+ whoever logged it** |

### Owner's view
- A new **RFQ Desk** screen with its own sidebar link and a mobile tile, like
  Architect Network. It shows:
  - the live queue at each step, with ages
  - turnaround per step
  - send-backs by exec (by reason once the list exists — §10)
  - Harjot's misses (RFQs bounced at estimation after approval)
  - fresh vs revision volume
  - price revisions

---

## 4. Open questions (ask at the start of the step that needs them)

| # | Question | My recommendation | Step |
|---|---|---|---|
| Q3 | Product segment list | Windows, Giesta, IN16, Skylight, Facade, Wrapping bars | 1 |
| Q4 | Quote value on a lead that has **no** desk quote (in-flight Excel RFQs, older leads) | Exec can still type it until the first desk quote lands; locked from then on | 3 |
| Q5 | Needs Attention's "RFQ raised 3+ days, no quote" bucket now measures the desk's speed, not the exec's | Replace it with "sent back, not revised in N days" and "quote in, not sent to client in N days" | 6 |
| Q6 | Where a sent-back RFQ shows on the exec's Today | In "Needs your attention today", above follow-ups | 3 |
| Q7 | "Waiting too long" per step | Technical 1 working day, estimation 1 day, Lixil 5 days (data: median 3 days end to end) | 4–7 |
| Q8 | Do Harjot and Harpreet see their own figures (RFQ Desk or a slimmer view)? | A slim "my desk this month" strip on their Today, but not the full RFQ Desk | 4–5 |
| Q9 | Does "Quote ready" offer a one-tap "Mark quote sent to client"? | Yes, on Lead Detail, for the exec | 3 |
| Q10 | An exec logs a new revision while the previous one is still in the queue | The older one is closed as "superseded"; only the newest is worked | 1 |

---

## 5. Data model (draft — firmed up at Step 1)

**`rfqs`** — one row per RFQ submission (each revision is its own row).
- `lead_id`, `revision` (0 = fresh, 1 = R1…), `kind` (`fresh` / `revised` / `price_revision`)
- `activity_id` — the exec's `rfq_raised` activity; null for a price revision
- `raised_by_employee_id` (credited exec), `logged_by_employee_id` (who pressed Save)
- `window_count`, `segments text[]`
- `status`: `with_technical` → `with_estimation` → `with_lixil` → `quoted`, plus `sent_back_technical`, `sent_back_estimation`, `superseded`
- timestamps and actors for each step: `tech_decided_at/by`, `est_decided_at/by`, `lixil_raised_at/by`, `quote_received_at/by`
- `send_back_note` (optional; a `send_back_reason` column arrives with the list, §10), `quote_ref`, `quote_value` (without GST)

**`rfq_events`** — append-only history, trigger-written, like `stage_history`
and `lead_change_log`. One row per transition, holding actor, from/to status
and note. The RFQ Desk's turnaround figures read this table.

**`employees.role` CHECK** gains two values. **`notifications`** gains five
types. **`activities`** is unchanged: an RFQ Raised activity stays the record
of the exec's work, and the "Activities logged" raw tally keeps counting it.

**Triggers, not app code** (the `lead_change_log` reasoning: one rule, no
forgotten call site):
- Insert into `rfqs` when an `rfq_raised` activity is inserted, or do it from
  `ActivityLog` in the same submit. Decide at Step 1.
- On **approve**: advance the lead to `rfq` (with a `stage_history` row) and
  set `rfq_raised` / `rfq_raised_at`. This replaces `ActivityLog`'s own
  advance.
- On **quote received**: write `leads.quote_value`.
- Every transition writes its `rfq_events` row and its notification.
- Guards: only a Production Executive (or the owner) moves `with_technical`, and
  only an Estimation Executive (or the owner) moves `with_estimation` /
  `with_lixil`. RLS restricts rows, never columns, so this needs a trigger,
  the `enforce_manager_lock()` pattern.

**RLS:** additive, role-guarded, hoisted `(select …)` policies (see
`CLAUDE.md` → RLS performance), plus `hide_test_accounts` on `rfqs` and
`rfq_events`. The new roles read `leads` / `parties` / `sites` /
`site_contacts` / `stage_history` only where an `rfqs` row exists for the
lead. Use a SECURITY INVOKER id-array helper, as in
`migration_rls_per_row_fixes.sql`, never a per-row EXISTS. **This is a new
migration that must go into `CLAUDE.md`'s migration order list.**

---

## 6. Every place the "RFQ Raised" count is read today (Step 6 must move all of them)

Approval-date counting has to reach every reader of the fresh-RFQ figure, or
two screens will disagree:
- `TargetsVsActualsCard.jsx`: `countsTowardActivityMetric` and the actuals
- `DashboardHeatmap.jsx`: the RFQ column
- `drilldownBuilders.js`: `buildLogPanel`'s quota count
- `EmployeeProfile.jsx`: the "RFQs raised" tile and the rank-pill blend
- `attention.js`: `PENDING_RFQ_DAYS` / the `pending_rfq` bucket, plus the same
  predicate inside the `leads_needing_attention()` RPC (SQL owns predicates)
- `SalesProgressSection.jsx`: the read-only RFQ block (Fresh / Revised dates)
  gets the desk status beside it
- `leadExport.js`: RFQ columns. Decide whether the export gains desk status.

---

## 7. Screens by role (draft — confirm layout at each step; UI-DESIGN.md applies)

**Production Executive (Harjot)**
- **Today:** the review queue, oldest first. Each row shows lead, exec,
  Fresh/R1…, windows, segment and time waiting. Actions: **Approve** /
  **Send back** (optional note). Also a line listing RFQs bounced at
  estimation after Harjot approved them.
- Lead Detail (read-only) with an RFQ history panel. Search covers only the
  leads they can read. Profile.
- **No** New Lead, Log Activity, Dashboard, Follow-ups or Team.

**Estimation Executive (Harpreet)**
- **Today:** "Waiting for estimation" (Send back / **Raised with Lixil**),
  then "With Lixil" (age, **Quote received**: ref + value + date), then a
  **Price revision** action reached from a quoted lead.
- Lead Detail (read-only) + RFQ panel, Search, Profile.

**Exec / coordinator / manager / BDM** (anyone who can log an RFQ)
- Log Activity → RFQ Raised gains windows + segment. The hint reads
  "goes to Harjot for a technical check; counts toward your RFQ target once
  approved".
- Lead Detail shows an RFQ status line ("R1 · with Harjot · 2 days"), the
  send-back note (if any), and "Quote in: ₹X (ref)".
- The quote value field is locked once the desk has quoted (Q4).
- Sent-back and quote-ready alerts arrive as a push and as an in-app line in
  `TodayGreetingHeader` (the `BdmUpdatesLine` pattern, so every Today screen
  gets it).

**Owner**
- RFQ Desk (§3). Can act on either queue. Manage employees offers the two new
  roles.

---

## 8. Build plan — STOP after each step

1. **Database.** Ask Q3 and Q10 first. Write the migration plus a
   `verify_rfq_desk.sql` (same pattern as `verify_bdm_role.sql`). The owner
   runs it and creates two test logins.
2. **Role plumbing.** Capabilities in `roles.js` (`canReviewRfqs`,
   `canEstimateRfqs`, `canSeeRfqDesk`…). Then `App.jsx` routes, `BottomNav`
   (one flag per capability, read by both renderings), `Today.jsx` naming both
   roles explicitly, and two dev ports (`role-technical` 5186,
   `role-estimation` 5187).
3. **Exec side.** RFQ Raised form, Lead Detail status, the in-app line,
   pushes (redeploy `send-followup-reminders` — its name stays wrong) and the
   quote-value lock.
4. **Production Executive screens.**
5. **Estimation Executive screens**, including price revision.
6. **Reporting changes** (§6). The figures must agree on every surface.
7. **RFQ Desk.** Pull the real numbers from the first live weeks before
   choosing chart forms (UI-DESIGN.md).
8. **Launch day.** Set a date with the owner. Harjot and Harpreet get logins
   and switch from Excel to the CRM for new RFQs that day; in-flight ones
   finish in Excel. Then document everything in `CLAUDE.md` and mark this
   file historical.

---

## 9. Verification matrix

Seven roles × two widths (below and above 1024px), each a real logged-in
session. For every step that touches UI, record:
- what each role can see
- what each role can do
- that a non-desk role gets nothing new it shouldn't have

RLS checks: an exec must **not** see another exec's RFQs. A Production Executive
must **not** be able to quote. An Estimation Executive must **not** be able to
approve a technical check.

---

## 10. For later — don't forget

- **Send-back reason list.** The owner deferred it (2026-10-05). v1 sends
  back with an optional note only. When it comes: get Harjot's real list (and
  Harpreet's, if it differs), make it a closed list on both sides (SQL CHECK
  ↔ an `rfqSendBackReasons.js`, like `lossReasonOptions.js`) plus an optional
  note, and add "send-backs by reason" to the RFQ Desk. Send-backs made
  before it lands have no reason — show them as "No reason recorded", never
  guess one from the note.

## 11. Phase 2 (not now)

- **Post-booking production:** Harjot's Production Docket and Harpreet's Lixil
  order status (in production → Chennai/Garhi → dispatched → warehouse).
  Columns still to explain: "Jot to KK", "MS", "To Simran", CO number.
- File attachments (RFQ design sheet, Lixil quote PDF) through Supabase Storage.
- Spare-part reorders, big-project cases (Vipin sir), IN16 partition pricing.

---

## 12. Session log (append-only — newest last)

- **2026-10-05 — planning.** Read both workbooks (§2). Four rounds of
  questions. Round 1: scope, one vs two roles, files, quote value. Round 2:
  target counting, visibility, pushes, history. Round 3: estimation
  send-back, reasons, RFQ number, price revisions. Round 4: RFQ form fields,
  Lixil step, extra notification recipients, owner view. Every answer is
  recorded in §3. Nothing built, nothing committed.
- **2026-10-05 — role values shipped early.** The owner wants to add Harjot
  and Harpreet now, so the roles were named (**Production Executive** /
  **Estimation Executive**, the owner's choice), added to `roles.js` and
  `migration_rfq_desk_roles.sql`, and gated to a "being set up" Today +
  Profile. Send-backs: optional note only, reasons parked in §10. Existing
  five roles' nav re-checked at 1024px and 375px, unchanged. The desk roles'
  own screen is NOT yet seen in a real session — check it with the first test
  login (both widths; the phone bar should be Today alone, centred).
