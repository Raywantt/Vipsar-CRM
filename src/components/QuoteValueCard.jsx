import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'
import { quoteValuePatch, shownQuoteValue } from '../lib/quoteValue'
import QuoteValueField, { QuoteValueRow } from './QuoteValueField'

// A sales manager's way to set the quote value on a TEAM member's lead
// (owner's ruling, 2026-10-09). Sales progress — where an owner, or a manager on
// their own lead, types it — is a rep's card and a manager never gets it on a
// team lead (enforce_manager_lock keeps every other column theirs), so this
// stands alone: the quote value and nothing else. The database lets a manager
// write quote_value only where no Lixil quote is on file
// (migration_manager_quote_value.sql); `control.mode === 'locked'` is the UI
// mirror, which shows the figure and says why it can't be changed.
function QuoteValueCard({ lead, deskQuote = null, control, onSaved }) {
  const [input, setInput] = useState(() => shownQuoteValue(lead, deskQuote) ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  async function handleSave() {
    setError(null)
    setSavedAt(null)
    const q = quoteValuePatch(input, { lead, deskQuote })
    if (q.error) {
      setError(q.error)
      return
    }
    if (!q.patch) {
      setSavedAt(Date.now())
      return
    }
    setSaving(true)
    const { data, error: err } = await supabase
      .from('leads')
      .update(q.patch)
      .eq('id', lead.id)
      .select()
      .single()
    setSaving(false)
    if (err) {
      setError(errorMessage(err))
      return
    }
    setSavedAt(Date.now())
    onSaved(data)
  }

  return (
    <div className="vip-card">
      <h2 className="vip-card-title">Quote value</h2>
      {control.mode === 'edit' ? (
        <>
          <QuoteValueField value={input} onChange={setInput} />
          {error && <p className="vip-error" role="alert">{error}</p>}
          {savedAt && !error && <p className="vip-success" role="status" aria-live="polite">Saved.</p>}
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      ) : (
        <>
          <QuoteValueRow lead={lead} deskQuote={deskQuote} />
          <span className="vip-field-hint">Set by the RFQ desk from Lixil's quote — only an owner can change it.</span>
        </>
      )}
    </div>
  )
}

export default QuoteValueCard
