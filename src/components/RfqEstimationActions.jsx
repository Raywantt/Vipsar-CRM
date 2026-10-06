import { useState } from 'react'
import NumPadInput from './NumPadInput'
import RfqSendBackForm from './RfqSendBackForm'
import RfqWithdrawControl from './RfqWithdrawControl'
import { errorMessage } from '../lib/errorMessage'
import { formatCurrency } from '../lib/format'
import { todayISO } from '../lib/followupDates'
import { RFQ_STATUS, isRfqMovedOnError, quoteProblem, rfqRaisedDay } from '../lib/rfqDesk'
import { raiseRfqWithLixil, recordRfqQuoteLines, sendBackRfq } from '../lib/rfqQueries'
import { useProductMap } from '../hooks/useProductMap'
import { productsOf } from '../lib/productShares'

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
//   with Lixil      → "Quote received": Lixil's reference, ONE VALUE PER
//                     PRODUCT on the RFQ, without GST (owner's ruling,
//                     2026-10-06 — all required), and the quote date (today
//                     by default). Their sum becomes the lead's quote value,
//                     the split its quote_lines, and the exec is told
//                     (rfq_record_quote_lines).
//
// onDone(action, row) — 'raised_with_lixil' | 'sent_back' | 'withdrawn' |
// 'quoted' — with name embeds patched in; onMovedOn(message) when the RFQ had
// already moved on (another person acted, the exec withdrew it).
function RfqEstimationActions({ rfq, viewer, onDone, onMovedOn }) {
  const [mode, setMode] = useState('idle') // idle | sendingBack | quoting
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [quote, setQuote] = useState(() => ({ ref: '', values: {}, date: todayISO() }))
  const productMap = useProductMap()

  const isPriceRevision = rfq.kind === 'price_revision'

  // One amount box per product on THIS RFQ (its own frozen list), in the
  // owner's order. An RFQ with no product takes one total ('total').
  const lineKeys = (() => {
    const ids = (rfq.product_ids ?? []).map(Number)
    if (!ids.length) return ['total']
    const ordered = productsOf(ids, productMap).map((p) => p.id)
    return [...ordered, ...ids.filter((id) => !ordered.includes(id))]
  })()
  const lineLabel = (key) =>
    key === 'total' ? 'Value without GST' : `${productMap.get(Number(key))?.name ?? `Product #${key}`} — without GST`
  const lineValue = (key) => quote.values[key] ?? ''
  const total = lineKeys.reduce((s, k) => s + (Number(lineValue(k)) || 0), 0)

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
    // Every product needs its own value (owner's ruling) — say which one.
    const missing = lineKeys.find((k) => !(Number(lineValue(k)) > 0))
    if (missing != null) {
      setError(missing === 'total' ? 'Enter the quote value (without GST).' : `Enter the value for ${productMap.get(Number(missing))?.name ?? 'each product'}.`)
      return
    }
    const problem = quoteProblem({ ref: quote.ref, value: total, date: quote.date }, rfq, todayISO())
    if (problem) {
      setError(problem)
      return
    }
    const lines = lineKeys.map((k) => ({ product_id: k === 'total' ? null : Number(k), value: Number(lineValue(k)) }))
    run('quoted', () => recordRfqQuoteLines(rfq.id, { ref: quote.ref, lines, date: quote.date }))
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

  const preview = total > 0 ? formatCurrency(total) : null

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
          {lineKeys.map((k) => (
            <label key={k} className="vip-field">
              {lineLabel(k)} *
              <NumPadInput
                variant="decimal"
                label={lineLabel(k)}
                type="number"
                step="0.01"
                min="0"
                value={lineValue(k)}
                onChange={(e) => editQuote({ values: { ...quote.values, [k]: e.target.value } })}
                disabled={busy}
              />
            </label>
          ))}
          {/* Read back in rupees, so a missed or extra zero shows before it
              becomes the lead's quote value — the TOTAL, which is what the
              lead's quote value becomes. */}
          {preview && (
            <p className="vip-rfq-facts vip-rfq-quote-preview">
              {lineKeys.length > 1 ? 'Total ' : ''}
              {preview} without GST
            </p>
          )}
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
            {lineKeys.length > 1 ? 'The total becomes' : 'Becomes'} the lead's quote value; {rfq.raised_by?.name ?? 'the exec'} is told the quote is in.
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
