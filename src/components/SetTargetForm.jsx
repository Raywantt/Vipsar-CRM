import { useState } from 'react'
import { METRIC_OPTIONS } from '../lib/targetMetrics'
import { periodForPreset } from '../lib/targetPeriods'
import { insertTarget } from '../lib/targetQueries'
import { errorMessage } from '../lib/errorMessage'

const PERIOD_TYPES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
]

const PERIOD_VALUE_PLACEHOLDERS = {
  week: 'e.g. 2026-W28',
  month: 'e.g. 2026-07',
  quarter: 'e.g. 2026-Q3',
}

function SetTargetForm({ employees, onCreated, onCancel }) {
  const [employeeId, setEmployeeId] = useState('')
  const [periodType, setPeriodType] = useState('week')
  const [periodValue, setPeriodValue] = useState(periodForPreset('week').periodValue)
  const [metricName, setMetricName] = useState(METRIC_OPTIONS[0].value)
  const [targetValue, setTargetValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  function handlePeriodTypeChange(value) {
    setPeriodType(value)
    setPeriodValue(periodForPreset(value).periodValue)
  }

  const canSubmit = employeeId && periodValue.trim() && metricName && targetValue !== '' && !saving

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    setSavedAt(null)

    const { data, error } = await insertTarget({
      employeeId: Number(employeeId),
      periodType,
      periodValue: periodValue.trim(),
      metricName,
      targetValue: Number(targetValue),
    })

    setSaving(false)

    if (error) {
      setError(errorMessage(error))
      return
    }

    setSavedAt(Date.now())
    setTargetValue('')
    onCreated(data)
  }

  return (
    <div className="vip-section-split vip-stack-s">
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vip-ink)' }}>Set a target</div>

      <select className="vip-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
        <option value="">— Select —</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>

      <div className="vip-grid-2">
        <select className="vip-select" value={periodType} onChange={(e) => handlePeriodTypeChange(e.target.value)}>
          {PERIOD_TYPES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          className="vip-input"
          value={periodValue}
          onChange={(e) => setPeriodValue(e.target.value)}
          placeholder={PERIOD_VALUE_PLACEHOLDERS[periodType]}
        />
      </div>

      <div className="vip-grid-2" style={{ gridTemplateColumns: '1fr 90px' }}>
        <select className="vip-select" value={metricName} onChange={(e) => setMetricName(e.target.value)}>
          {METRIC_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          className="vip-input"
          type="number"
          step="0.01"
          value={targetValue}
          onChange={(e) => setTargetValue(e.target.value)}
        />
      </div>

      {error && <p className="vip-error" role="alert">{error}</p>}
      {savedAt && !error && <p className="vip-success" role="status" aria-live="polite">Saved.</p>}

      <div className="vip-btn-row">
        <button type="button" className="vip-btn vip-btn-dark vip-btn-sm" onClick={handleSubmit} disabled={!canSubmit}>
          {saving ? 'Saving…' : 'Set'}
        </button>
        {onCancel && (
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

export default SetTargetForm
