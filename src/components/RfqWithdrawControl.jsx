import { useState } from 'react'
import { errorMessage } from '../lib/errorMessage'
import { canWithdrawRfq, isRfqMovedOnError } from '../lib/rfqDesk'
import { withdrawRfq } from '../lib/rfqQueries'

// "Withdraw this RFQ" — a link that expands to a two-step confirm (never
// window.confirm; the same shape as "Cancel this target"). Renders nothing
// unless canWithdrawRfq(): the credited exec, whoever logged it, or the owner,
// while it is with the technical check or estimation (rfq_withdraw() in SQL is
// the boundary). Moved out of Lead Detail's RFQ card at Step 5 so the
// Estimation Executive's list can offer it too — on a price revision they
// started (they "logged" it), which can't be sent back, only withdrawn.
//
// onWithdrawn(row) gets the updated RFQ with the withdrawer's name patched in;
// onMovedOn(message), when given, is called if the RFQ had already moved on.
function RfqWithdrawControl({ rfq, viewer, onWithdrawn, onMovedOn, question = 'Take this RFQ back from the desk?' }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!canWithdrawRfq(rfq, viewer)) return null

  async function handleWithdraw() {
    setBusy(true)
    setError(null)
    const { data, error: err } = await withdrawRfq(rfq.id)
    setBusy(false)
    if (err) {
      if (isRfqMovedOnError(err) && onMovedOn) {
        onMovedOn(errorMessage(err))
        return
      }
      setError(errorMessage(err))
      return
    }
    setConfirming(false)
    // The function returns the bare row; keep the name embeds the card reads.
    onWithdrawn({ ...rfq, ...data, withdrawer: { name: viewer?.name } })
  }

  return (
    <>
      {confirming ? (
        <div className="vip-btn-row vip-rfq-confirm">
          <span className="vip-rfq-confirm-text">{question}</span>
          <button type="button" className="vip-btn vip-btn-danger vip-btn-sm vip-rfq-action" disabled={busy} onClick={handleWithdraw}>
            {busy ? 'Withdrawing…' : 'Withdraw'}
          </button>
          <button
            type="button"
            className="vip-btn vip-btn-secondary vip-btn-sm vip-rfq-action"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" className="vip-btn-link vip-rfq-withdraw" onClick={() => setConfirming(true)}>
          Withdraw this RFQ
        </button>
      )}
      {error && (
        <p className="vip-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

export default RfqWithdrawControl
