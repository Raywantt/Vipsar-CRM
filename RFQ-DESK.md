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
| 3 | Exec side: RFQ Raised form, RFQ status on Lead Detail, sent-back / quote-ready | ✅ built 2026-10-06 on branch `rfq-desk` (NOT on master — ships on launch day), live-checked end to end on test data; `migration_rfq_desk_advance_fix.sql` run live, `verify_rfq_desk.sql` 43 PASS, 0 FAIL |
| 4 | Production Executive: review queue (approve / send back) | ✅ built 2026-10-06 on branch `rfq-desk` (ships with 3, 5, 6 on launch day); live-checked on test data as the test exec, both desk logins and the owner, at phone and desktop width |
| 5 | Estimation Executive: estimation queue, Lixil step, quote, send back, price revision | ✅ built 2026-10-06 on branch `rfq-desk` (ships with 3, 4, 6 on launch day); live-checked on test data as the test exec, both desk logins, at phone and desktop width |
| 6 | Reporting changes: RFQ target on approval, Needs Attention rework | 🟡 code built 2026-10-06 (ships with 3–5 on launch day); 700 tests, lint clean. **`migration_rfq_desk_reporting.sql` NOT yet run**, so `verify_rfq_desk.sql` T40–T50 and the live check are still to do |
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

**Steps 3–6 live on a branch until then**: on GitHub,
`claude/rfq-counting-needs-attention-2wgmy5` (it was the PC's local `rfq-desk`
until 2026-10-06, when it was pushed there; pull from it before working
locally again). Master
deploys straight to the live CRM, and with the switch already on, Step 3 alone
would stop logging from moving leads to RFQ Raised while nobody could approve
them yet. Merge the branch on launch day.

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

### Step 3 rulings (2026-10-06)
- **Lead Detail: a new "RFQs" card in the main column, under Deal progress**
  (offered: inside Sales progress). One row per desk RFQ, newest first, three
  shown then "+N more earlier": revision · step · age, raised by / windows /
  segments, the send-back note (or "No note — check your email"), the quote,
  and Withdraw for the credited exec / logger / owner while it is with the
  technical check or estimation (two-step confirm). Every role that can open
  the lead sees it; only those two actions are gated.
- **Today: a line at the top** (offered: also keep a sent-back RFQ in "Needs
  your attention" until revised) — `RfqUpdatesCard`, mounted once in
  `TodayGreetingHeader` like `AssignedLeadsCard`, same look. One row per unseen
  `rfq_sent_back` / `rfq_quote_ready`; a tap opens the lead and clears it.
- **Q4: the exec may type Quote value until the first desk quote lands**, then
  it is locked and shows "from Lixil quote {ref}". Sales progress also now
  sends Quote value only when the rep changed it, so a quote that lands while
  the page is open can't be overwritten by a stale form.
- **Q9: yes, a one-tap "Mark quote sent to client"** on the latest quote, for
  whoever may edit the lead (owner / coordinator / its exec — `canEdit`).
- Decided in the build, not asked (say if any is wrong): the steps are named,
  not the people ("Technical check", "Estimation", "With Lixil") — there can be
  more than one of each; **windows and at least one segment are required on
  the form** (the database keeps them optional); a revision's hint and success
  line promise nothing about the target (only a FRESH RFQ is said to count —
  Step 6 decides how a corrected revision counts).
- **Found in the live trial and fixed in SQL** (`migration_rfq_desk_advance_fix.sql`):
  approval moved the lead to RFQ Raised only for a FRESH RFQ, so a lead whose
  fresh RFQ was sent back stayed at Calling after its revision was approved.
  Now the lead's first approved RFQ of any kind (not a price revision) moves
  it; the stage test still stops a second move. New verify check T16b.

### Step 4 rulings (2026-10-06)
- **Harjot's Today = one column at every width, queue first** (offered: a
  desktop table + side panel). The same rows on a phone and a desktop, like
  the BDM pool card. Top to bottom: the greeting bar (carrying the "An RFQ you
  approved was sent back" line), a "this month" strip, the queue.
- **Approve takes two taps** (Approve → "Yes, approve"), since nothing can
  reverse an approval (offered: one tap). Send back opens an optional note box
  under the row (≤1,000 characters, the SQL limit), then Send back / Cancel.
- **Q8: a slim "this month" strip on their Today** — Approved, Sent back,
  Sent back later (by estimation, after they approved — amber above zero) and
  Typical check (median raised → their decision). The full figures stay on the
  owner's RFQ Desk (Step 7).
- **Q7, technical step: amber at 1 working day, red at 2; Sundays don't
  count** (offered: calendar days, or no colour). Once a working day has
  passed the age is written in the same unit ("1 working day"), so two rows
  saying "2 days" can't be different colours; before that it reads in
  hours/minutes. Estimation and Lixil get theirs at Step 5.
- Decided in the build, not asked (say if any is wrong): the queue is oldest
  first and never hidden when empty ("Nothing waiting…"); each row shows lead,
  revision, exec, office (the old sheets were split LDH/JLD), who logged it if
  not the exec, windows + segments ("No window count or segment given" when
  missing), the lead's stage only when it is Won / Lost / On hold, and "Also
  waiting for this lead: R2" when two revisions of one lead are both queued.
  **Lead Detail's RFQ card gets the same Approve / Send back** (one
  `RfqReviewActions` component, gated on `canReviewRfqs`), so **the owner can
  already cover Harjot from any lead** before the RFQ Desk exists; an approval
  there re-reads the lead so the stepper and timeline show the move to RFQ
  Raised. "Bounced at estimation" reuses Step 3's Today line
  (`RfqUpdatesCard`, now also listing `rfq_bounced`). An RFQ that moved on
  before the click landed (approved by someone else, withdrawn) leaves the
  queue with the database's own explanation.
- **Fixed in passing:** the desk's actions are database functions (RPCs), and
  the transport treated every RPC as a read, so an approval / withdrawal /
  Delete lead never cleared the remembered screens. `supabaseFetch.js` now
  names the writing functions (`rfq_*`, `delete_lead_totally`).

### Step 5 rulings (2026-10-06)
- **Harpreet's Today = two cards in one column** (offered: one card with a
  two-way switch): the greeting bar, a "this month" strip, then **Waiting for
  estimation** (Raised with Lixil / Send back) above **With Lixil** (Quote
  received). The same rows on a phone and a desktop.
- **Q7: estimation amber 1 / red 2 working days (counted from the
  approval), Lixil amber 5 / red 7 (from "Raised with Lixil")** — the sheets'
  75th / 90th percentile for a whole RFQ → quote (offered: Lixil 3 / 5, or no
  colour on Lixil).
- **Price revisions start on Lead Detail's RFQs card**, on the current quote
  ("Start a price revision", two taps), found through Search (offered: also a
  "Quoted" list on Today). The new one then waits in "Waiting for estimation".
- **Q8: Harpreet's strip** — Raised with Lixil, Quotes recorded, Sent back,
  Typical Lixil time (median raised with Lixil → quote recorded).
- Kept from §3 (locked): **"Raised with Lixil" is one tap**; a price revision
  can't be sent back — it offers **Withdraw** instead (to whoever started it,
  or the owner).
- Decided in the build, not asked (say if any is wrong): each list is longest
  wait AT ITS STEP first (an RFQ raised last week and approved this morning
  has waited for estimation since this morning); a row in "Waiting for
  estimation" says where it came from ("Approved by Harjot · 10:40 am" /
  "Price revision started by Harpreet"); **Quote received is a form under the
  row** — Lixil's reference (required), value without GST (the on-screen
  keypad on a phone) with the figure read back in rupees under it so a missed
  zero shows, and the quote date (today by default, limited to between the
  raised day and today). The database's own checks are said before the save
  (`quoteProblem`); recording the quote needs no second confirm — filling the
  form is the deliberate step. **The owner gets the same estimation controls
  on Lead Detail** (`canEstimateRfqs`), as with the technical check. A quote
  recorded on Lead Detail re-reads the lead and refreshes Sales progress, so
  its Quote value lock shows the new figure.

### Step 6 rulings (2026-10-06)
Recorded after the fact: the build session paused before writing them down,
so this is the owner's answers as relayed in that session plus what the code
on the branch does. Say if anything here is wrong.
- **The RFQ Raised target counts an RFQ on the day Harjot approves it** (the
  technical check passes), credited to whoever raised it, **once per lead**.
- **A corrected resubmission counts when it passes**: a fresh RFQ sent back
  counts through the revision that is approved. Later revisions never count,
  and neither does a price revision.
- **RFQs logged before the cutover count the old way, by the day they were
  logged.** The cutover is `rfq_desk_settings.live_from`, which launch day
  re-stamps, so the pre-launch backlog (switch on since 09:26 today) counts by
  its log date, never again on approval.
- **An RFQ that estimation sends back after approval stays counted.** A
  month's figure never changes after the fact.
- **Needs Attention: ONE combined item, "RFQs back with the exec"**
  (offered: two separate items, Q5). A lead with a desk RFQ is judged by its
  newest RFQ that wasn't withdrawn: **sent back and not re-logged**, or
  **Lixil's quote in and not marked sent to the client** since the day it came
  in. Waiting on the desk or on Lixil never counts against the exec.
- **Sales progress's RFQ block: unchanged** (§6 had suggested adding desk
  status beside it).
- **All Leads' Excel export: unchanged** (§6: "decide whether the export gains
  desk status"; it doesn't).
- Decided in the build, not asked (say if any is wrong):
  - **2 days** before either "back with the exec" case lands on Needs
    Attention (`RFQ_BACK_DAYS` in `attention.js`, the RPC's `p_rfq_back_days`
    default; change both together). Calendar days, not working days.
  - **A lead with no desk RFQ** (its RFQ was handled in Excel) keeps the old
    rule ("RFQ raised 3+ days, no quote sent") until it clears. The bucket key
    stays `pending_rfq`; its title becomes "RFQs back with the exec".
  - **Whether an approval counts is decided by the database at the moment of
    approval and frozen** (`rfqs.counts_toward_target`, a trigger; nobody can
    set it by hand).
  - **The exec who raised an RFQ keeps reading it after the lead is reassigned**
    (new `rfqs_raised_by_select` policy, plus their coordinator / manager), so
    their own RFQ figure doesn't drop while the owner's view still credits them.
    Activities already behave this way.
  - **The Sales Exec Profile's "RFQs raised" tile now uses the target's rule**
    (fresh only, and approval-dated once the desk is live). It used to count
    revisions too, so it could disagree with the owner's heatmap.
  - **Lead Detail offers "Mark quote sent to client" again on a re-quote** (a
    revision or price revision). Without it the "quote in, not sent" case could
    never clear.

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
| Q4 | Quote value on a lead that has **no** desk quote (in-flight Excel RFQs, older leads) | ✅ answered 2026-10-06 as recommended — see Step 3 rulings | 3 |
| Q5 | Needs Attention's "RFQ raised 3+ days, no quote" bucket now measures the desk's speed, not the exec's | Replace it with "sent back, not revised in N days" and "quote in, not sent to client in N days" | ✅ answered 2026-10-06: replaced, but as ONE combined item ("RFQs back with the exec"), not two — see Step 6 rulings |
| Q6 | Where a sent-back RFQ shows on the exec's Today | ✅ answered 2026-10-06: a line at the top of Today (not the attention list) — see Step 3 rulings | 3 |
| Q7 | "Waiting too long" per step | Technical 1 working day, estimation 1 day, Lixil 5 days (data: median 3 days end to end) | ✅ answered 2026-10-06, working days with Sundays excluded: technical and estimation amber 1 / red 2, Lixil amber 5 / red 7 — Step 4 and Step 5 rulings |
| Q8 | Do Harjot and Harpreet see their own figures (RFQ Desk or a slimmer view)? | A slim "my desk this month" strip on their Today, but not the full RFQ Desk | ✅ answered 2026-10-06 as recommended, for both (Step 4 and Step 5 rulings) |
| Q9 | Does "Quote ready" offer a one-tap "Mark quote sent to client"? | ✅ answered 2026-10-06: yes — see Step 3 rulings | 3 |

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
  this RFQ's raised date), and on a lead still before RFQ (calling /
  presentation / joinery follow-up) the move to `rfq` + a `stage_history` row
  credited to the approver. Any kind but a price revision — it was FRESH-only
  until `migration_rfq_desk_advance_fix.sql` (Step 3 rulings).
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
   **In order, on the day:**
   1. ~~`migration_rfq_desk_advance_fix.sql`~~ — already run and verified
      2026-10-06; nothing to do unless an older file was re-run since.
   2. `migration_rfq_desk_reporting.sql` (Step 6), if it hasn't run already.
      **It must run before the merge**: the branch's Dashboard reads
      `rfqs.counts_toward_target`, and a missing column fails the whole period
      read, so every role's Dashboard would break.
   3. The backlog SQL below (re-stamp the switch first).
   4. Merge `claude/rfq-counting-needs-attention-2wgmy5` (Steps 3–6, pushed
      from the PC's local `rfq-desk` branch on 2026-10-06) into master. Vercel
      deploys it.
   5. **Then** `supabase functions deploy send-followup-reminders` — never
      before the re-stamp: it pushes every RFQ alert written at or after
      `live_from`, and today's `live_from` would push weeks of Excel-handled
      RFQs to Harjot. (It also stamps older alerts as handled without
      sending, so the backlog can't clog its queue.)

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
- **2026-10-06 — Step 3 built (branch `rfq-desk`, uncommitted).** Owner's
  rulings in §3 "Step 3 rulings". New: `src/lib/rfqDesk.js` (pure rules —
  segments, statuses, labels, the withdraw rule mirroring SQL, the latest desk
  quote, the switch; `rfqDesk.test.js` also pins the segment list to the
  migration's CHECKs), `src/lib/rfqQueries.js`, `LeadRfqCard.jsx`,
  `RfqUpdatesCard.jsx`, theme section 44. Changed: Log Activity (windows +
  segments; with the desk on it stops moving the lead / stamping rfq_raised
  and says where the RFQ goes; re-reads the switch at submit; pings the push
  sender), Lead Detail (fetches the lead's RFQs; the card; remounts Sales
  progress after Mark sent), Sales progress (quote lock, send Quote value only
  when changed), the Edge Function (five rfq_* kinds with wording; an alert
  older than `live_from` is stamped handled, never sent). **Fixed in passing,
  live bug:** `markNotificationsSeen` returned a lazy query builder, so tapping
  one row of "lead assigned to you" (fire-and-forget) never sent the request
  and the alert came back next visit — now async. **Live trial** (test exec +
  both desk test logins, deleted afterwards with `delete_lead_totally`): the
  real form at 375px and 1280px (fresh then revised; Log it disabled until
  windows + a segment), lead stayed at Calling with no rfq_raised; send-back →
  Today line with the note → tap opened the lead and (after the fix) cleared
  it; approve / Lixil / quote → "A quote came in", card quote row, Sales
  progress locked; Mark sent → lead + checkbox + Quotes & orders; withdraw and
  Keep it; the desk sees the card read-only. Lint clean, 637 tests. Not seen:
  the coordinator / manager / BDM Today line (no session) — same one mount.
- **2026-10-06 — advance fix live.** The owner ran
  `migration_rfq_desk_advance_fix.sql`, then `verify_rfq_desk.sql`: **43
  PASS, 0 FAIL** (T16b: approving a revised RFQ on a lead at Calling moved it
  to RFQ Raised, one history row; T26 still holds — no second move). Step 3's
  code is still uncommitted on `rfq-desk`.
- **2026-10-06 — Step 4 built (branch `rfq-desk`, uncommitted).** Owner's
  rulings in §3 "Step 4 rulings" (one column; two-tap Approve; Q8 strip; Q7
  amber 1 / red 2 working days, Sundays out). New: `ProductionToday.jsx`
  (greeting bar → "this month" strip → queue), `TechnicalQueueCard.jsx`,
  `RfqReviewActions.jsx` (Approve / Send back — the one implementation, also
  on Lead Detail's RFQ card for `canReviewRfqs`, so the owner can cover from
  any lead), theme section 45 + two text tokens (`--vip-status-warn-ink` /
  `-bad-ink`: the plain warn/bad colours measured 3.1:1 and 4.2:1 on their
  soft fills). `rfqDesk.js` gained the working-day clock, wait levels/labels,
  oldest-first sort, "also waiting" siblings, the month stats and the
  moved-on error test; `rfqQueries.js` the queue, the decisions read, approve
  and send back; `leadDetailQueries.js` `fetchLeadAfterRfqMove`.
  `RfqUpdatesCard` now lists `rfq_bounced` ("An RFQ you approved was sent
  back", first name only so the time survives at 375px — measured 255 of
  258px) and names the kind in a plural heading ("3 RFQs were sent back").
  The setup card now serves only the Estimation Executive. **Fixed in
  passing:** `supabaseFetch.js` treated every RPC as a read, so the desk's
  actions and Delete lead never cleared remembered screens — the writing
  functions are now named (`isWriteRequest`, tested). **Live trial** (test
  exec 26, production-exec 48, estimation-exec 49, owner; three throwaway
  leads #1624–1626 with RFQs #18–21): the queue oldest first with "Also
  waiting for this lead" on two revisions of one lead; Send back with a note
  (row leaves, flash, strip updates at once — the RPC invalidation working);
  two-tap Approve (lead moved to RFQ Raised); estimation sent that one back →
  `rfq_bounced` to production-exec only → the Today line + strip "Sent back
  later 1" in amber; Approve from Harjot's Lead Detail at 375px (stepper and
  Stage history updated without a reload); the owner (Test accounts switched
  ON for the check, then OFF — confirmed in the database) sent one back from
  Lead Detail at 1280px with no note; Harjot's stale Approve on it was
  refused and the row left with "…it is already sent back"; the exec saw only
  Withdraw on Lead Detail and "3 RFQs were sent back" on Today; the
  Estimation Executive's Today unchanged. No horizontal scroll at phone width.
  **Cleaned up** with `delete_lead_totally` (1624–1626): leads, sites,
  activities, RFQs, events and alerts re-read as gone from the exec and both
  desk sessions. Lint clean, 662 tests. **Not seen:** an amber or red age on a
  real row (nothing in the trial was a working day old — the levels are unit
  tested and the colours measured 5.0–5.9:1 in both themes); the
  coordinator / manager / BDM Today line with the new plural headings (same
  one mount); the owner's Today receiving `rfq_bounced` after approving.
- **2026-10-06 — Step 5 built (branch `rfq-desk`, uncommitted).** Owner's
  rulings in §3 "Step 5 rulings" (two cards; Q7 estimation 1/2, Lixil 5/7;
  price revision from Lead Detail; Q8 strip). New: `EstimationToday.jsx`,
  `EstimationQueues.jsx` (both lists from one read), `RfqEstimationActions.jsx`
  (Raised with Lixil / Send back / Withdraw a price revision / Quote received
  — the one implementation, also on Lead Detail's card for `canEstimateRfqs`),
  and three pieces split out of Step 4's components so both desk steps share
  them: `RfqQueueRow.jsx`, `RfqSendBackForm.jsx`, `RfqWithdrawControl.jsx`.
  Lead Detail's card gained "Start a price revision" on the current quote.
  `rfqDesk.js`: the two new wait limits, `sortRfqsByWait`,
  `estimationMonthStats`, `canStartPriceRevision` (mirrors the SQL),
  `quoteProblem` / `rfqRaisedDay` (mirror `rfq_record_quote`'s refusals),
  `rfqLeadName`; `durationLabel` now says "<1m" rather than "0m".
  `rfqQueries.js`: raise with Lixil, record quote, start price revision, the
  estimation read and the decisions read. Harjot's strip now uses the Day
  Review's `DayKpiStrip`, as Harpreet's does. The "being set up" Today card is
  gone — both desk roles have their real screen. The sent-back pill on Lead
  Detail's card now uses `TONE_WARN_INK` (the plain amber measured 3.1:1).
  **Live trial** (test exec 26, production-exec 48, estimation-exec 49; leads
  #1627–1629, RFQs #22–28): Harpreet's lists at 1280px and 375px; Raised with
  Lixil moved D into With Lixil at once; Send back from estimation with a note
  → the exec's line and Harjot's "An RFQ you approved was sent back" + "Sent
  back later 1"; Save quote with nothing filled → "Enter Lixil's quote
  reference."; the quote via the phone keypad with "₹4,25,000 without GST" read
  back → saved, strip counted it, exec told "Quote in"; on D's Lead Detail
  Harpreet started a price revision (Withdraw offered, no Send back, the start
  link gone while it was open), raised it with Lixil and recorded ₹4,40,000 →
  the lead's quote value in the database, the exec's Sales progress locked at
  "₹4,40,000 · from Lixil quote ZZ-TRIAL-502" and "Mark quote sent" on the new
  quote; a second price revision withdrawn from Today ("The earlier quote
  still stands", lead value unchanged); the exec withdrew F while Harpreet's
  screen still showed it → her Raised with Lixil was refused and the row left
  with "…it is withdrawn"; Harjot's Lead Detail showed estimation's RFQ with no
  buttons. No horizontal scroll at 375px. **Cleaned up** with
  `delete_lead_totally` (1627–1629): leads, sites, activities, RFQs, events
  and alerts re-read as gone from all three sessions. Lint clean, 676 tests.
  **Not seen:** the owner's estimation controls on Lead Detail (needs the
  owner's Test accounts switch — same component as Harpreet's, which was
  walked); an amber/red age on a real row (unit tested); a quote dated in the
  past through the form (the date input's own min/max; the rule is unit
  tested and the SQL refuses it).
- **2026-10-06 — Step 6 built (code only), then rescued to GitHub.** Owner's
  rulings in §3 "Step 6 rulings". New: `Schema/migration_rfq_desk_reporting.sql`
  (`rfqs.counts_toward_target` + its BEFORE UPDATE trigger on approval; the
  `rfqs_raised_by_select` policy; `leads_needing_attention()` re-created with a
  9th argument, `p_rfq_back_days`, and two output columns, `rfq_back_kind` /
  `rfq_back_at`); `verify_rfq_desk.sql` T40–T50. App: `rfqDesk.js`
  (`latestDeskRfqByLead`, `quoteSentToClient`, `rfqBackWithExec`,
  `loggedWhileDeskLive`); `rfqQueries.js` (`fetchCountedRfqs`,
  `fetchDeskRfqsForAttention`); the target rule in `TargetsVsActualsCard.jsx`
  (`countsTowardActivityMetric(a, liveFrom)`, `rfqCounting`, `countedRfqsFor`),
  passed through the heatmap, `buildLogPanel`, Dashboard and the Sales Exec
  Profile (whose RFQ tile now reads the target's rule); `attention.js`'s
  combined item on both paths (RPC and the client fallback used by My Team and
  a manager's Team scope); Lead Detail's RFQ card re-offering "Mark quote sent
  to client" on a re-quote. **The local session ran out of usage credits
  before running the SQL or writing this log**, with everything (Steps 3–6)
  still uncommitted on the PC's `rfq-desk` branch. It was committed as-is and
  pushed to GitHub as **`claude/rfq-counting-needs-attention-2wgmy5`** (commit
  `2c94626`). **That branch is now the launch-day branch, not a local
  `rfq-desk`.** A cloud session checked it: 700 tests pass, lint has no errors,
  the production build is clean, and no file has mojibake, a BOM or CRLF
  endings (a PowerShell 5.1 `Get-Content`/`Set-Content` rewrite had garbled
  the SQL files' dashes and arrows mid-session; repaired, and confirmed
  intact). Also checked: the migration's DROP matches the live 8-argument
  signature, master's 3-argument call resolves to the new function, and master
  never reads `rfqs`, so the new policy can't touch it.
  **Live effect of running the SQL before launch day** (master is still the
  live app): a lead whose RFQ entered the desk (every RFQ since 09:26 today)
  drops out of master's "RFQs pending a quote" on Today and Dashboard, which
  read the RPC. My Team's per-card count and a manager's Team scope compute it
  client-side the old way and still include it. No difference before
  2026-10-09, since master stamps `rfq_raised_at` on every RFQ and the old rule
  waits 3 days. **Not done yet:** run `migration_rfq_desk_reporting.sql`, then
  `verify_rfq_desk.sql` (expect T40–T50 to PASS alongside the 43 before them),
  then the live check of Step 6 as the test exec, both desk logins and the
  owner at both widths.
