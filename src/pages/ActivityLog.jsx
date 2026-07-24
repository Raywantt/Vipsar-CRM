import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import PartySearchOrCreate from '../components/PartySearchOrCreate'
import LeadSearchSelect from '../components/LeadSearchSelect'
import './ActivityLog.css'

const ACTIVITY_TYPES = [
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'call', label: 'Call' },
  { value: 'rfq_raised', label: 'RFQ Raised' },
  { value: 'office_day', label: 'Office Day' },
  { value: 'booking_update', label: 'Booking Update' },
]

const ACTIVITY_LABELS = Object.fromEntries(ACTIVITY_TYPES.map((o) => [o.value, o.label]))

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function ActivityLog() {
  const { employee } = useAuth()

  const [activityType, setActivityType] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const [selectedParty, setSelectedParty] = useState(null)
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

  const isOfficeDay = activityType === 'office_day'
  const needsAnchor = activityType && !isOfficeDay
  const canSubmit =
    Boolean(activityType) && (!needsAnchor || Boolean(selectedLead || selectedParty)) && !submitting

  function resetForm() {
    setActivityType(null)
    setSelectedLead(null)
    setSelectedParty(null)
    setNotes('')
    setAccompaniedBy('')
    setLeadsGenerated('')
    setOrderValue('')
    setNextFollowupDate('')
    setSubmitError(null)
    setResult(null)
  }

  async function handleSubmit() {
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
      setSubmitError(`Couldn't log the activity: ${activityError.message}`)
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
          warnings.push(`Activity logged, but updating the lead failed: ${leadUpdateError.message}`)
        }
      }
    }

    setSubmitting(false)
    setResult({ activity, warnings })
  }

  if (result) {
    return (
      <main className="activity-log">
        <h1>Activity logged</h1>
        <ul className="activity-log-summary">
          <li>Type: {ACTIVITY_LABELS[result.activity.activity_type]}</li>
          {selectedLead && (
            <li>
              Lead: <Link to={`/leads/${selectedLead.id}`}>#{selectedLead.id}</Link>
            </li>
          )}
          {selectedParty && <li>Party: {selectedParty.name}</li>}
          {notes && <li>Notes: {notes}</li>}
        </ul>
        {result.warnings.map((w) => (
          <p key={w} className="activity-log-error">
            {w}
          </p>
        ))}
        <button type="button" onClick={resetForm}>
          Log another activity
        </button>
      </main>
    )
  }

  return (
    <main className="activity-log">
      <div className="activity-log-header">
        <h1>Log Activity</h1>
      </div>

      <div className="activity-log-type">
        {ACTIVITY_TYPES.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={
              activityType === opt.value
                ? 'activity-log-type-btn activity-log-type-btn-active'
                : 'activity-log-type-btn'
            }
            onClick={() => setActivityType(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {needsAnchor && (
        <>
          <LeadSearchSelect onSelect={setSelectedLead} />
          <PartySearchOrCreate label="Party" allowCreate={false} onSelect={setSelectedParty} />
        </>
      )}

      {selectedLead && (
        <>
          {activityType === 'booking_update' && (
            <label className="activity-log-field">
              Order value (optional)
              <input
                type="number"
                step="0.01"
                value={orderValue}
                onChange={(e) => setOrderValue(e.target.value)}
              />
            </label>
          )}
          <label className="activity-log-field">
            Update next follow-up date (optional)
            <input
              type="date"
              value={nextFollowupDate}
              onChange={(e) => setNextFollowupDate(e.target.value)}
            />
          </label>
        </>
      )}

      {isOfficeDay && (
        <label className="activity-log-field">
          Leads generated
          <input
            type="number"
            value={leadsGenerated}
            onChange={(e) => setLeadsGenerated(e.target.value)}
          />
        </label>
      )}

      <label className="activity-log-field">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
      </label>

      <label className="activity-log-field">
        Accompanied by (optional)
        <select value={accompaniedBy} onChange={(e) => setAccompaniedBy(e.target.value)}>
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

      {submitError && <p className="activity-log-error">{submitError}</p>}

      <button type="button" className="activity-log-submit" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? 'Saving…' : 'Log Activity'}
      </button>
    </main>
  )
}

export default ActivityLog
