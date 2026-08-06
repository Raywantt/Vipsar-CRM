import { Link } from 'react-router-dom'
import { ACTIVITY_LABELS } from '../lib/activityTypes'

function formatDueDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function formatDueTime(timeStr) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':')
  const d = new Date()
  d.setHours(Number(h), Number(m))
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

// Shared row list for Home's "Your reminders" and EmployeeProfile's
// "Follow-ups" cards. No outer <Link> wraps the row (unlike most list cards
// in this app), so the party/lead link and the assignor link are both plain
// <Link>s rather than EmployeeLink — EmployeeLink exists specifically for
// nesting inside an already-clickable row, which this isn't.
function FollowUpList({ followUps, onMarkDone, emptyLabel = 'Nothing here.' }) {
  if (!followUps.length) return <p className="vip-empty">{emptyLabel}</p>

  return (
    <>
      {followUps.map((f) => {
        const assignedByOther = f.created_by !== f.assigned_to
        const dueTime = formatDueTime(f.due_time)
        return (
          <div key={f.id} className="vip-row">
            <div className="vip-row-main" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <input
                type="checkbox"
                checked={f.is_done}
                disabled={f.is_done}
                onChange={() => onMarkDone(f.id)}
                style={{ width: 18, height: 18, accentColor: 'var(--vip-teal)', marginTop: 3, flex: '0 0 auto' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div
                  className="vip-row-title"
                  style={f.is_done ? { textDecoration: 'line-through', color: 'var(--vip-muted)' } : undefined}
                >
                  {f.title}
                </div>
                <div className="vip-row-sub">
                  {f.activity_type && (ACTIVITY_LABELS[f.activity_type] ?? 'Other')}
                  {f.activity_type && (f.lead_id || f.party_id) ? ' · ' : ''}
                  {f.lead_id ? <Link to={`/leads/${f.lead_id}`}>{f.parties?.name}</Link> : f.parties?.name}
                </div>
                {f.notes && <div className="vip-row-sub">{f.notes}</div>}
                {assignedByOther && (
                  <div className="vip-row-sub">
                    Assigned by <Link to={`/employees/${f.created_by}`}>{f.created_by_employee?.name ?? 'Owner'}</Link>
                  </div>
                )}
              </div>
            </div>
            <div className="vip-row-side">
              <div className="vip-row-value">{formatDueDate(f.due_date)}</div>
              {dueTime && <div className="vip-row-meta">{dueTime}</div>}
            </div>
          </div>
        )
      })}
    </>
  )
}

export default FollowUpList
