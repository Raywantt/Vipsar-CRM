import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'
import NumPadInput from './NumPadInput'
import ProductPicker from './ProductPicker'
import QuoteValueField, { QuoteValueRow } from './QuoteValueField'
import { formatCurrencyCompact, formatDateShort } from '../lib/format'
import { leadProductIds, productsById } from '../lib/productShares'
import { quoteValuePatch, shownQuoteValue } from '../lib/quoteValue'

// `rfq` is summariseRfqHistory()'s output (src/lib/rfqKind.js) — read-only.
// The RFQ raised checkbox and its date input were removed 2026-09-09: an RFQ
// is now recorded by logging the RFQ Raised activity, which also advances the
// stage, so this card reports that history rather than asking for it a second
// time. leads.rfq_raised / rfq_raised_at are written automatically — by
// ActivityLog while the RFQ desk is off, by the desk's approval once it is on
// (RFQ-DESK.md) — and still drive Needs Attention's pending-RFQ bucket. This
// form never touches them, which is why they're absent from the update
// payload below.
//
// `deskQuote` is the latest quote the RFQ desk recorded on this lead (null if
// none). Quote value comes from the RFQ desk, quoted per product (owner's
// ruling, 2026-10-06), so for most roles this card shows it read-only with the
// split. The owner reopened typing it for the OWNER and sales MANAGERS
// (2026-10-09): `quoteControl` (src/lib/quoteValue.js) says whether this viewer
// gets the field — `edit`, or `edit` with `overrides` when it would replace a
// desk quote's figure (owner only), or `locked`/`none` for the read-only row.
// An older value (the legacy imports) still shows read-only for everyone else.
//
// Products are the lead's list (leads.product_ids), edited with THE product
// picker the RFQ Raised form also uses (ProductPicker) — one column.
function SalesProgressSection({
  lead,
  products,
  rfq,
  deskQuote = null,
  quoteControl = { mode: 'none', overrides: false },
  onSaved,
}) {
  const [productIds, setProductIds] = useState(() => leadProductIds(lead))
  const [quoteInput, setQuoteInput] = useState(() => shownQuoteValue(lead, deskQuote) ?? '')
  const [quoteSent, setQuoteSent] = useState(lead.quote_sent ?? false)
  const [quoteSentAt, setQuoteSentAt] = useState(lead.quote_sent_at ?? '')
  const [closureProbability, setClosureProbability] = useState(lead.closure_probability ?? '')
  const [estimatedCloseDate, setEstimatedCloseDate] = useState(lead.estimated_close_date ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSavedAt(null)

    // Products are sent only when they changed here: re-sending the list this
    // form opened with would undo products an RFQ Raised set while the page
    // was open. (The database keeps product_id as a mirror of the first.)
    const opened = leadProductIds(lead).map(Number)
    const productsChanged = opened.length !== productIds.length || opened.some((id, i) => id !== Number(productIds[i]))

    // The quote value goes out only when it differs from the lead's current
    // figure (quoteValuePatch returns no patch otherwise), for the same reason
    // as the products: saving this card must not rewrite a figure — or clear a
    // desk quote's per-product split — that nobody touched.
    let quotePatch = {}
    if (quoteControl.mode === 'edit') {
      const q = quoteValuePatch(quoteInput, { lead, deskQuote })
      if (q.error) {
        setSaving(false)
        setError(q.error)
        return
      }
      quotePatch = q.patch ?? {}
    }

    const { data, error } = await supabase
      .from('leads')
      .update({
        ...(productsChanged ? { product_ids: productIds } : {}),
        ...quotePatch,
        quote_sent: quoteSent,
        quote_sent_at: quoteSent ? quoteSentAt || null : null,
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
  // The latest desk quote's split, "Tostem ₹6L · IN16 ₹4L" — only when there
  // is one to show (a single-product quote needs no split line).
  const byId = productsById(products)
  const lines = Array.isArray(lead.quote_lines) ? lead.quote_lines : []
  const quoteSplit =
    lines.length > 1
      ? lines
          .map((l) => `${byId.get(Number(l.product_id))?.name ?? 'Product'} ${formatCurrencyCompact(Number(l.value))}`)
          .join(' · ')
      : null

  const shownQuote = shownQuoteValue(lead, deskQuote)

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
      <h2 className="vip-card-title">Sales progress</h2>

      {/* Four groups, in the order a deal actually moves: what we're selling,
          the RFQ, the quote, then how it closes. Separated by
          .vip-section-split's hairline rule rather than headings — four
          labels would cost more height than they buy on a phone, where this
          card opens as a full-screen panel. */}
      <ProductPicker
        value={productIds}
        onChange={setProductIds}
        products={products}
        hint="Pick every product this lead is for. The RFQ Raised form edits the same list."
      />

      <div className="vip-section-split vip-stack-s">{rfqSummary}</div>

      <div className="vip-section-split vip-stack-s">
        {quoteControl.mode === 'edit' ? (
          <QuoteValueField
            value={quoteInput}
            onChange={setQuoteInput}
            overrides={quoteControl.overrides}
            deskQuote={deskQuote}
          />
        ) : (
          <QuoteValueRow lead={lead} deskQuote={deskQuote} />
        )}
        {quoteSplit && (
          <div className="vip-field-hint">{quoteSplit}</div>
        )}
        {quoteControl.mode === 'locked' && (
          <span className="vip-field-hint">Set by the RFQ desk from Lixil's quote — only an owner can change it.</span>
        )}
        {quoteControl.mode === 'none' && shownQuote == null && (
          <span className="vip-field-hint">Comes from the RFQ desk once Lixil's quote is in.</span>
        )}

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
