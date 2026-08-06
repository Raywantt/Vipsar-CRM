import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { insertLeadOwnerHistory } from '../lib/leadOwnerHistory'
import { FOLLOWUP_OPTIONS, followupDateFor } from '../lib/followupDates'
import LeadStageSection from './LeadStageSection'

// The three quick actions from the Lead Profile handoff (README.md §6.1 /
// DATA_CONTRACT.md §5). Change stage reuses LeadStageSection unmodified
// (mandatory loss-reason-on-lost prompt included) rather than duplicating
// that flow — this component just controls *when* it's visible. Set
// follow-up/Reassign owner are new, simpler writes with no existing
// component to reuse. Reassign owner is owner-only even within canEdit
// (FLOW.md §4 — an owning sales exec gets the other two, never this one).
function LeadQuickActions({
  lead,
  isOwner,
  activeSalesExecs,
  onStageChanged,
  onFollowUpSaved,
  onOwnerReassigned,
}) {
  const { employee } = useAuth()
  const [open, setOpen] = useState(null) // 'stage' | 'followup' | 'owner' | null

  const [followupChoice, setFollowupChoice] = useState('')
  const [customDate, setCustomDate] = useState('')
  const [savingFollowup, setSavingFollowup] = useState(false)
  const [followupError, setFollowupError] = useState(null)
  const [followupSaved, setFollowupSaved] = useState(false)

  const [ownerChoice, setOwnerChoice] = useState(lead.owner_employee_id ?? '')
  const [savingOwner, setSavingOwner] = useState(false)
  const [ownerError, setOwnerError] = useState(null)
  const [ownerHistoryWarning, setOwnerHistoryWarning] = useState(null)
  const [ownerSaved, setOwnerSaved] = useState(false)

  function toggle(key) {
    setOpen((prev) => (prev === key ? null : key))
  }

  async function handleSaveFollowup() {
    const date = followupDateFor(followupChoice, customDate)
    if (!date) return
    setSavingFollowup(true)
    setFollowupError(null)
    setFollowupSaved(false)

    const { data, error } = await supabase
      .from('leads')
      .update({ next_followup_date: date })
      .eq('id', lead.id)
      .select()
      .single()

    setSavingFollowup(false)
    if (error) {
      setFollowupError(error.message)
      return
    }
    setFollowupSaved(true)
    onFollowUpSaved(data)
  }

  async function handleReassignOwner(newOwnerId) {
    if (newOwnerId === lead.owner_employee_id || savingOwner) return
    setSavingOwner(true)
    setOwnerError(null)
    setOwnerHistoryWarning(null)
    setOwnerSaved(false)
    setOwnerChoice(newOwnerId)

    const oldOwnerId = lead.owner_employee_id
    const { data: updatedLead, error: leadError } = await supabase
      .from('leads')
      .update({ owner_employee_id: newOwnerId })
      .eq('id', lead.id)
      .select('*, employees!owner_employee_id(name)')
      .single()

    if (leadError) {
      setSavingOwner(false)
      setOwnerError(leadError.message)
      setOwnerChoice(oldOwnerId ?? '')
      return
    }

    const { data: historyRow, error: historyError } = await insertLeadOwnerHistory({
      leadId: lead.id,
      oldOwnerId,
      newOwnerId,
      changedBy: employee?.id ?? null,
    })

    setSavingOwner(false)

    // The reassignment itself already succeeded — a history-logging failure
    // (e.g. lead_owner_history not migrated live yet, see CLAUDE.md) surfaces
    // as a warning rather than rolling back the actual reassignment, same
    // pattern ActivityLog uses for its own lead-side-effect writes.
    if (historyError) {
      setOwnerHistoryWarning(`Owner reassigned, but logging the change failed: ${historyError.message}`)
    } else {
      setOwnerSaved(true)
    }

    onOwnerReassigned(updatedLead, historyError ? null : historyRow)
  }

  return (
    <div className="vip-stack-s">
      <div className="vip-btn-row" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className={open === 'stage' ? 'vip-btn vip-btn-dark vip-btn-sm' : 'vip-btn vip-btn-secondary vip-btn-sm'}
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={() => toggle('stage')}
        >
          Change stage
        </button>
        <button
          type="button"
          className={open === 'followup' ? 'vip-btn vip-btn-dark vip-btn-sm' : 'vip-btn vip-btn-secondary vip-btn-sm'}
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={() => toggle('followup')}
        >
          Set follow-up
        </button>
        {isOwner && (
          <button
            type="button"
            className={open === 'owner' ? 'vip-btn vip-btn-dark vip-btn-sm' : 'vip-btn vip-btn-secondary vip-btn-sm'}
            style={{ width: 'auto', flex: '0 0 auto' }}
            onClick={() => toggle('owner')}
          >
            Reassign owner
          </button>
        )}
      </div>

      {open === 'stage' && <LeadStageSection lead={lead} onStageChanged={onStageChanged} />}

      {open === 'followup' && (
        <div className="vip-action-panel">
          <span className="vip-action-panel-title">Set follow-up</span>
          <div className="vip-action-panel-opts">
            {FOLLOWUP_OPTIONS.map((label) => (
              <button
                key={label}
                type="button"
                className={followupChoice === label ? 'vip-action-opt vip-active' : 'vip-action-opt'}
                onClick={() => setFollowupChoice(label)}
              >
                {label}
              </button>
            ))}
          </div>
          {followupChoice === 'Custom date' && (
            <input
              type="date"
              className="vip-input"
              style={{ minHeight: 30, padding: '4px 8px', width: 'auto' }}
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
            />
          )}
          <button
            type="button"
            className="vip-action-opt vip-active"
            disabled={!followupDateFor(followupChoice, customDate) || savingFollowup}
            onClick={handleSaveFollowup}
          >
            {savingFollowup ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="vip-action-close" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}

      {open === 'owner' && (
        <div className="vip-action-panel">
          <span className="vip-action-panel-title">Reassign owner</span>
          <div className="vip-action-panel-opts">
            {activeSalesExecs.map((e) => (
              <button
                key={e.id}
                type="button"
                className={ownerChoice === e.id ? 'vip-action-opt vip-active' : 'vip-action-opt'}
                disabled={savingOwner}
                onClick={() => handleReassignOwner(e.id)}
              >
                {e.name}
              </button>
            ))}
          </div>
          <button type="button" className="vip-action-close" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}

      {followupError && <p className="vip-error">{followupError}</p>}
      {followupSaved && !followupError && open === 'followup' && <p className="vip-success">Follow-up set.</p>}
      {ownerError && <p className="vip-error">{ownerError}</p>}
      {ownerHistoryWarning && <p className="vip-error">{ownerHistoryWarning}</p>}
      {ownerSaved && !ownerError && open === 'owner' && <p className="vip-success">Owner reassigned.</p>}
    </div>
  )
}

export default LeadQuickActions
