# RFQ-DESK.md — back-office RFQ roles (Phase 12, PLANNING)

> **🔨 BEING BUILT — one step at a time.** Planned 2026-10-05 after four
> rounds of questions with the owner (*discuss and plan first, then
> implement*). Steps 1–2 are done; §1 says where it stands. Don't start the
> next step until the owner says go.

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
| 1 | Database: `rfqs` + `rfq_events`, triggers, RLS, notifications | ✅ 2026-10-06 — `migration_rfq_desk.sql` live (switch OFF); `verify_rfq_desk.sql` 42 PASS, 0 FAIL, 0 SKIP |
| 2 | Role plumbing: `roles.js`, routes, nav, Today switch, two test ports | ✅ 2026-10-06 — Search + read-only Lead Detail for the desk; both test logins checked at both widths, including on a real (throwaway) RFQ'd lead |
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

**The desk switch went ON early — 2026-10-06 09:26 IST** (owner's choice,
Step 2 session, over turning it back off). Every RFQ Raised since then sits in
Harjot's queue as `with_technical` with an `rfq_new` alert row, while Harjot
keeps working them in Excel. Nothing is pushed yet. Launch day has to clear
this backlog — §8 Step 8.

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

### Step 1 rulings (2026-10-06)
- **Segments:** Windows, Giesta, IN16, Skylight, Facade, Wrapping bars
  (`windows`/`giesta`/`in16`/`skylight`/`facade`/`wrapping_bars` — a closed
  list on both sides; Step 3's JS list must match the SQL CHECK).
- **A new revision while the last is still in the queue: both stay.** Nothing
  is closed automatically; Harjot/Harpreet decide which to work.
- **Withdraw:** the credited exec, whoever logged it (a coordinator), or the
  owner — while it is with Harjot or Harpreet, never once it is with Lixil.
- **A lead marked Won/Lost leaves its RFQs alone** — they stay in the queue
  and the desk sees the lead's stage.
- **Every RFQ Raised activity, by anyone, goes to Harjot and alerts him**
  (owner, 2026-10-06) — exec, coordinator, manager or BDM, with or without the
  window count / segments (those are optional in the database; Step 3's form
  still asks for them).
- **Nothing flows until the owner switches the desk on, on launch day**
  (owner's choice over "as soon as the SQL runs"): no backlog of RFQs also
  tracked in Excel, and no RFQ counted toward a target under both the old and
  the new rule. `rfq_desk_settings.live_from` — see §8 Step 8.
- **Every move is timed and attributed** (owner, 2026-10-06): a time + person
  per step on the RFQ itself, and one `rfq_events` line per move.
- Decided in the build, not asked (say if any is wrong): a quote needs
  Lixil's reference as well as the value; "Quote received" is only possible
  after "Raised with Lixil"; the quote date can't be in the future or before
  the RFQ was raised (Harpreet's sheet had 14 such slips); a price revision
  can't be sent back to the exec (withdraw it instead); a test desk login
  sees and works only test RFQs, and the real Harjot/Harpreet only real ones.

### Step 2 rulings (2026-10-06)
- **The switch stays ON from today** (offered: turn it off until launch).
  Consequences accepted: RFQs collect in the desk while Excel stays the
  working copy; the pre-launch backlog and its alerts are dealt with on launch
  day (§8 Step 8).
- **Lead Detail for the desk = the full read-only page, without Call client**
  (offered: full page with it, or the summary-only page a rep sees on a
  colleague's lead). Main column + rail (owner, client, contact, site), no
  Log activity, no quick actions. The client's number shows as plain text.
- **Architect names are plain text for the desk** (offered: open architect
  profiles to them). In Search an architect row is then an ordinary party
  row — linked to its lead if they can read one, else plain.
- **Their Today keeps the "being set up" card, plus one line:** "You can
  already look up any lead that has an RFQ in Search."
- Decided in the build, not asked: things on Lead Detail computed from data
  the desk's RLS can't read are switched off for them rather than shown wrong
  — the health pill and Last touch (activities), Remarks ("No remarks yet"
  would be false), and the timeline is titled "Stage history". The owner's
  RFQ Desk link waits for its screen (Step 7); `canSeeRfqDesk` exists now.

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
| Q4 | Quote value on a lead that has **no** desk quote (in-flight Excel RFQs, older leads) | Exec can still type it until the first desk quote lands; locked from then on | 3 |
| Q5 | Needs Attention's "RFQ raised 3+ days, no quote" bucket now measures the desk's speed, not the exec's | Replace it with "sent back, not revised in N days" and "quote in, not sent to client in N days" | 6 |
| Q6 | Where a sent-back RFQ shows on the exec's Today | In "Needs your attention today", above follow-ups | 3 |
| Q7 | "Waiting too long" per step | Technical 1 working day, estimation 1 day, Lixil 5 days (data: median 3 days end to end) | 4–7 |
| Q8 | Do Harjot and Harpreet see their own figures (RFQ Desk or a slimmer view)? | A slim "my desk this month" strip on their Today, but not the full RFQ Desk | 4–5 |
| Q9 | Does "Quote ready" offer a one-tap "Mark quote sent to client"? | Yes, on Lead Detail, for the exec | 3 |

---

## 5. Data model (built at Step 1 — `Schema/migration_rfq_desk.sql`)

The migration's own header and STEP comments are the full reference; this is
the map.

**`activities.rfq_window_count` / `rfq_segments`** — what the RFQ Raised form
sends (Step 3); optional in the database.

**`rfq_desk_settings`** — one row, `live_from` NULL = off. **While on, every
RFQ Raised activity on a lead becomes a desk RFQ** (`rfq_from_activity`, an
AFTER INSERT trigger), whoever logs it and whether or not it carries a window
count. Readable by every employee: Step 3's Log Activity reads it to decide
whether logging still advances the lead (off) or the approval does (on).

**`rfqs`** — one row per submission, each revision its own row.
- `kind` fresh / revised (the activity's own `rfq_kind`) / price_revision
- `revision` = how many RFQ Raised activities the lead had before (activities,
  not desk rows, so a pre-launch RFQ still counts); a price revision repeats it
- `window_count` / `segments` — blank when the activity didn't carry them
- `raised_by_employee_id` (credited exec — for a price revision, the lead's
  owner), `logged_by_employee_id` (who pressed Save)
- `is_test`, frozen at creation from the credited exec
- `status`: `with_technical` → `with_estimation` → `with_lixil` → `quoted`,
  or `sent_back` (with `sent_back_from` technical/estimation and an optional
  `send_back_note`) or `withdrawn`
- one timestamp + actor pair per step (`approved_*`, `sent_back_*`,
  `lixil_raised_*`, `quote_received_*`, `withdrawn_*`); `quote_date`,
  `quote_ref`, `quote_value` (without GST). TIMESTAMPTZ throughout.

**`rfq_events`** — append-only, written only by `rfqs_after_write()` on every
insert and status change: action, from/to status, actor, note. The RFQ Desk's
turnaround figures (Step 7) read it.

**Nobody writes either table directly** (no INSERT/UPDATE/DELETE grant).
Six SECURITY DEFINER functions are the only way to act, each checking role,
test scope and starting status under a row lock: `rfq_approve`,
`rfq_send_back(id, note)`, `rfq_raise_with_lixil`,
`rfq_record_quote(id, ref, value, date)`, `rfq_withdraw`,
`rfq_start_price_revision(lead_id)`. Steps 3–5 call them via `supabase.rpc`.

**Side effects, in `rfqs_after_write()`:**
- approved → `leads.rfq_raised`, `rfq_raised_at` (the later of its own and
  this RFQ's raised date), and for a FRESH RFQ on a lead still before RFQ
  (calling / presentation / joinery follow-up) the move to `rfq` + a
  `stage_history` row credited to the approver — exactly `shouldAdvanceToRfq`.
- quoted → `leads.quote_value`.
- notifications (five new kinds, `notifications.rfq_id`): `rfq_new`,
  `rfq_approved`, `rfq_sent_back`, `rfq_bounced`, `rfq_quote_ready`.

**`enforce_owner_only_stage_change()` gained one exit** for the approval's
own move to `rfq` (a transaction-local flag set only by that trigger). It is
the BDM migration's copy otherwise — so re-running an older file that defines
it removes the exit; re-run this one after.

**Desk visibility:** `desk_lead_ids()` / `desk_site_ids()` /
`desk_party_ids()` (SECURITY DEFINER — a leads policy reading rfqs would
recurse) feed one additive `desk_select` policy each on `leads`, `sites`,
`parties`, `site_contacts`, `stage_history`. Everyone else reads `rfqs` for
the leads they can already see. `hide_test_accounts` covers both new tables.

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

1. **Database.** ✅ written 2026-10-06 (see §5). Write the migration plus a
   `verify_rfq_desk.sql` (same pattern as `verify_bdm_role.sql`). The owner
   runs it and creates two test logins.
2. **Role plumbing.** ✅ 2026-10-06. Capabilities in `roles.js`
   (`canReviewRfqs`, `canEstimateRfqs`, `canSeeRfqDesk`; `canSearch` /
   `canOpenLeads` widened). `App.jsx` routes already read them, `BottomNav`
   (one flag per capability, read by both renderings), `Today.jsx` naming both
   roles explicitly, Lead Detail's desk branch, and two dev ports
   (`role-production` 5186, `role-estimation` 5187).
3. **Exec side.** RFQ Raised form, Lead Detail status, the in-app line,
   pushes (redeploy `send-followup-reminders` — its name stays wrong) and the
   quote-value lock.
4. **Production Executive screens.**
5. **Estimation Executive screens**, including price revision.
6. **Reporting changes** (§6). The figures must agree on every surface.
7. **RFQ Desk.** Pull the real numbers from the first live weeks before
   choosing chart forms (UI-DESIGN.md).
8. **Launch day.** Set a date with the owner. Deploy Steps 3–6. Harjot and
   Harpreet switch from Excel to the CRM for new RFQs that day; in-flight ones
   finish in Excel. Then document everything in `CLAUDE.md` and mark this
   file historical.
   **The switch is already on (since 2026-10-06 09:26 IST, §1)**, so launch
   day also has to deal with the backlog that built up before it. Write this
   as one SQL file for the owner, run just before the deploy, and decide each
   point with the owner at Step 8:
   - **Re-stamp the switch:** `UPDATE rfq_desk_settings SET live_from = now();`
     The trigger only asks "is it on?", so this changes nothing for new RFQs,
     but it makes `live_from` the real cutover time. **Step 6 counts an RFQ
     raised before `live_from` the OLD way (by its logging date)** and one
     raised after by its approval. Without that, every pre-launch RFQ would
     drop out of the exec's target, because nobody approves it in the CRM.
   - **The pre-launch desk RFQs** (raised before the cutover, still
     `with_technical`): either delete them (they were never worked in the CRM;
     `rfq_events` and their alerts cascade with them) or keep them as history
     and take them out of the queue. Harjot's queue must open empty either way.
   - **Their `rfq_new` alerts** (`notified_at IS NULL`): mark them notified or
     delete them **before** the new Edge Function deploys, or Harjot's phone
     gets every one of them at once.
   - A lead's stage already moved on logging for every pre-launch fresh RFQ
     (today's ActivityLog). Approving one later is a no-op for the stage —
     safe, nothing to do.

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
- **2026-10-06 — role values live and checked.** The owner ran
  `migration_rfq_desk_roles.sql` and added Harjot (Production Executive),
  Harpreet Kaur (Estimation Executive) and two test logins, `production-exec`
  (port 5186) and `estimation-exec` (5187), both `is_test_account = true`.
  Both test logins checked at 375px and 1280px: holding screen with the
  right wording, Today + Profile only, sales routes bounce to `/`, Profile
  without the owner block. Step 1 (the RFQ tables) still waits for the
  owner's go-ahead.
- **2026-10-06 — Step 1 written.** Owner's rulings: all six segments; a new
  revision while the last is waiting leaves BOTH in the queue; the exec /
  logger / owner may withdraw until it reaches Lixil; Won/Lost leaves RFQs
  alone. Built `Schema/migration_rfq_desk.sql` (tables, the six action
  functions, triggers, desk visibility, notifications, the stage-rule exit)
  and `Schema/verify_rfq_desk.sql` (39 checks as real test sessions, rolls
  itself back). Found and fixed before handing over: `rfq_withdraw`'s
  permission test was `IF NOT (a OR b OR c)`, which is NULL — and so lets
  anyone through — when an RFQ has no logged_by; now COALESCEd. No local
  Postgres, so neither file has been executed yet.
- **2026-10-06 — two owner asks folded into Step 1 (still unrun).** (1) "Record
  the time of each move" — already there; T19b added to the verify to prove
  it. (2) "Whenever anyone logs RFQ Raised it should alert Harjot" — the
  window-count gate is gone; every RFQ Raised activity on a lead enters the
  desk and fires `rfq_new`, gated only by the new launch switch
  (`rfq_desk_settings`, off until launch day — owner's choice). T00a/T00b
  check the switch both ways; `rfqs_window_count_required` dropped.
- **2026-10-06 — Step 1 live.** The owner ran `migration_rfq_desk.sql`, then
  `verify_rfq_desk.sql`: **42 PASS, 0 FAIL, 0 SKIP**, run as the test exec
  (26), test coordinator (25), production-exec (48), estimation-exec (49), a
  real exec, the real Production Executive (Harjot) and the owner (Test
  accounts switch OFF). Proven: the switch both ways; every RFQ Raised enters
  the desk with or without a window count; every action's role, status and
  test-scope guard; approval's stage move (once, fresh only) and
  `rfq_raised`; quote → lead quote value; price revision; withdraw; all five
  notification kinds to the right people and no one else; every move timed
  and attributed; real and test data fully separated. The desk switch is
  OFF. Next: Step 2, on the owner's go-ahead.
- **2026-10-06 — Step 2 built.** The owner had switched the desk ON at
  09:26 IST before this session and chose to keep it on (rulings in §3 "Step
  2 rulings"; the launch-day clean-up it needs is in §8 Step 8). Built:
  `roles.js` — `canSearch` / `canOpenLeads` admit both desk roles, new
  `canReviewRfqs` / `canEstimateRfqs` / `canSeeRfqDesk` mirror the SQL action
  functions' role tests (pinned in `roles.test.js`); `BottomNav` gives them
  Today + Search from the same flags at both widths; their Today card gains
  the Search line; Lead Detail has a desk branch (read-only, main + rail, no
  Call client / Log activity / quick actions / mobile bar, Remarks hidden,
  touch health off, "Stage history" timeline); architect names are plain text
  for them in Lead Detail and Search. Found on the way: Lead Detail offered
  the desk roles "Log activity" (none of `canLogActivityHere`'s exclusions
  named them) — it now requires `canLogActivity(role)` first. Lint clean,
  619/619 tests. Checked as both test logins at 375px and 1280px: nav, Today
  card, Search (architects/firms as plain rows), the sales routes bounce, an
  unreadable lead reads "Lead not found". **Not yet seen:** the Lead Detail
  desk branch on a real lead — the test logins can read none until a test RFQ
  exists (a throwaway test lead from the test exec, deleted afterwards with
  the owner's Delete Lead, which cascades the RFQ). The five sales roles'
  Lead Detail and Search are unchanged in logic (every new condition is true
  for them); not re-walked in the browser this session — no sales login was
  signed in.
- **2026-10-06 — Step 2 checked on a real lead.** As the test exec: a
  throwaway lead #1620 ("ZZ RFQ desk Step 2 trial — delete me", test
  architect #177 as a site contact, test client #1664 given a dummy mobile)
  plus one RFQ Raised (12 windows, Windows). With the switch ON the trigger
  made desk RFQ #7 (`with_technical`, `is_test`) and one `rfq_new` alert to the
  test production-exec only. Both desk logins at 1280px (772 + 360 columns)
  and 375px: the teal "belongs to exec" note, no buttons or button row, the
  number as plain text, the architect unlinked, the owner as plain text,
  "Open lead" with no health pill, Last touch "not visible to the desk",
  "Stage history · No stage changes yet.", Remarks absent, no sticky bar, no
  horizontal scroll, no console errors. The test production-exec could read
  lead #1620 and nothing else; Search found it by site name and by client
  (lead linked, site and architect rows plain). The test exec's own view of
  #1620 was unchanged at both widths (Log activity, Call client, `tel:`
  number, architect link, Remarks, health pill, ⇄). **Cleaned up:** the
  owner's `delete_lead_totally(1620)` removed the lead, site, contact,
  activity, RFQ #7, its event and alert #120 (each re-read as gone from the
  exec and production-exec sessions); #1664's mobile set back to blank. The
  owner's Test accounts switch was never touched (the delete function runs
  past RLS). Not walked this session: the coordinator / manager / BDM /
  owner Lead Detail — their logic is unchanged (every new condition is true
  for them).
