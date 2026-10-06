import { useState } from 'react'
import NumPadInput from './NumPadInput'
import RfqSendBackForm from './RfqSendBackForm'
import RfqWithdrawControl from './RfqWithdrawControl'
import { errorMessage } from '../lib/errorMessage'
import { formatCurrency } from '../lib/format'
import { todayISO } from '../lib/followupDates'
import { RFQ_STATUS, isRfqMovedOnError, quoteProblem, rfqRaisedDay } from '../lib/rfqDesk'
import { raiseRfqWithLixil, recordRfqQuote, sendBackRfq } from '../lib/rfqQueries'

// Estimation's decisions on one RFQ (RFQ-DESK.md Step 5) — ONE implementation,
// rendered by the Estimation Executive's lists (EstimationQueues) and by Lead
// Detail's RFQ card for canEstimateRfqs (Harpreet, and the owner covering),
// the way RfqReviewActions serves the technical check.
//
//   with estimation → "Raised with Lixil" (one tap — RFQ-DESK.md §3: the step
//                     exists to split Lixil's time from the desk's), and
//                     Send back with an optional note; a PRICE REVISION can't
//                     be sent back (rfq_send_back refuses it), so it offers
//                     Withdraw instead, to whoever started it or the owner.
//   with Lixil      → "Quote received": Lixil's reference, the value without
//                     GST and the quote date (today by default). It becomes
//                     the lead's quote value and the exec is told.
//
// onDone(action, row) — 'raised_with_lixil' | 'sent_back' | 'withdrawn' |
// 'quoted' — with name embeds patched in; onMovedOn(message) when the RFQ had
// already moved on (another person acted, the exec withdrew it).
function RfqEstimationActions({ rfq, viewer, onDone, onMovedOn }) {
  const [mode, setMode] = useState('idle') // idle | sendingBack | quoting
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [quote, setQuote] = useState(() => ({ ref: '', value: '', date: todayISO() }))

  const isPriceRevision = rfq.kind === 'price_revision'

  function reset() {
    setMode('idle')
    setError(null)
  }

  async function run(action, call, names = {}) {
    if (busy) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await call()
    setBusy(false)
    if (err) {
      if (isRfqMovedOnError(err) && onMovedOn) {
        onMovedOn(errorMessage(err))
        return
      }
      setError(errorMessage(err))
      return
    }
    reset()
    onDone(action, { ...rfq, ...data, ...names })
  }

  // Any edit clears the last message — a "enter the reference" left on screen
  // after the reference is typed reads as the form still refusing it.
  function editQuote(change) {
    setQuote((q) => ({ ...q, ...change }))
    setError(null)
  }

  function saveQuote() {
    const problem = quoteProblem(quote, rfq, todayISO())
    if (problem) {
      setError(problem)
      return
    }
    run('quoted', () => recordRfqQuote(rfq.id, quote))
  }

  if (rfq.status === RFQ_STATUS.WITH_ESTIMATION) {
    return (
      <div className="vip-rfq-review">
        {mode === 'idle' && (
          <div className="vip-btn-row vip-rfq-review-row">
            <button
              type="button"
              className="vip-btn vip-btn-sm vip-rfq-action"
              disabled={busy}
              onClick={() => run('raised_with_lixil', () => raiseRfqWithLixil(rfq.id))}
            >
              {busy ? 'Saving…' : 'Raised with Lixil'}
            </button>
            {!isPriceRevision && (
              <button
                type="button"
                className="vip-btn vip-btn-secondary vip-btn-sm vip-rfq-action"
                disabled={busy}
                onClick={() => setMode('sendingBack')}
              >
                Send back
              </button>
            )}
          </div>
        )}
        {mode === 'idle' && isPriceRevision && (
          <RfqWithdrawControl
            rfq={rfq}
            viewer={viewer}
            question="Withdraw this price revision? The current quote stays."
            onWithdrawn={(row) => onDone('withdrawn', row)}
            onMovedOn={onMovedOn}
          />
        )}
        {mode === 'sendingBack' && (
          <RfqSendBackForm
            rfq={rfq}
            busy={busy}
            onSubmit={(note) => run('sent_back', () => sendBackRfq(rfq.id, note), { sender: { name: viewer?.name } })}
            onCancel={reset}
          />
        )}
        {error && (
          <p className="vip-error" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }

  if (rfq.status !== RFQ_STATUS.WITH_LIXIL) return null

  const preview = quote.value !== '' && Number(quote.value) > 0 ? formatCurrency(Number(quote.value)) : null

  return (
    <div className="vip-rfq-review">
      {mode === 'idle' && (
        <div className="vip-btn-row vip-rfq-review-row">
          <button type="button" className="vip-btn vip-btn-sm vip-rfq-action" onClick={() => setMode('quoting')}>
            Quote received
          </button>
        </div>
      )}

      {mode === 'quoting' && (
        <div className="vip-rfq-quote-form">
          <label className="vip-field">
            Lixil quote reference *
            <input
              type="text"
              className="vip-input"
              value={quote.ref}
              onChange={(e) => editQuote({ ref: e.target.value })}
              placeholder="e.g. R26-118"
              maxLength={60}
              disabled={busy}
            />
          </label>
          <label className="vip-field">
            Value without GST *
            <NumPadInput
              variant="decimal"
              label="Value without GST"
              type="number"
              step="0.01"
              min="0"
              value={quote.value}
              onChange={(e) => editQuote({ value: e.target.value })}
              disabled={busy}
            />
          </label>
          {/* Read back in rupees, so a missed or extra zero shows before it
              becomes the lead's quote value. */}
          {preview && <p className="vip-rfq-facts vip-rfq-quote-preview">{preview} without GST</p>}
          <label className="vip-field">
            Quote date
            <input
              type="date"
              className="vip-input"
              value={quote.date}
              min={rfqRaisedDay(rfq) ?? undefined}
              max={todayISO()}
              onChange={(e) => editQuote({ date: e.target.value })}
              disabled={busy}
            />
          </label>
          <p className="vip-rfq-facts">
            Becomes the lead's quote value; {rfq.raised_by?.name ?? 'the exec'} is told the quote is in.
          </p>
          <div className="vip-btn-row vip-rfq-review-row">
            <button type="button" className="vip-btn vip-btn-sm vip-rfq-action" disabled={busy} onClick={saveQuote}>
              {busy ? 'Saving…' : 'Save quote'}
            </button>
            <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm vip-rfq-action" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="vip-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default RfqEstimationActions
