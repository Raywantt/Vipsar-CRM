# UI/UX Improvements — Dashboard (all roles)

> **Status: all actionable findings below are fixed and verified live**
> (owner/coordinator/exec, desktop + mobile where relevant). See the
> "✅ FIXED" note under each issue for what changed and where. The one
> Medium finding was retracted after a follow-up DOM check showed it was a
> false positive from an earlier flawed query — see its own note.

## Summary

Reviewed `/dashboard` (Reports view, All/My/Team Leads, Follow-ups, and every
drill-down panel reachable from a "Details ›" link or metric tile) across
all three roles — `owner` (localhost:5181), `sales_coordinator` (5182),
`sales_executive` (5183) — at both desktop (1440×900) and mobile (375×812)
widths, against real dev-database data.

Role scoping itself is solid: headers, titles, and drill-down scope labels
all correctly differentiate "Team performance"/"Your performance", "All
leads"/"My leads"/"Team leads", and "Company"/"My team"/the exec's own name
inside drill-down panels. The two-level drill-down stack (e.g. Pipeline by
stage → a single stage's lead list, with Back navigation) works correctly.
The one finding below rated **Critical** is a real data-presentation defect,
not a role-scoping one.

## Critical Issues

### Issue: Stage-to-stage conversion rates render above 100%, with no visual or textual explanation

**Current State**: Dashboard → Pipeline by stage → Details → "STAGE-TO-STAGE
CONVERSION" section. On the owner's live data, three of the eight rows read:
`MEASUREMENTS TO BE TAKEN → DESIGN DISCUSSION 275% (4 → 11)`,
`DESIGN DISCUSSION → RFQ 255% (11 → 28)`, and
`RFQ → QUOTE SUBMISSION 143% (28 → 40)`. All three render in the exact same
neutral card styling as the legitimate sub-100% rows (17%, 57%, 15%, 55%,
50%).

**Problem**: A "conversion rate" reading 275% is not a number a manager can
act on — it looks like a broken calculation, not a real business figure, and
undermines trust in every other number on the same card. The underlying
cause is understandable once you know the schema (`stage_history` only logs
a lead's *destination* stage, so a lead that jumps straight from
"Measurements to be taken" to "Design discussion" — or skips several stages
entirely — never contributes to the earlier stage's "reached" count, while
still counting toward the later one's), but nothing in the UI communicates
that. A viewer has no way to distinguish "a genuinely confusing number" from
"a bug."

**Recommendation**: Either (a) cap the displayed value's visual treatment —
e.g. render anything over 100% with a distinct badge/tone ("stage-skipping"
or similar) and a `title`/inline note explaining why it can exceed 100%, or
(b) change the underlying metric to something that can't mathematically
exceed 100% (e.g. "% of leads currently past this stage" rather than a
strict A→B reach ratio). (a) is the smaller change; (b) is more correct but
touches `buildPipelinePanel` in `drilldownBuilders.js`.

**Impact**: Removes a number that currently reads as broken from the
owner's highest-traffic drill-down panel.

**Implementation Notes**: `src/lib/drilldownBuilders.js`'s
`buildPipelinePanel` computes the `progression` chain; the render lives in
`DrilldownPanel.jsx`'s pipeline body. This is a display-layer fix — no
schema or query change needed for option (a).

**✅ FIXED**: Went with option (a). `buildPipelinePanel` now flags a row
`skipped: true` when its rate exceeds 100%, uses `TONE_NEUTRAL` instead of
the red/amber/green grading for that row's color, and appends
"· stage skipped" to its sub-text. `DrilldownPanel.jsx`'s `PipelineBody`
shows a section-level hint ("over 100% = leads skipped straight past that
stage") whenever any row is flagged, gives each flagged card a
`title` tooltip with the fuller explanation, and a new
`.vip-dd-conv-card-skipped` class (dashed border, soft neutral background)
visually separates it from a graded percentage. Verified live: the three
275%/255%/143% rows on the owner's real data now render with the hint,
the "· stage skipped" sub-text, and the dashed/neutral card styling.

## High Priority Improvements

### Issue: "Missed" counts disagree between two blocks on the same Follow-ups screen with no visible reason

**Current State**: `/dashboard?tab=followups`, owner view. The top
"FOLLOW-UPS · THIS WEEK" table shows Raghav Gupta at 55 assigned / 0 done /
**54 missed**, Vishal Kumar at 31 / 19 / **—**. Directly below, the status
tab strip reads **Overdue 61** / Today 13 / Upcoming 35 / Done 73 /
Cancelled 37 — a materially different overdue total than the per-exec table
implies (54 + 0 ≈ 54, not 61), with no date range or "all-time vs. this
week" label distinguishing the two blocks.

**Problem**: These are very likely two different time windows (the top
table scoped to "this week," the tab strip showing an all-time queue), but
nothing on screen says so. An owner scanning both numbers in the same
glance has a reasonable expectation they describe the same thing, and they
don't visibly reconcile.

**Recommendation**: Label each block's time scope explicitly (e.g. "This
week" vs. "All open, any date") so the two counts are legibly answering
different questions, or scope both to the same window if that's the
intent.

**Impact**: Removes a plausible "which number do I trust" moment for the
person this screen is built for.

**Implementation Notes**: Needs a look at whichever component renders the
per-exec follow-up summary vs. the status tab strip on the Follow-ups tab —
not covered in the current `CLAUDE.md` documentation, so it may be recent
and undocumented.

**✅ FIXED**: `src/components/FollowUpsCard.jsx` — the bucket tab strip
(Overdue/Today/Upcoming/Done/Cancelled) now has its own card head reading
"All reminders" with a hint, "any due date — not scoped to {rangeLabel}",
directly distinguishing it from the per-exec table's own
"Follow-ups · {rangeLabel}" heading just above it. Verified live: at
Week/"this week", the two headings now read "Follow-ups · this week" and
"any due date — not scoped to this week" side by side.

## Medium Priority Enhancements

### ~~Issue: Uneven row heights in All Leads / My Leads / Team Leads when the stage name is long~~ — RETRACTED, false positive

**Original claim**: The desktop leads table's Stage column pill was thought
to wrap long stage names ("Measurements to be taken") onto a second line,
producing taller rows than short-stage-name ones.

**Why it's wrong**: The original computed-style check queried the wrong
element — the grid's unstyled wrapper `<span>` around the chip, not the
`.vip-chip` pill itself. A corrected check against the actual `.vip-chip`
element shows `white-space: nowrap; text-overflow: ellipsis; overflow:
hidden` are already applied and working (`scrollWidth: 155` clamped to a
rendered `width: 120`, single-line `height: 23.95px`), and a same-page
height comparison across 15 rows — "Calling" and "Measurements to be
taken" alike — showed a uniform 47.55px row height. This CSS already
carries its own comment referencing a prior fix ("Phase 9 finding
F-P4-1") for exactly this overlap case, and it holds. No change made —
retracted rather than "fixed" so this isn't mistaken for a real edit.

## Low Priority Suggestions

### Issue: Owner-name badges inside ageing/pipeline/forecast/loss drill-down row lists still aren't links

**Current State**: Confirmed via DOM inspection (zero `a[href^="/employees/"]`
elements inside the "No activity in 14+ days" panel's per-lead owner
badges), matching what `CLAUDE.md` already records as a known, deliberately
deferred gap.

**Problem**: Every other place a person's name appears in this app is a
link to their Sales Exec Profile (the app's own "Universal linking" rule) —
this is the one remaining exception, and it's inside the panel an owner is
most likely to be scanning multiple reps' names in at once.

**Recommendation**: No new information here beyond confirming the gap is
still live — worth prioritizing given how central this panel is to the
owner's daily use, but this was already a known, deliberately-scoped-out
item, not a new finding.

**Impact**: Small — one extra tap saved per lookup.

**Implementation Notes**: `DrilldownPanel.jsx`'s per-row owner badge
markup, per the app's own documented follow-up item.

**✅ FIXED**, and it surfaced a second, more serious bug along the way.
`DrilldownPanel.jsx` now imports the existing `EmployeeLink` component
(the app's established pattern for a person's name inside a row that's
already a `<Link>` to something else) and uses it for the owner badge in
`AgeRowContent` (ageing), `PipelineBody`'s "Biggest open leads" and
`StageLeadsBody`'s lead list, `ForecastBody`'s forecast rows, and
`LossBody`'s lost-leads list. Each needed an `ownerId` field the row
objects didn't carry before:
- `buildPipelinePanel`'s `topLeads` and `ForecastBody`'s `fcRows` (in
  `drilldownBuilders.js`) — added `ownerId: l.owner_employee_id ?? null`.
- `LossBody`'s `lostLeads` (`drilldownBuilders.js`) — added
  `ownerId: row.leads?.owner_employee_id ?? null`, which needed
  `owner_employee_id` added to `fetchLossReasons`'s embedded `leads(...)`
  select in `dashboardQueries.js` (it wasn't being fetched at all).
- **The real bug**: `attention.js`'s `buildAgeingPanel` already computed
  `ownerId` in its internal `toRow()` helper (used for the owner-summary
  bar chart), but silently dropped it when building the final `ageRows`
  passed to the UI. That's not just why the ageing panel's owner names
  were plain text — `DrilldownPanel.jsx`'s `handleSaveDate` (the "Set
  date" swipe action and "Set a follow-up on all N" button on Today's
  work queue) reads `r.ownerId ?? assignee` to decide who a follow-up
  gets assigned to. With `ownerId` always undefined, every follow-up
  created this way was silently assigned to whoever was looking at the
  dashboard, not the lead's actual owner. Fixed by adding
  `ownerId: r.ownerId` to the `ageRows` mapping.

Verified live across all four panel kinds on the owner's real data: every
owner badge (Vishal Kumar, Raghav Gupta, …) now renders in
`var(--vip-teal)` with `cursor: pointer`, and clicking one navigates to
the correct `/employees/:id` without triggering the row's own
`/leads/:id` navigation (confirmed via `stopPropagation`, matching how
`EmployeeLink` is already used elsewhere in this app). The forecast
panel's owner column is still hidden below 1024px by pre-existing CSS
unrelated to this change (a `display: none` class rule with no
competing inline `display` from `EmployeeLink`) — not a regression.

## Positive Observations

- Role-specific header copy is correct and consistent everywhere checked:
  "Team performance" (owner/coordinator) vs. "Your performance" (exec);
  "All leads" / "Team leads" / "My leads"; "Team follow-ups" / "My
  follow-ups".
- Drill-down panel scope labels are correctly role-scoped — verified "My
  team · …" for the coordinator and the exec's own name for a sales exec,
  vs. "Company · …" for the owner — not hardcoded, as an earlier version of
  this app apparently had been (per its own changelog).
- The two-level drill-down stack (Pipeline by stage → a single stage's full
  lead list, with a working "‹ Back") functions correctly and matches its
  documented design.
- The mobile full-screen drill-down sheet (tested at 375×812) renders
  cleanly with no overflow or clipping, correctly hides the bottom tab bar
  while open, and dismisses on backdrop tap.
- The desktop persistent filter rail on All Leads / My Leads / Team Leads
  (owner filter, stage, source, status, quote-value range) is present and
  functional for all three roles, correctly scoped (coordinator sees only
  their own team in the owner-filter chip list).
- `DashboardHeatmap`'s Targets vs. Actuals table correctly renders for both
  `owner` and `sales_coordinator` (team-wide heatmap), not just the owner —
  confirms the documented `seesOthersData` fix is actually live, not just
  claimed.

## Testing Notes

- `sales_coordinator`'s dev server (port 5182) was intermittently
  unreachable during this review (confirmed via `curl`/`netstat`, not a
  permissions or app issue) and came back up mid-session — likely tied to
  another active session working in this same repo. Coordinator findings
  above were captured after it recovered.
- This review did not exercise write actions (setting a target, marking a
  lead won/lost, etc.) — read-only navigation and drill-down panels only,
  consistent with another session's uncommitted changes being present in
  this working tree at review time.
