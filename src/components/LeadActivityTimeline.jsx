import { ACTIVITY_LABELS } from '../lib/activityTypes'
import '../pages/LeadDetail.css'

function formatWhen(value) {
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function LeadActivityTimeline({ activities, stageHistory }) {
  const entries = [
    ...stageHistory.map((h) => ({
      key: `stage-${h.id}`,
      at: h.changed_at,
      kind: 'stage',
      title: `Stage changed to ${h.stage}`,
      by: h.employees?.name ?? 'Unknown',
    })),
    ...activities.map((a) => ({
      key: `activity-${a.id}`,
      at: a.created_at,
      kind: 'activity',
      title: ACTIVITY_LABELS[a.activity_type] ?? a.activity_type,
      by: a.employees?.name ?? 'Unknown',
      notes: a.notes,
      accompaniedBy: a.accompanied_by_employee?.name,
    })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at))

  return (
    <section className="lead-section">
      <h2>Activity</h2>

      {entries.length === 0 ? (
        <p className="lead-section-subhead">No activity yet.</p>
      ) : (
        <ul className="lead-timeline">
          {entries.map((entry) => (
            <li key={entry.key} className={`lead-timeline-entry lead-timeline-entry-${entry.kind}`}>
              <p className="lead-timeline-title">{entry.title}</p>
              <p className="lead-timeline-meta">
                {entry.by} — {formatWhen(entry.at)}
                {entry.accompaniedBy ? ` — with ${entry.accompaniedBy}` : ''}
              </p>
              {entry.notes && <p className="lead-timeline-notes">{entry.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default LeadActivityTimeline
