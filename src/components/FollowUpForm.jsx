import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { FOLLOWUP_OPTIONS, followupDateFor } from '../lib/followupDates'
import { fetchLeadsByParty, mostRecentLeadByParty } from '../lib/partyQueries'
import { createFollowUp } from '../lib/followUpQueries'
import { ACTIVITY_TYPES } from '../lib/activityTypes'
import PartySearchOrCreate from './PartySearchOrCreate'

// assignedTo is locked, not a picker — the caller (Home for a self reminder,
// EmployeeProfile for an owner assigning one) decides who this is for.
// party_id is the only link the user picks; lead_id is resolved silently
// from that party's most recent lead via the same fetchLeadsByParty/
// mostRecentLeadByParty helpers PartiesCard already uses for "worked with"
// links, then folded into both the follow_ups insert and (if resolved) a
// sync onto that lead's next_followup_date — mirrors LeadQuickActions'
// existing "Set follow-up" write exactly.
function FollowUpForm({ assignedTo, createdBy, onSaved, onCancel }) {
  const [followupChoice, setFollowupChoice] = useState('')
  const [customDate, setCustomDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [party, setParty] = useState(null)
  const [activityType, setActivityType] = useState('')
  const [resolvedLead, setResolvedLead] = useState(null) // { id, createdAt } | null, once looked up
  const [resolvingLead, setResolvingLead] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const dueDate = followupDateFor(followupChoice, customDate)

  useEffect(() => {
    if (!party) {
      setResolvedLead(null)
      return
    }
    let active = true
    setResolvingLead(true)
    fetchLeadsByParty().then(({ data, error: fetchError }) => {
      if (!active) return
      setResolvingLead(false)
      if (fetchError) return
      const leadId = mostRecentLeadByParty(data ?? []).get(party.id) ?? null
      const row = leadId ? (data ?? []).find((r) => r.id === leadId) : null
      setResolvedLead(leadId ? { id: leadId, createdAt: row?.created_at ?? null } : null)
    })
    return () => {
      active = false
    }
  }, [party])

  function handlePartySelect(nextParty) {
    setParty(nextParty)
    if (!nextParty) setActivityType('')
  }

  async function handleSave() {
    if (!dueDate || !title.trim() || saving) return
    setSaving(true)
    setError(null)

    const { data, error: saveError } = await createFollowUp({
      assignedTo,
      createdBy,
      partyId: party?.id ?? null,
      leadId: resolvedLead?.id ?? null,
      activityType: party ? activityType || null : null,
      title: title.trim(),
      notes: notes.trim() || null,
      dueDate,
      dueTime: dueTime || null,
    })

    if (saveError) {
      setSaving(false)
      setError(saveError.message)
      return
    }

    if (resolvedLead?.id) {
      await supabase.from('leads').update({ next_followup_date: dueDate }).eq('id', resolvedLead.id)
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

      <div className="vip-field">
        Related party <span className="vip-field-hint">optional</span>
        <PartySearchOrCreate label="Party" allowCreate={false} onSelect={handlePartySelect} />
      </div>

      {party && !resolvingLead && (
        <p className="vip-field-hint" style={{ margin: 0 }}>
          {resolvedLead ? 'Linked to their most recent lead.' : 'No lead on file for this party yet — reminder will still be saved against the party.'}
        </p>
      )}

      {party && (
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

      {error && <p className="vip-error">{error}</p>}

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
