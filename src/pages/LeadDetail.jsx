import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import SiteDetailsSection from '../components/SiteDetailsSection'
import ClientDetailsSection from '../components/ClientDetailsSection'
import AdditionalContactsSection from '../components/AdditionalContactsSection'
import SalesProgressSection from '../components/SalesProgressSection'
import LeadQuickActions from '../components/LeadQuickActions'
import LeadActivityTimeline from '../components/LeadActivityTimeline'
import LeadRemarks from '../components/LeadRemarks'
import { fetchActiveSalesExecs } from '../lib/employeeQueries'
import { fetchAreas, fetchProducts } from '../lib/lookupQueries'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { fetchLeadDetail } from '../lib/leadDetailQueries'
import LeadFollowUpsCard from '../components/LeadFollowUpsCard'
import BdmChip from '../components/BdmChip'
import { fetchFollowUpsForLead, FOLLOW_UP_OPEN, compareFollowUps } from '../lib/followUpQueries'
import { errorMessage } from '../lib/errorMessage'
import { materializePartyDraft } from '../lib/partyQueries'
import { leadAddress, leadDisplayName, leadSiteLabel } from '../lib/leadName'
import { LEAD_STAGE_OPTIONS, stageLabel } from '../lib/leadStageOptions'
import { stageFg, TONE_GOOD, TONE_WARN, TONE_BAD, TONE_MID, TONE_GOOD_SOFT, TONE_WARN_SOFT, TONE_BAD_SOFT, TONE_NEUTRAL, TONE_NEUTRAL_SOFT } from '../lib/statusColors'
import { getInitials } from '../lib/initials'
import { STALE_DAYS, ATTENTION_DAYS, staleGateDays } from '../lib/attention'
import { formatCurrency, formatCurrencyCompact } from '../lib/format'
import { todayISO } from '../lib/followupDates'
import { SOURCE_TYPE_LABELS as SOURCE_LABELS } from '../lib/sourceTypeOptions'
import { linkPartiesAsSiteContacts } from '../lib/partyQueries'
import { summariseRfqHistory } from '../lib/rfqKind'
import { withSelfAssignTestOption } from '../lib/selfAssignTest'
import { isPoolLead, sourcingArchitect } from '../lib/poolLeads'
import { canOpenEmployeeProfiles, isBdm } from '../lib/roles'
import { lossReasonLabel } from '../lib/lossReasonOptions'

// Was a fourth hand-rolled copy of the source labels, which had already
// drifted ('Other referral' vs the shared list's own wording). One list now —
// src/lib/sourceTypeOptions.js — so splitting or renaming a source can't leave
// this page saying something different from the dashboard.

// Probability is whatever the exec actually typed into Sales progress, or
// nothing at all. There used to be a STAGE_PROBABILITY_DEFAULTS map here
// (DATA_CONTRACT.md §4) filling an unset closure_probability in from the
// lead's stage — removed at the owner's direction: a guessed number renders
// identically to a real one, so a lead nobody has assessed read as "70%
// likely" purely for sitting at negotiation. An unset probability now shows
// —, the same way an unquoted lead shows — rather than ₹0 (see
// pipelineValue.js's dealValueOrNull for the same rule on deal value).

// The stepper's fixed backbone — the 8 real funnel stages, always shown in
// this order. 'won'/'lost' are deliberately not part of this fixed list:
// the stepper only ever shows *one* trailing outcome cell (whichever one
// actually happened), not two permanent slots — see the stageSteps build
// below. 'on_hold' isn't part of it either — it's an independent pause
// reachable from any stage (same reasoning drilldownBuilders.js's pipeline
// "progression" chain already applies to 'lost'), so it's spliced in at
// whatever position the lead actually paused at, not a fixed slot.
const FUNNEL_STAGES = LEAD_STAGE_OPTIONS.filter((s) => s !== 'on_hold' && s !== 'won' && s !== 'lost')

// Stable "nothing yet" for the lookup lists, so props don't change identity
// every render before they load. Never mutated.
const NO_ROWS = []

function shortDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

// Real bug found and fixed: with no guard here, a null `a` (e.g. a lead
// whose created_at is itself null, and which has no activity/stage history
// to fall back to either — confirmed live on lead #402/"VINAY", the source
// of the "20687d ago" figure this fix addresses) fed straight into
// `new Date(null)`, which JS parses as epoch (1970-01-01) — every caller
// below then computed a "days since" figure of ~20687 and rendered it as if
// it meant something. Same null-in-null-out shape attention.js's daysSince
// already uses; every caller here now has to handle a null result instead
// of silently getting a huge fake number.
function daysBetween(a, b) {
  if (!a) return null
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

function LeadDetail() {
  const { id } = useParams()
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()

  const [lead, setLead] = useState(null)
  const [party, setParty] = useState(null)
  // The "other" party and the referrer are read during load, to link them as
  // site contacts (see the loader below). The one thing kept from them is
  // which of the two is an architect, for a BDM lead's "Sourced by … via
  // Architect …" line (BDM.md §7).
  const [sourcingArchitectParty, setSourcingArchitectParty] = useState(null)
  const [site, setSite] = useState(null)
  const [siteContacts, setSiteContacts] = useState([])
  const [stageHistory, setStageHistory] = useState([])
  const [activities, setActivities] = useState([])
  const [ownerHistory, setOwnerHistory] = useState([])
  const [leadFollowUps, setLeadFollowUps] = useState([])
  const [lastActivityAt, setLastActivityAt] = useState(null)
  // Mobile-only: which collapsed section (if any) is pushed open as a
  // full-screen editor, and whether the sticky action bar's ⇄ button has
  // opened LeadQuickActions as a sheet. Both unused at ≥1024px, where the
  // desktop rail/inline quick actions render unconditionally instead.
  const [openSection, setOpenSection] = useState(null)
  const [addingSite, setAddingSite] = useState(false)
  const [addSiteError, setAddSiteError] = useState(null)
  const [quickActionsSheetOpen, setQuickActionsSheetOpen] = useState(false)
  // Why a lost lead was lost — shown to whoever may read it (owner's ruling,
  // BDM.md Step 4). loss_reasons SELECT decides who that is: the owner, a
  // manager for their team, the BDM for their own leads. For everyone else the
  // query simply returns nothing and nothing renders.
  const [lossReason, setLossReason] = useState(null)

  // INSTANT OPEN (owner's choice, 2026-09-21: "instant, edits wait"). The
  // page paints the copy of this lead the device remembered, and every control
  // that writes stays disabled (`editsLocked`, below) until the fresh copy
  // arrives — usually 1–2 s. A save made from the remembered copy could quietly
  // undo something a colleague changed in the meantime. When the fresh copy
  // lands, the page re-seeds from it ONCE and the edit forms remount (their
  // inputs are useState seeds), so they start from fresh values too.
  //
  // After that the page behaves exactly as it always has: its own saves merge
  // into local state, and later background refreshes (coming back to the app,
  // the refetch every save triggers) are deliberately NOT re-applied —
  // re-seeding would wipe a half-typed form. They still update the remembered
  // copy, so the next open starts from the latest.
  //
  // The lookups are their own remembered queries (shared with other screens),
  // so opening fifty leads doesn't store fifty copies of the areas list.
  // When THIS lead was opened: a copy fetched after it is fresh, one fetched
  // before it is remembered. Reset when the route moves to another lead
  // without remounting (React's "adjust state while rendering" pattern).
  const [opened, setOpened] = useState(() => ({ id, at: Date.now() }))
  if (opened.id !== id) setOpened({ id, at: Date.now() })
  const openedAt = opened.id === id ? opened.at : Date.now()
  const detailQuery = useCachedQuery(['lead', id], () => fetchLeadDetail(id))
  const execsQuery = useCachedQuery(['dash', 'active-execs'], fetchActiveSalesExecs)
  const areasQuery = useCachedQuery(['lookup', 'areas'], fetchAreas)
  const productsQuery = useCachedQuery(['lookup', 'products'], fetchProducts)
  const activeSalesExecs = execsQuery.result?.data ?? NO_ROWS
  const areas = areasQuery.result?.data ?? NO_ROWS
  const products = productsQuery.result?.data ?? NO_ROWS

  // Which copy the page's own state was seeded from. `version` keys the edit
  // forms, so each seed remounts them.
  const [seed, setSeed] = useState({ id: null, fresh: false, version: 0 })
  // The lead on screen right now, for async work that finishes after the
  // viewer has moved on to another lead.
  const currentIdRef = useRef(id)
  useEffect(() => {
    currentIdRef.current = id
  }, [id])

  const detailResult = detailQuery.result
  const detailUpdatedAt = detailQuery.updatedAt
  // A layout effect, so a remembered copy is on screen in the very first
  // paint — a plain effect showed "Loading…" for one frame first.
  useLayoutEffect(() => {
    if (!detailResult || detailResult.error) return
    const fresh = detailUpdatedAt != null && detailUpdatedAt >= openedAt
    // Seed from the first copy this lead gets, then once more from the first
    // FRESH one — never again (see above).
    if (seed.id === id && (seed.fresh || !fresh)) return

    const d = detailResult.data
    setLead(d.lead)
    setParty(d.party)
    setSourcingArchitectParty(sourcingArchitect(d.referrerParty, d.otherParty))
    setSite(d.site)
    setSiteContacts(d.siteContacts)
    setStageHistory(d.stageHistory)
    setActivities(d.activities)
    setOwnerHistory(d.ownerHistory)
    setLeadFollowUps(d.followUps)
    const mostRecent = [...d.stageHistory.map((h) => h.changed_at), ...d.activities.map((a) => a.created_at)].sort().pop()
    setLastActivityAt(mostRecent ?? d.lead.created_at)
    setSeed({ id, fresh, version: seed.version + 1 })

    // Leads captured before intake started linking these itself (see
    // LeadQuickCapture) still have an "other" party or referrer that never
    // reached site_contacts. Heal them on sight rather than asking the rep to
    // re-classify someone they already described at intake.
    // linkPartiesAsSiteContacts skips anyone already linked, so this is a
    // no-op on every later visit. Only from a FRESH copy (never write from a
    // remembered one), and only for a viewer who may edit the lead — a rep
    // viewing a colleague's lead is a reader. A failure is left silent on
    // purpose: nothing the reader did caused it.
    if (!fresh || !d.lead.site_id) return
    const viewerCanEdit =
      employee?.role === 'owner' || employee?.role === 'sales_coordinator' || d.lead.owner_employee_id === employee?.id
    const unlinked = [d.otherParty, d.referrerParty].filter(
      (p) => p && !d.siteContacts.some((c) => c.party_id === p.id)
    )
    if (!viewerCanEdit || unlinked.length === 0) return
    linkPartiesAsSiteContacts({
      siteId: d.lead.site_id,
      parties: unlinked,
      alreadyLinkedPartyIds: new Set(d.siteContacts.map((c) => c.party_id)),
    }).then(({ data: healed }) => {
      if (currentIdRef.current !== id || !healed?.length) return
      setSiteContacts((prev) => [...prev, ...healed.filter((h) => !prev.some((c) => c.id === h.id))])
    })
    // `seed` is read to decide whether to re-seed and is itself set here; the
    // early return above is what stops that from looping.
  }, [detailResult, detailUpdatedAt, id, openedAt, seed, employee?.id, employee?.role])

  // Edits wait while the page shows a remembered copy that is being refreshed,
  // or whose refresh failed (the header then reads "Not updated" and the next
  // return to the app tries again) — and until the lookup lists have
  // something, so a dropdown never renders without its options.
  const seededFromFresh = seed.id === id && seed.fresh
  const editsLocked =
    (!seededFromFresh && (detailQuery.isFetching || Boolean(detailQuery.lastError))) ||
    !execsQuery.result ||
    !areasQuery.result ||
    !productsQuery.result
  // The database now says this lead doesn't exist for this viewer (deleted,
  // or reassigned out of their reach) — never keep showing a remembered copy.
  const goneNow = detailQuery.lastError?.code === 'PGRST116'

  // One naming rule for the whole app (src/lib/leadName.js): the lead's party,
  // then the site's address, then its nickname. This page holds party/site as
  // separate state rather than as embeds, so the shape is assembled here — and
  // because it is DERIVED, adding a client name below re-titles the page (and
  // the header override) on the spot, with no reload and nothing stored.
  const namedLead = lead ? { id: lead.id, parties: party, sites: site } : null
  const leadTitle = namedLead ? leadDisplayName(namedLead) : ''

  useEffect(() => {
    if (!lead) return
    setOverride({ sub: leadTitle })
    return () => setOverride(null)
  }, [lead, leadTitle, setOverride])

  // Keyed on the stage too, so marking the lead lost on this page shows the
  // reason it was just given without a reload. loss_reasons is append-only, so
  // the newest row is the current reason.
  const leadIdForLoss = lead?.id
  const leadIsLost = lead?.current_stage === 'lost'
  useEffect(() => {
    if (!leadIdForLoss || !leadIsLost) {
      setLossReason(null)
      return
    }
    let active = true
    supabase
      .from('loss_reasons')
      .select('reason, competitor_name, lost_at')
      .eq('lead_id', leadIdForLoss)
      .order('lost_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (active) setLossReason(data?.[0] ?? null)
      })
    return () => {
      active = false
    }
  }, [leadIdForLoss, leadIsLost])

  if (goneNow) return <p className="vip-state-msg">Lead not found.</p>
  if (seed.id !== id) {
    if (detailResult?.error) return <p className="vip-state-msg-error">{errorMessage(detailResult.error)}</p>
    return <p className="vip-state-msg">Loading…</p>
  }
  if (!lead) return <p className="vip-state-msg">Lead not found.</p>

  // Exactly three people may change a lead (owner's ruling, 2026-08-13): its
  // own sales executive, that exec's sales coordinator, and the owner. Another
  // rep gets nothing — RLS already refuses their UPDATE, and this is the
  // UI-level mirror of that, so they see a clear read-only notice instead of
  // edit forms that would fail on save.
  //
  // The coordinator test is just the role, with no team check alongside it,
  // and that is not a shortcut: `leads` SELECT only ever returns a row to a
  // coordinator through coordinator_team_select, i.e. is_my_team_member(
  // owner_employee_id). If a coordinator can load this lead at all, it is by
  // definition one of their team's. Re-deriving the team here would need the
  // owner's coordinator_id, which this page doesn't fetch, to restate a fact
  // the database has already decided.
  const isOwner = employee?.role === 'owner'
  const isCoordinator = employee?.role === 'sales_coordinator'
  const isManager = employee?.role === 'sales_manager'
  const isMyLead = lead.owner_employee_id === employee?.id
  // A manager viewing one of THEIR OWN leads is simply a rep here and takes
  // the ordinary isMyLead branch below — every limit in this block applies
  // only to a team member's lead.
  const isTeamLeadForManager = isManager && !isMyLead
  // A business development manager (BDM.md Step 4) edits a lead they brought
  // in only while it waits in the pool; once the owner assigns it, it is view
  // only for them — the same line bdm_pool_update draws in RLS (an UPDATE on a
  // handed-off lead matches 0 rows). A lead they work themselves is simply
  // isMyLead. RLS only ever shows a BDM leads tagged to them or owned by them,
  // so "tagged to me" needs no further check here.
  const isBdmViewer = isBdm(employee?.role)
  const isMyPoolLead = isBdmViewer && isPoolLead(lead) && lead.bdm_employee_id === employee?.id
  const isMyHandedOffLead = isBdmViewer && !isMyLead && !isPoolLead(lead) && lead.bdm_employee_id === employee?.id
  const canEdit = isOwner || isCoordinator || isMyLead || isMyPoolLead

  // A sales manager supervises without overwriting: on a team member's lead
  // they get the quick actions (stage, follow-up, reassign) but NOT the
  // detail sections, so `canEdit` above deliberately stays false for them.
  // The database draws the same line one level down — enforce_manager_lock()
  // (Schema/migration_sales_manager.sql STEP 7) permits exactly
  // current_stage / next_followup_date / order_value / owner_employee_id on
  // a team lead and refuses every other column — so this is the UI mirror of
  // a real boundary, not the boundary itself.
  //
  // `isManager` with no team check beside it is the same shortcut the
  // coordinator test above documents, and it is sound for the same reason:
  // `leads` SELECT only ever reaches a manager through manager_team_select,
  // i.e. is_my_managed_member(owner_employee_id). A team lead they can load
  // is by definition one of their own team's.
  const canQuickAct = canEdit || isManager

  // Reassigning moves a lead between people — an oversight action. The
  // database bounds each supervisor's half: coordinator_team_update's and
  // manager_team_update's WITH CHECK both keep the new owner inside that
  // supervisor's own team. The manager's differs in one respect by design —
  // they MAY take a team lead onto their own name, because unlike a
  // coordinator they carry a quota and work deals themselves.
  const canReassign = isOwner || isCoordinator || isManager

  // A sales executive may only move a lead FORWARD; walking it back is a
  // coordinator/owner action. Enforced by the owner_only_stage_change trigger
  // (Schema/migration_lead_edit_rights.sql) — this flag just lets the picker
  // grey the chip out with a reason instead of collecting a database error.
  // A manager is deliberately NOT in this list: the owner's ruling is that
  // they are held to the same one-way funnel as their reps, on their own
  // leads as well as their team's.
  // A BDM may correct a pool lead's stage either way until it's assigned — the
  // stage trigger allows exactly that (migration_bdm_role.sql STEP 7). On a
  // lead they work themselves they're held forward-only, like a rep.
  const canMoveStageBackward = isOwner || isCoordinator || isMyPoolLead

  // Log activity is "record work I personally did". A manager logs only
  // their own work (the owner's ruling), so on a TEAM lead the link is
  // withheld — without this it would open /activity?lead=<team lead>, whose
  // preselect bypasses the picker's own owner scoping and would let a
  // manager credit themselves with an activity on someone else's deal.
  // A coordinator keeps it: entry-on-behalf is their job, and that screen
  // asks them whose it is.
  //
  // A BDM gets it only on a lead they OWN. Not on a pool lead either: an
  // activity logged there would sit on the exec's lead after assignment,
  // credited to the BDM — and their architect meetings anchor on the
  // architect, not a lead, anyway.
  const canLogActivityHere = !isOwner && !isTeamLeadForManager && (!isBdmViewer || isMyLead)

  const stage = lead.current_stage ?? 'calling'
  const isWon = stage === 'won'
  const isOnHold = stage === 'on_hold'

  // FOLLOWUPS.md Rule 8.1 — the "hold review" is the reminder that holds this
  // lead paused, and the one that drives the "resumes …" line above. A lead
  // can carry several open reminders now (Rule 3.1), so it has to be picked
  // out rather than assumed to be the only one.
  //
  // Identified as: the earliest-due OPEN follow-up created by the On Hold
  // flow. That flow is the only writer that pairs activity_type 'other' with
  // a title starting "On hold", so both are checked — the title alone would
  // match a reminder a rep happened to name that way, and activity_type
  // 'other' alone also covers Architect Meeting reminders.
  const holdReview = isOnHold
    ? leadFollowUps.find((f) => f.status === FOLLOW_UP_OPEN && f.activity_type === 'other' && f.title?.startsWith('On hold')) ?? null
    : null

  // Rule 8.4 — the reason belongs to the lead, not to a reminder. Reading the
  // column first means completing the hold reminder no longer erases the
  // record of why the lead was paused. The reminder's notes stay as a
  // fallback for leads paused before migration_followups_rebuild.sql ran.
  const holdReason = lead?.on_hold_reason ?? holdReview?.notes ?? null
  const isOpen = !['won', 'lost'].includes(stage)
  const isLost = stage === 'lost'
  const touchDays = daysBetween(lastActivityAt, Date.now())
  // hasTouch: whether there's any real "last touched" fact to report at all
  // (real bug fixed here — see daysBetween's own comment). A lead with
  // neither activity nor a created_at can't honestly be called stale OR
  // active; it renders as unknown (TONE_NEUTRAL), not as either extreme.
  const hasTouch = touchDays != null
  // Staleness is only a meaningful question for a lead that's both open and
  // not paused. A decided deal (won/lost) isn't something to chase, and a
  // held lead was deliberately taken off the clock by On Hold's own flow —
  // showing either one a red "Needs attention · 180d no touch" pill (or the
  // "Last touch" deal stat colored the same way) reads as exactly the
  // neglect warning it isn't. staleGateDays already excludes on_hold from
  // ever gating "stale" (see attention.js), but the health pill/deal-stat
  // color and copy below still need this guard directly, since they render
  // even when the gate comes back "not stale".
  const showTouchHealth = isOpen && !isOnHold
  // Every threshold below tests touchGate (floored at HISTORY_STARTS_AT) while
  // every label still prints the real touchDays. A legacy lead therefore reads
  // "Active" until its floored age crosses the line, then reports its true age
  // when it does. See attention.js.
  const touchGate = staleGateDays(lastActivityAt, lead?.created_at ?? null, lead) ?? touchDays
  // Thresholds come from attention.js so this page can't drift from the
  // Needs Attention queue. They were hardcoded 14/7 here, and the labels
  // disagreed with the rest of the app: 7 days read as "Cooling" here but was
  // what the queue itself called stale. Settled 2026-08-10 — 7 days is stale,
  // 14 is when it needs attention.
  const touchColor = !showTouchHealth || !hasTouch
    ? TONE_NEUTRAL
    : touchGate >= ATTENTION_DAYS
      ? TONE_BAD
      : touchGate >= STALE_DAYS
        ? TONE_WARN
        : TONE_GOOD
  const isAtRisk = isOpen && !isOnHold && hasTouch && touchGate >= ATTENTION_DAYS

  const statusLabel = isWon ? 'Customer' : isLost ? 'Lost' : isOnHold ? 'On hold' : isAtRisk ? 'At risk' : 'Open lead'
  const statusStyle = isWon
    ? { bg: TONE_GOOD_SOFT, fg: TONE_GOOD }
    : isLost
      ? { bg: TONE_BAD_SOFT, fg: TONE_BAD }
      : isOnHold
      ? { bg: TONE_NEUTRAL_SOFT, fg: TONE_NEUTRAL }
      : isAtRisk
        ? { bg: TONE_BAD_SOFT, fg: TONE_BAD }
        : { bg: 'var(--vip-canvas-2)', fg: 'var(--vip-body)' }
  const healthLabel = !showTouchHealth
    ? null
    : !hasTouch
    ? 'No activity on record'
    : touchGate >= ATTENTION_DAYS
      ? `Needs attention · ${touchDays}d no touch`
      : touchGate >= STALE_DAYS
        ? `Stale · ${touchDays}d`
        : `Active · ${touchDays}d ago`
  const healthStyle = !hasTouch
    ? { bg: TONE_NEUTRAL_SOFT, fg: TONE_NEUTRAL }
    : touchGate >= ATTENTION_DAYS
      ? { bg: TONE_BAD_SOFT, fg: TONE_BAD }
      : touchGate >= STALE_DAYS
        ? { bg: TONE_WARN_SOFT, fg: TONE_WARN }
        : { bg: TONE_GOOD_SOFT, fg: TONE_GOOD }

  const leadSubtitle = [
    party?.party_type,
    // Whatever site descriptor the TITLE didn't take — otherwise a lead named
    // after its address prints that address twice, once above the other.
    leadSiteLabel(namedLead),
    SOURCE_LABELS[lead.source_type] ?? lead.source_type,
    // Real bug fixed here: shortDate(null) returns null, and interpolating
    // that straight into the template literal below produced the literal
    // text "created null" (confirmed live on lead #402/"VINAY", whose
    // created_at is genuinely null in the DB). Guard first so a missing
    // created_at just drops this segment instead of printing it.
    lead.created_at ? `created ${shortDate(lead.created_at)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // Stage stepper — built off FUNNEL_STAGES (the 8 fixed funnel stages)
  // plus one more fixed slot at the very end, 'outcome': the real next step
  // after Negotiation is always either Won or Lost, so that slot is always
  // shown, not conditionally added once decided. It stays a neutral grey,
  // unlabeled column (same as any other stage still to come) until the
  // lead actually reaches one of the two — then it (and only it) takes on
  // the real color and label for whichever one happened. There are still
  // never two separate Won/Lost columns, just the one that fills in.
  // - on_hold: not a fixed slot — spliced in right after whichever funnel
  //   stage the lead actually paused at (e.g. paused after Quote
  //   submission inserts On hold between Quote submission and
  //   Negotiation), found via the most recent non-on-hold stage_history
  //   row. 'calling' has no explicit stage_history row when a lead has
  //   never been touched (DB default, not a logged "change" — same gap
  //   SalesFunnelCard already works around), so that lookup falls back to
  //   created_at/'calling'. 'outcome' still comes after it — a hold is a
  //   pause, not a replacement of the eventual won/lost step.
  const isDecidedWon = stage === 'won'
  const isDecidedLost = stage === 'lost'
  const effectiveStage = isOnHold
    ? [...stageHistory].reverse().find((h) => h.stage !== 'on_hold')?.stage ?? 'calling'
    : stage
  const displayStages = isOnHold
    ? (() => {
        const idx = FUNNEL_STAGES.indexOf(effectiveStage)
        const insertAt = idx === -1 ? FUNNEL_STAGES.length : idx + 1
        return [...FUNNEL_STAGES.slice(0, insertAt), 'on_hold', ...FUNNEL_STAGES.slice(insertAt), 'outcome']
      })()
    : [...FUNNEL_STAGES, 'outcome']
  const currentIdx = displayStages.indexOf(isOnHold ? 'on_hold' : isDecidedWon || isDecidedLost ? 'outcome' : stage)
  const stageEnteredAt = (s) => {
    const row = stageHistory.find((h) => h.stage === s)
    if (row) return row.changed_at
    return s === 'calling' ? lead.created_at : null
  }
  const stageSteps = displayStages.map((s, i) => {
    if (s === 'outcome') {
      const bar = isDecidedWon ? stageFg('won') : isDecidedLost ? stageFg('lost') : 'var(--vip-line-soft)'
      const label = isDecidedWon ? stageLabel('won') : isDecidedLost ? stageLabel('lost') : 'Won / Lost'
      const meta = isDecidedWon
        ? shortDate(stageEnteredAt('won')) ?? 'not yet'
        : isDecidedLost
          ? shortDate(stageEnteredAt('lost')) ?? 'not yet'
          : 'not yet'
      return { stage: s, label, bar, isCurrent: i === currentIdx, meta }
    }
    return {
      stage: s,
      label: stageLabel(s),
      // Reached (and current) stages show their real stage color; a stage
      // still to come stays neutral grey rather than previewing a hue it
      // hasn't earned yet.
      bar: i <= currentIdx ? stageFg(s) : 'var(--vip-line-soft)',
      isCurrent: i === currentIdx,
      meta: i <= currentIdx ? shortDate(stageEnteredAt(s)) ?? 'not yet' : 'not yet',
    }
  })
  const daysInPipeline = daysBetween(lead.created_at, Date.now())

  const dealValue = Math.max(Number(lead.order_value ?? 0), Number(lead.quote_value ?? 0))
  const probability = lead.closure_probability
  const hasProbability = probability != null
  const probColor = !hasProbability
    ? TONE_NEUTRAL
    : probability >= 60
      ? TONE_GOOD
      : probability >= 35
        ? TONE_WARN
        : TONE_BAD
  // Calendar comparison on a DATE column — see attention.js's note. A close
  // date of TODAY is not yet slipped; the old instant comparison said it was,
  // from 05:30 IST onwards.
  const closeSlipped = lead.estimated_close_date && isOpen && lead.estimated_close_date < todayISO()
  const dealStats = [
    { label: 'Deal value', value: formatCurrency(dealValue), sub: isWon ? 'booked' : 'quoted scope', color: 'var(--vip-ink)' },
    { label: 'Probability', value: hasProbability ? `${probability}%` : '—', sub: hasProbability ? (isWon ? 'closed' : 'set by owner') : 'not set', color: probColor },
    { label: 'Expected close', value: closeSlipped ? 'slipped' : shortDate(lead.estimated_close_date) ?? '—', sub: isWon ? 'order booked' : 'target date', color: closeSlipped ? TONE_BAD : 'var(--vip-ink)' },
    {
      label: 'Last touch',
      // Real bug fixed here: this used to read `${touchDays}d` unguarded —
      // on a lead with no activity and no created_at, touchDays was a fake
      // ~20687 (days since the Unix epoch, from new Date(null)). See
      // daysBetween's own comment.
      //
      // Also unguarded against isOpen/isOnHold: a decided (won/lost) or
      // paused lead isn't something to chase, so this tile no longer shows a
      // staleness-colored day count for either — same reasoning as the
      // health pill above.
      value: showTouchHealth && hasTouch ? `${touchDays}d` : '—',
      sub: showTouchHealth
        ? hasTouch
          ? `ago · by ${(lead.employees?.name ?? 'unassigned').split(' ')[0]}`
          : 'no activity on record'
        : isOnHold
          ? 'on hold'
          : 'closed',
      color: touchColor,
    },
  ]

  // Quotes & orders — at most 2 real rows from this app's actual fields
  // (quote_value/quote_sent_at, order_value), not a fabricated document
  // list. Order date is approximated from the stage_history 'won' row,
  // same proxy computeOrderValueActuals already relies on elsewhere.
  const wonAt = stageHistory.find((h) => h.stage === 'won')?.changed_at
  const quoteRows = []
  if (lead.quote_sent) {
    quoteRows.push({
      id: 'Quote',
      what: products.find((p) => p.id === lead.product_id)?.name ?? 'Quote',
      value: formatCurrency(lead.quote_value),
      date: shortDate(lead.quote_sent_at) ?? '—',
      status: isWon ? 'Superseded' : stage === 'negotiation' ? 'In negotiation' : 'Sent',
      color: isWon ? 'var(--vip-faint)' : TONE_WARN,
    })
  }
  if (lead.order_value) {
    quoteRows.push({
      id: 'Order',
      what: 'Order booked',
      value: formatCurrency(lead.order_value),
      date: shortDate(wonAt) ?? '—',
      status: 'Booked',
      color: TONE_GOOD,
    })
  }

  const product = products.find((p) => p.id === lead.product_id)

  // Mobile's collapsed-sections card (see the return below) — one summary
  // line per section, derived from data already loaded above, not a new
  // fetch. Desktop keeps the four full sections inline instead of this card.
  // One title, read by the mobile summary row and the full-screen panel's
  // header below, so they can't disagree about whether this lead has a client.
  const clientCardTitle = party?.party_type === 'client' ? 'Client details' : 'Client'
  const detailSections = [
    {
      key: 'sales',
      title: 'Sales progress',
      summary: lead.quote_sent ? `quote sent ${shortDate(lead.quote_sent_at)}` : isWon ? 'order booked' : 'not started yet',
    },
    {
      // Deliberately NOT gated on `site` — a lead with no site row is exactly
      // the case that needs reaching, to add one (see handleAddSite below).
      key: 'site',
      title: 'Site details',
      summary: site
        ? [site.locality || site.nickname, site.site_stage].filter(Boolean).join(' · ') || 'no details yet'
        : 'not linked yet',
    },
    {
      // Never gated on `party` either — hiding this row hid the only way to add
      // a client on a phone, on exactly the leads that needed it.
      key: 'client',
      title: clientCardTitle,
      summary:
        party?.party_type === 'client'
          ? party.mobile || 'no mobile on file'
          : party
            ? `no client yet · ${party.name}`
            : 'no client yet',
    },
    site && {
      key: 'contacts',
      title: 'Contacts',
      summary: siteContacts.length > 0 ? `${siteContacts.length} on site` : 'none added yet',
    },
  ].filter(Boolean)
  const SECTION_TITLES = { sales: 'Sales progress', site: 'Site details', client: clientCardTitle, contacts: 'Contacts' }

  const rail = (
    <div className="vip-stack">
      <div className="vip-card">
        <h2 className="vip-card-title">Deal owner</h2>
        {lead.owner_employee_id ? (
          // A plain block, not a link, for a viewer who can't open a Sales
          // Exec Profile (a BDM) — a link that bounces them to Today is worse
          // than no link.
          (() => {
            const ownerCard = (
              <>
                <span className="vip-profile-avatar vip-profile-avatar-sm">
                  {getInitials(lead.employees?.name)}
                </span>
                <span className="vip-owner-link-meta">
                  <span className="vip-owner-link-name">{lead.employees?.name ?? 'Unassigned'}</span>
                  <span className="vip-owner-link-loc">{lead.employees?.office_location ?? '—'}</span>
                </span>
              </>
            )
            return canOpenEmployeeProfiles(employee?.role) ? (
              <Link to={`/employees/${lead.owner_employee_id}`} className="vip-owner-link">
                {ownerCard}
              </Link>
            ) : (
              <div className="vip-owner-link">{ownerCard}</div>
            )
          })()
        ) : isPoolLead(lead) ? (
          <p className="vip-empty">Not assigned yet — waiting for the owner.</p>
        ) : (
          <p className="vip-empty">Unassigned.</p>
        )}
        {/* Every role sees who brought a BDM lead in (BDM.md §7). The BDM's
            name is plain text (a BDM has no Sales Exec Profile); the
            architect's name opens their profile, which every role may see. */}
        {lead.bdm_employee_id != null && (
          <p className="vip-form-note vip-sourced-by">
            Sourced by {lead.bdm_employee_id === employee?.id ? 'you' : lead.bdm?.name ?? 'a business development manager'}
            {sourcingArchitectParty && (
              <>
                {' via Architect '}
                <Link to={`/architects/${sourcingArchitectParty.id}`}>{sourcingArchitectParty.name}</Link>
              </>
            )}
          </p>
        )}
        {lead.created_by?.role === 'sales_coordinator' && lead.created_by_employee_id !== lead.owner_employee_id && (
          <p className="vip-form-note">Added by sales coordinator {lead.created_by.name}</p>
        )}
        {ownerHistory.length > 0 && (
          <div className="vip-rail-list-divided">
            {ownerHistory.map((h) => (
              <span key={h.id} className="vip-kv-row vip-kv-row-meta">
                {h.old ? `Reassigned from ${h.old.name}` : `Assigned to ${h.new?.name}`}
                <b>{shortDate(h.changed_at)}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="vip-card">
        <h2 className="vip-card-title">Contact</h2>
        {siteContacts.length === 0 ? (
          <p className="vip-empty">No contact captured.</p>
        ) : (
          siteContacts.map((c) => (
            <div key={c.id} className="vip-contact-row">
              <div className="vip-contact-row-head">
                <span className="vip-contact-row-name">
                  {/* An architect has a profile page every role can open. */}
                  {c.parties?.party_type === 'architect' ? (
                    <Link to={`/architects/${c.party_id}`}>{c.parties?.name}</Link>
                  ) : (
                    c.parties?.name
                  )}
                </span>
                <span className="vip-contact-row-role">{c.role}</span>
              </div>
            </div>
          ))
        )}
        {party?.mobile && (
          <a href={`tel:${party.mobile}`} className="vip-mono vip-contact-tel">
            {party.mobile}
          </a>
        )}
        <div className="vip-rail-list">
          {[
            ['Type', party?.party_type ?? '—'],
            // The facts list is the one place that should repeat the title if
            // the title was a site: it is answering "what is this lead's site",
            // so it gives both descriptors rather than the leftover one. Deduped
            // because a scanned lead's nickname is very often the address typed
            // again verbatim (lead #447 holds "#89 mahavir enclave" in both), and
            // printing it twice side by side reads as a rendering bug.
            ['Site', [...new Set([leadAddress(site), site?.nickname].filter(Boolean))].join(' · ') || '—'],
            ['Source', SOURCE_LABELS[lead.source_type] ?? lead.source_type],
            ['Created', shortDate(lead.created_at)],
            ['Follow-up', shortDate(lead.next_followup_date) ?? 'none set'],
          ].map(([label, value]) => (
            <span key={label} className="vip-kv-row">
              {label}
              <b>{value}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  )

  // Shared by both LeadQuickActions mounts (desktop inline + mobile sheet's
  // quickActionsProps below) so they can't drift apart. Refreshes the
  // on-hold reason line immediately after a stage change lands on or off
  // 'on_hold', instead of waiting for a reload.
  function handleStageChanged(updatedLead, historyRow) {
    setLead((prev) => ({ ...prev, ...updatedLead }))
    if (historyRow) setStageHistory((prev) => [...prev, historyRow])
    fetchFollowUpsForLead(updatedLead.id).then(({ data }) => setLeadFollowUps(data ?? []))
  }

  // Set follow-up creates a real follow_ups row (FollowUpForm, the same flow
  // Home's "Add reminder" uses), so this receives the follow-up, not a lead.
  //
  // The lead's own next_followup_date is DERIVED by a database trigger now
  // (FOLLOWUPS.md Rule 1.2) — the earliest due date among its open follow-ups.
  // This mirrors that rule locally rather than assuming the new reminder is
  // the soonest one: a lead can carry several at once (Rule 3.1), so blindly
  // taking the newly-saved date would make this screen disagree with the
  // database whenever an earlier reminder already existed.
  //
  // Also receives every write from the Follow-ups card (done, cancel,
  // reschedule, reopen), so it upserts rather than appends.
  function handleFollowUpSaved(followUp) {
    const next = (
      leadFollowUps.some((f) => f.id === followUp.id)
        ? leadFollowUps.map((f) => (f.id === followUp.id ? followUp : f))
        : [...leadFollowUps, followUp]
    ).sort(compareFollowUps)
    setLeadFollowUps(next)
    const earliest = next.filter((f) => f.status === FOLLOW_UP_OPEN).map((f) => f.due_date).sort()[0] ?? null
    setLead((prev) => ({ ...prev, next_followup_date: earliest }))
  }

  // ONE props object, spread into BOTH LeadQuickActions mounts (the desktop
  // inline one in mainContent below, and the mobile sheet at the end of the
  // return). They used to be built separately, which is the same shape of bug
  // that left a coordinator with no New Lead button on desktop: two renderings
  // of one control, each computing its own inputs, free to drift apart. It has
  // to be declared above mainContent — that's a const, so referencing it from
  // an earlier line would hit the temporal dead zone.
  const quickActionsProps = {
    lead,
    leadTitle,
    canReassign,
    canMoveStageBackward,
    // Permanent delete — owner only, matching the `owner_only_delete` RLS
    // policy and delete_lead_totally()'s own internal role check.
    canDeleteLead: isOwner,
    // Where an on-hold lead actually paused, so the picker ranks it there
    // rather than at the rankless 'on_hold' — otherwise a rep could walk a
    // lead backwards via a detour through On hold. Same derivation the Deal
    // progress stepper uses above.
    pausedAtStage: isOnHold ? effectiveStage : null,
    // ⚠️ TEMPORARY (2026-09-12): adds the logged-in OWNER to the reassign
    // dropdown as "<name> (me — TEST)", so the assignment push notification
    // can be tested end to end on their own phone. Returns the roster
    // untouched for every other role, and for the owner too once the flag in
    // src/lib/selfAssignTest.js is turned off — which is the entire removal.
    activeSalesExecs: withSelfAssignTestOption(activeSalesExecs, employee),
    onStageChanged: handleStageChanged,
    onFollowUpSaved: handleFollowUpSaved,
    onOwnerReassigned: (updatedLead, historyRow) => {
      setLead((prev) => ({ ...prev, ...updatedLead }))
      if (historyRow) setOwnerHistory((prev) => [...prev, historyRow])
    },
  }

  const mainContent = (
    <div className="vip-stack">
      <div className="vip-profile-band">
        <div className="vip-profile-id">
          <div className="vip-profile-avatar">{getInitials(leadTitle)}</div>
          <div className="vip-profile-id-meta">
            <div className="vip-profile-name-row">
              <h2 className="vip-profile-name">{leadTitle}</h2>
              <BdmChip bdmEmployeeId={lead.bdm_employee_id} />
              <span className="vip-pill" style={{ background: statusStyle.bg, color: statusStyle.fg }}>{statusLabel}</span>
              {healthLabel && (
                <span className="vip-pill" style={{ background: healthStyle.bg, color: healthStyle.fg }}>{healthLabel}</span>
              )}
            </div>
            {leadSubtitle && <span className="vip-profile-sub">{leadSubtitle}</span>}
          </div>
        </div>
      </div>

      {/* Desktop: unchanged inline row + always-visible quick actions. Mobile
          gets its own sticky bottom bar + a quick-actions sheet instead (see
          the bottom of this component's return) — same underlying data and
          the exact same LeadQuickActions component, just relocated. */}
      <div className="vip-only-desktop">
        <div className="vip-btn-row">
          {canLogActivityHere && (
            <Link className="vip-btn vip-btn-sm" to={`/activity?lead=${id}`}>
              Log activity
            </Link>
          )}
          {party?.mobile ? (
            <a className="vip-btn vip-btn-secondary vip-btn-sm" href={`tel:${party.mobile}`}>
              Call client
            </a>
          ) : (
            <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" disabled>
              Call client
            </button>
          )}
        </div>

        {canQuickAct && (
          <fieldset className="vip-lock" disabled={editsLocked}>
            <LeadQuickActions key={seed.version} {...quickActionsProps} />
          </fieldset>
        )}
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <h2 className="vip-card-title">Deal progress</h2>
          <span className="vip-card-note">
            {isWon
              ? `closed won · ${shortDate(wonAt) ?? ''}`
              : isOnHold
                ? `on hold · resumes ${shortDate(holdReview?.due_date) ?? 'no date set'}`
                : `stage ${currentIdx + 1} of ${displayStages.length}${daysInPipeline != null ? ` · ${daysInPipeline}d in pipeline` : ''}`}
          </span>
        </div>
        {isOnHold && holdReason && (
          <p className="vip-empty vip-flush">
            On hold — {holdReason}
          </p>
        )}
        {isLost && lossReason && (
          <p className="vip-empty vip-flush">
            Lost — {lossReasonLabel(lossReason.reason)}
            {lossReason.competitor_name ? ` (to ${lossReason.competitor_name})` : ''}
          </p>
        )}
        <div className="vip-stepper">
          {stageSteps.map((s) => (
            <div
              key={s.stage}
              className={s.isCurrent ? 'vip-stepper-col vip-stepper-col-current' : 'vip-stepper-col'}
              title={`${s.label} — ${s.meta}`}
            >
              <div className="vip-stepper-bar" style={{ background: s.bar }} />
              {s.isCurrent && (
                <>
                  <span className="vip-stepper-label">{s.label}</span>
                  <span className="vip-stepper-meta">{s.meta}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="vip-dd-stats">
          {dealStats.map((d) => (
            <div key={d.label} className="vip-dd-stat">
              <span className="vip-dd-stat-label">{d.label}</span>
              <span className="vip-dd-stat-value" style={{ color: d.color }}>{d.value}</span>
              <span className="vip-dd-stat-sub">{d.sub}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <h2 className="vip-card-title">Quotes &amp; orders</h2>
          <span className="vip-card-note">{quoteRows.length === 1 ? '1 document' : `${quoteRows.length} documents`}</span>
        </div>
        {quoteRows.length === 0 ? (
          <p className="vip-empty">No quotes or orders yet.</p>
        ) : (
          <>
            {/* Desktop: the fixed 5-column grid. Below 1024px this doesn't
                fit — 296px of fixed columns plus gaps in a ~325px phone
                track collapses the Scope column to 0 width and overlaps it
                with Value (a real bug found in the browser preview at
                390px). There are at most two rows here, so a table was
                never needed on a phone — see the stacked two-line rows
                below instead. */}
            <div className="vip-only-desktop">
              <div className="vip-linegrid-head vip-linegrid-quotes">
                <span>Ref</span>
                <span>Scope</span>
                <span>Value</span>
                <span>Date</span>
                <span className="vip-linegrid-quotes-status">Status</span>
              </div>
              {quoteRows.map((q) => (
                <div key={q.id} className="vip-linegrid-row vip-linegrid-quotes">
                  <span className="vip-mono">{q.id}</span>
                  <span className="vip-linegrid-scope">{q.what}</span>
                  <span className="vip-num vip-linegrid-value">{q.value}</span>
                  <span className="vip-linegrid-date">{q.date}</span>
                  <span className="vip-linegrid-quotes-status" style={{ fontWeight: 600, color: q.color }}>{q.status}</span>
                </div>
              ))}
            </div>

            {/* Mobile: two-line stacked row — Ref + Scope on line 1,
                Value · Date · Status on line 2. No header row; with at most
                two rows on screen the labels aren't needed to read them. */}
            <div className="vip-only-mobile">
              {quoteRows.map((q) => (
                <div key={q.id} className="vip-linegrid-mrow">
                  <div className="vip-linegrid-mrow-top">
                    <span className="vip-mono vip-linegrid-mrow-ref">{q.id}</span>
                    <span className="vip-linegrid-mrow-title">{q.what}</span>
                  </div>
                  <div className="vip-linegrid-mrow-bottom">
                    <span className="vip-num vip-linegrid-mrow-value">{q.value}</span>
                    <span className="vip-linegrid-mrow-meta">·</span>
                    <span className="vip-linegrid-mrow-meta">{q.date}</span>
                    <span className="vip-linegrid-mrow-meta">·</span>
                    <span className="vip-linegrid-mrow-status" style={{ color: q.color }}>{q.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <h2 className="vip-card-title">Products in scope</h2>
        </div>
        {!product ? (
          <p className="vip-empty">No product specified yet.</p>
        ) : (
          <div className="vip-bar-row">
            <div className="vip-product-label">{product.name}</div>
            <div className="vip-bar-track vip-thick">
              <div className="vip-bar-fill" style={{ width: '100%', background: isWon ? TONE_GOOD : lead.quote_sent ? TONE_MID : 'var(--vip-line)' }} />
            </div>
            <div className="vip-bar-value vip-bar-value-wide">{formatCurrencyCompact(dealValue)}</div>
            <div className="vip-product-status">{isWon ? 'ordered' : lead.quote_sent ? 'quoted' : 'pending'}</div>
          </div>
        )}
      </div>

      <fieldset className="vip-lock" disabled={editsLocked}>
        <LeadFollowUpsCard
          followUps={leadFollowUps}
          viewer={employee}
          canLogHere={canLogActivityHere}
          onChanged={handleFollowUpSaved}
        />
      </fieldset>

      <fieldset className="vip-lock" disabled={editsLocked}>
        <LeadRemarks leadId={id} employeeId={employee?.id} canAdd={canEdit} />
      </fieldset>

      <LeadActivityTimeline leadId={id} activities={activities} stageHistory={stageHistory} ownerHistory={ownerHistory} />
    </div>
  )

  // Mobile-only sticky bar, replacing the desktop btn-row in mainContent —
  // Log activity/Call client are available to every viewer (not gated by
  // canEdit, matching the original unconditional btn-row), the ⇄
  // quick-actions button only for canEdit (opens LeadQuickActions as a sheet).
  const mobileActionBar = (
    <div className="vip-only-mobile">
      <div className="vip-sticky-footer">
        <div className="vip-lead-actionbar">
          {canLogActivityHere && (
            <Link className="vip-btn" to={`/activity?lead=${id}`}>
              Log activity
            </Link>
          )}
          {party?.mobile ? (
            <a className="vip-btn vip-btn-secondary" href={`tel:${party.mobile}`}>
              Call client
            </a>
          ) : (
            <button type="button" className="vip-btn vip-btn-secondary" disabled>
              Call client
            </button>
          )}
          {canQuickAct && (
            <button
              type="button"
              className="vip-lead-actionbar-toggle"
              onClick={() => setQuickActionsSheetOpen(true)}
              aria-label="Quick actions"
              disabled={editsLocked}
            >
              ⇄
            </button>
          )}
        </div>
      </div>
    </div>
  )

  // A BDM's lead after the owner assigned it (owner's ruling, BDM.md Step 4):
  // view only, but WITH the rail — who has it now, "Sourced by you via
  // Architect …", the handover date — which the generic read-only page below
  // leaves out. No quick actions (canQuickAct is false) and no Log activity.
  if (isMyHandedOffLead) {
    return (
      <>
        <div className="vip-cols vip-pad-sticky-footer">
          <div className="vip-stack">
            <p className="vip-handoff-note">
              You brought this lead in — it's now with {lead.employees?.name ?? 'a sales executive'}. You can follow
              it here but not change it.
            </p>
            {mainContent}
          </div>
          <div className="vip-stack">{rail}</div>
        </div>
        {mobileActionBar}
      </>
    )
  }

  if (!canEdit) {
    return (
      <>
        <div className="vip-narrow vip-pad-sticky-footer">
          {mainContent}
          {/* Two different read-only states share this branch, and telling
              them apart matters: a plain rep looking at a colleague's lead
              really can change nothing, but a MANAGER looking at one of
              their own team's leads has just been shown a full quick-actions
              panel by mainContent. Giving them the "only they or an owner can
              make changes" line would flatly contradict the controls sitting
              directly above it. */}
          {isTeamLeadForManager ? (
            <p className="vip-empty">
              This lead belongs to {lead.employees?.name ?? 'one of your sales executives'}, who reports to you — you
              can change its stage, set follow-ups and reassign it above. Its client, site and quote details stay
              theirs to edit.
            </p>
          ) : (
            <p className="vip-empty">
              This lead belongs to {lead.employees?.name ?? 'another sales exec'} — you can view the summary above, but
              only they or an owner can make changes to it.
            </p>
          )}
        </div>
        {mobileActionBar}
      </>
    )
  }

  // The lead's RFQ standing, off the same activities already fetched for the
  // timeline — no separate query. See summariseRfqHistory for the rules.
  const rfqSummary = summariseRfqHistory(activities, lead)

  const salesProgressEditor = (
    <SalesProgressSection
      key={`sales-${seed.version}`}
      lead={lead}
      products={products}
      rfq={rfqSummary}
      onSaved={(updated) => setLead((prev) => ({ ...prev, ...updated }))}
    />
  )
  // A lead created before "every lead creates a sites row" (2026-08-17) can
  // have NO site at all, and nothing else in this app can create one after
  // intake — SiteDetailsSection/AdditionalContactsSection only ever UPDATE an
  // existing row. Without this, such a lead could never get a site stage,
  // locality, area or site contact for the rest of its life (5 leads were in
  // exactly that state when this was added; the owner hit it on lead #197).
  //
  // discovered_by is the LEAD'S OWNER, not whoever clicks: it's their site,
  // and it's also what makes the write legal for all three editing roles —
  // Postgres applies the SELECT policy to INSERT ... RETURNING, and sites'
  // team_scoped_select is wide for owner/coordinator but falls back to
  // `discovered_by = current_employee_id()` for a sales exec, who reaches
  // this only on their own lead. The row is created deliberately EMPTY —
  // nothing here guesses a stage for a site nobody has visited.
  // Point this lead at a client, which is the fix for a lead captured with no
  // client name at all (reported 2026-09-12) — before this there was no path to
  // one anywhere in the app, and there still isn't a second one.
  //
  // The client TAKES OVER leads.party_id rather than getting a column of its
  // own, because party_id already means "the most identifying person on this
  // lead": LeadQuickCapture sets it to the client if there is one, else the
  // referrer, else the other party. Promoting into it is therefore what makes
  // src/lib/leadName.js's priority resolve correctly on every screen at once,
  // with no migration and no display query embedding a second party.
  //
  // It is LOSSLESS. Whatever party_id previously fell back to was also written
  // to its own specific column at capture (other_party_id or
  // referred_by_party_id), so the outgoing party keeps its real relationship to
  // the lead. The exception is a legacy-imported lead, whose party_id was set
  // directly with no other_party_id alongside it — so an outgoing party that is
  // recorded nowhere else is parked in other_party_id, that column's documented
  // job (traceability, not reporting). Never over an occupied one: a real
  // "other" party outranks a displaced fallback.
  //
  // A displaced CLIENT is deliberately NOT parked, which is the difference
  // between the two things this one control does. Promoting a client over an
  // architect is a PROMOTION and the architect is still genuinely attached to
  // the lead; replacing one client with another is a CORRECTION, and filing the
  // wrong name away as an "other party on this lead" would leave a permanent
  // contact nobody meant to record. Caught by testing the replace path rather
  // than the add path — the add path alone looks identical either way.
  async function handleSetClient(picked) {
    // deferCreate means the picker hands back a local draft for a typed-in
    // name, so nothing was written to parties until this moment — the rep can
    // abandon the card without leaving a permanent row behind.
    const { data: client, error: createError } = await materializePartyDraft(
      picked,
      lead.owner_employee_id ?? employee?.id ?? null
    )
    if (createError) return { error: errorMessage(createError) }

    const outgoing = party
    const displaced =
      outgoing &&
      outgoing.party_type !== 'client' &&
      outgoing.id !== client.id &&
      outgoing.id !== lead.other_party_id &&
      outgoing.id !== lead.referred_by_party_id &&
      lead.other_party_id == null

    const patch = { party_id: client.id }
    if (displaced) patch.other_party_id = outgoing.id

    const { data: updated, error: linkError } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', lead.id)
      .select('id, party_id, other_party_id')
      .single()

    if (linkError) return { error: errorMessage(linkError) }

    // Merge, never replace — lead.employees is not in that select and a plain
    // replace would drop it, the same rule every other save on this page follows.
    setLead((prev) => ({ ...prev, ...updated }))
    setParty(client)
    return {}
  }

  async function handleAddSite() {
    setAddingSite(true)
    setAddSiteError(null)

    const { data: newSite, error: siteError } = await supabase
      .from('sites')
      .insert({
        discovered_by: lead.owner_employee_id ?? employee?.id ?? null,
        discovered_via: lead.source_type ?? null,
      })
      .select()
      .single()

    if (siteError) {
      setAddingSite(false)
      setAddSiteError(errorMessage(siteError))
      return
    }

    // Not wrapped in a transaction, same as LeadQuickCapture's site+lead
    // inserts — so surface the orphaned site's id rather than swallowing it.
    const { error: linkError } = await supabase
      .from('leads')
      .update({ site_id: newSite.id })
      .eq('id', lead.id)
      .select()
      .single()

    setAddingSite(false)

    if (linkError) {
      setAddSiteError(
        `Site #${newSite.id} was created but couldn't be linked to this lead: ${errorMessage(linkError)}`
      )
      return
    }

    setLead((prev) => ({ ...prev, site_id: newSite.id }))
    setSite(newSite)
  }

  const siteDetailsEditor = site ? (
    <SiteDetailsSection key={`site-${seed.version}`} site={site} areas={areas} onSaved={setSite} />
  ) : (
    <div className="vip-card">
      <h2 className="vip-card-title">Site details</h2>
      <p className="vip-empty">
        No site is linked to this lead, so there is nothing to record a site stage against yet.
      </p>
      {addSiteError && (
        <p className="vip-error" role="alert">
          {addSiteError}
        </p>
      )}
      <button
        type="button"
        className="vip-btn vip-btn-secondary vip-btn-sm"
        onClick={handleAddSite}
        disabled={addingSite}
      >
        {addingSite ? 'Adding…' : '+ Add site details'}
      </button>
    </div>
  )
  // Deliberately NOT gated on `party` — a lead with no client is exactly the
  // case that needs reaching. Keyed on the party's id so swapping the client
  // re-seeds the card's own name/mobile/city inputs, which are useState seeds.
  const clientDetailsEditor = (
    <ClientDetailsSection
      key={`client-${seed.version}-${party?.id ?? 'none'}`}
      party={party}
      canEdit={canEdit}
      onSaved={setParty}
      onSetClient={handleSetClient}
    />
  )
  const contactsEditor = site && (
    <AdditionalContactsSection
      key={`contacts-${seed.version}`}
      site={site}
      siteContacts={siteContacts}
      onContactAdded={(contact) => setSiteContacts((prev) => [...prev, contact])}
    />
  )
  // (quickActionsProps is declared once, above mainContent — both mounts
  // spread the same object. Don't rebuild it here.)

  return (
    <>
      <div className="vip-cols vip-pad-sticky-footer">
        {mainContent}
        <div className="vip-stack">
          {rail}

          {/* Desktop: the four sections stay inline, always editable, as
              before. Mobile: one card of tap-to-expand summary rows instead
              (see the full-screen editor overlay below). */}
          <div className="vip-only-desktop">
            <fieldset className="vip-lock" disabled={editsLocked}>
              {salesProgressEditor}
              {siteDetailsEditor}
              {clientDetailsEditor}
              {contactsEditor}
            </fieldset>
          </div>

          <div className="vip-card vip-only-mobile">
            <fieldset className="vip-lock" disabled={editsLocked}>
              {detailSections.map((s) => (
                <button key={s.key} type="button" className="vip-detail-row" onClick={() => setOpenSection(s.key)}>
                  <span className="vip-detail-row-title">{s.title}</span>
                  <span className="vip-detail-row-summary">{s.summary} ›</span>
                </button>
              ))}
            </fieldset>
          </div>
        </div>
      </div>

      {openSection && (
        <>
          <div className="vip-dd-backdrop" onClick={() => setOpenSection(null)} />
          <div className="vip-dd-panel" role="dialog" aria-modal="true" aria-labelledby="vip-lead-section-title">
            <div className="vip-dd-head">
              <div className="vip-dd-head-text">
                <h2 className="vip-dd-title" id="vip-lead-section-title">{SECTION_TITLES[openSection]}</h2>
              </div>
              <button type="button" className="vip-dd-close" onClick={() => setOpenSection(null)} aria-label="Close">
                ✕
              </button>
            </div>
            {openSection === 'sales' && salesProgressEditor}
            {openSection === 'site' && siteDetailsEditor}
            {openSection === 'client' && clientDetailsEditor}
            {openSection === 'contacts' && contactsEditor}
          </div>
        </>
      )}

      {mobileActionBar}

      {quickActionsSheetOpen && (
        <>
          <div className="vip-sheet-backdrop" onClick={() => setQuickActionsSheetOpen(false)} />
          <div className="vip-sheet" role="dialog" aria-modal="true" aria-label="Quick actions">
            <div className="vip-sheet-handle" />
            <LeadQuickActions key={seed.version} {...quickActionsProps} />
          </div>
        </>
      )}
    </>
  )
}

export default LeadDetail
