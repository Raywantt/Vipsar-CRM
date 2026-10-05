import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'
import NumPadInput from './NumPadInput'

// Owner-only correction of a WON lead's order value, opened from Lead
// Detail's Deal value stat. Same write as LeadStageSection's "already won"
// correction: it updates order_value and NOTHING else — no stage_history row,
// because booked value is dated by the lead's most recent 'won' row and a new
// one would move an old deal into this month's figure.
function OrderValueEdit({ lead, onSaved, disabled = false }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function openEditor() {
    setValue(lead.order_value ?? '')
    setError(null)
    setOpen(true)
  }

  async function handleSave() {
    const n = Number(value)
    if (value === '' || !Number.isFinite(n) || n <= 0 || saving) return
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('leads')
      .update({ order_value: n })
      .eq('id', lead.id)
      .select()
      .single()
    setSaving(false)
    if (err) {
      setError(errorMessage(err))
      return
    }
    onSaved(data)
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        className="vip-link"
        style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontSize: 12, cursor: 'pointer', textAlign: 'left' }}
        onClick={openEditor}
        disabled={disabled}
      >
        Edit order value
      </button>
    )
  }

  return (
    <div className="vip-stack-s" style={{ marginTop: 6 }}>
      <NumPadInput
        variant="decimal"
        label="Order value"
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Order value"
      />
      {error && <p className="vip-error" role="alert">{error}</p>}
      <div className="vip-btn-row">
        <button
          type="button"
          className="vip-btn vip-btn-sm"
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={handleSave}
          disabled={value === '' || Number(value) <= 0 || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="vip-btn vip-btn-secondary vip-btn-sm"
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={() => setOpen(false)}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default OrderValueEdit
