import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import PartySearchOrCreate from '../components/PartySearchOrCreate'
import LeadSearchSelect from '../components/LeadSearchSelect'
import { ACTIVITY_TYPES, ACTIVITY_LABELS } from '../lib/activityTypes'
import { fetchLeadsList, fetchLastActivityPerLead } from '../lib/dashboardQueries'
import { stageChipClass } from '../lib/statusColors'
import { stageLabel } from '../lib/leadStageOptions'
import { todayISO } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'

function touchLabel(lastAt) {
  if (!lastAt) return 'no activity yet'
  const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000)
  if (days <= 0) return 'touched today'
  return `${days}d ago`
}

function leadLabel(lead) {
  const place = lead.sites?.nickname || lead.sites?.locality
  return lead.parties?.name ?? place ?? `Lead #${lead.id}`
}

// Default anchor picker for Site Visit/RFQ Raised/Call/Booking Update —
// this employee's own leads (fetchLeadsList, already scoped by RLS/the
// employeeId filter), newest-touched first via fetchLastActivityPerLead,
// falling back to created_at for a lead with no activity logged yet. Both
// queries are reused as-is (no new query function), per the mobile handoff's
// "no new query needed" note. "Search all" (ActivityLog.jsx) falls back to
// the full LeadSearchSelect for anything not in this recent list.
function RecentLeadsPicker({ employeeId, selected, onSelect }) {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!employeeId) return
    let active = true
    Promise.all([fetchLeadsList({ employeeId }), fetchLastActivityPerLead()]).then(([leadsRes, activityRes]) => {
      if (!active) return
      setLoading(false)
      if (leadsRes.error) return
      const lastByLead = new Map()
      ;(activityRes.data ?? []).forEach((row) => {
        const existing = lastByLead.get(row.lead_id)
        if (!existing || new Date(row.created_at) > new Date(existing)) lastByLead.set(row.lead_id, row.created_at)
      })
      const sorted = [...(leadsRes.data ?? [])].sort((a, b) => {
        const aAt = lastByLead.get(a.id) ?? a.created_at
        const bAt = lastByLead.get(b.id) ?? b.created_at
        return new Date(bAt) - new Date(aAt)
      })
      setLeads(sorted.slice(0, 8).map((l) => ({ ...l, lastTouchedAt: lastByLead.get(l.id) ?? null })))
    })
    return () => {
      active = false
    }
  }, [employeeId])

  if (loading) return <p className="vip-empty">Loading your leads…</p>
  if (leads.length === 0) return <p className="vip-empty">You don't have any leads yet — use Search all.</p>

  return (
    <div className="vip-card">
      {leads.map((lead) => {
        const place = lead.sites?.nickname || lead.sites?.locality
        const label = leadLabel(lead)
        return (
          <button
            key={lead.id}
            type="button"
            className="vip-radio-row"
            onClick={() => onSelect({ id: lead.id, current_stage: lead.current_stage, source_type: lead.source_type, parties: lead.parties, sites: lead.sites })}
          >
            <span className={selected?.id === lead.id ? 'vip-radio-dot vip-active' : 'vip-radio-dot'} />
            <span className="vip-row-main" style={{ flex: 1 }}>
              <span className="vip-row-title">{label}</span>
              <span className="vip-row-sub">
                {place && lead.parties?.name ? `${place} · ` : ''}
                {touchLabel(lead.lastTouchedAt)}
              </span>
            </span>
            <span className={stageChipClass(lead.current_stage ?? 'calling')}>{stageLabel(lead.current_stage ?? 'calling')}</span>
          </button>
        )
      })}
    </div>
  )
}

function ActivityLog() {
  const { employee } = useAuth()
  const [searchParams] = useSearchParams()
  const preselectedLeadId = searchParams.get('lead')

  const [activityType, setActivityType] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const [selectedParty, setSelectedParty] = useState(null)
  const [searchAll, setSearchAll] = useState(false)
  // "Log activity" links from Lead Detail carry ?lead=<id> so the rep lands
  // with their lead already picked instead of having to find it again in
  // RecentLeadsPicker/LeadSearchSelect — changingLead lets them back out of
  // that preselection into the normal picker if they need a different lead.
  // preselectedLead is kept separately (immutable once fetched) so "Log
  // another activity" can restore it rather than clearing back to nothing.
  const [changingLead, setChangingLead] = useState(false)
  const [preselectedLead, setPreselectedLead] = useState(null)
  const [notes, setNotes] = useState('')
  const [accompaniedBy, setAccompaniedBy] = useState('')
  const [leadsGenerated, setLeadsGenerated] = useState('')
  const [orderValue, setOrderValue] = useState('')
  const [nextFollowupDate, setNextFollowupDate] = useState('')

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
      .select('id, current_stage, source_type, parties!party_id(name), sites(nickname, locality)')
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

  const isOfficeDay = activityType === 'office_day'
  const isSiteVisit = activityType === 'site_visit'
  // Party is only offered as an anchor alongside Site Visit/Booking Update —
  // Call and RFQ Raised must be tied to a lead, since there's no party
  // picker to fall back on for them.
  const showPartyPicker = activityType === 'site_visit' || activityType === 'booking_update'
  const needsAnchor = activityType && !isOfficeDay
  const anchorSatisfied = isOfficeDay || (showPartyPicker ? Boolean(selectedLead || selectedParty) : Boolean(selectedLead))
  const canSubmit = Boolean(activityType) && anchorSatisfied && !submitting
  const leadPreselectedAndLocked =
    Boolean(preselectedLeadId) && selectedLead && String(selectedLead.id) === preselectedLeadId && !changingLead

  function selectActivityType(value) {
    setActivityType(value)
    if (value !== 'site_visit' && value !== 'booking_update') {
      setSelectedParty(null)
    }
    if (value !== 'site_visit') {
      setAccompaniedBy('')
    }
  }

  function resetForm() {
    setActivityType(null)
    setSelectedLead(preselectedLead)
    setSelectedParty(null)
    setSearchAll(false)
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
        party_id: selectedParty?.id ?? null,
        lead_id: selectedLead?.id ?? null,
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
          {selectedParty && (
            <div>
              <div className="vip-fact-label">Party</div>
              <div className="vip-fact-value">{selectedParty.name}</div>
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
            {!leadPreselectedAndLocked && (
              <button type="button" className="vip-btn-link" onClick={() => setSearchAll((v) => !v)}>
                {searchAll ? 'Recent leads' : 'Search all'}
              </button>
            )}
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
          ) : searchAll ? (
            <LeadSearchSelect onSelect={setSelectedLead} />
          ) : (
            <RecentLeadsPicker employeeId={employee?.id} selected={selectedLead} onSelect={setSelectedLead} />
          )}
          {showPartyPicker && (
            <PartySearchOrCreate label="Party" allowCreate={false} onSelect={setSelectedParty} />
          )}
        </>
      )}

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

      <label className="vip-field">
        Notes
        <textarea className="vip-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Short note" />
      </label>

      {isSiteVisit && (
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
      )}

      {submitError && <p className="vip-error" role="alert">{submitError}</p>}

      <div className="vip-sticky-footer">
        <button className="vip-btn" type="submit" disabled={!canSubmit}>
          {submitting ? 'Saving…' : 'Log it'}
        </button>
      </div>
    </form>
  )
}

export default ActivityLog
