import NumPadInput from './NumPadInput'
import { formatCurrency } from '../lib/format'
import { quoteOrigin, shownQuoteValue } from '../lib/quoteValue'

// The read-only row: the figure on screen and where it came from — the Lixil
// quote it is, or (an owner overrode it) the Lixil quote it differs from.
export function QuoteValueRow({ lead, deskQuote = null }) {
  const shown = shownQuoteValue(lead, deskQuote)
  const origin = quoteOrigin(lead, deskQuote)
  return (
    <div className="vip-kv-row">
      <span>Quote value</span>
      <b>
        {shown != null ? formatCurrency(shown) : '—'}
        {origin === 'desk' && <span className="vip-field-hint"> · from Lixil quote {deskQuote.quote_ref}</span>}
        {origin === 'override' && (
          <span className="vip-field-hint">
            {' '}· Lixil quote {deskQuote.quote_ref} is {formatCurrency(deskQuote.quote_value)}
          </span>
        )}
      </b>
    </div>
  )
}

// The typed quote value (owner's ruling, 2026-10-09: owners and managers) —
// one input, drawn identically by Sales progress and by the manager's card on a
// team lead (QuoteValueCard), so the two can't drift. The caller owns the text
// and the write; src/lib/quoteValue.js owns every rule about it.
//
// `overrides` = a Lixil quote is on file and saving will replace its figure
// (owner only): the hint says so, and that the per-product split goes with it.
function QuoteValueField({ value, onChange, overrides = false, deskQuote = null }) {
  return (
    <label className="vip-field">
      Quote value
      <NumPadInput
        variant="decimal"
        label="Quote value"
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Not quoted yet"
      />
      {overrides && deskQuote ? (
        <span className="vip-field-hint">
          Lixil quote {deskQuote.quote_ref} is on file at {formatCurrency(deskQuote.quote_value)}. A different total
          replaces it on this lead and clears the per-product split.
        </span>
      ) : (
        <span className="vip-field-hint">Leave blank if there is no quote yet.</span>
      )}
    </label>
  )
}

export default QuoteValueField
