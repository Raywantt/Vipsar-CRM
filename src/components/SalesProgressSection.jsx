import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './SearchOrCreate.css'

function SalesProgressSection({ lead, products, onSaved }) {
  const [productId, setProductId] = useState(lead.product_id ?? '')
  const [rfqRaised, setRfqRaised] = useState(lead.rfq_raised ?? false)
  const [rfqRaisedAt, setRfqRaisedAt] = useState(lead.rfq_raised_at ?? '')
  const [quoteSent, setQuoteSent] = useState(lead.quote_sent ?? false)
  const [quoteSentAt, setQuoteSentAt] = useState(lead.quote_sent_at ?? '')
  const [quoteValue, setQuoteValue] = useState(lead.quote_value ?? '')
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
        quote_value: quoteSent && quoteValue !== '' ? Number(quoteValue) : null,
      })
      .eq('id', lead.id)
      .select()
      .single()

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    setSavedAt(Date.now())
    onSaved(data)
  }

  return (
    <section className="lead-section">
      <h2>Sales progress</h2>

      <label className="search-or-create-field">
        Product
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— Not specified —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.category ? ` (${p.category})` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="lead-section-checkbox">
        <input type="checkbox" checked={rfqRaised} onChange={(e) => setRfqRaised(e.target.checked)} />
        RFQ raised
      </label>
      {rfqRaised && (
        <label className="search-or-create-field">
          RFQ raised on
          <input type="date" value={rfqRaisedAt ?? ''} onChange={(e) => setRfqRaisedAt(e.target.value)} />
        </label>
      )}

      <label className="lead-section-checkbox">
        <input type="checkbox" checked={quoteSent} onChange={(e) => setQuoteSent(e.target.checked)} />
        Quote sent
      </label>
      {quoteSent && (
        <>
          <label className="search-or-create-field">
            Quote sent on
            <input type="date" value={quoteSentAt ?? ''} onChange={(e) => setQuoteSentAt(e.target.value)} />
          </label>
          <label className="search-or-create-field">
            Quote value
            <input
              type="number"
              step="0.01"
              value={quoteValue}
              onChange={(e) => setQuoteValue(e.target.value)}
            />
          </label>
        </>
      )}

      {error && <p className="search-or-create-error">{error}</p>}
      {savedAt && !error && <p className="lead-section-success">Saved.</p>}

      <button type="button" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save sales progress'}
      </button>
    </section>
  )
}

export default SalesProgressSection
