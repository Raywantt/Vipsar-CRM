import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { insertLeadOwnerHistory } from '../lib/leadOwnerHistory'
import LeadStageSection from './LeadStageSection'
import FollowUpForm from './FollowUpForm'
import { errorMessage } from '../lib/errorMessage'

// The three quick actions from the Lead Profile handoff (README.md §6.1 /
// DATA_CONTRACT.md §5).
//
// **Change stage and Reassign owner are both owner-only**, even within
// canEdit — a sales exec who owns the lead gets neither. Reassign owner was
// always this way (FLOW.md §4); Change stage joined it later, at the user's
// request: moving a lead through the funnel (including closing it Won or
// Lost) is the owner's call, not the rep's. A rep can still record the
// numbers behind a close — order value via Activity Log's Booking Update or
// Sales progress' own Order value field — they just don't flip the stage
// themselves. NOTE: this is a UI-layer gate only; `leads` UPDATE is "own data
// or owner role" at the RLS layer, so a rep's own lead is still technically
// stage-updatable via the API. See Schema/migration_owner_only_stage.sql for
// the database-level enforcement to match.
//
// Set follow-up mounts the same FollowUpForm Home's "Add reminder" uses,
// with this lead preset (so it never asks "which lead?") and assigned to the
// lead's *owner* rather than whoever is clicking — an owner setting a
// reminder on a rep's lead is reminding the rep, and it's their device the
// push notification should reach. Same rule LeadStageSection's On Hold flow
// already follows for its own createFollowUp call.
function LeadQuickActions({
  lead,
  leadTitle,
  isOwner,
  activeSalesExecs,
  onStageChanged,
  onFollowUpSaved,
  onOwnerReassigned,
}) {
  const { employee } = useAuth()
  const [open, setOpen] = useState(null) // 'stage' | 'followup' | 'owner' | null
  const [followupSaved, setFollowupSaved] = useState(false)

  const [ownerChoice, setOwnerChoice] = useState(lead.owner_employee_id ?? '')
  const [savingOwner, setSavingOwner] = useState(false)
  const [ownerError, setOwnerError] = useState(null)
  const [ownerHistoryWarning, setOwnerHistoryWarning] = useState(null)
  const [ownerSaved, setOwnerSaved] = useState(false)

  function toggle(key) {
    setOpen((prev) => (prev === key ? null : key))
    setFollowupSaved(false)
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
      setOwnerError(errorMessage(leadError))
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
      setOwnerHistoryWarning(`Owner reassigned, but logging the change failed: ${errorMessage(historyError)}`)
    } else {
      setOwnerSaved(true)
    }

    onOwnerReassigned(updatedLead, historyError ? null : historyRow)
  }

  return (
    <div className="vip-stack-s">
      <div className="vip-btn-row" style={{ flexWrap: 'wrap' }}>
        {isOwner && (
          <button
            type="button"
            className={open === 'stage' ? 'vip-btn vip-btn-dark vip-btn-sm' : 'vip-btn vip-btn-secondary vip-btn-sm'}
            style={{ width: 'auto', flex: '0 0 auto' }}
            onClick={() => toggle('stage')}
          >
            Change stage
          </button>
        )}
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

      {open === 'stage' && isOwner && <LeadStageSection lead={lead} leadTitle={leadTitle} onStageChanged={onStageChanged} />}

      {open === 'followup' && (
        <FollowUpForm
          lead={lead}
          assignedTo={lead.owner_employee_id ?? employee?.id}
          createdBy={employee?.id}
          onSaved={(row) => {
            setFollowupSaved(true)
            setOpen(null)
            onFollowUpSaved(row)
          }}
          onCancel={() => setOpen(null)}
        />
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

      {/* FollowUpForm surfaces its own save error inline, so there's no
          followupError to mirror here — only the confirmation, which has to
          outlive the panel since onSaved closes it. */}
      {followupSaved && open !== 'followup' && <p className="vip-success" role="status" aria-live="polite">Reminder set.</p>}
      {ownerError && <p className="vip-error" role="alert">{ownerError}</p>}
      {ownerHistoryWarning && <p className="vip-error" role="alert">{ownerHistoryWarning}</p>}
      {ownerSaved && !ownerError && open === 'owner' && <p className="vip-success" role="status" aria-live="polite">Owner reassigned.</p>}
    </div>
  )
}

export default LeadQuickActions
