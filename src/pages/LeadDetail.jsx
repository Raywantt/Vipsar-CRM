import { useEffect, useState } from 'react'
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
import { fetchActiveSalesExecs } from '../lib/employeeQueries'
import { fetchLeadOwnerHistory } from '../lib/leadOwnerHistory'
import { fetchLatestFollowUpForLead } from '../lib/followUpQueries'
import { errorMessage } from '../lib/errorMessage'
import { LEAD_STAGE_OPTIONS, stageLabel } from '../lib/leadStageOptions'
import { stageFg, TONE_GOOD, TONE_WARN, TONE_BAD, TONE_MID, TONE_GOOD_SOFT, TONE_WARN_SOFT, TONE_BAD_SOFT, TONE_NEUTRAL, TONE_NEUTRAL_SOFT } from '../lib/statusColors'
import { getInitials } from '../lib/initials'
import { STALE_DAYS, ATTENTION_DAYS } from '../lib/attention'
import { formatCurrency, formatCurrencyCompact } from '../lib/format'
import { todayISO } from '../lib/followupDates'
import { SOURCE_TYPE_LABELS as SOURCE_LABELS } from '../lib/sourceTypeOptions'
import { attachFirms, linkPartiesAsSiteContacts } from '../lib/partyQueries'

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

const EMPTY = { data: null, error: null }

function shortDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function daysBetween(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

function LeadDetail() {
  const { id } = useParams()
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()

  const [lead, setLead] = useState(null)
  const [party, setParty] = useState(null)
  // The "other" party and the referrer are read during load only, to link them
  // as site contacts (see the loader below) — nothing renders them directly
  // any more, so they're locals in the effect rather than state.
  const [site, setSite] = useState(null)
  const [siteContacts, setSiteContacts] = useState([])
  const [stageHistory, setStageHistory] = useState([])
  const [activities, setActivities] = useState([])
  const [ownerHistory, setOwnerHistory] = useState([])
  const [onHoldFollowUp, setOnHoldFollowUp] = useState(null)
  const [activeSalesExecs, setActiveSalesExecs] = useState([])
  const [areas, setAreas] = useState([])
  const [products, setProducts] = useState([])
  const [lastActivityAt, setLastActivityAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  // Mobile-only: which collapsed section (if any) is pushed open as a
  // full-screen editor, and whether the sticky action bar's ⇄ button has
  // opened LeadQuickActions as a sheet. Both unused at ≥1024px, where the
  // desktop rail/inline quick actions render unconditionally instead.
  const [openSection, setOpenSection] = useState(null)
  const [quickActionsSheetOpen, setQuickActionsSheetOpen] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: leadRow, error: leadError } = await supabase
        .from('leads')
        // created_by is aliased separately from the owner embed above — a
        // lead created by a sales_coordinator on an exec's behalf has
        // created_by_employee_id != owner_employee_id (see
        // migration_lead_change_log.sql's stamp_lead_creator trigger, which
        // always stamps the real actor). Used by the Deal owner card's
        // "Added by coordinator" note below.
        .select('*, employees!owner_employee_id(name, office_location), created_by:employees!created_by_employee_id(name, role)')
        .eq('id', id)
        .single()

      if (!active) return

      if (leadError) {
        setLoadError(errorMessage(leadError))
        setLoading(false)
        return
      }

      const [
        partyResult,
        otherPartyResult,
        referrerPartyResult,
        siteResult,
        contactsResult,
        stageHistoryResult,
        activitiesResult,
        ownerHistoryResult,
        activeExecsResult,
        areasResult,
        productsResult,
        onHoldFollowUpResult,
      ] = await Promise.all([
        leadRow.party_id
          ? supabase.from('parties').select('*').eq('id', leadRow.party_id).single()
          : Promise.resolve(EMPTY),
        leadRow.other_party_id
          ? supabase.from('parties').select('*').eq('id', leadRow.other_party_id).single()
          : Promise.resolve(EMPTY),
        // The referrer (New Lead's "Referral from", general or architect) is
        // just as much a party captured at intake as other_party_id — it was
        // invisible to Contacts entirely before this, since only otherParty
        // fed the "mentioned during intake" suggestion below.
        leadRow.referred_by_party_id
          ? supabase.from('parties').select('*').eq('id', leadRow.referred_by_party_id).single()
          : Promise.resolve(EMPTY),
        leadRow.site_id
          ? supabase.from('sites').select('*').eq('id', leadRow.site_id).single()
          : Promise.resolve(EMPTY),
        leadRow.site_id
          ? supabase
              .from('site_contacts')
              .select('id, role, party_id, parties(name, party_type)')
              .eq('site_id', leadRow.site_id)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('stage_history')
          .select('id, stage, changed_at, changed_by, employees(name)')
          .eq('lead_id', leadRow.id)
          .order('changed_at', { ascending: true }),
        supabase
          .from('activities')
          .select(
            'id, activity_type, notes, created_at, employee_id, employees!employee_id(name), accompanied_by_employee:employees!accompanied_by(name), logged_by_employee_id, logged_by:employees!logged_by_employee_id(name, role)'
          )
          .eq('lead_id', leadRow.id)
          .order('created_at', { ascending: false }),
        fetchLeadOwnerHistory(leadRow.id),
        fetchActiveSalesExecs(),
        supabase.from('areas').select('id, area_name, city').order('area_name'),
        supabase.from('products').select('id, name, category').order('name'),
        leadRow.current_stage === 'on_hold' ? fetchLatestFollowUpForLead(leadRow.id) : Promise.resolve(EMPTY),
      ])

      if (!active) return

      setLead(leadRow)
      setParty(partyResult.data ?? null)
      // .firm is resolved separately, not embedded — see attachFirms. The
      // Contacts card reads it to pre-fill an architect's existing firm.
      const resolvedOtherParty = otherPartyResult.data ? (await attachFirms([otherPartyResult.data]))[0] : null
      const resolvedReferrerParty = referrerPartyResult.data
        ? (await attachFirms([referrerPartyResult.data]))[0]
        : null
      setSite(siteResult.data ?? null)

      // Leads captured before intake started linking these itself (see
      // LeadQuickCapture) still have an "other" party or referrer that never
      // reached site_contacts. Heal them on sight rather than asking the rep
      // to re-classify someone they already described at intake — that prompt
      // is exactly what this change removes. linkPartiesAsSiteContacts skips
      // anyone already linked, so this is a no-op on every subsequent visit
      // and on leads captured after the change.
      //
      // Gated on being able to edit the lead: a rep viewing a colleague's lead
      // is a reader, and site_contacts INSERT would otherwise let a read-only
      // page write. A failure here is left silent on purpose — nothing the
      // reader did caused it, and the contacts simply stay unlinked until
      // someone who can edit opens the lead.
      const existingContacts = contactsResult.data ?? []
      const viewerCanEdit =
        employee?.role === 'owner' ||
        employee?.role === 'sales_coordinator' ||
        leadRow.owner_employee_id === employee?.id
      const unlinked = [resolvedOtherParty, resolvedReferrerParty].filter(
        (p) => p && !existingContacts.some((c) => c.party_id === p.id)
      )

      if (leadRow.site_id && viewerCanEdit && unlinked.length > 0) {
        const { data: healed } = await linkPartiesAsSiteContacts({
          siteId: leadRow.site_id,
          parties: unlinked,
          alreadyLinkedPartyIds: new Set(existingContacts.map((c) => c.party_id)),
        })
        if (!active) return
        setSiteContacts([...existingContacts, ...(healed ?? [])])
      } else {
        setSiteContacts(existingContacts)
      }
      setStageHistory(stageHistoryResult.data ?? [])
      setActivities(activitiesResult.data ?? [])
      setOwnerHistory(ownerHistoryResult.data ?? [])
      setActiveSalesExecs(activeExecsResult.data ?? [])
      setAreas(areasResult.data ?? [])
      setProducts(productsResult.data ?? [])
      setOnHoldFollowUp(onHoldFollowUpResult.data ?? null)
      const mostRecent = [...(stageHistoryResult.data ?? []).map((h) => h.changed_at), ...(activitiesResult.data ?? []).map((a) => a.created_at)].sort().pop()
      setLastActivityAt(mostRecent ?? leadRow.created_at)
      setLoading(false)
    }

    load()

    return () => {
      active = false
    }
    // employee.id/role are read by the contact-healing branch above, to decide
    // whether this viewer may write. Both are stable for a session, so listing
    // them doesn't cause a refetch in practice.
  }, [id, employee?.id, employee?.role])

  const leadTitle = party?.name ?? site?.nickname ?? site?.locality ?? (lead ? `Lead #${lead.id}` : '')

  useEffect(() => {
    if (!lead) return
    setOverride({ sub: leadTitle })
    return () => setOverride(null)
  }, [lead, leadTitle, setOverride])

  if (loading) return <p className="vip-state-msg">Loading…</p>
  if (loadError) return <p className="vip-state-msg-error">{loadError}</p>
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
  const canEdit = isOwner || isCoordinator || lead.owner_employee_id === employee?.id

  // Reassigning moves a lead between people — owner and coordinator only. The
  // database agrees: coordinator_team_update's WITH CHECK keeps the new owner
  // inside the coordinator's own team and, since is_my_team_member() is false
  // for their own id, stops them assigning a lead to themselves.
  const canReassign = isOwner || isCoordinator

  // A sales executive may only move a lead FORWARD; walking it back is a
  // coordinator/owner action. Enforced by the owner_only_stage_change trigger
  // (Schema/migration_lead_edit_rights.sql) — this flag just lets the picker
  // grey the chip out with a reason instead of collecting a database error.
  const canMoveStageBackward = isOwner || isCoordinator

  const stage = lead.current_stage ?? 'calling'
  const isWon = stage === 'won'
  const isOnHold = stage === 'on_hold'
  const isOpen = !['won', 'lost'].includes(stage)
  const touchDays = daysBetween(lastActivityAt, Date.now())
  // Thresholds come from attention.js so this page can't drift from the
  // Needs Attention queue. They were hardcoded 14/7 here, and the labels
  // disagreed with the rest of the app: 7 days read as "Cooling" here but was
  // what the queue itself called stale. Settled 2026-08-10 — 7 days is stale,
  // 14 is when it needs attention.
  const touchColor = touchDays >= ATTENTION_DAYS ? TONE_BAD : touchDays >= STALE_DAYS ? TONE_WARN : TONE_GOOD
  const isAtRisk = isOpen && !isOnHold && touchDays >= ATTENTION_DAYS

  const statusLabel = isWon ? 'Customer' : isOnHold ? 'On hold' : isAtRisk ? 'At risk' : 'Open lead'
  const statusStyle = isWon
    ? { bg: TONE_GOOD_SOFT, fg: TONE_GOOD }
    : isOnHold
      ? { bg: TONE_NEUTRAL_SOFT, fg: TONE_NEUTRAL }
      : isAtRisk
        ? { bg: TONE_BAD_SOFT, fg: TONE_BAD }
        : { bg: 'var(--vip-canvas-2)', fg: 'var(--vip-body)' }
  const healthLabel =
    touchDays >= ATTENTION_DAYS
      ? `Needs attention · ${touchDays}d no touch`
      : touchDays >= STALE_DAYS
        ? `Stale · ${touchDays}d`
        : `Active · ${touchDays}d ago`
  const healthStyle =
    touchDays >= ATTENTION_DAYS
      ? { bg: TONE_BAD_SOFT, fg: TONE_BAD }
      : touchDays >= STALE_DAYS
        ? { bg: TONE_WARN_SOFT, fg: TONE_WARN }
        : { bg: TONE_GOOD_SOFT, fg: TONE_GOOD }

  const leadSubtitle = [
    party?.party_type,
    [site?.nickname || site?.locality, site?.house_no].filter(Boolean).join(', ') || null,
    SOURCE_LABELS[lead.source_type] ?? lead.source_type,
    `created ${shortDate(lead.created_at)}`,
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
    { label: 'Last touch', value: `${touchDays}d`, sub: `ago · by ${(lead.employees?.name ?? 'unassigned').split(' ')[0]}`, color: touchColor },
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
  const detailSections = [
    {
      key: 'sales',
      title: 'Sales progress',
      summary: lead.quote_sent ? `quote sent ${shortDate(lead.quote_sent_at)}` : isWon ? 'order booked' : 'not started yet',
    },
    site && {
      key: 'site',
      title: 'Site details',
      summary: [site.locality || site.nickname, site.site_stage].filter(Boolean).join(' · ') || 'no details yet',
    },
    party && { key: 'client', title: 'Client details', summary: party.mobile || 'no mobile on file' },
    site && {
      key: 'contacts',
      title: 'Contacts',
      summary: siteContacts.length > 0 ? `${siteContacts.length} on site` : 'none added yet',
    },
  ].filter(Boolean)
  const SECTION_TITLES = { sales: 'Sales progress', site: 'Site details', client: 'Client details', contacts: 'Contacts' }

  const rail = (
    <div className="vip-stack">
      <div className="vip-card">
        <div className="vip-card-title">Deal owner</div>
        {lead.owner_employee_id ? (
          <Link to={`/employees/${lead.owner_employee_id}`} className="vip-owner-link">
            <span className="vip-profile-avatar vip-profile-avatar-sm">
              {getInitials(lead.employees?.name)}
            </span>
            <span className="vip-owner-link-meta">
              <span className="vip-owner-link-name">{lead.employees?.name ?? 'Unassigned'}</span>
              <span className="vip-owner-link-loc">{lead.employees?.office_location ?? '—'}</span>
            </span>
          </Link>
        ) : (
          <p className="vip-empty">Unassigned.</p>
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
        <div className="vip-card-title">Contact</div>
        {siteContacts.length === 0 ? (
          <p className="vip-empty">No contact captured.</p>
        ) : (
          siteContacts.map((c) => (
            <div key={c.id} className="vip-contact-row">
              <div className="vip-contact-row-head">
                <span className="vip-contact-row-name">{c.parties?.name}</span>
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
            ['Site', site?.nickname || site?.locality || '—'],
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
    if (updatedLead.current_stage === 'on_hold') {
      fetchLatestFollowUpForLead(updatedLead.id).then(({ data }) => setOnHoldFollowUp(data ?? null))
    } else {
      setOnHoldFollowUp(null)
    }
  }

  // Set follow-up now creates a real follow_ups row (FollowUpForm, the same
  // flow Home's "Add reminder" uses) rather than only stamping the lead's own
  // next_followup_date — so this receives the follow-up row, not a lead row.
  // FollowUpForm has already written next_followup_date on the lead itself;
  // mirroring it into local state here keeps the Deal-progress "resumes"
  // line and the deal stats in step without a refetch.
  function handleFollowUpSaved(followUp) {
    setLead((prev) => ({ ...prev, next_followup_date: followUp.due_date }))
    if (lead?.current_stage === 'on_hold') setOnHoldFollowUp(followUp)
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
    // Where an on-hold lead actually paused, so the picker ranks it there
    // rather than at the rankless 'on_hold' — otherwise a rep could walk a
    // lead backwards via a detour through On hold. Same derivation the Deal
    // progress stepper uses above.
    pausedAtStage: isOnHold ? effectiveStage : null,
    activeSalesExecs,
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
              <span className="vip-profile-name">{leadTitle}</span>
              <span className="vip-pill" style={{ background: statusStyle.bg, color: statusStyle.fg }}>{statusLabel}</span>
              <span className="vip-pill" style={{ background: healthStyle.bg, color: healthStyle.fg }}>{healthLabel}</span>
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
          {employee?.role !== 'owner' && (
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

        {canEdit && (
          <LeadQuickActions
            {...quickActionsProps}
          />
        )}
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <div className="vip-card-title">Deal progress</div>
          <span className="vip-card-note">
            {isWon
              ? `closed won · ${shortDate(wonAt) ?? ''}`
              : isOnHold
                ? `on hold · resumes ${shortDate(lead.next_followup_date) ?? 'no date set'}`
                : `stage ${currentIdx + 1} of ${displayStages.length} · ${daysInPipeline}d in pipeline`}
          </span>
        </div>
        {isOnHold && onHoldFollowUp?.notes && (
          <p className="vip-empty vip-flush">
            On hold — {onHoldFollowUp.notes}
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
          <div className="vip-card-title">Quotes &amp; orders</div>
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
          <div className="vip-card-title">Products in scope</div>
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

      <LeadActivityTimeline activities={activities} stageHistory={stageHistory} ownerHistory={ownerHistory} />
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
          {employee?.role !== 'owner' && (
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
          {canEdit && (
            <button
              type="button"
              className="vip-lead-actionbar-toggle"
              onClick={() => setQuickActionsSheetOpen(true)}
              aria-label="Quick actions"
            >
              ⇄
            </button>
          )}
        </div>
      </div>
    </div>
  )

  if (!canEdit) {
    return (
      <>
        <div className="vip-narrow vip-pad-sticky-footer">
          {mainContent}
          <p className="vip-empty">
            This lead belongs to {lead.employees?.name ?? 'another sales exec'} — you can view the summary above, but
            only they or an owner can make changes to it.
          </p>
        </div>
        {mobileActionBar}
      </>
    )
  }

  const salesProgressEditor = (
    <SalesProgressSection
      lead={lead}
      products={products}
      onSaved={(updated) => setLead((prev) => ({ ...prev, ...updated }))}
    />
  )
  const siteDetailsEditor = site && <SiteDetailsSection site={site} areas={areas} onSaved={setSite} />
  const clientDetailsEditor = party && <ClientDetailsSection party={party} onSaved={setParty} />
  const contactsEditor = site && (
    <AdditionalContactsSection
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
            {salesProgressEditor}
            {siteDetailsEditor}
            {clientDetailsEditor}
            {contactsEditor}
          </div>

          <div className="vip-card vip-only-mobile">
            {detailSections.map((s) => (
              <button key={s.key} type="button" className="vip-detail-row" onClick={() => setOpenSection(s.key)}>
                <span className="vip-detail-row-title">{s.title}</span>
                <span className="vip-detail-row-summary">{s.summary} ›</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {openSection && (
        <>
          <div className="vip-dd-backdrop" onClick={() => setOpenSection(null)} />
          <div className="vip-dd-panel">
            <div className="vip-dd-head">
              <div className="vip-dd-head-text">
                <div className="vip-dd-title">{SECTION_TITLES[openSection]}</div>
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
          <div className="vip-sheet">
            <div className="vip-sheet-handle" />
            <LeadQuickActions {...quickActionsProps} />
          </div>
        </>
      )}
    </>
  )
}

export default LeadDetail
