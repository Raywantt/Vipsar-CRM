import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import LeadSearchSelect from '../components/LeadSearchSelect'
import PartySearchOrCreate from '../components/PartySearchOrCreate'
import NumPadInput from '../components/NumPadInput'
import { ACTIVITY_TYPES, ACTIVITY_LABELS } from '../lib/activityTypes'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { MEETING_LOCATION_OPTIONS, meetingLocationLabel } from '../lib/meetingLocationOptions'
import { formatTimeRange } from '../lib/format'
import { todayISO } from '../lib/followupDates'
import { createFollowUp } from '../lib/followUpQueries'
import { fetchMyTeamExecs } from '../lib/employeeQueries'
import { materializePartyDraft, setPartyFirm } from '../lib/partyQueries'
import { errorMessage } from '../lib/errorMessage'

function leadLabel(lead) {
  const place = lead.sites?.nickname || lead.sites?.locality
  return lead.parties?.name ?? place ?? `Lead #${lead.id}`
}

function ActivityLog() {
  const { employee } = useAuth()
  const isCoordinator = employee?.role === 'sales_coordinator'
  const [searchParams] = useSearchParams()
  const preselectedLeadId = searchParams.get('lead')

  // A coordinator owns no leads/activities of their own — this picks who the
  // activity is actually for, and that exec's id is what activities.employee_id
  // gets set to (never the coordinator's). Not reset by resetForm/"Log another
  // activity", same reasoning as LeadQuickCapture's forExec: a coordinator
  // logging several activities in a row is almost always doing it for the
  // same exec who just called in.
  const [teamExecs, setTeamExecs] = useState([])
  const [teamExecsLoaded, setTeamExecsLoaded] = useState(!isCoordinator)
  const [forExec, setForExec] = useState(null)

  const [activityType, setActivityType] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  // "Log activity" links from Lead Detail carry ?lead=<id> so the rep lands
  // with their lead already picked instead of having to find it again in
  // LeadSearchSelect — changingLead lets them back out of that preselection
  // into the normal search picker if they need a different lead.
  // preselectedLead is kept separately (immutable once fetched) so "Log
  // another activity" can restore it rather than clearing back to nothing.
  const [changingLead, setChangingLead] = useState(false)
  const [preselectedLead, setPreselectedLead] = useState(null)
  // Architect Meeting's own anchor — an architect party rather than a lead,
  // since the meeting itself is the point, not a specific deal. The party can
  // be an individual architect or an 'firm' ("architect firm") — a meeting is
  // just as often with the practice as with one person.
  const [selectedArchitect, setSelectedArchitect] = useState(null)
  // Which firm that individual architect works under — a real 'firm' party,
  // not a typed name, so architect→firm is a link the app can walk both ways.
  // Only meaningful when the party is a person; a 'firm' party already IS the
  // firm, so recording it again would just be the name twice.
  const [firmParty, setFirmParty] = useState(null)
  const [notes, setNotes] = useState('')
  const [accompaniedBy, setAccompaniedBy] = useState('')
  // Office Day's three fields, all required (see canSubmit below). The
  // summary is deliberately separate from `notes` — that screen asks both
  // questions, so folding them into one column would silently merge two
  // things the rep filled in separately. These replaced the old "Leads
  // generated" input (2026-08-18); activities.leads_generated itself stays,
  // holding the entries logged while that field existed.
  const [workSummary, setWorkSummary] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  // Client Meeting only — 'site' | 'office', required. Closed list, real
  // CHECK; see src/lib/meetingLocationOptions.js.
  const [meetingLocation, setMeetingLocation] = useState('')
  const [orderValue, setOrderValue] = useState('')
  const [nextFollowupDate, setNextFollowupDate] = useState('')
  // Rule 4.6 — the optional note that turns a bare date into a reminder that
  // actually says what to do. Its absence on every other reminder surface is
  // why notes were unreadable app-wide (FOLLOWUPS.md §6.5).
  const [followupNote, setFollowupNote] = useState('')
  // Site Visit's "change site stage" field — same preset+other shape
  // SiteDetailsSection already uses, synced to whichever lead/site is
  // currently selected by the effect below.
  const [siteStage, setSiteStage] = useState('')
  const [customStage, setCustomStage] = useState('')

  const [employees, setEmployees] = useState([])

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    supabase
      .from('employees')
      .select('id, name')
      .order('name')
      .then(({ data }) => setEmployees(data ?? []))
  }, [])

  useEffect(() => {
    if (!isCoordinator) return
    let active = true
    fetchMyTeamExecs(employee?.id).then(({ data }) => {
      if (!active) return
      setTeamExecs(data ?? [])
      setTeamExecsLoaded(true)
    })
    return () => {
      active = false
    }
  }, [isCoordinator, employee?.id])

  useEffect(() => {
    if (!preselectedLeadId) return
    let active = true
    supabase
      .from('leads')
      // owner_employee_id + the embed are only used for the coordinator case
      // below — auto-filling "Who is this for?" from the lead that was
      // already picked on Lead Detail, rather than making the coordinator
      // re-identify an exec they've already implicitly selected by opening
      // this specific lead's activity log.
      .select(
        'id, current_stage, source_type, owner_employee_id, parties!party_id(name), sites(id, nickname, locality, site_stage), employees!owner_employee_id(id, name)'
      )
      .eq('id', preselectedLeadId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        if (data) {
          setPreselectedLead(data)
          setSelectedLead(data)
          if (isCoordinator && data.employees) {
            setForExec({ id: data.employees.id, name: data.employees.name })
          }
        }
      })
    return () => {
      active = false
    }
  }, [preselectedLeadId, isCoordinator])

  // Keeps the Site stage field in sync with whichever lead is currently
  // selected (search pick, preselected-from-Lead-Detail, or reset back to
  // none) — same derivation SiteDetailsSection uses for its own initial value.
  useEffect(() => {
    const stage = selectedLead?.sites?.site_stage
    if (stage && SITE_STAGE_OPTIONS.includes(stage)) {
      setSiteStage(stage)
      setCustomStage('')
    } else if (stage) {
      setSiteStage('other')
      setCustomStage(stage)
    } else {
      setSiteStage('')
      setCustomStage('')
    }
  }, [selectedLead])

  // The firm belongs to the architect, not to this activity — so it follows
  // whoever is selected, pre-filled from their stored link. This is the
  // "type a known architect and their firm comes up on its own" behaviour;
  // the Firm picker below is keyed on the architect's id so it re-seeds.
  // Keyed on the id so re-picking the same architect doesn't wipe an edit in
  // progress.
  useEffect(() => {
    setFirmParty(selectedArchitect?.firm ?? null)
  }, [selectedArchitect?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const isOfficeDay = activityType === 'office_day'
  const isSiteVisit = activityType === 'site_visit'
  const isArchitectMeeting = activityType === 'architect_meeting'
  const isClientMeeting = activityType === 'client_meeting'
  // The Firm box is for an individual architect only — see firmName's own
  // comment. Reading party_type off the selected party (rather than tracking
  // the picker's dropdown) means this is right for an existing party too, not
  // just one created here.
  const showFirmField = isArchitectMeeting && selectedArchitect?.party_type === 'architect'
  // Every lead-anchored activity requires a Lead — Party as a fallback
  // anchor was removed (2026-08-09) so Next follow-up/Order value/Site
  // stage, which all write onto a lead, are never silently hidden behind a
  // party-only pick. Architect Meeting is its own separate case — it's
  // anchored on an architect party instead of a lead entirely, so it's
  // excluded from this lead-picker block the same way Office Day is.
  const needsAnchor = activityType && !isOfficeDay && !isArchitectMeeting
  const anchorSatisfied = isOfficeDay || (isArchitectMeeting ? Boolean(selectedArchitect) : Boolean(selectedLead))
  // Office Day wants all three of its fields, Client Meeting its location.
  // Both are UI-level gates only: the columns are nullable, because every
  // entry logged before these fields existed has no honest value to carry.
  // A Till at or before the From is a typo, not a night shift — an office day
  // sits inside one working day. Compared as plain strings: <input type="time">
  // always yields a zero-padded "HH:MM", so lexical order is clock order and
  // there is no Date (and no timezone) to get wrong. Deliberately NOT a DB
  // CHECK — a constraint violation would surface as an opaque Postgres error
  // on a form the rep can't argue with; this says what's wrong, in place.
  const timeRangeInvalid = isOfficeDay && Boolean(startTime && endTime) && endTime <= startTime
  const officeDaySatisfied =
    !isOfficeDay || Boolean(workSummary.trim() && startTime && endTime && !timeRangeInvalid)
  const meetingLocationSatisfied = !isClientMeeting || Boolean(meetingLocation)
  const canSubmit =
    Boolean(activityType) &&
    anchorSatisfied &&
    officeDaySatisfied &&
    meetingLocationSatisfied &&
    (!isCoordinator || Boolean(forExec)) &&
    !submitting
  const leadPreselectedAndLocked =
    Boolean(preselectedLeadId) && selectedLead && String(selectedLead.id) === preselectedLeadId && !changingLead
  // Whose activity this really is — the picked exec for a coordinator
  // entering it on their behalf, otherwise the logged-in employee. Drives
  // activities.employee_id, the lead search scope, and party attribution.
  const actingForId = isCoordinator ? forExec?.id ?? null : employee?.id ?? null

  function selectActivityType(value) {
    setActivityType(value)
    if (value !== 'site_visit') {
      setAccompaniedBy('')
    }
    // Leaving Architect Meeting drops its anchor and firm, so a party picked
    // and then abandoned can't be written by an activity whose form never
    // showed those fields — same reasoning as LeadQuickCapture's selectSource.
    if (value !== 'architect_meeting') {
      setSelectedArchitect(null)
      setFirmParty(null)
    }
    // Same reasoning for the two type-specific groups below — a required
    // field filled and then abandoned by switching type must not be written
    // by an activity whose form never showed it.
    if (value !== 'office_day') {
      setWorkSummary('')
      setStartTime('')
      setEndTime('')
    }
    if (value !== 'client_meeting') {
      setMeetingLocation('')
    }
    // The same rule, finally applied to the follow-up fields and the lead.
    // It wasn't, and that was a real reachable bug: a date typed under Site
    // Visit survived a switch to Office Day or Architect Meeting — both of
    // which hide the lead picker AND the date field — and was then written
    // against a lead the form was no longer showing. Arriving from Lead
    // Detail's "Log activity" link (?lead=) made it reachable with zero
    // switching, since the lead is preselected on mount.
    //
    // `needsAnchor` is recomputed from `value`, not read from the render-scope
    // constant, which still holds the OUTGOING type at this point.
    const nextNeedsAnchor = value && value !== 'office_day' && value !== 'architect_meeting'
    if (!nextNeedsAnchor) {
      setSelectedLead(null)
      setChangingLead(false)
    } else if (preselectedLead) {
      // Coming back to a lead-anchored type restores the lead this screen was
      // opened with, rather than making a rep who arrived from Lead Detail
      // find it again — same reasoning resetForm already uses.
      setSelectedLead(preselectedLead)
    }
    setNextFollowupDate('')
    setFollowupNote('')
  }

  function resetForm() {
    setActivityType(null)
    setSelectedLead(preselectedLead)
    setSelectedArchitect(null)
    setFirmParty(null)
    setChangingLead(false)
    setNotes('')
    setAccompaniedBy('')
    setWorkSummary('')
    setStartTime('')
    setEndTime('')
    setMeetingLocation('')
    setOrderValue('')
    setNextFollowupDate('')
    setFollowupNote('')
    setSubmitError(null)
    setResult(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError(null)
    setSubmitting(true)

    // The architect (and, if picked, their firm) may still be an unsaved
    // draft from PartySearchOrCreate's deferCreate mode — materialized here,
    // right before the activity that references it, so backing out of this
    // form before Log it never leaves a real, permanent party behind.
    const architectResult = isArchitectMeeting
      ? await materializePartyDraft(selectedArchitect, actingForId)
      : { data: null }
    if (architectResult.error) {
      setSubmitError(`Couldn't save the architect: ${errorMessage(architectResult.error)}`)
      setSubmitting(false)
      return
    }
    const resolvedArchitect = architectResult.data

    const firmResult = showFirmField
      ? await materializePartyDraft(firmParty, actingForId)
      : { data: firmParty }
    if (firmResult.error) {
      setSubmitError(`Couldn't save the firm: ${errorMessage(firmResult.error)}`)
      setSubmitting(false)
      return
    }
    const resolvedFirmParty = firmResult.data

    const { data: activity, error: activityError } = await supabase
      .from('activities')
      .insert({
        employee_id: actingForId,
        lead_id: selectedLead?.id ?? null,
        party_id: isArchitectMeeting ? resolvedArchitect?.id ?? null : null,
        activity_type: activityType,
        accompanied_by: accompaniedBy || null,
        notes: notes.trim() || null,
        // Each guarded by its own type as well as cleared in
        // selectActivityType — belt-and-braces, matching how leads_generated
        // was guarded before it was retired from this form.
        work_summary: isOfficeDay ? workSummary.trim() || null : null,
        start_time: isOfficeDay ? startTime || null : null,
        end_time: isOfficeDay ? endTime || null : null,
        meeting_location: isClientMeeting ? meetingLocation || null : null,
      })
      .select()
      .single()

    if (activityError) {
      setSubmitError(`Couldn't log the activity: ${errorMessage(activityError)}`)
      setSubmitting(false)
      return
    }

    const warnings = []

    if (selectedLead) {
      const leadUpdates = {}

      if (activityType === 'rfq_raised') {
        leadUpdates.rfq_raised = true
        leadUpdates.rfq_raised_at = todayISO()
      }
      if (activityType === 'booking_update' && orderValue !== '') {
        leadUpdates.order_value = Number(orderValue)
      }
      // next_followup_date is NOT written here anymore. It used to be — a bare
      // date stamp with no title, no notes, no push and no row in follow_ups,
      // which made it invisible in every reminder list while still rendering
      // on Lead Detail as though a follow-up were scheduled. This was the
      // single biggest source of the measured 78% orphan rate (21 of 27 leads
      // showing a follow-up date had no reminder behind them).
      //
      // The field now creates a REAL follow-up below (FOLLOWUPS.md Rule 4.6),
      // and the lead's own column is derived from it by a database trigger
      // (Rule 1.2). Writing it by hand here would recreate the orphan.

      if (Object.keys(leadUpdates).length > 0) {
        const { error: leadUpdateError } = await supabase
          .from('leads')
          .update(leadUpdates)
          .eq('id', selectedLead.id)

        if (leadUpdateError) {
          warnings.push(`Activity logged, but updating the lead failed: ${errorMessage(leadUpdateError)}`)
        }
      }

      if (isSiteVisit && selectedLead.sites?.id) {
        const resolvedSiteStage = siteStage === 'other' ? customStage.trim() || null : siteStage || null
        if (resolvedSiteStage !== (selectedLead.sites.site_stage ?? null)) {
          const { error: siteUpdateError } = await supabase
            .from('sites')
            .update({ site_stage: resolvedSiteStage })
            .eq('id', selectedLead.sites.id)

          if (siteUpdateError) {
            warnings.push(`Activity logged, but updating the site stage failed: ${errorMessage(siteUpdateError)}`)
          }
        }
      }
    }

    // The firm is a property of the architect, not of this meeting, so the
    // link is written onto their party row. setPartyFirm owns the no-op and
    // silent-RLS-rejection handling — see src/lib/partyQueries.js.
    if (showFirmField && resolvedArchitect) {
      const firmWarning = await setPartyFirm({
        partyId: resolvedArchitect.id,
        partyName: resolvedArchitect.name,
        firmId: resolvedFirmParty?.id ?? null,
        currentFirmId: resolvedArchitect.firm?.id ?? null,
      })
      if (firmWarning) warnings.push(`Activity logged, but ${firmWarning}`)
    }

    // Architect Meeting has no lead to write next_followup_date onto, so its
    // "Next follow-up" instead creates a real reminder (same table/helper
    // LeadDetail's On Hold flow already uses) assigned to whoever the meeting
    // is credited to (actingForId — the exec, when a coordinator logged this
    // on their behalf), linked to the architect party. createdBy stays the
    // real actor, so FollowUpList's "Assigned by {name}" shows correctly when
    // the two differ. activityType: 'other' — the real 'architect_meeting'
    // value isn't in follow_ups' own activity_type CHECK list, same reasoning
    // On Hold's own createFollowUp call uses.
    if (isArchitectMeeting && resolvedArchitect && nextFollowupDate) {
      const { error: followUpError } = await createFollowUp({
        assignedTo: actingForId,
        createdBy: employee?.id,
        partyId: resolvedArchitect.id,
        activityType: 'other',
        title: `Follow up with ${resolvedArchitect.name}`,
        notes: followupNote.trim() || notes.trim() || null,
        dueDate: nextFollowupDate,
      })

      if (followUpError) {
        warnings.push(`Activity logged, but the follow-up reminder wasn't saved: ${errorMessage(followUpError)}`)
      }
    }

    // A lead-anchored "Next follow-up" creates a real reminder — same table,
    // same helper, same push pipeline as every other reminder in the app.
    // Its own due date is what drives the push notification later; nothing
    // here needs to react to it beyond saving it.
    //
    // Guarded on `needsAnchor` as well as `selectedLead` for the same reason
    // rfq_raised and order_value are type-guarded above: selectActivityType
    // clears these fields on a type change, but the guard is what makes it
    // impossible for a date to be written by a form that never showed it.
    if (needsAnchor && selectedLead && nextFollowupDate) {
      const { error: followUpError } = await createFollowUp({
        assignedTo: actingForId,
        createdBy: employee?.id,
        partyId: selectedLead.party_id ?? null,
        leadId: selectedLead.id,
        activityType,
        title: `Follow up after ${ACTIVITY_LABELS[activityType] ?? 'activity'}`,
        notes: followupNote.trim() || null,
        dueDate: nextFollowupDate,
      })

      if (followUpError) {
        warnings.push(`Activity logged, but the follow-up reminder wasn't saved: ${errorMessage(followUpError)}`)
      }
    }

    setSubmitting(false)
    setResult({ activity, warnings })
  }

  if (result) {
    return (
      <div className="vip-card vip-narrow">
        <p className="vip-success" role="status" aria-live="polite" style={{ fontSize: 15, fontWeight: 600 }}>
          Activity logged.
        </p>
        <div className="vip-facts" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div>
            <div className="vip-fact-label">Type</div>
            <div className="vip-fact-value">{ACTIVITY_LABELS[result.activity.activity_type]}</div>
          </div>
          {selectedLead && (
            <div>
              <div className="vip-fact-label">Lead</div>
              <div className="vip-fact-value">
                <Link to={`/leads/${selectedLead.id}`}>#{selectedLead.id}</Link>
              </div>
            </div>
          )}
          {isArchitectMeeting && selectedArchitect && (
            <div>
              <div className="vip-fact-label">
                {selectedArchitect.party_type === 'firm' ? 'Architect firm' : 'Architect'}
              </div>
              <div className="vip-fact-value">{selectedArchitect.name}</div>
            </div>
          )}
          {showFirmField && firmParty && (
            <div>
              <div className="vip-fact-label">Firm</div>
              <div className="vip-fact-value">{firmParty.name}</div>
            </div>
          )}
          {isClientMeeting && result.activity.meeting_location && (
            <div>
              <div className="vip-fact-label">Meeting location</div>
              <div className="vip-fact-value">{meetingLocationLabel(result.activity.meeting_location)}</div>
            </div>
          )}
          {isOfficeDay && formatTimeRange(result.activity.start_time, result.activity.end_time) && (
            <div>
              <div className="vip-fact-label">Time</div>
              <div className="vip-fact-value">
                {formatTimeRange(result.activity.start_time, result.activity.end_time)}
              </div>
            </div>
          )}
        </div>
        {isOfficeDay && result.activity.work_summary && (
          <p className="vip-form-note">What you did: {result.activity.work_summary}</p>
        )}
        {notes && <p className="vip-form-note">Notes: {notes}</p>}
        {result.warnings.map((w) => (
          <p key={w} className="vip-error" role="alert">
            {w}
          </p>
        ))}

        <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={resetForm}>
          Log another activity
        </button>
      </div>
    )
  }

  return (
    <form className="vip-form vip-narrow vip-pad-sticky-footer" onSubmit={handleSubmit}>
      {isCoordinator && (
        <label className="vip-field">
          Who is this for? *
          {teamExecsLoaded && teamExecs.length === 0 ? (
            <p className="vip-form-note">You have no sales executives assigned to you yet.</p>
          ) : (
            <select
              className="vip-select"
              value={forExec?.id ?? ''}
              onChange={(e) => {
                setForExec(teamExecs.find((ex) => String(ex.id) === e.target.value) ?? null)
                // Switching exec mid-form invalidates any lead already picked
                // for the previous one — LeadSearchSelect re-scopes to the
                // new exec, but a stale selectedLead wouldn't re-validate
                // itself against that scope on its own.
                setSelectedLead(null)
              }}
              disabled={leadPreselectedAndLocked}
            >
              <option value="">{teamExecsLoaded ? '— Select an exec —' : 'Loading your team…'}</option>
              {teamExecs.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      <div className="vip-lede">What did you do?</div>

      <div className="vip-choice-grid">
        {ACTIVITY_TYPES.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={activityType === opt.value ? 'vip-choice vip-active' : 'vip-choice'}
            onClick={() => selectActivityType(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {needsAnchor && (
        <>
          <div className="vip-card-head">
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vip-ink)' }}>Against which lead?</div>
          </div>
          {leadPreselectedAndLocked ? (
            <div className="vip-row">
              <div className="vip-row-main">
                <div className="vip-row-title">{leadLabel(selectedLead)}</div>
              </div>
              <button type="button" className="vip-btn-link" onClick={() => setChangingLead(true)}>
                Change
              </button>
            </div>
          ) : isCoordinator && !forExec ? (
            <p className="vip-form-note">Select who this is for above, to search their leads.</p>
          ) : (
            <LeadSearchSelect onSelect={setSelectedLead} employeeId={actingForId} />
          )}
        </>
      )}

      {isArchitectMeeting && (
        <>
          <div className="vip-card-head">
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vip-ink)' }}>Architect</div>
          </div>
          {/* 'firm' renders as "architect firm" (src/lib/partyTypeOptions.js)
              — a meeting is as often with the practice as with one person.
              Two options rather than one means PartySearchOrCreate now shows
              its Type dropdown here, where it used to be hidden. showFirmName
              is deliberately NOT passed: the create form's own firm box only
              covers a party being created, and the always-visible field below
              covers existing architects too, so passing both would put two
              firm inputs on screen at once. */}
          <PartySearchOrCreate
            label="Architect name"
            defaultPartyType="architect"
            typeOptions={['architect', 'firm']}
            deferCreate
            onSelect={setSelectedArchitect}
            createdByEmployeeId={actingForId}
          />

          {/* key on the architect's id (or, for one not yet saved, their
              name) so the picker re-seeds when a different architect is
              chosen — initialSelected is a seed, not a controlled value. This
              is what makes a known architect's firm appear on its own. */}
          {showFirmField && (
            <PartySearchOrCreate
              key={selectedArchitect.id ?? selectedArchitect.name}
              label="Firm"
              hint={`optional, saved against ${selectedArchitect.name}`}
              defaultPartyType="firm"
              typeOptions={['firm']}
              deferCreate
              initialSelected={selectedArchitect.firm ?? null}
              onSelect={setFirmParty}
              createdByEmployeeId={actingForId}
            />
          )}
        </>
      )}

      {isSiteVisit ? (
        <>
          <label className="vip-field">
            Notes
            <textarea className="vip-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Short note" />
          </label>

          {selectedLead?.sites?.id && (
            <>
              <label className="vip-field">
                Site stage <span className="vip-field-hint">optional</span>
                <select className="vip-select" value={siteStage} onChange={(e) => setSiteStage(e.target.value)}>
                  <option value="">— Not specified —</option>
                  {SITE_STAGE_OPTIONS.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                  <option value="other">Other…</option>
                </select>
              </label>
              {siteStage === 'other' && (
                <label className="vip-field">
                  Describe stage
                  <input className="vip-input" value={customStage} onChange={(e) => setCustomStage(e.target.value)} />
                </label>
              )}
            </>
          )}

          {selectedLead && (
            <>
              <label className="vip-field">
                Next follow-up <span className="vip-field-hint">optional</span>
                <input
                  className="vip-input"
                  type="date"
                  value={nextFollowupDate}
                  onChange={(e) => setNextFollowupDate(e.target.value)}
                />
              </label>
              {nextFollowupDate && (
                <label className="vip-field">
                  What's the follow-up for? <span className="vip-field-hint">optional</span>
                  <input
                    className="vip-input"
                    type="text"
                    value={followupNote}
                    onChange={(e) => setFollowupNote(e.target.value)}
                    placeholder="Chase the revised quote, client wants laminated glass"
                  />
                </label>
              )}
            </>
          )}

          <label className="vip-field">
            Accompanied by <span className="vip-field-hint">optional</span>
            <select className="vip-select" value={accompaniedBy} onChange={(e) => setAccompaniedBy(e.target.value)}>
              <option value="">— Not specified —</option>
              {employees
                .filter((e) => e.id !== actingForId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
        </>
      ) : isOfficeDay ? (
        <>
          {/* Rebuilt 2026-08-18: "Leads generated" is gone, replaced by what
              the rep actually did and the hours they put in. All three are
              required — see officeDaySatisfied. Office Day still asks for no
              lead at all, matching the loosened activity_needs_an_anchor
              CHECK. */}
          <label className="vip-field">
            What did you do? *
            <textarea
              className="vip-textarea"
              value={workSummary}
              onChange={(e) => setWorkSummary(e.target.value)}
              rows={3}
              placeholder="e.g. quote follow-ups, showroom duty, design sheets"
            />
          </label>

          {/* Not a <label> — a label needs one control to point at, and this
              heads a pair. Same treatment as the tap-select groups on New
              Lead. */}
          <div className="vip-stack-s">
            <div className="vip-field-label">Time range *</div>
            <div className="vip-grid-2">
              <label className="vip-field">
                From
                <input
                  className="vip-input"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </label>
              <label className="vip-field">
                Till
                <input
                  className="vip-input"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </label>
            </div>
            {timeRangeInvalid && (
              <p className="vip-error" role="alert">
                Till has to be after From.
              </p>
            )}
          </div>

          <label className="vip-field">
            Notes
            <textarea
              className="vip-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything else worth recording"
            />
          </label>
        </>
      ) : isArchitectMeeting ? (
        <>
          <label className="vip-field">
            Next follow-up <span className="vip-field-hint">optional</span>
            <input
              className="vip-input"
              type="date"
              value={nextFollowupDate}
              onChange={(e) => setNextFollowupDate(e.target.value)}
            />
          </label>

          {nextFollowupDate && (
                <label className="vip-field">
                  What's the follow-up for? <span className="vip-field-hint">optional</span>
                  <input
                    className="vip-input"
                    type="text"
                    value={followupNote}
                    onChange={(e) => setFollowupNote(e.target.value)}
                    placeholder="Chase the revised quote, client wants laminated glass"
                  />
                </label>
              )}

          <label className="vip-field">
            Notes
            <textarea className="vip-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Short note" />
          </label>
        </>
      ) : (
        <>
          {selectedLead && (
            <>
              {/* Sits directly under "Against which lead?" — the meeting's
                  location is a fact about the meeting, asked before the
                  follow-up/value fields that are really about the deal.
                  .vip-choice-row, not .vip-choice-grid: two `flex: 1`
                  children split the track evenly at every width, where the
                  grid would render them quarter-width at desktop. */}
              {isClientMeeting && (
                <div className="vip-stack-s">
                  <div className="vip-field-label">Meeting location *</div>
                  <div className="vip-choice-row">
                    {MEETING_LOCATION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={meetingLocation === opt.value ? 'vip-choice vip-active' : 'vip-choice'}
                        onClick={() => setMeetingLocation(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {activityType === 'booking_update' && (
                <label className="vip-field">
                  {/* The column is plain order_value; only the wording says
                      without-GST, at the owner's direction (2026-08-18) and
                      deliberately only here — Lead Detail's Sales progress
                      field and the won-stage prompt still read "Order value". */}
                  Order value without GST <span className="vip-field-hint">optional</span>
                  <NumPadInput
                    variant="decimal"
                    label="Order value without GST"
                    type="number"
                    step="0.01"
                    value={orderValue}
                    onChange={(e) => setOrderValue(e.target.value)}
                  />
                </label>
              )}
              <label className="vip-field">
                Next follow-up <span className="vip-field-hint">optional</span>
                <input
                  className="vip-input"
                  type="date"
                  value={nextFollowupDate}
                  onChange={(e) => setNextFollowupDate(e.target.value)}
                />
              </label>
              {nextFollowupDate && (
                <label className="vip-field">
                  What's the follow-up for? <span className="vip-field-hint">optional</span>
                  <input
                    className="vip-input"
                    type="text"
                    value={followupNote}
                    onChange={(e) => setFollowupNote(e.target.value)}
                    placeholder="Chase the revised quote, client wants laminated glass"
                  />
                </label>
              )}
            </>
          )}

          {activityType && (
            <label className="vip-field">
              Notes
              <textarea className="vip-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Short note" />
            </label>
          )}
        </>
      )}

      {activityType && (
        <>
          {submitError && <p className="vip-error" role="alert">{submitError}</p>}

          <div className="vip-sticky-footer">
            <button className="vip-btn" type="submit" disabled={!canSubmit}>
              {submitting ? 'Saving…' : 'Log it'}
            </button>
          </div>
        </>
      )}
    </form>
  )
}

export default ActivityLog
