import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import LeadSearchSelect from '../components/LeadSearchSelect'
import PartySearchOrCreate from '../components/PartySearchOrCreate'
import { ACTIVITY_TYPES, ACTIVITY_LABELS } from '../lib/activityTypes'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { todayISO } from '../lib/followupDates'
import { createFollowUp } from '../lib/followUpQueries'
import { errorMessage } from '../lib/errorMessage'

function leadLabel(lead) {
  const place = lead.sites?.nickname || lead.sites?.locality
  return lead.parties?.name ?? place ?? `Lead #${lead.id}`
}

function ActivityLog() {
  const { employee } = useAuth()
  const [searchParams] = useSearchParams()
  const preselectedLeadId = searchParams.get('lead')

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
  // since the meeting itself is the point, not a specific deal.
  const [selectedArchitect, setSelectedArchitect] = useState(null)
  const [notes, setNotes] = useState('')
  const [accompaniedBy, setAccompaniedBy] = useState('')
  const [leadsGenerated, setLeadsGenerated] = useState('')
  const [orderValue, setOrderValue] = useState('')
  const [nextFollowupDate, setNextFollowupDate] = useState('')
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
    if (!preselectedLeadId) return
    let active = true
    supabase
      .from('leads')
      .select('id, current_stage, source_type, parties!party_id(name), sites(id, nickname, locality, site_stage)')
      .eq('id', preselectedLeadId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        if (data) {
          setPreselectedLead(data)
          setSelectedLead(data)
        }
      })
    return () => {
      active = false
    }
  }, [preselectedLeadId])

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

  const isOfficeDay = activityType === 'office_day'
  const isSiteVisit = activityType === 'site_visit'
  const isArchitectMeeting = activityType === 'architect_meeting'
  // Every lead-anchored activity requires a Lead — Party as a fallback
  // anchor was removed (2026-08-09) so Next follow-up/Order value/Site
  // stage, which all write onto a lead, are never silently hidden behind a
  // party-only pick. Architect Meeting is its own separate case — it's
  // anchored on an architect party instead of a lead entirely, so it's
  // excluded from this lead-picker block the same way Office Day is.
  const needsAnchor = activityType && !isOfficeDay && !isArchitectMeeting
  const anchorSatisfied = isOfficeDay || (isArchitectMeeting ? Boolean(selectedArchitect) : Boolean(selectedLead))
  const canSubmit = Boolean(activityType) && anchorSatisfied && !submitting
  const leadPreselectedAndLocked =
    Boolean(preselectedLeadId) && selectedLead && String(selectedLead.id) === preselectedLeadId && !changingLead

  function selectActivityType(value) {
    setActivityType(value)
    if (value !== 'site_visit') {
      setAccompaniedBy('')
    }
  }

  function resetForm() {
    setActivityType(null)
    setSelectedLead(preselectedLead)
    setSelectedArchitect(null)
    setChangingLead(false)
    setNotes('')
    setAccompaniedBy('')
    setLeadsGenerated('')
    setOrderValue('')
    setNextFollowupDate('')
    setSubmitError(null)
    setResult(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError(null)
    setSubmitting(true)

    const { data: activity, error: activityError } = await supabase
      .from('activities')
      .insert({
        employee_id: employee?.id ?? null,
        lead_id: selectedLead?.id ?? null,
        party_id: isArchitectMeeting ? selectedArchitect?.id ?? null : null,
        activity_type: activityType,
        accompanied_by: accompaniedBy || null,
        notes: notes.trim() || null,
        leads_generated: isOfficeDay && leadsGenerated !== '' ? Number(leadsGenerated) : null,
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
      if (nextFollowupDate) {
        leadUpdates.next_followup_date = nextFollowupDate
      }

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

    // Architect Meeting has no lead to write next_followup_date onto, so its
    // "Next follow-up" instead creates a real reminder (same table/helper
    // LeadDetail's On Hold flow already uses) assigned to the employee who
    // logged it, linked to the architect party. activityType: 'other' — the
    // real 'architect_meeting' value isn't in follow_ups' own activity_type
    // CHECK list, same reasoning On Hold's own createFollowUp call uses.
    if (isArchitectMeeting && selectedArchitect && nextFollowupDate) {
      const { error: followUpError } = await createFollowUp({
        assignedTo: employee?.id,
        createdBy: employee?.id,
        partyId: selectedArchitect.id,
        activityType: 'other',
        title: `Follow up with ${selectedArchitect.name}`,
        notes: notes.trim() || null,
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
              <div className="vip-fact-label">Architect</div>
              <div className="vip-fact-value">{selectedArchitect.name}</div>
            </div>
          )}
        </div>
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
          ) : (
            <LeadSearchSelect onSelect={setSelectedLead} />
          )}
        </>
      )}

      {isArchitectMeeting && (
        <>
          <div className="vip-card-head">
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vip-ink)' }}>Architect</div>
          </div>
          <PartySearchOrCreate
            label="Architect name"
            defaultPartyType="architect"
            typeOptions={['architect']}
            onSelect={setSelectedArchitect}
          />
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
            <label className="vip-field">
              Next follow-up <span className="vip-field-hint">optional</span>
              <input
                className="vip-input"
                type="date"
                value={nextFollowupDate}
                onChange={(e) => setNextFollowupDate(e.target.value)}
              />
            </label>
          )}

          <label className="vip-field">
            Accompanied by <span className="vip-field-hint">optional</span>
            <select className="vip-select" value={accompaniedBy} onChange={(e) => setAccompaniedBy(e.target.value)}>
              <option value="">— Not specified —</option>
              {employees
                .filter((e) => e.id !== employee?.id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
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

          <label className="vip-field">
            Notes
            <textarea className="vip-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Short note" />
          </label>
        </>
      ) : (
        <>
          {selectedLead && (
            <>
              {activityType === 'booking_update' && (
                <label className="vip-field">
                  Order value <span className="vip-field-hint">optional</span>
                  <input
                    className="vip-input"
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
            </>
          )}

          {isOfficeDay && (
            <label className="vip-field">
              Leads generated
              <input
                className="vip-input"
                type="number"
                value={leadsGenerated}
                onChange={(e) => setLeadsGenerated(e.target.value)}
              />
            </label>
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
