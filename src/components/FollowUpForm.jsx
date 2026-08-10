import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { FOLLOWUP_OPTIONS, followupDateFor } from '../lib/followupDates'
import { createFollowUp } from '../lib/followUpQueries'
import { ACTIVITY_TYPES } from '../lib/activityTypes'
import LeadSearchSelect from './LeadSearchSelect'
import { errorMessage } from '../lib/errorMessage'

// assignedTo is locked, not a picker — the caller (Home for a self reminder,
// EmployeeProfile for an owner assigning one, LeadQuickActions for a reminder
// on a specific lead) decides who this is for.
//
// The link is now a **lead**, picked explicitly, not a party whose most recent
// lead was silently resolved behind the scenes (the old behaviour — it meant a
// reminder often ended up with no lead attached at all, or attached to a lead
// the user never chose). `party_id` still gets written, derived from whichever
// lead is linked, so FollowUpList keeps showing a client name.
//
// `lead` (optional) presets the link and hides the picker entirely — passed by
// LeadQuickActions, where the lead is already the screen you're on, so asking
// "which lead?" would be redundant. Everywhere else the picker shows and the
// link stays optional (a reminder with no lead is still valid).
function FollowUpForm({ assignedTo, createdBy, lead = null, onSaved, onCancel }) {
  const { employee } = useAuth()
  // An owner picking a lead for their own reminder searches the whole
  // pipeline, not just leads they personally carry (which on a real database
  // is often none) — see LeadSearchSelect's `allLeads`. Assigning to someone
  // else still scopes to that person's leads.
  const searchAllLeads = employee?.role === 'owner' && assignedTo === employee?.id

  const [followupChoice, setFollowupChoice] = useState('')
  const [customDate, setCustomDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [pickedLead, setPickedLead] = useState(null)
  const [activityType, setActivityType] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const dueDate = followupDateFor(followupChoice, customDate)
  // A preset lead always wins over the picker (the picker isn't rendered in
  // that case anyway).
  const linkedLead = lead ?? pickedLead

  function handleLeadSelect(nextLead) {
    setPickedLead(nextLead)
    if (!nextLead) setActivityType('')
  }

  async function handleSave() {
    if (!dueDate || !title.trim() || saving) return
    setSaving(true)
    setError(null)

    const { data, error: saveError } = await createFollowUp({
      assignedTo,
      createdBy,
      partyId: linkedLead?.party_id ?? null,
      leadId: linkedLead?.id ?? null,
      activityType: linkedLead ? activityType || null : null,
      title: title.trim(),
      notes: notes.trim() || null,
      dueDate,
      dueTime: dueTime || null,
    })

    if (saveError) {
      setSaving(false)
      setError(errorMessage(saveError))
      return
    }

    // Keep the lead's own next_followup_date in step with the reminder, so
    // this doesn't create a second, out-of-sync "when's the next touch" field
    // (same plain overwrite LeadQuickActions' old inline picker did).
    if (linkedLead?.id) {
      await supabase.from('leads').update({ next_followup_date: dueDate }).eq('id', linkedLead.id)
    }

    setSaving(false)
    onSaved(data)
  }

  return (
    <div className="vip-form vip-section-split">
      <div className="vip-field">
        When
        <div className="vip-chip-wrap">
          {FOLLOWUP_OPTIONS.map((label) => (
            <button
              key={label}
              type="button"
              className="vip-chip-select"
              aria-pressed={followupChoice === label}
              onClick={() => setFollowupChoice(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {followupChoice === 'Custom date' && (
        <input type="date" className="vip-input" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
      )}

      <label className="vip-field">
        Time <span className="vip-field-hint">optional</span>
        <input type="time" className="vip-input" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
      </label>

      <label className="vip-field">
        What's this reminder about?
        <input
          className="vip-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Call about quote follow-up"
        />
      </label>

      {!lead && (
        <div className="vip-field">
          Related lead <span className="vip-field-hint">optional</span>
          <LeadSearchSelect onSelect={handleLeadSelect} employeeId={assignedTo} allLeads={searchAllLeads} />
        </div>
      )}

      {linkedLead && (
        <div className="vip-field">
          Type of follow-up <span className="vip-field-hint">optional</span>
          <div className="vip-chip-wrap">
            {ACTIVITY_TYPES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="vip-chip-select"
                aria-pressed={activityType === opt.value}
                onClick={() => setActivityType(opt.value)}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              className="vip-chip-select"
              aria-pressed={activityType === 'other'}
              onClick={() => setActivityType('other')}
            >
              Other
            </button>
          </div>
        </div>
      )}

      <label className="vip-field">
        Notes <span className="vip-field-hint">optional</span>
        <textarea className="vip-textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <p className="vip-error" role="alert">{error}</p>}

      <div className="vip-btn-row">
        <button type="button" className="vip-btn vip-btn-sm" disabled={!dueDate || !title.trim() || saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save reminder'}
        </button>
        {onCancel && (
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

export default FollowUpForm
