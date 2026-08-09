import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'

function SalesProgressSection({ lead, products, onSaved }) {
  const [productId, setProductId] = useState(lead.product_id ?? '')
  const [rfqRaised, setRfqRaised] = useState(lead.rfq_raised ?? false)
  const [rfqRaisedAt, setRfqRaisedAt] = useState(lead.rfq_raised_at ?? '')
  const [quoteSent, setQuoteSent] = useState(lead.quote_sent ?? false)
  const [quoteSentAt, setQuoteSentAt] = useState(lead.quote_sent_at ?? '')
  const [quoteValue, setQuoteValue] = useState(lead.quote_value ?? '')
  const [orderValue, setOrderValue] = useState(lead.order_value ?? '')
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
        rfq_raised: rfqRaised,
        rfq_raised_at: rfqRaised ? rfqRaisedAt || null : null,
        quote_sent: quoteSent,
        quote_sent_at: quoteSent ? quoteSentAt || null : null,
        quote_value: quoteValue !== '' ? Number(quoteValue) : null,
        order_value: orderValue !== '' ? Number(orderValue) : null,
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

  return (
    <div className="vip-card">
      <div className="vip-card-title">Sales progress</div>

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

      <div className="vip-grid-2">
        <label className="vip-field">
          Quote value
          <input
            className="vip-input"
            type="number"
            step="0.01"
            value={quoteValue}
            onChange={(e) => setQuoteValue(e.target.value)}
          />
        </label>
        <label className="vip-field">
          Probability
          <input
            className="vip-input"
            type="number"
            min="0"
            max="100"
            step="1"
            value={closureProbability}
            onChange={(e) => setClosureProbability(e.target.value)}
          />
        </label>
      </div>

      <label className="vip-field">
        Order value
        <input
          className="vip-input"
          type="number"
          step="0.01"
          value={orderValue}
          onChange={(e) => setOrderValue(e.target.value)}
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

      <div className="vip-section-split vip-stack-s">
        <label className="vip-check">
          <input type="checkbox" checked={rfqRaised} onChange={(e) => setRfqRaised(e.target.checked)} />
          RFQ raised{rfqRaised && rfqRaisedAt ? ` · ${rfqRaisedAt}` : ''}
        </label>
        {rfqRaised && (
          <input
            className="vip-input"
            type="date"
            value={rfqRaisedAt ?? ''}
            onChange={(e) => setRfqRaisedAt(e.target.value)}
          />
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

      {error && <p className="vip-error">{error}</p>}
      {savedAt && !error && <p className="vip-success">Saved.</p>}

      <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

export default SalesProgressSection
