import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'
import NumPadInput from './NumPadInput'
import { formatDateShort } from '../lib/format'

// `rfq` is summariseRfqHistory()'s output (src/lib/rfqKind.js) — read-only.
// The RFQ raised checkbox and its date input were removed 2026-09-09: an RFQ
// is now recorded by logging the RFQ Raised activity, which also advances the
// stage, so this card reports that history rather than asking for it a second
// time. leads.rfq_raised / rfq_raised_at are still written automatically by
// ActivityLog (and still drive Needs Attention's pending-RFQ bucket) — this
// form simply no longer touches them, which is why they're absent from the
// update payload below.
function SalesProgressSection({ lead, products, rfq, onSaved }) {
  const [productId, setProductId] = useState(lead.product_id ?? '')
  const [quoteSent, setQuoteSent] = useState(lead.quote_sent ?? false)
  const [quoteSentAt, setQuoteSentAt] = useState(lead.quote_sent_at ?? '')
  const [quoteValue, setQuoteValue] = useState(lead.quote_value ?? '')
  const [closureProbability, setClosureProbability] = useState(lead.closure_probability ?? '')
  const [estimatedCloseDate, setEstimatedCloseDate] = useState(lead.estimated_close_date ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSavedAt(null)

    const { data, error } = await supabase
      .from('leads')
      .update({
        product_id: productId || null,
        quote_sent: quoteSent,
        quote_sent_at: quoteSent ? quoteSentAt || null : null,
        quote_value: quoteValue !== '' ? Number(quoteValue) : null,
        closure_probability: closureProbability !== '' ? Number(closureProbability) : null,
        estimated_close_date: estimatedCloseDate || null,
      })
      .eq('id', lead.id)
      .select()
      .single()

    setSaving(false)

    if (error) {
      setError(errorMessage(error))
      return
    }

    setSavedAt(Date.now())
    onSaved(data)
  }

  // Read-only, derived from the lead's real RFQ Raised activities (falling
  // back to the columns the legacy imports wrote for leads whose RFQ was
  // never logged as an activity). A revised line shows only the LATEST
  // revision, not every one — the point is "where does this RFQ stand
  // today", and the full history is right below in the activity timeline.
  const freshLabel = formatDateShort(rfq?.freshAt)
  const revisedLabel = formatDateShort(rfq?.revisedAt)

  const rfqSummary = rfq?.raised ? (
    <>
      {/* The fresh row is withheld only when the lead genuinely has no fresh
          RFQ on record — every logged RFQ is a revision. Otherwise it always
          shows, even with no date behind it, because "an RFQ was raised" is
          itself the fact worth keeping. */}
      {(freshLabel || rfq.revisedCount === 0) && (
        <div className="vip-kv-row">
          <span>Fresh RFQ</span>
          <b>{freshLabel ?? 'date not recorded'}</b>
        </div>
      )}
      {revisedLabel && (
        <div className="vip-kv-row">
          <span>Revised RFQ</span>
          <b>
            {revisedLabel}
            {rfq.revisedCount > 1 ? ` (${rfq.revisedCount} revisions)` : ''}
          </b>
        </div>
      )}
    </>
  ) : (
    <p className="vip-field-hint">No RFQ raised yet — log one from Log Activity.</p>
  )

  return (
    <div className="vip-card">
      <div className="vip-card-title">Sales progress</div>

      {/* Four groups, in the order a deal actually moves: what we're selling,
          the RFQ, the quote, then how it closes. Separated by
          .vip-section-split's hairline rule rather than headings — four
          labels would cost more height than they buy on a phone, where this
          card opens as a full-screen panel. */}
      <label className="vip-field">
        Product
        <select className="vip-select" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— Not specified —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.category ? ` (${p.category})` : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="vip-section-split vip-stack-s">{rfqSummary}</div>

      <div className="vip-section-split vip-stack-s">
        <label className="vip-field">
          Quote value
          <NumPadInput
            variant="decimal"
            label="Quote value"
            type="number"
            step="0.01"
            value={quoteValue}
            onChange={(e) => setQuoteValue(e.target.value)}
          />
        </label>

        <label className="vip-check">
          <input type="checkbox" checked={quoteSent} onChange={(e) => setQuoteSent(e.target.checked)} />
          Quote sent{quoteSent && quoteSentAt ? ` · ${quoteSentAt}` : ''}
        </label>
        {quoteSent && (
          <input
            className="vip-input"
            type="date"
            value={quoteSentAt ?? ''}
            onChange={(e) => setQuoteSentAt(e.target.value)}
          />
        )}
      </div>

      {/* No Order value field here, by the owner's ruling (2026-09-09): a
          deal is only worth anything once it's booked, and marking a lead
          won already demands the figure in LeadStageSection's own prompt.
          Asking for it on every open lead invited a value on a deal that
          hadn't closed — exactly the "order_value set while still open"
          state the pipelineValue.js audit had to work around. order_value is
          deliberately absent from handleSave's payload too, so saving this
          card leaves a booked lead's real figure untouched. */}
      <div className="vip-section-split vip-stack-s">
        <label className="vip-field">
          Probability
          <NumPadInput
            variant="integer"
            label="Probability"
            type="number"
            min="0"
            max="100"
            step="1"
            value={closureProbability}
            onChange={(e) => setClosureProbability(e.target.value)}
          />
        </label>

        <label className="vip-field">
          Estimated close
          <input
            className="vip-input"
            type="date"
            value={estimatedCloseDate}
            onChange={(e) => setEstimatedCloseDate(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="vip-error" role="alert">{error}</p>}
      {savedAt && !error && <p className="vip-success" role="status" aria-live="polite">Saved.</p>}

      <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

export default SalesProgressSection
