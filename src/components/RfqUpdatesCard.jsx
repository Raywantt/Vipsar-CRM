import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { isRfqDeskRole } from '../lib/roles'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { markNotificationsSeen } from '../lib/notificationQueries'
import { fetchUnseenRfqUpdates, RFQ_UPDATES_LIMIT } from '../lib/rfqQueries'
import { parseTimestamp } from '../lib/dbTime'
import { leadDisplayName } from '../lib/leadName'
import { quoteSummary, revisionLabel } from '../lib/rfqDesk'

// "An RFQ was sent back" / "A quote came in" — the in-app half of the RFQ
// desk's two alerts to whoever raises RFQs (RFQ-DESK.md Step 3, owner's
// placement 2026-10-06: a line at the top of Today). Since Step 4 it also
// carries "An RFQ you approved was sent back" to whoever approved an RFQ that
// estimation then bounced — the Production Executive's Today.
//
// It exists beside the push for the reason AssignedLeadsCard does: a push is
// the easiest signal to never receive (permission declined, or an iPhone that
// hasn't installed the app). It keys off seen_at, not notified_at, so it
// works the same whether or not a push went out.
//
// Mounted once, inside TodayGreetingHeader, so every Today screen has it —
// an exec's, a coordinator's (they get the alerts for RFQs they logged on an
// exec's behalf), a manager's, a BDM's. Returns null when there's nothing,
// and for a role that never receives these kinds it simply finds no rows.
// Same look as AssignedLeadsCard (its vip-assigned-* classes): both are work
// arriving, not an alarm.

// A naive TIMESTAMP (notifications.created_at) — parseTimestamp, never
// new Date, or every alert reads 5½ hours old (src/lib/dbTime.js).
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

function leadName(row) {
  if (row.leads) return leadDisplayName(row.leads)
  return row.lead_id ? `Lead #${row.lead_id}` : 'A lead'
}

const NOTE_PREVIEW_LEN = 140
function previewNote(text) {
  if (!text) return null
  return text.length > NOTE_PREVIEW_LEN ? `${text.slice(0, NOTE_PREVIEW_LEN).trimEnd()}…` : text
}

// The line under the lead's name. `rfqs` is null when the viewer can no
// longer read the lead (handed on since) — the alert is still real, so it
// says what happened without the detail.
function describe(row) {
  const rfq = row.rfqs
  const rev = rfq ? `${revisionLabel(rfq)} · ` : ''
  if (row.kind === 'rfq_quote_ready') {
    return `${rev}Quote in${rfq && quoteSummary(rfq) ? ` — ${quoteSummary(rfq)}` : ''}`
  }
  // An RFQ the viewer approved, sent back at estimation (Step 4). Kept short,
  // first name only: the line is single-line and clips, and a longer one cut
  // off the time on a phone. "You approved it" is the heading's job (and every
  // row the desk gets is this kind).
  if (row.kind === 'rfq_bounced') {
    const first = row.actor?.name?.trim().split(/\s+/)[0]
    return `${rev}Sent back at estimation${first ? ` by ${first}` : ''}`
  }
  const from = rfq?.sent_back_from === 'estimation' ? 'estimation' : rfq ? 'the technical check' : null
  return `${rev}Sent back${from ? ` from ${from}` : ''}${row.actor?.name ? ` by ${row.actor.name}` : ''}`
}

const SINGLE_HEADINGS = {
  rfq_sent_back: 'An RFQ was sent back',
  rfq_quote_ready: 'A quote came in',
  rfq_bounced: 'An RFQ you approved was sent back',
}

const PLURAL_HEADINGS = {
  rfq_sent_back: (n) => `${n} RFQs were sent back`,
  rfq_quote_ready: (n) => `${n} quotes came in`,
  rfq_bounced: (n) => `${n} RFQs you approved were sent back`,
}

function RfqUpdatesCard() {
  const { employee } = useAuth()
  const [rows, setRows] = useState([])
  const [dismissing, setDismissing] = useState(false)

  // Remembered on the device like the rest of Today, and seeded into state
  // because "Got it" and each row's tap remove rows the moment they're
  // acknowledged — AssignedLeadsCard's pattern.
  const query = useCachedQuery(['today', 'rfq-updates', employee?.id], () => fetchUnseenRfqUpdates(employee.id), {
    enabled: Boolean(employee?.id),
  })
  useEffect(() => {
    // Silent on failure, like AssignedLeadsCard: an additive line is better
    // absent than an error above the greeting.
    if (query.result && !query.result.error) setRows(query.result.data ?? [])
  }, [query.result])

  if (!rows.length) return null
  const deskViewer = isRfqDeskRole(employee?.role)

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

  // Each row says what happened, so the heading only has to count them — and
  // name the kind when they're all one kind (the desk's line is always
  // bounces, and its rows lean on the heading for "you approved").
  const kinds = new Set(rows.map((r) => r.kind))
  const onlyKind = kinds.size === 1 ? rows[0].kind : null
  const heading =
    rows.length === 1
      ? (SINGLE_HEADINGS[onlyKind] ?? 'An RFQ update')
      : (onlyKind && PLURAL_HEADINGS[onlyKind]?.(rows.length)) ?? `${rows.length} RFQ updates`

  return (
    <div className="vip-assigned-card" role="status" aria-live="polite">
      <div className="vip-assigned-head">
        <h2 className="vip-assigned-title">{heading}</h2>
        <button type="button" className="vip-assigned-dismiss" onClick={dismissAll} disabled={dismissing}>
          Got it
        </button>
      </div>

      <div className="vip-assigned-rows">
        {rows.map((row) => {
          const when = relativeTime(row.created_at)
          const note = row.kind !== 'rfq_quote_ready' ? previewNote(row.rfqs?.send_back_note) : null
          const body = (
            <span className="vip-assigned-row-main">
              <span className="vip-assigned-lead">{leadName(row)}</span>
              <span className="vip-assigned-meta">
                {describe(row)}
                {when ? ` · ${when}` : ''}
              </span>
              {note && <span className="vip-assigned-remark">"{note}"</span>}
            </span>
          )
          // The desk reads only the leads in its own process (owner's ruling,
          // 2026-10-06): an RFQ sent back at estimation has left the
          // Production Executive's, so the row tells them what happened but
          // doesn't open a page they can no longer read. "Got it" clears it.
          if (deskViewer) {
            return (
              <div key={row.id} className="vip-assigned-row">
                {body}
              </div>
            )
          }
          return (
            <Link
              key={row.id}
              to={row.lead_id ? `/leads/${row.lead_id}` : '/'}
              className="vip-assigned-row"
              onClick={() => acknowledgeOne(row.id)}
            >
              {body}
              <span className="vip-assigned-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          )
        })}
      </div>

      {rows.length >= RFQ_UPDATES_LIMIT && (
        <p className="vip-assigned-more">Showing the latest {RFQ_UPDATES_LIMIT}. Open each lead to see the rest.</p>
      )}
    </div>
  )
}

export default RfqUpdatesCard
