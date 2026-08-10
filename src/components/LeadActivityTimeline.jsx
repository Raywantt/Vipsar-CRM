import { Link } from 'react-router-dom'
import { ACTIVITY_LABELS } from '../lib/activityTypes'
import { stageLabel } from '../lib/leadStageOptions'
import { parseTimestamp } from '../lib/dbTime'

// parseTimestamp, not new Date(): activities.created_at and
// stage_history.changed_at are naive TIMESTAMPs holding UTC, so a bare parse
// reads them as local and shifts them 5.5 hours back in IST — enough to date
// anything logged after 6:30 pm to the previous day. See src/lib/dbTime.js.
function formatWhen(value) {
  return parseTimestamp(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function LeadActivityTimeline({ activities, stageHistory, ownerHistory = [] }) {
  const entries = [
    ...stageHistory.map((h) => ({
      key: `stage-${h.id}`,
      at: h.changed_at,
      kind: 'Stage',
      title: `Stage changed to ${stageLabel(h.stage)}`,
      by: h.employees?.name ?? 'Unknown',
      byId: h.changed_by,
    })),
    ...activities.map((a) => ({
      key: `activity-${a.id}`,
      at: a.created_at,
      kind: 'Activity',
      title: ACTIVITY_LABELS[a.activity_type] ?? a.activity_type,
      by: a.employees?.name ?? 'Unknown',
      byId: a.employee_id,
      notes: a.notes,
      accompaniedBy: a.accompanied_by_employee?.name,
    })),
    ...ownerHistory.map((h) => ({
      key: `owner-${h.id}`,
      at: h.changed_at,
      kind: 'Ownership',
      title: h.old ? `Reassigned from ${h.old.name} to ${h.new?.name ?? 'Unknown'}` : `Assigned to ${h.new?.name ?? 'Unknown'}`,
      by: h.changed_by_employee?.name ?? 'Unknown',
      byId: h.changed_by,
    })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at))

  return (
    <div className="vip-card">
      <div className="vip-card-title">Activity</div>

      {entries.length === 0 ? (
        <p className="vip-empty">No activity yet.</p>
      ) : (
        entries.map((entry) => (
          <div key={entry.key} className="vip-timeline-item">
            <div className="vip-timeline-when">{formatWhen(entry.at)}</div>
            <div className="vip-timeline-main">
              <div className="vip-timeline-head">
                <div className="vip-timeline-title">{entry.title}</div>
                <div className="vip-tag">{entry.kind}</div>
              </div>
              {entry.notes && <div className="vip-timeline-detail">{entry.notes}</div>}
              <div className="vip-timeline-by">
                {entry.byId ? <Link to={`/employees/${entry.byId}`}>{entry.by}</Link> : entry.by}
                {entry.accompaniedBy ? ` · with ${entry.accompaniedBy}` : ''}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default LeadActivityTimeline
