import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FollowUpList from './FollowUpList'
import ShowMoreRows from './ShowMoreRows'
import { canCloseByLogging, cancelFollowUp, logActivityPathFor, markFollowUpDone, rescheduleFollowUp } from '../lib/followUpQueries'
import { errorMessage } from '../lib/errorMessage'

const ROW_CHUNK = 5

// Open architect follow-ups — the "next meeting" agenda (BDM.md Step 7). The
// owner's ruling: an architect's next meeting is a plain follow-up, set from
// Architect Meeting's "Next follow-up" and closed by logging the next meeting
// through "Log activity & close", exactly as an exec works a lead. So this is
// FollowUpList with its usual actions, nothing meeting-specific; a past-due row
// reads "Missed" like everywhere else.
//
// ONE card for both mounts (My Architects, the architect profile), which differ
// only in what they load. Renders nothing while empty — neither page needs a
// second empty state beside its own.
//
//   load     () => Promise<{ data, error }>  rows from FOLLOW_UP_SELECT, due-date order
//   loadKey  changes when `load` would return something different
function ArchitectFollowUpsCard({ employee, load, loadKey, title = 'Follow-ups', className = 'vip-card' }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [shown, setShown] = useState(ROW_CHUNK)

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    load().then(({ data, error: loadError }) => {
      if (!active) return
      if (loadError) setError(errorMessage(loadError))
      setRows(data ?? [])
    })
    return () => {
      active = false
    }
    // `load` is a fresh closure every render; loadKey is what identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id, loadKey])

  async function run(write, apply) {
    const { data, error: writeError } = await write()
    if (writeError) return setError(errorMessage(writeError))
    setError(null)
    setRows((prev) => apply(prev ?? [], data))
  }

  const dropRow = (id) => (prev) => prev.filter((f) => f.id !== id)

  if (rows === null || (rows.length === 0 && !error)) return null

  return (
    <div className={className}>
      <div className="vip-card-head">
        <h2 className="vip-card-title">{title}</h2>
        <span className="vip-bdm-list-count">{rows.length}</span>
      </div>
      {error && (
        <p className="vip-error" role="alert">
          {error}
        </p>
      )}
      <FollowUpList
        followUps={rows.slice(0, shown)}
        viewerId={employee.id}
        onMarkDone={(id) => run(() => markFollowUpDone(id), dropRow(id))}
        onCancel={(id, reason) => run(() => cancelFollowUp(id, reason), dropRow(id))}
        onReschedule={(id, dueDate) =>
          run(
            () => rescheduleFollowUp(id, dueDate),
            (prev, data) =>
              prev.map((f) => (f.id === id ? data : f)).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
          )
        }
        onLogActivity={(f) => {
          const path = logActivityPathFor(f)
          if (path) navigate(path)
        }}
        canLogActivityFor={(f) => canCloseByLogging(employee, f)}
      />
      <ShowMoreRows
        shown={Math.min(shown, rows.length)}
        total={rows.length}
        noun="follow-ups"
        onShowMore={() => setShown((n) => n + ROW_CHUNK)}
      />
    </div>
  )
}

export default ArchitectFollowUpsCard
