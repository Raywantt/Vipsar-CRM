import { useState } from 'react'
import RfqSendBackForm from './RfqSendBackForm'
import { errorMessage } from '../lib/errorMessage'
import { isRfqMovedOnError } from '../lib/rfqDesk'
import { approveRfq, sendBackRfq } from '../lib/rfqQueries'

// The technical check's two decisions on one RFQ — Approve and Send back
// (RFQ-DESK.md Step 4). ONE implementation, rendered by the Production
// Executive's queue (TechnicalQueueCard) and by Lead Detail's RFQ card, so the
// two places that can approve an RFQ can't drift into different rules. Who
// sees it is the caller's `canReviewRfqs` test; the database's rfq_approve /
// rfq_send_back re-check role, test scope and status themselves.
//
// Owner's rulings (2026-10-06):
//   * Approve takes two taps — an approval can't be undone (it moves the lead
//     to RFQ Raised, alerts estimation and counts toward the exec's target),
//     and a queue sits under a thumb. Same shape as the BDM pool's Assign.
//   * Send back carries an optional note and nothing else (RFQ-DESK.md §3) —
//     RfqSendBackForm, shared with estimation.
//
// onDone(action, row) gets 'approved' | 'sent_back' and the updated RFQ with
// its name embeds patched in (the function returns the bare row). When the
// RFQ moved on before the click landed — someone else decided it, or the exec
// withdrew it — onMovedOn(message) gets the database's own explanation
// instead, so the caller can drop the row rather than show buttons that can
// only fail again.
function RfqReviewActions({ rfq, viewer, onDone, onMovedOn }) {
  const [mode, setMode] = useState('idle') // idle | approving | sendingBack
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function reset() {
    setMode('idle')
    setError(null)
  }

  async function run(action, note) {
    if (busy) return
    setBusy(true)
    setError(null)
    const { data, error: err } = action === 'approved' ? await approveRfq(rfq.id) : await sendBackRfq(rfq.id, note)
    setBusy(false)
    if (err) {
      if (isRfqMovedOnError(err) && onMovedOn) {
        onMovedOn(errorMessage(err))
        return
      }
      setError(errorMessage(err))
      return
    }
    const names = action === 'approved' ? { approver: { name: viewer?.name } } : { sender: { name: viewer?.name } }
    reset()
    onDone(action, { ...rfq, ...data, ...names })
  }

  return (
    <div className="vip-rfq-review">
      {mode === 'idle' && (
        <div className="vip-btn-row vip-rfq-review-row">
          <button type="button" className="vip-btn vip-btn-sm vip-rfq-action" onClick={() => setMode('approving')}>
            Approve
          </button>
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm vip-rfq-action" onClick={() => setMode('sendingBack')}>
            Send back
          </button>
        </div>
      )}

      {/* Two taps, never window.confirm (CLAUDE.md's "Cancel this target"). */}
      {mode === 'approving' && (
        <div className="vip-btn-row vip-rfq-confirm">
          <span className="vip-rfq-confirm-text">Approve and send it to estimation? This can't be undone.</span>
          <button type="button" className="vip-btn vip-btn-sm vip-rfq-action" disabled={busy} onClick={() => run('approved')}>
            {busy ? 'Approving…' : 'Yes, approve'}
          </button>
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm vip-rfq-action" disabled={busy} onClick={reset}>
            Cancel
          </button>
        </div>
      )}

      {mode === 'sendingBack' && (
        <RfqSendBackForm rfq={rfq} busy={busy} onSubmit={(note) => run('sent_back', note)} onCancel={reset} />
      )}

      {error && (
        <p className="vip-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default RfqReviewActions
