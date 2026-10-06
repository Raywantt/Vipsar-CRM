import { useState } from 'react'
import ShowMoreRows from './ShowMoreRows'
import RfqReviewActions from './RfqReviewActions'
import RfqEstimationActions from './RfqEstimationActions'
import RfqWithdrawControl from './RfqWithdrawControl'
import { errorMessage } from '../lib/errorMessage'
import { canEstimateRfqs, canReviewRfqs, isRfqDeskRole } from '../lib/roles'
import { formatDateShort } from '../lib/format'
import { TONE_GOOD, TONE_GOOD_SOFT, TONE_MID, TONE_NEUTRAL, TONE_NEUTRAL_SOFT, TONE_WARN_INK, TONE_WARN_SOFT } from '../lib/statusColors'
import {
  RFQ_STATUS,
  canStartPriceRevision,
  isRfqOpen,
  latestDeskQuote,
  quoteSentToClient,
  quoteSummary,
  revisionLabel,
  rfqStatusLabel,
  rfqStepSince,
  daysAgoLabel,
  segmentsLabel,
  sortRfqsNewestFirst,
} from '../lib/rfqDesk'
import { markQuoteSentToClient, startPriceRevision } from '../lib/rfqQueries'

// Lead Detail's RFQ card (RFQ-DESK.md Step 3, owner's placement 2026-10-06:
// the main column, under Deal progress). One row per desk RFQ, newest first:
// where it is and for how long, why it came back, the quote, and the two
// things an exec can do from here — withdraw an RFQ still with the desk, and
// mark a received quote as sent to the client.
//
// Renders nothing on a lead with no desk RFQ (every lead before launch day),
// the same "no card at all when there are none" rule LeadFollowUpsCard keeps.
// Every role that can open the lead sees the same rows — RLS has already
// decided which RFQs they may read; only the actions are gated.
//
// The desk's own actions live on this same card too, each the SAME component
// the desk's own screen renders, so a lead and a queue can't offer different
// rules:
//   Step 4 — Approve / Send back at the technical check (RfqReviewActions),
//            for canReviewRfqs: the Production Executive, the owner covering.
//   Step 5 — Raised with Lixil / Send back / Quote received
//            (RfqEstimationActions) for canEstimateRfqs: the Estimation
//            Executive, the owner covering; and "Start a price revision" on
//            the current quote (owner's ruling: price revisions start here,
//            not on Today).

const ROWS_SHOWN = 3

const STATUS_TONE = {
  [RFQ_STATUS.QUOTED]: { bg: TONE_GOOD_SOFT, fg: TONE_GOOD },
  // The -ink token, not TONE_WARN: plain warn on its soft fill measured 3.1:1
  // (Step 4 — theme section 45's note).
  [RFQ_STATUS.SENT_BACK]: { bg: TONE_WARN_SOFT, fg: TONE_WARN_INK },
  [RFQ_STATUS.WITHDRAWN]: { bg: TONE_NEUTRAL_SOFT, fg: TONE_NEUTRAL },
}
const OPEN_TONE = { bg: 'var(--vip-canvas-2)', fg: TONE_MID }

// "4 Oct" — formatDateShort reads both a DATE and a timestamp correctly; the
// year is dropped while it's this year, since every RFQ here is recent.
function shortDay(value) {
  const label = formatDateShort(value)
  const year = String(new Date().getFullYear())
  return label?.endsWith(` ${year}`) ? label.slice(0, -year.length - 1) : label
}

function firstName(embed) {
  return embed?.name?.trim().split(/\s+/)[0] ?? null
}

// What the card says after a desk decision made on it.
function decisionNotice(action, rfq) {
  const rev = revisionLabel(rfq)
  switch (action) {
    case 'approved':
      return `${rev} approved — it's with estimation.`
    case 'sent_back':
      return `${rev} sent back to ${rfq.raised_by?.name ?? 'the exec'}.`
    case 'raised_with_lixil':
      return `${rev} raised with Lixil.`
    case 'quoted':
      return `Quote saved for ${rev}: ${quoteSummary(rfq) ?? 'recorded'}. It's now the lead's quote value.`
    case 'withdrawn':
      return `${rev} withdrawn.`
    default:
      return `${rev} updated.`
  }
}

// onRfqDecided(updated) — after a desk decision (approve / send back): the
// page swaps the row in AND re-reads the lead, since an approval can move its
// stage. onRfqsStale() — the RFQ had moved on before the click landed; the
// page re-reads this lead's RFQs.
function LeadRfqCard({
  rfqs,
  lead,
  viewer,
  canMarkQuoteSent,
  onRfqUpdated,
  onLeadUpdated,
  onRfqDecided,
  onRfqsStale,
  onRfqCreated,
}) {
  const [visible, setVisible] = useState(ROWS_SHOWN)
  const [notice, setNotice] = useState(null)
  if (!rfqs?.length) return null

  const sorted = sortRfqsNewestFirst(rfqs)
  // The one quote "Mark sent" belongs to — the latest the desk recorded. An
  // older quote that a newer revision has replaced isn't the one going out.
  const currentQuoteId = latestDeskQuote(rfqs)?.id ?? null
  // Lixil changed its prices (Step 5): offered on the current quote only, and
  // not while a price revision of it is already open — canStartPriceRevision
  // mirrors rfq_start_price_revision().
  const canRevisePrice = canStartPriceRevision(rfqs, viewer?.role)

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <h2 className="vip-card-title">RFQs</h2>
        <span className="vip-card-note">{rfqs.length === 1 ? '1 submission' : `${rfqs.length} submissions`}</span>
      </div>
      {notice && (
        <p className={notice.tone === 'success' ? 'vip-success' : 'vip-error'} role="status" aria-live="polite">
          {notice.text}
        </p>
      )}
      <div className="vip-rfq-rows">
        {sorted.slice(0, visible).map((rfq) => (
          <RfqRow
            key={rfq.id}
            rfq={rfq}
            lead={lead}
            viewer={viewer}
            isCurrentQuote={rfq.id === currentQuoteId}
            canMarkQuoteSent={canMarkQuoteSent}
            onRfqUpdated={onRfqUpdated}
            onLeadUpdated={onLeadUpdated}
            canRevisePrice={canRevisePrice && rfq.id === currentQuoteId}
            onDecided={(action, updated) => {
              setNotice({ tone: 'success', text: decisionNotice(action, updated) })
              onRfqDecided(updated)
            }}
            onPriceRevisionStarted={(created) => {
              setNotice({
                tone: 'success',
                text: `${revisionLabel(created)} started — it's waiting for estimation. The current quote stays until the new one is in.`,
              })
              onRfqCreated(created)
            }}
            onMovedOn={(message) => {
              setNotice({ tone: 'error', text: message })
              onRfqsStale()
            }}
          />
        ))}
      </div>
      <ShowMoreRows
        shown={Math.min(visible, sorted.length)}
        total={sorted.length}
        noun="earlier"
        onShowMore={() => setVisible((v) => v + ROWS_SHOWN)}
      />
    </div>
  )
}

function RfqRow({
  rfq,
  lead,
  viewer,
  isCurrentQuote,
  canMarkQuoteSent,
  canRevisePrice,
  onRfqUpdated,
  onLeadUpdated,
  onDecided,
  onMovedOn,
  onPriceRevisionStarted,
}) {
  const [confirmingRevision, setConfirmingRevision] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const tone = STATUS_TONE[rfq.status] ?? OPEN_TONE
  const age = daysAgoLabel(rfqStepSince(rfq))
  const raisedBy = rfq.raised_by?.name
  const loggedBySomeoneElse =
    rfq.logged_by_employee_id != null && rfq.logged_by_employee_id !== rfq.raised_by_employee_id ? rfq.logged_by?.name : null

  const facts = [
    rfq.kind === 'price_revision'
      ? `Started ${shortDay(rfq.raised_at) ?? ''}${rfq.logged_by?.name ? ` by ${rfq.logged_by.name}` : ''}`
      : `Raised ${shortDay(rfq.raised_at) ?? ''}${raisedBy ? ` by ${raisedBy}` : ''}${loggedBySomeoneElse ? ` (logged by ${loggedBySomeoneElse})` : ''}`,
    rfq.window_count ? `${rfq.window_count} ${rfq.window_count === 1 ? 'window' : 'windows'}` : null,
    segmentsLabel(rfq.segments),
  ].filter(Boolean)

  // Estimation's actions on this row (Step 5) — the Estimation Executive, or
  // the owner covering — the same RfqEstimationActions their lists render.
  const showEstimationActions =
    (rfq.status === RFQ_STATUS.WITH_ESTIMATION || rfq.status === RFQ_STATUS.WITH_LIXIL) && canEstimateRfqs(viewer?.role)

  async function handleStartRevision() {
    setBusy(true)
    setError(null)
    const { data, error: err } = await startPriceRevision(lead.id)
    setBusy(false)
    if (err) {
      setError(errorMessage(err))
      return
    }
    setConfirmingRevision(false)
    // The function returns the bare row; give it the names the card shows —
    // credited to the lead's owner, started by whoever pressed it.
    onPriceRevisionStarted({
      ...data,
      raised_by: lead.employees?.name ? { name: lead.employees.name } : null,
      logged_by: { name: viewer?.name },
    })
  }

  async function handleMarkSent() {
    setBusy(true)
    setError(null)
    const { data, error: err } = await markQuoteSentToClient(lead.id)
    setBusy(false)
    if (err) {
      setError(errorMessage(err))
      return
    }
    onLeadUpdated(data)
  }

  return (
    <div className="vip-rfq-row">
      <div className="vip-rfq-row-head">
        <span className="vip-rfq-rev">{revisionLabel(rfq)}</span>
        <span className="vip-pill" style={{ background: tone.bg, color: tone.fg }}>
          {rfqStatusLabel(rfq.status)}
        </span>
        {age && (
          <span className="vip-rfq-age">{isRfqOpen(rfq) ? `waiting ${age}` : age === 'today' ? 'today' : `${age} ago`}</span>
        )}
      </div>
      <div className="vip-rfq-facts">{facts.join(' · ')}</div>

      {rfq.status === RFQ_STATUS.WITH_ESTIMATION && rfq.approved_at && (
        <div className="vip-rfq-facts">
          Approved {shortDay(rfq.approved_at)}
          {firstName(rfq.approver) ? ` by ${firstName(rfq.approver)}` : ''}
        </div>
      )}

      {rfq.status === RFQ_STATUS.SENT_BACK && (
        <div className="vip-rfq-sentback">
          <div className="vip-rfq-facts">
            Sent back from {rfq.sent_back_from === 'estimation' ? 'estimation' : 'the technical check'}
            {firstName(rfq.sender) ? ` by ${firstName(rfq.sender)}` : ''}
            {shortDay(rfq.sent_back_at) ? ` · ${shortDay(rfq.sent_back_at)}` : ''}
          </div>
          {/* The note is optional (RFQ-DESK.md §3) — the details may only be in
              the email, and saying so beats an empty space. */}
          <div className="vip-rfq-note">
            {rfq.send_back_note ? `"${rfq.send_back_note}"` : 'No note — check your email for the details.'}
          </div>
          {/* Advice for whoever raises RFQs — not the desk, who can't log one. */}
          {!isRfqDeskRole(viewer?.role) && <div className="vip-rfq-facts">Log a revised RFQ Raised once it's fixed.</div>}
        </div>
      )}

      {rfq.status === RFQ_STATUS.QUOTED && (
        <div className="vip-rfq-quote">
          <span className="vip-rfq-quote-value">{quoteSummary(rfq)}</span>
          <span className="vip-rfq-facts">without GST</span>
          {/* Sent = marked sent on or after the day THIS quote came in. A
              revision or price revision is a new figure: an earlier quote's
              "sent" date doesn't cover it, and Needs Attention keeps it under
              "RFQs back with the exec" until it is marked (Step 6). */}
          {isCurrentQuote &&
            (quoteSentToClient(lead, rfq) ? (
              <span className="vip-rfq-facts">
                Sent to client{lead.quote_sent_at ? ` ${shortDay(lead.quote_sent_at)}` : ''}
              </span>
            ) : (
              canMarkQuoteSent && (
                <button type="button" className="vip-btn vip-btn-sm vip-rfq-action" onClick={handleMarkSent} disabled={busy}>
                  {busy ? 'Saving…' : 'Mark quote sent to client'}
                </button>
              )
            ))}
        </div>
      )}

      {/* Lixil changed its prices (Step 5, owner's ruling: started here, on the
          current quote). Two taps — it opens a new RFQ the exec will hear
          about when its quote lands. */}
      {canRevisePrice &&
        (confirmingRevision ? (
          <div className="vip-btn-row vip-rfq-confirm">
            <span className="vip-rfq-confirm-text">
              Start a price revision of this quote? It goes straight to estimation, skipping the technical check.
            </span>
            <button type="button" className="vip-btn vip-btn-sm vip-rfq-action" disabled={busy} onClick={handleStartRevision}>
              {busy ? 'Starting…' : 'Start price revision'}
            </button>
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm vip-rfq-action"
              disabled={busy}
              onClick={() => setConfirmingRevision(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="vip-btn-link vip-rfq-revise" onClick={() => setConfirmingRevision(true)}>
            Start a price revision
          </button>
        ))}

      {rfq.status === RFQ_STATUS.WITHDRAWN && (
        <div className="vip-rfq-facts">
          Withdrawn {shortDay(rfq.withdrawn_at)}
          {firstName(rfq.withdrawer) ? ` by ${firstName(rfq.withdrawer)}` : ''}
        </div>
      )}

      {/* The technical check's decision (Step 4) — the Production Executive,
          or the owner covering. */}
      {rfq.status === RFQ_STATUS.WITH_TECHNICAL && canReviewRfqs(viewer?.role) && (
        <RfqReviewActions rfq={rfq} viewer={viewer} onDone={onDecided} onMovedOn={onMovedOn} />
      )}

      {showEstimationActions && (
        <RfqEstimationActions rfq={rfq} viewer={viewer} onDone={onDecided} onMovedOn={onMovedOn} />
      )}

      {/* Withdraw — RfqWithdrawControl renders nothing unless canWithdrawRfq.
          Estimation's actions already offer it on a price revision (which
          can't be sent back), so it isn't drawn twice there. */}
      {!(showEstimationActions && rfq.kind === 'price_revision') && (
        <RfqWithdrawControl rfq={rfq} viewer={viewer} onWithdrawn={onRfqUpdated} onMovedOn={onMovedOn} />
      )}

      {error && (
        <p className="vip-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default LeadRfqCard
