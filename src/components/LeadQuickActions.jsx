import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { insertLeadOwnerHistory } from '../lib/leadOwnerHistory'
import { requestAssignmentPush } from '../lib/notificationQueries'
import LeadStageSection from './LeadStageSection'
import FollowUpForm from './FollowUpForm'
import { errorMessage } from '../lib/errorMessage'

// The three quick actions from the Lead Profile handoff (README.md §6.1 /
// DATA_CONTRACT.md §5).
//
// This whole component mounts under `canQuickAct` (see LeadDetail.jsx),
// which — since the Sales Manager build (2026-09-03) — is wider than
// `canEdit`: the lead's own sales executive, that exec's sales coordinator,
// the owner, AND a sales manager viewing one of their own team's leads (who
// gets this sheet without getting the detail sections below it — a manager
// supervises without overwriting, see LeadDetail.jsx's canEdit/canQuickAct
// split).
//
// **Change stage is available to all four.** It was owner-only between
// 2026-08-10 and 2026-08-13 — deliberately, then deliberately reversed; the
// rep gets it back, but forward-only. `canMoveStageBackward` (owner and
// coordinator only — a manager is held to the same one-way funnel as their
// reps, by the owner's ruling) is passed straight through to
// LeadStageSection, which greys out any chip that would walk the lead to an
// earlier stage. That is a UI convenience, not the boundary: the
// owner_only_stage_change trigger (Schema/migration_lead_edit_rights.sql /
// migration_sales_manager.sql STEP 8) is what actually refuses the write.
//
// **Reassign owner is owner + coordinator + manager** (`canReassign`) —
// moving a lead between people is an oversight action, and a rep
// reassigning their own lead away isn't a thing they should do
// unilaterally. The database bounds each supervisor's half differently:
// coordinator_team_update's WITH CHECK still keeps the new owner inside the
// coordinator's own team. manager_team_update's WITH CHECK is wider — as of
// 2026-09-07 (Schema/migration_manager_reassign_any_employee.sql) a manager
// may hand a lead they can already reach (their own, or their team's) to
// ANY active exec in the company, not just their own team — the owner's own
// direct request, after the dropdown below had always listed every exec
// while the database silently refused anyone outside the team. This widens
// WHO a reachable lead can be given to; it does NOT widen WHICH leads a
// manager can reach in the first place — `activeSalesExecs` below has
// always been the full company roster regardless (see its own prop
// comment in LeadDetail.jsx), so this dropdown needed no change, only the
// database catching up to what it already offered.
//
// All flags arrive as capabilities rather than as a role, on purpose. An
// `isOwner` prop is what previously made this component un-openable for a
// coordinator who had full database rights the entire time — the same
// "not an owner means a rep" shorthand that cost them the desktop nav. A
// bare `role !== 'owner'` check would have made the identical mistake for a
// manager, who is a rep AND a supervisor at once.
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
  canReassign,
  canMoveStageBackward,
  pausedAtStage,
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

    // Tell the new owner, now. The notifications row already exists at this
    // point — the lead_assignment_notification trigger wrote it inside the
    // UPDATE above, which is precisely why this cannot be missed by a screen
    // that forgets to call something (see the migration's WHY A TRIGGER
    // note). All this does is ask the push sender to flush it immediately
    // rather than on its next 5-minute pass.
    //
    // NOT awaited, and its result is never read. The reassignment has already
    // committed; the scheduled run is the guarantee and this is only the
    // speed-up, so a slow or failed Edge Function must not hold up the UI or
    // surface an error for something that already worked.
    requestAssignmentPush()

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
        {canReassign && (
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

      {open === 'stage' && (
        <LeadStageSection
          lead={lead}
          leadTitle={leadTitle}
          canMoveStageBackward={canMoveStageBackward}
          pausedAtStage={pausedAtStage}
          onStageChanged={onStageChanged}
        />
      )}

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
