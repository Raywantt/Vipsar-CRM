# FOLLOWUPS.md

The single source of truth for how follow-ups / reminders work in VIPSAR CRM.

**Status: rules agreed 2026-08-21, build not started.** Sections 1–5 and 8–9 are
settled product decisions from a full Q&A with the owner. Section 6 is the audited
state of the code *today* — what's broken, with evidence, from three parallel audits
(write paths / read paths / data layer, the last verified against the live
database). Section 7 is the build plan. Section 10 is what's still open, including
one question that must be answered before the first migration runs.

Read this before touching anything that creates, shows, completes, or counts a
reminder. `CLAUDE.md`'s "Follow-ups" section is **superseded by this file** and
carries at least four claims the audit disproved — see §6.8.

---

## 1. What a follow-up is

A **follow-up** is a commitment that a specific employee will do a specific thing
by a specific date. It is not a note, not a tag, and not a date field on a lead.

One follow-up = one row in `follow_ups`. There is no second mechanism. This is the
central rule of this document and the one the current code most violates: today
there are **six different ways to "set a follow-up" and three of them create no
reminder at all** (§6.1).

### The two-entity problem — and how it is resolved

Today two separate things both call themselves "follow-up":

| | What it is | Problem |
|---|---|---|
| `follow_ups` row | The real reminder — assignee, title, due date, notes, push | — |
| `leads.next_followup_date` | A bare `DATE` on the lead | Written independently by three paths, never cleared, never re-synced |

Measured live on 2026-08-21: **27 leads carry a `next_followup_date`; only 6 have a
matching reminder. 21 (78%) are orphans** — the lead displays a scheduled follow-up
and no notification will ever fire for it.

**RULE 1.1 — `follow_ups` is the only source of truth.**

**RULE 1.2 — `leads.next_followup_date` becomes strictly derived.** It is
maintained automatically as *the earliest due date among that lead's open
follow-ups*, and is `NULL` when there are none. **No application code may ever
write it directly.** This is enforced by a database trigger on `follow_ups`, not
by convention — convention is exactly what produced the 78% orphan rate.

> *Technical decision (not a product question): a trigger, because this app has no
> single lead-update service — `leads` is written from four LeadDetail sections,
> `LeadStageSection`, `LeadQuickActions` and three side-effect paths in
> `ActivityLog`. The same reasoning that made `lead_change_log` trigger-written
> applies verbatim. Rule 1.2 also becomes necessary the moment a lead may carry
> several open follow-ups (Rule 3.1) — a hand-written single column has no
> coherent value at that point.*

---

## 2. Lifecycle — three states, not two

**RULE 2.1 — A follow-up is `open`, `done`, or `cancelled`.** Today only
open/done exist (`is_done` boolean).

- **open** — live. Counts toward workload, fires notifications, appears in queues.
- **done** — the work happened. Normally carries the activity that proves it (§4).
- **cancelled** — no longer relevant (client went cold, plan changed, set by
  mistake). **Requires a reason.** Kept in history, visible in the lead's record.

**RULE 2.2 — `cancelled` never counts as `done`.** Not in completion rates, not in
the Day Review, not in any per-exec figure. The whole point of having a third state
is that reps would otherwise clear an irrelevant reminder by marking it done, which
quietly corrupts every number the owner uses to judge the team.

**RULE 2.3 — A follow-up is *missed* when it is past its due date and still open.**
Derived, never stored. This matches `DECISIONS.md`'s existing red-flag definition
and the exec's own overdue list, so a coordinator and a rep can never be looking at
different definitions of the same word.

**RULE 2.4 — "Missed" only begins after the day ends.** While today is still
running, an open reminder due today is **pending**, not missed. Existing Day Review
behaviour; keep it.

**RULE 2.5 — Nothing is ever deleted from the UI.** Cancel, don't delete. DELETE on
`follow_ups` stays owner-only at the RLS layer for manual cleanup.

---

## 3. Scope and shape

**RULE 3.1 — A lead may carry several open follow-ups at once, all equal.**
"Call Tuesday" and "site visit Friday" can coexist. The lead's derived date
(Rule 1.2) shows the earliest.

**RULE 3.2 — A lead is optional.** A follow-up may be anchored to a lead, to a
party (an architect/firm — how Architect Meeting reminders already work), or to
nothing at all (a personal reminder). A lead-less follow-up simply skips the
activity step at completion (Rule 4.3).

**RULE 3.3 — Required fields: assignee, title, due date.** Everything else — time,
lead, party, activity type, notes — is optional. Unchanged from today's schema.

**RULE 3.4 — The hold review is a distinguished follow-up.** A follow-up created by
the On Hold flow is badged as the hold review, is the one that drives the lead's
"on hold · resumes {date}" line, and obeys the extra rules in §8.

---

## 4. Completion is an activity

The owner's model, adopted: *"completing a follow-up is doing an activity against
that lead."* Today there is **no connection whatsoever** — no FK, no trigger, no
shared key beyond an optional `lead_id`. A rep who completes five follow-ups shows
`Activities 0 · Leads touched 0` on the Day Review.

**RULE 4.1 — Marking a lead-anchored follow-up done opens Log Activity**,
pre-filled with that lead and the follow-up's activity type. Saving the activity is
what closes the follow-up.

**RULE 4.2 — The completing activity is recorded on the follow-up.** A new
`completed_by_activity_id` FK. This is what makes "did they actually do it?"
answerable — today `is_done` is unverifiable self-report.

**RULE 4.3 — A follow-up with no lead just marks done.** Nothing to log an activity
against. This is the accepted cost of Rule 3.2.

**RULE 4.4 — "Just mark done" exists as a visible second option**, beside the
primary Log Activity button, for a rep who genuinely can't log right then. It closes
the follow-up with no activity attached.

> ⚠️ **Watch this one.** The owner chose it deliberately over a no-skip rule, and it
> is the single decision most likely to undermine Rule 4.2 in practice — if most
> reps take the shortcut, activity counts and completion counts drift apart again
> and §6.3's problem returns in a new form. Make the primary path genuinely
> faster than the shortcut, and **report the split** (done-with-activity vs
> done-without) in the oversight view so the owner can see if it's being abused.
> Revisit after the pilot.

**RULE 4.5 — REVERSED 2026-08-22, at the owner's direction. Do not rebuild this.**
This rule was implemented (Log Activity's success card listed every open reminder
on the lead just logged against, each with its own "Mark done" button) and then
removed. Two problems surfaced in real use:

1. **A reminder created by the same save could be offered back for closing.**
   Rule 4.6's "Next follow-up" box creates a real reminder *before* this rule's own
   fetch of "open reminders on this lead" ran, with nothing excluding the row just
   inserted — so setting a *future* follow-up date and logging an activity in one
   go surfaced that brand-new reminder asking to be marked done, before its due
   date had even arrived. Confusing on its own terms: the exec was being asked to
   close something they had just scheduled for later.
2. **The feature added a decision on a screen that didn't need one.** Every
   reminder already carries its own due date and already gets its own push
   notification on that date (the existing `send-followup-reminders` cron job —
   unaffected by this reversal), and already has a "Mark done" button on Home's
   "Still to do today" list and on the Sales Exec Profile. Asking again,
   mid-activity-log, for a lead that might carry several old reminders, was one
   more judgment call layered onto the highest-traffic screen in the app, for a
   need the Home screen already covered.

Log Activity's success card no longer fetches or lists a lead's open reminders at
all — see `src/pages/ActivityLog.jsx`'s `handleSubmit`/success-card render, which
now stops at `warnings` after Rule 4.6's `createFollowUp` call. `completed_by_activity_id`
(Rule 4.2) is real and still gets stamped whenever *any* path calls
`markFollowUpDone(id, activityId)` with an activity id — it was never exclusive to
this rule — but nothing in the app currently passes one; every existing "Mark done"
button (Home, Sales Exec Profile) calls `markFollowUpDone(id)` with no activity
attached. If Rule 4.2's "close is provably backed by a real activity" goal is
revisited, it needs a different entry point than this one.

**RULE 4.6 — Log Activity's own "Next follow-up" field creates a real reminder.**
It asks a date plus an optional note; the title is generated from the activity
("Follow up after Site Visit"). This is the highest-traffic follow-up control in the
app and today it writes nothing but a bare date (§6.1). It is the single biggest
source of the 78% orphan rate.

---

## 5. Who can do what

### 5.1 Assignment

| Role | May assign to |
|---|---|
| `owner` | anyone |
| `sales_coordinator` | themselves, and any member of their own team |
| `sales_executive` | themselves only |

**This already matches the database exactly** — `coordinator_team_{select,insert,update}`
on `follow_ups` were verified live end-to-end (a coordinator created a reminder for
their exec, read it back, marked it done, rescheduled it). **The gap is entirely in
the UI**, which is more restrictive than the RLS. No policy change is needed.

**RULE 5.1 — A rep can always complete a reminder someone else assigned them.**
The UPDATE policy keys on `assigned_to`, not `created_by`. Correct as-is.

**RULE 5.2 — A rep can never reassign a follow-up away from themselves.** Enforced
live by the `WITH CHECK` clause. Correct as-is.

### 5.2 Editing

**RULE 5.3 —**
- The **assignee** may reschedule the date and edit the notes.
- The **assigner** may edit anything — title, type, date, notes — while it is open.
- **Nobody edits a closed one** (done or cancelled).

Today **no edit path exists at all**. The only mutable field is `due_date`, and it
is the one whose edit silently breaks notification (§6.2).

### 5.3 Visibility

**RULE 5.4 — If you can see a follow-up, you can act on it.** Mark done, reschedule,
cancel and edit are available on *every* surface that displays a follow-up, subject
to §5.2. Today there are 17 display surfaces and **exactly two** offer mark-done.

**RULE 5.5 — An assigner can always see the outcome of what they assigned.**
Including a "reminders I assigned" view. Today no query anywhere filters by
`created_by`.

### 5.4 Readability — a reminder must show what it actually says

A reminder's whole value is the instruction inside it. Today that instruction is
truncated, or missing entirely, on every surface (§6.5).

**RULE 5.6 — The title always renders.** On every surface, never as a fallback for
something else. A reminder that reads *"Ask about the balcony glazing spec before
quoting"* must not display as just the client's name.

**RULE 5.7 — Tapping any follow-up expands it in place**, revealing everything the
row couldn't fit: notes in full (wrapped, never clipped), activity type, linked lead
or party, who assigned it, exact due date and time, and — once closed — how it was
closed (the completing activity, or the cancellation reason). Collapsed rows stay
compact; the expanded state is opt-in per row.

**RULE 5.8 — Never truncate notes to a single line without an expand affordance.**
If a row shows a clipped note, that row must be expandable and must look it.

> *Implementation caution: the truncation comes from `.vip-row-sub`
> (`vipsar-theme.css:342-345` — `white-space: nowrap; overflow: hidden;
> text-overflow: ellipsis`), which is a **shared** class used by Search results,
> Closure forecast and other list cards. Do not relax the base rule — that changes
> truncation app-wide. The expanded state needs its own `vip-` class.*

### 5.4 Lead reassignment

**RULE 5.6 — When a lead changes owner, its open follow-ups move to the new owner.**
Automatically, by trigger. Done and cancelled ones stay with whoever held them —
they are historical fact. Consistent with this app's existing "history follows the
person" ruling for coordinators (`DECISIONS.md`).

---

## 6. What is broken today (audited 2026-08-21)

Three parallel audits: write paths, read/display/complete paths, and data
layer + RLS + push. Full reports in the session scratchpad. Everything below cites
`file:line` and was verified against source; the data-layer findings were verified
against the **live database** with all three role sessions.

### 6.1 Six create-flows, three of which create nothing

| Flow | Where | Asks for | Creates a reminder? |
|---|---|---|---|
| Full reminder form | `FollowUpForm.jsx` (3 mounts) | 7 fields | ✅ + syncs lead date |
| On Hold prompt | `LeadStageSection.jsx:214` | reason + date | ✅ + syncs |
| Architect Meeting | `ActivityLog.jsx:372` | date | ✅ party-anchored |
| **Generic activity "Next follow-up"** | `ActivityLog.jsx:319` | date | ❌ **silent** |
| **Queue swipe "Set date"** | `DrilldownPanel.jsx:232` | date | ❌ **silent** |
| **Bulk "Set a follow-up on all N"** | `DrilldownPanel.jsx:232` | date, N leads | ❌ **silent** |

"Next follow-up" (`ActivityLog.jsx:319`) and "Set follow-up"
(`LeadQuickActions.jsx:129`) sit two taps apart on the same lead and do opposite
things. The only control in the app whose label literally reads *"Set a follow-up"*
creates none — and reports success regardless, because `DrilldownPanel.jsx:232`
discards its write result entirely.

### 6.2 🔴 Rescheduling permanently kills the notification

`rescheduleFollowUp` (`dayReviewQueries.js:174`) updates `due_date` and nothing
else. The Edge Function filters `.is('notified_at', null)`
(`send-followup-reminders/index.ts:39`). **A reminder that has already fired once
and is then moved forward will never fire again** — while still appearing live and
dated in every list. `notified_at` appears in **no** app query, so nothing on any
screen can reveal it.

There is a live row in exactly this state: **row 89**, open, overdue, already
notified — one "Move" click from silence.

### 6.3 🔴 A failed push marks the reminder notified anyway

`index.ts:92` — `notifiedIds.push(f.id)` sits **outside** the try/catch. Any
transient failure (a 500 from FCM, a network blip, an expired VAPID JWT) is
swallowed and the reminder is permanently marked notified with nothing sent. It can
never be retried. The function still returns HTTP 200.

### 6.4 The three reported symptoms — all confirmed

**"Can't mark done on one screen but can on another."** Home's "Still to do today"
cards render exactly one action each — Call or Move (`Home.jsx:403-418`).
`handleMarkDone` exists (`Home.jsx:181`) but has one call site: the "+N more · see
all" button, which only renders when there are **more than 3** open follow-ups
(`Home.jsx:439`, cap at `:256`). **With 1–3 open reminders a rep cannot mark one
done on Today at all.** EmployeeProfile always can. The day sheet — the owner's own
view — never can.

**"Doesn't disappear after marking done."** Four independent causes:
- Needs Attention's "Follow-ups overdue" reads `leads.next_followup_date`
  (`attention.js:123`), not `follow_ups`. `markFollowUpDone` never clears that
  column — nothing in `src/` does — so **the lead stays in that bucket forever.**
  Same root cause at `EmployeeProfile.jsx:401` and `LeadDetail.jsx:511`.
- `Home.jsx`'s "Done today" tile reads `dayData`, fetched once (`:137`) and never
  updated by `handleMarkDone` — it keeps showing `N still open` above a list that
  just shrank.
- `EmployeeProfile.jsx:240` uses `map` (strikethrough, stays) where `Home.jsx:184`
  uses `filter` (removed). Same click, opposite behaviour on two screens.
- Both handlers do `if (error) return` with **no message** — a rejected update is
  indistinguishable from "it didn't disappear".

**"No way to see if an assigned follow-up was completed."** Only two surfaces show
completed ones, and neither shows *when*: `done_at` is fetched but `FollowUpList`
never renders it. No query filters by `created_by`; there is no "assigned by me"
view anywhere.

### 6.5 The instruction inside a reminder is unreadable everywhere

Reported by the owner 2026-08-21 ("I can't see the reminder notes fully even after I
press on it"), verified in source. It is not just truncation — on the two surfaces a
rep uses most, the reminder's own words are **not rendered at all**:

| Surface | Title | Notes | Expandable? |
|---|---|---|---|
| `FollowUpList` (the 2 mark-done surfaces) | ✅ shown | ⚠️ **clipped to one line, ellipsis** | ❌ row has no click handler (`FollowUpList.jsx:47`) |
| Home → "Still to do today" — *the primary daily surface* | ❌ **fallback only** — renders only when the lead/party has no name (`Home.jsx:393`) | ❌ **never rendered** | ❌ |
| Day sheet — *the owner's review surface* | ❌ **never rendered** | ❌ **never rendered** | ❌ |

The clipping is `.vip-row-sub` (`vipsar-theme.css:342-345`), which sets
`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`. Nothing anywhere
in the app can reveal the rest of a note.

So: an owner assigns *"Chase the revised quote — client asked for laminated glass on
the west elevation"*, and the rep's Today screen shows the client's name and
"2 days late". Addressed by Rules 5.6–5.8.

### 6.6 Data-layer findings

- **No link to activities in either direction** — no `activity_id`, no
  `follow_up_id`, no trigger, no shared key beyond an optional `lead_id`.
- **No trigger, no `updated_at`, no audit trail on `follow_ups`.** A due date can be
  moved backwards to make a missed follow-up look on-time, with no trace of who or
  when. `lead_change_log`'s `field` CHECK also excludes `next_followup_date`, so
  even the lead-side change is unaudited.
- **No index on `follow_ups.lead_id`**, though `fetchLatestFollowUpForLead` filters
  on it on every Lead Detail load. Every other FK in this schema is indexed.
- **Index-name collision:** `idx_follow_ups_assigned_due` is declared twice with
  *different* definitions (`tostem_crm_schema.sql:394` partial, vs
  `migration_lead_change_log.sql:121` non-partial), both `IF NOT EXISTS`. Which one
  is live is undeterminable without `pg_indexes`.
- **Edge Function fetches every open unnotified follow-up** with no `due_date` bound
  and no `.order()`. `max_rows = 1000` will silently truncate arbitrarily as volume
  grows, and *which* 1000 come back is undefined.
- **An assigned follow-up can arrive context-free.** A rep's `parties`/`sites` SELECT
  is scoped to their own leads, so a reminder on a lead they don't own resolves its
  embeds to `null` — no client name, no lead link, and the push degrades to a
  generic "Follow-up reminder".
- **`parties` is an undeclared `service_role` dependency** of the Edge Function
  (embedded at `index.ts:37`), working only because that table predates the
  no-auto-expose platform default.
- **The Edge Function's schedule and secrets exist only in the Supabase dashboard.**
  No cron config, no deploy step in the repo or `DEPLOY.md`. It is empirically
  running, but unreproducible from source.

### 6.7 Confirmed **not** broken

- **Coordinator assign-then-read works.** `follow_ups` was *not* missed by
  `migration_sales_coordinator.sql`; STEP 7 covers SELECT/INSERT/UPDATE. Verified
  end-to-end live. Cross-team isolation holds (`42501` on another SC's rep).
- **The `.insert().select()` RETURNING trap does not apply** — SELECT and INSERT
  predicates are textually identical for every role, so any row you may insert you
  may read back. ⚠️ **This symmetry is load-bearing and undocumented: narrowing the
  SELECT policy without narrowing INSERT identically breaks `createFollowUp` with
  `42501` for every non-owner.**
- **The two `activity_type` CHECK lists have not drifted** — identical on all 8
  shared values. `follow_ups` additionally allows `'other'` and NULL, both
  intentional. ⚠️ Maintained by hand across two constraints and one JS constant with
  no test pinning it; a ninth activity type needs three edits.
- **No date-comparison bugs.** All 10 comparisons use `YYYY-MM-DD` string compares
  or append `T00:00:00`. The Phase 9 `F-P7-1` class is genuinely fixed. Three
  *display-only* parses (`FollowUpList.jsx:6`, `EmployeeProfile.jsx:400`,
  `LeadDetail.jsx:53`) UTC-parse a `DATE` — correct in IST, latent west of UTC.
- **`anon` has no grant** on `follow_ups` or `push_subscriptions` (live `42501`).
- **`assigned_to` is indexed** — this table avoided the historical unindexed-RLS
  mistake.

### 6.8 `CLAUDE.md` claims the audit disproved

1. *"an SC still has no 'Set follow-up' action anywhere today"* — **false.**
   `LeadDetail.jsx:265` admits `isCoordinator` explicitly. The real gaps are
   narrower: no personal reminder (their Today screen is a placeholder), and no
   assignment from an exec's profile (`EmployeeProfile.jsx:194` `isOwner || isSelf`).
2. *"the shared module stays, since `LeadStageSection`'s On Hold flow still uses it"*
   — **false.** `FOLLOWUP_OPTIONS`/`followupDateFor` have exactly one consumer
   (`FollowUpForm`); On Hold uses a bare `<input type="date">`.
3. *"this doesn't create a second, out-of-sync 'when's the next touch' field"* —
   **false.** They desync on every reschedule and whenever a lead has more than one
   reminder, and the write is unchecked so it can silently not happen.
4. *"the literal `'architect_meeting'` value isn't in `follow_ups.activity_type`'s
   CHECK list"* — **stale** since `migration_architect_meeting.sql:49`.
5. Home's card is described as `FollowUpList`-based with mark-done. It is neither.
6. The on-hold reason is described as showing "as soon as a lead is on hold" —
   `fetchLatestFollowUpForLead` filters `is_done=false`, so **completing the
   reminder erases the reason.**

Also stale: `PHASE9_LOG.md` records 78 follow-ups / 0 push subscriptions. Live on
2026-08-21: **14 follow-ups, 5 push subscriptions.** Don't plan against Phase 9
counts.

---

## 7. Build plan

Agreed delivery: **fix the broken parts first, then the new views.**

### Round 1 — make it correct

1. **Schema migration** (owner runs it):
   - `status` (`open`/`done`/`cancelled`) + `cancel_reason`, backfilled from `is_done`.
   - `completed_by_activity_id` FK → `activities`.
   - `leads.on_hold_reason` (Rule 8.4).
   - Trigger maintaining `leads.next_followup_date` as the earliest open due date.
   - Trigger moving open follow-ups on lead reassignment (Rule 5.6).
   - Index on `follow_ups.lead_id`; resolve the `idx_follow_ups_assigned_due`
     collision.
2. **Collapse six create-flows into one.** Every path creates a real `follow_ups`
   row. Remove every direct write to `leads.next_followup_date`.
3. **One-time data repair** for the 21 orphaned lead dates — see §8.
4. **Mark done / reschedule / cancel everywhere** a follow-up is shown, with real
   error surfacing and immediate removal from the list.
4b. **Make every reminder readable and expandable** (Rules 5.6–5.8) — title always
   rendered, tap-to-expand for notes and the rest, on all three surfaces. Needs a
   new `vip-` class; do not relax shared `.vip-row-sub`.
5. **Wire done → activity** (Rules 4.1–4.5).
6. **Fix the push pipeline** — clear `notified_at` on reschedule, only stamp on a
   successful send, bound and order the fetch. *(Note: daily re-nagging (Rule 8.1)
   changes the filter from "never notified" to "not notified today", which makes the
   reschedule bug structurally impossible rather than merely fixed.)*
7. **Fix the read surfaces** that point at `leads.next_followup_date` — Needs
   Attention, EmployeeProfile's next-step line, Lead Detail's Follow-up fact.

### Round 2 — the new views

8. **Dashboard → "My Followups"** category (`?tab=followups`, alongside Reports and
   All Leads): Overdue / Today / Upcoming / Done, filterable. Switches to the team's
   follow-ups for an owner or coordinator, exactly as All Leads already does.
9. **Per-exec assigned / done / missed counts** for the selected period, in that
   view — **and** Day Review keeps its existing daily column. Both must agree.
10. **"Reminders I assigned"** (Rule 5.5).
11. **Coordinator's Today screen** — currently a placeholder, so a coordinator has
    no personal reminder surface at all.

**Every change is a role × breakpoint matrix.** Three roles, two widths, per
`CLAUDE.md`'s standing rule. Follow-ups have already shipped one
capability-on-one-breakpoint-only bug class; don't add another.

---

## 8. On Hold — the special case

The On Hold flow is the best-built of the six create-flows (it's compulsory,
ordered correctly, and creates a real reminder) and it's also where several bugs
bite hardest.

**RULE 8.1 — The hold review is badged**, and is the follow-up that drives the
lead's "on hold · resumes {date}" line. A rep may add ordinary reminders alongside
it (Rule 3.1) without confusing which one holds the lead paused.

**RULE 8.2 — It cannot be cancelled while the lead is on hold.** Reschedule as far
out as you like; an on-hold lead always has a live reminder on it. This is what the
compulsory field was for. (It follows that Rule 2.1's `cancelled` state is
unreachable for a hold review until the lead leaves `on_hold`.)

**RULE 8.3 — Completing it changes nothing about the stage.** No auto-resume, no
prompt. The rep changes stage separately and deliberately, as today.

**RULE 8.4 — The hold reason lives on the lead, permanently.** A new
`leads.on_hold_reason`, not buried in the reminder's notes. Fixes the
reason-vanishes-when-completed bug (§6.8 item 6) and means a lead paused twice keeps
both reasons in its history.

**RULE 8.5 — Rescheduling the hold review updates the lead's resume date.** Falls
out of Rule 1.2 automatically once the date is derived. Today the lead advertises a
resume date the reminder no longer fires on.

---

## 9. Deliberately NOT doing

- **No "lead has no follow-up" attention flag.** The existing 14-day staleness
  bucket already catches neglected leads; this would flag nearly every lead on
  creation and drown the real signals.
- **No push notifications for dashboard red flags.** Existing ruling in
  `DECISIONS.md`, unchanged.
- **No `plans` table involvement.** Vestigial, zero references in `src/`.
  `DECISIONS.md` already settled that assignment goes through `follow_ups`.
- **No auto-resume from hold** (Rule 8.3).

---

## 10. Settled late, and still open

### Settled 2026-08-21 (after the first draft of this file)

**RULE 10.1 — The 21 orphaned lead dates are promoted, not cleared.** Each becomes a
real `follow_ups` row assigned to that lead's `owner_employee_id`, carrying the
existing date, a generated title (`Follow up`), and `created_by` set to the same
owner. They start firing notifications immediately.

> The title and assignee are **inferred, not recorded fact** — nobody knows who set
> those dates or why. The migration must mark them so they are distinguishable
> forever after (a note in `notes`, e.g. *"Migrated from the lead's follow-up date —
> original author unknown"*). This app's standing rule is that a guessed value must
> never be indistinguishable from a real one. Skipping the marker would put 21
> fabricated titles into the same column as real ones.

**RULE 10.2 — `follow_ups` gets a history trail**, in the same migration. Every
reschedule, edit, completion and cancellation records who and when, mirroring
`lead_change_log`'s trigger-written treatment for `leads`. Rule 5.3 makes reminders
editable and Rule 2.3 makes "missed" consequential — without a trail, a due date can
be moved backwards to make a missed follow-up look on-time, and the figures the
owner judges the team on are quietly editable.

### Still open

1. **Whether Rule 4.4's shortcut needs limiting** after the pilot — see the warning
   under Rule 4.4.
2. **Documenting the Edge Function's schedule and secrets** so push is reproducible
   from source (§6.6). Out of scope for this feature, but it's how push silently
   dies in a rebuild.
3. **Reminder time-of-day.** `due_time` is optional and defaults to 09:00 IST.
   Nobody has asked to change it; noted so it's a decision rather than an accident.
