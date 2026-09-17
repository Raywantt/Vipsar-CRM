import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FollowUpList from './FollowUpList'
import {
  FOLLOW_UP_OPEN,
  canCloseByLogging,
  cancelFollowUp,
  logActivityPathFor,
  markFollowUpDone,
  reopenFollowUp,
  rescheduleFollowUp,
} from '../lib/followUpQueries'
import { errorMessage } from '../lib/errorMessage'

// A lead's own reminders on Lead Detail (owner's layout call, 2026-09-16):
// open ones with every action, closed ones behind a link, nothing at all when
// the lead has none. Which rows appear is RLS's call — a rep viewing a
// colleague's lead sees only reminders assigned to themselves, if any.
//
//   followUps     every reminder on this lead, already in compareFollowUps order
//   viewer        the logged-in employee
//   canLogHere    Lead Detail's own "may this viewer log an activity on this
//                 lead" flag, ANDed with canCloseByLogging per row
//   onChanged     (row) => void, after any successful write
function LeadFollowUpsCard({ followUps, viewer, canLogHere, onChanged }) {
  const navigate = useNavigate()
  const [showClosed, setShowClosed] = useState(false)
  const [error, setError] = useState(null)

  if (followUps.length === 0) return null

  const open = followUps.filter((f) => f.status === FOLLOW_UP_OPEN)
  const closed = followUps.filter((f) => f.status !== FOLLOW_UP_OPEN)

  async function run(write) {
    const { data, error: writeError } = await write
    if (writeError) return setError(errorMessage(writeError))
    setError(null)
    onChanged(data)
  }

  const handlers = {
    viewerId: viewer?.id,
    onMarkDone: (id) => run(markFollowUpDone(id)),
    onCancel: (id, reason) => run(cancelFollowUp(id, reason)),
    onReschedule: (id, dueDate) => run(rescheduleFollowUp(id, dueDate)),
    onReopen: (id) => run(reopenFollowUp(id)),
    onLogActivity: (f) => {
      const path = logActivityPathFor(f)
      if (path) navigate(path)
    },
    canLogActivityFor: (f) => canLogHere && canCloseByLogging(viewer, f),
  }

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <h2 className="vip-card-title">Follow-ups</h2>
        {open.length > 0 && <span className="vip-card-note">{open.length} open</span>}
      </div>
      {error && (
        <p className="vip-error" role="alert">
          {error}
        </p>
      )}
      <FollowUpList followUps={open} emptyLabel="No open reminders." {...handlers} />
      {closed.length > 0 && (
        <>
          <button type="button" className="vip-btn-link" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Hide closed' : `Show closed (${closed.length})`}
          </button>
          {showClosed && <FollowUpList followUps={closed} {...handlers} />}
        </>
      )}
    </div>
  )
}

export default LeadFollowUpsCard
