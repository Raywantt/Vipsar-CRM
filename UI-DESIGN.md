# UI-DESIGN.md

How UI decisions get made in this app, written from one worked example that
went through five rounds of rejection and three rounds of live bug-finding.

**Read this before designing or redesigning any screen.** `CLAUDE.md`'s
Design system section tells you what the components ARE; this file is about
how to decide what to build in the first place, and how to know it actually
works. The rules below are not general design advice — every one of them was
paid for by something that shipped wrong in this repo, and each cites the
measurement that caught it.

The worked example is the Sales Exec Profile's **Activity** card
(`EmployeeProfile.jsx`, theme section 27). Its final shape is documented in
`CLAUDE.md`; what follows is how it got there and what generalises.

---

## 1. The journey, in order

Worth reading once end to end, because the *sequence* is the lesson: nearly
every step was rejected for a reason that couldn't have been predicted from
the step before it.

**Round 0 — what existed.** A 4-series stacked bar: Calls, Site visits,
Offers sent, Bookings. It looked fine and had been on the page for weeks.

**Round 1 — a bug nobody could see.** The Calls and Site visits series
rendered zero for every exec, at every period, always. `fetchActivityCounts()`
never selected `created_at`, so every per-bucket date check compared
`undefined`. The metric tiles directly above the chart read the same array
without date-bucketing and showed the correct 55 and 7 — so the screen
contradicted itself, and *that* is what made it reportable. Nothing looked
broken; the chart just quietly said zero.

> **Two numbers on one screen that disagree is the most valuable bug signal
> you get.** A wrong number alone is invisible. Prefer designs where the same
> underlying data appears twice, derived two different ways.

**Round 2 — the shape was wrong too.** Asked to show all 8 loggable activity
types with Client Meeting split into its Old/New buckets — 9 categories. The
obvious move is a 9-series stacked bar. It was rejected on **the exec's real
data, not on principle**: Vishal's quarter was 250 calls out of 306
activities. Calls alone is ~82% of the bar, so the other eight categories are
hairline slivers, and the categorical palette itself caps at 8 hues before it
tells you to fold the rest into "Other". A design-system rule alone would have
been arguable; the actual numbers ended the argument.

**Round 3 — offer real options, drawn with real data.** Four candidate shapes
were mocked up using Vishal's actual counts (including, deliberately, the
9-colour stacked bar *rendered honestly* so the sliver problem could be seen
rather than described). The owner picked "trend, then breakdown". Built: a
single-colour volume trend bar over a full 9-row breakdown list.

**Round 4 — right data, wrong economics.** *"The part below the bar graphs is
taking up a lot of space and giving so little value."* Nine full-width rows,
most of them showing small numbers or zero, for ~300px. Correct, honest, and
not worth its pixels.

> **Being right about the data doesn't make a layout right.** Density is a
> real requirement here, not polish — this app is used on a phone in the field.

**Round 5 — go bold.** Three compaction options offered; chip cloud chosen,
with an explicit brief to stop designing around the existing look. Built: a
hero total, a bare rhythm strip with no axis or gridlines, and chips that
double as the filter.

**Round 6 — three bugs that measurement passed clean.** Covered in §3.

---

## 2. Rules for choosing the form

**2.1 — Pull the real numbers before choosing a chart type.** Every shape
decision above was settled by one exec's actual distribution, not by a
heuristic. A category breakdown that is 80/20 in practice needs a different
form than the same breakdown drawn evenly in a mockup. Query the live data
first; mock with it, not with `[12, 19, 8, 15]`.

**2.2 — Past ~7 categories, a chart usually stops helping.** Adding hues is
never the fix. The options are: fold the tail into "Other", use small
multiples, or use a list/table where every category gets its own labelled
line. This app chose the last, then compressed it into chips.

**2.3 — Don't mix taxonomies in one visual.** The original chart put two real
`activity_type` values next to two *derived* facts (a quote-sent date and a
won-stage transition) and called all four "activity mix". That was a category
error, and it survived weeks because each series was individually correct.
When a chart is titled after a domain concept, everything in it should be that
concept.

**2.4 — Reuse the app's own vocabulary unless the data says otherwise.** The
first working version was deliberately built from `ActivityCountsCard`'s
existing `.vip-bar-row` idiom and the `pace chart + contribution list` split
that `buildActivitiesAttainPanel` already used. Inventing a new pattern is the
last resort, not the first idea — but see 2.5.

**2.5 — "Bold" means changing the information architecture, not the skin.**
When the brief is to go bold, the useful moves are structural: drop the axis
and gridlines, promote a number to hero size, merge two components into one,
make the legend the control. Novel colours and decoration are not boldness;
they're noise. Everything in the final card is built from existing tokens.

**2.6 — Make a control earn its pixels by doing a second job.** The chips
survived the density complaint because they are also the filter — clicking one
re-scopes the strip above. A legend that only labels would not have been worth
the space it takes.

---

## 3. Rules for verification

**This is the part that matters most, and the part most easily skipped.**

**3.1 — Measuring and looking catch *different* bugs. Do both.**

Caught by measuring (`getBoundingClientRect`, computed styles) — all invisible
to the eye at a glance:

| Bug | How it presented |
|---|---|
| Bars rendered 0px tall | Default `flex-shrink` let the labels squash them |
| Chip widths encoded backwards | `flex-grow: count` resolves per LINE under wrap: `Call 55` sat at its natural 84px while `Design Sheet 2`, alone on line two, took all the slack at 371px |
| Totals disagreeing across views | Bar sum vs chip sum vs hero number |

Caught only by **looking**, after the browser pane started compositing again —
every one of these had *passed* a measurement check:

| Bug | Why measurement missed it |
|---|---|
| The tallest bar's value label invisible at both widths | The bar measured 76px, which was "correct". The failure was in what surrounded it — the label was pushed outside a clipped container |
| Chip fill encoded label length, not count | Each fill was individually the right *percentage*; the lie only appears when you compare two chips |
| Dark-mode chip text at 4.30:1 | Renders, is legible-ish, looks fine until you compute the ratio |

> If you cannot see the screen, say so and say what that leaves unverified.
> Do not describe measurement as verification.

**3.2 — Verify the thing *around* the thing you changed.** `barH: 76` was a
true measurement and a false conclusion. When you check an element, also check
its container, its siblings, and whether it is clipped.

**3.3 — Check an encoding by comparing two data points that should match.**
`Site Visit 1` drew 12.2px of fill and `Architect Meeting 1` drew 19.1px —
same count. That comparison is what exposed it; measuring either one alone
looked fine. Pick two items with equal values and confirm they render equal;
pick a 2× and confirm it renders 2×.

**3.4 — Contrast is a number, not an impression.** Compute it in both themes.
`--vip-teal` on `--vip-teal-soft` looked perfectly readable and was 4.30:1.

**3.5 — Prefer a discriminating test over a confirming one.** Testing that
something works in the case that already works proves nothing. Two examples
from this repo: a role-scoping check run as the owner (who sees everything)
cannot distinguish correct scoping from RLS merely hiding rows; a perf change
gated on row counts must be verified as the role with the FEWEST rows.

---

## 4. Rules for implementation

**4.1 — Never let JS own a pixel dimension that CSS also owns.** The bar
height was computed in JS against a hardcoded `STRIP_H = 76` while the
stylesheet set the container to 76px at desktop and 62px on mobile. They drift
the moment either side changes, and the drift is silent. The fix is
structural: give the bar a track that flexes to whatever the labels leave, and
express the bar as a **percentage** of it. Now the breakpoint override is a
free choice and JS knows no pixel figure at all.

**4.2 — An entry animation must never own the resting state.** With
`animation-fill-mode: both`, the element holds its FROM frame after finishing
— so the resting appearance belongs to the animation. A backgrounded tab
freezes animations at frame 0, and the whole strip measured 0px tall: an
invisible chart. Rules: use `backwards`, never `both`; never animate a
dimension that carries data; start opacity at ~0.3 rather than 0, so a frozen
first frame is dim rather than absent.

**4.3 — A shared class must not carry a flex basis.** `.vip-filter-field`
rendered in both a row (desktop) and a column (mobile); `flex: 1 1 150px` set
its *height* in the column, giving ~90px of dead space under five controls.
Flex basis follows whichever axis the parent runs.

**4.4 — Watch the `display` cascade trap.** `.vip-only-mobile` /
`.vip-only-desktop` are single-class rules, so any *unguarded* `display` you
declare on the same element later in the stylesheet wins at equal specificity
and leaks the hidden half through. This has bitten three times
(`.vip-leads-layout`, `.vip-daycards`, and nearly again here). Leave `display`
out of the base rule; set it only inside the media query that should own it.

**4.5 — Prefer shrinking to clipping.** Fixed-width columns plus
`overflow: hidden` meant a sixth day-bucket silently vanished on a phone
rather than getting narrower. A layout that drops data is worse than one that
looks cramped.

**4.6 — Knockout text on a themed fill should use a token that flips.**
`color: var(--vip-surface)` on a teal fill is white in light mode and
near-black in dark — exactly the flip a filled chip needs, because dark mode's
teal is the *lighter* value. A literal `#fff` measured 2.6:1 there. Likewise
`--vip-teal-dark` is darker than teal in light mode and lighter in dark, which
is why it lifted contrast in *both*.

**4.7 — Never hardcode a colour after theme section 22.** It's a colour dark
mode cannot reach. Build from tokens and dark mode repaints for free.

---

## 5. Encodings: what is allowed to mean what

Learned by getting it wrong twice in the same card.

- **A length must be honest about ratios.** If two items with equal values
  don't render equal, or a doubled value doesn't render doubled, it is not a
  valid length encoding. Both failures here came from percentages of
  differently-sized containers.
- **Equal-width columns fix a percentage encoding honestly** — and were tried
  — but cost ~100px of height by collapsing to two columns at this card's
  width. Correct and unaffordable is still a rejection.
- **A tint is a threshold, not a ratio.** It says big / medium / small without
  claiming a proportion it can't keep. That's why the final chips are tinted
  rather than filled.
- **A number is the most precise encoding available and costs almost nothing.**
  When the list is short and sorted, the numbers often carry the whole story
  and the bar is decoration. That was the conclusion here.
- **Never invent a confident value.** An unset probability renders `—`, not a
  stage-inferred guess; an unquoted lead renders `—`, not ₹0; an imported lead
  with no history isn't reported as neglected. See `dealValueOrNull` and
  `HISTORY_STARTS_AT` in `CLAUDE.md`.
- **Show zero categories, don't hide them.** "Never logged" is a real finding.
  Ghost chips carry it quietly. Same instinct as showing every exec on the
  Follow-ups roster whether or not they have reminders.

---

## 6. Working with the owner

- **Offer options, rendered with real data, and let them choose.** Both
  branch points in this arc were decided that way, quickly and confidently.
  A prose description of three layouts is much harder to choose between than
  three drawings of them.
- **Include the option you're arguing against, drawn honestly.** The 9-colour
  stacked bar was shown with real numbers so the sliver problem was visible
  rather than asserted. It made the recommendation credible.
- **Mark a recommendation, and say the tradeoff in one line.** Not a menu of
  equals.
- **Ask which role and which breakpoint if the brief doesn't say** — see
  `CLAUDE.md`'s standing matrix rule.
- **Don't commit unless asked** — see the same file.

---

## 7. Rejected here — don't silently re-try

Each of these was built or measured, not merely imagined:

| Idea | Why it failed |
|---|---|
| 9-series stacked bar | One category is ~80% of real volume; the rest are unreadable slivers |
| Donut / pie for 9 categories | Same sliver problem, plus unclickable slices |
| Small multiples (9 tiles, one trend each) | Genuinely good; rejected on screen space and build cost |
| Chip width via `flex-grow: count` | Resolves per line under wrap — produced exactly inverted widths |
| Background fill at `count/max` percent on content-sized chips | Encodes label length; equal counts rendered 12.2px vs 19.1px |
| Equal-width chip grid | Honest, but +100px height at this card's width |
| Y-axis and gridlines on the rhythm strip | Axis furniture cost more pixels than it returned at this size |
| Bar height in JS pixels | Drifts from the CSS-owned container; see 4.1 |
