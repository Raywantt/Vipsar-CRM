import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { fetchUnseenAssignments, markNotificationsSeen, ASSIGNED_CARD_LIMIT } from '../lib/notificationQueries'
import { parseTimestamp } from '../lib/dbTime'
import { stageLabel } from '../lib/leadStageOptions'
import { stageChipClass } from '../lib/statusColors'

// "A lead has been handed to you" — the in-app half of the assignment
// notification (2026-09-12).
//
// WHY THIS EXISTS ALONGSIDE THE PUSH: a push notification is the only signal
// that reaches a pocketed phone, and it is also the one that is easiest to
// never receive. A rep who declined the permission prompt gets nothing. On an
// iPhone, web push does not work AT ALL unless the CRM has been installed to
// the home screen — which is most of this team. And a banner that arrives
// while the phone is locked is routinely swiped away with the rest. Without
// something inside the app, "you now own this lead" would still be a fact the
// rep can miss entirely, which is the bug this whole feature is fixing.
//
// It reads the same notifications rows the push sender does, but keys off
// seen_at rather than notified_at — the two are independent, so this card
// works identically whether or not a push was ever sent.

// A naive TIMESTAMP from this schema needs parseTimestamp, not new Date —
// see src/lib/dbTime.js. Getting that wrong here would read every assignment
// as 5½ hours older than it is, i.e. "yesterday" for most of the evening.
function relativeTime(value) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return null
  const minutes = Math.floor((Date.now() - d.getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

// The same fallback chain every other lead-naming surface in this app uses.
// `leads` comes back null when the lead has since been handed on again (RLS
// no longer matches it for this employee) — the notification is still real, so
// it is named rather than dropped.
function leadName(row) {
  return (
    row.leads?.parties?.name ||
    row.leads?.sites?.nickname ||
    row.leads?.sites?.locality ||
    (row.lead_id ? `Lead #${row.lead_id}` : 'A lead')
  )
}

function AssignedLeadsCard() {
  const { employee } = useAuth()
  const [rows, setRows] = useState([])
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!employee?.id) return
    fetchUnseenAssignments(employee.id).then(({ data }) => {
      // A failure here is silent on purpose: this card is additive, and an
      // error banner above the greeting for a table that may not be migrated
      // yet would be worse than the card simply not appearing.
      if (!cancelled) setRows(data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [employee?.id])

  if (!rows.length) return null

  // Optimistic in both handlers: the row is gone from the card the instant it
  // is acknowledged. A failed write means it reappears on the next load, which
  // is the safe direction to fail in — far better than a rep believing they
  // dismissed something they did not.
  async function dismissAll() {
    if (dismissing) return
    setDismissing(true)
    const ids = rows.map((r) => r.id)
    setRows([])
    await markNotificationsSeen(ids)
    setDismissing(false)
  }

  function acknowledgeOne(id) {
    setRows((prev) => prev.filter((r) => r.id !== id))
    markNotificationsSeen([id])
  }

  const heading = rows.length === 1 ? 'A lead was assigned to you' : `${rows.length} leads were assigned to you`

  return (
    <div className="vip-assigned-card" role="status" aria-live="polite">
      <div className="vip-assigned-head">
        <span className="vip-assigned-title">{heading}</span>
        <button type="button" className="vip-assigned-dismiss" onClick={dismissAll} disabled={dismissing}>
          Got it
        </button>
      </div>

      <div className="vip-assigned-rows">
        {rows.map((row) => {
          const when = relativeTime(row.created_at)
          const stage = row.leads?.current_stage
          return (
            <Link
              key={row.id}
              to={row.lead_id ? `/leads/${row.lead_id}` : '/'}
              className="vip-assigned-row"
              onClick={() => acknowledgeOne(row.id)}
            >
              <span className="vip-assigned-row-main">
                <span className="vip-assigned-lead">{leadName(row)}</span>
                <span className="vip-assigned-meta">
                  {row.actor?.name ? `Assigned by ${row.actor.name}` : 'Assigned to you'}
                  {when ? ` · ${when}` : ''}
                </span>
              </span>
              {stage && <span className={stageChipClass(stage)}>{stageLabel(stage)}</span>}
              <span className="vip-assigned-chevron">›</span>
            </Link>
          )
        })}
      </div>

      {/* The fetch is capped (ASSIGNED_CARD_LIMIT) so a rep handed a whole
          book of business gets a readable card rather than an endless one.
          Saying so beats silently truncating. */}
      {rows.length >= ASSIGNED_CARD_LIMIT && (
        <p className="vip-assigned-more">Showing the {ASSIGNED_CARD_LIMIT} most recent.</p>
      )}
    </div>
  )
}

export default AssignedLeadsCard
