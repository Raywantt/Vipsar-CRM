import { useState } from 'react'
import { METRIC_OPTIONS } from '../lib/targetMetrics'
import { periodForPreset } from '../lib/targetPeriods'
import { insertTarget } from '../lib/targetQueries'
import '../pages/Dashboard.css'

const PERIOD_TYPES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

function SetTargetForm({ employees, onCreated }) {
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
      setError(error.message)
      return
    }

    setSavedAt(Date.now())
    setTargetValue('')
    onCreated(data)
  }

  return (
    <div className="dashboard-set-target">
      <h3>Set a target</h3>

      <label className="dashboard-field">
        Employee
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">— Select —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      <label className="dashboard-field">
        Period type
        <select value={periodType} onChange={(e) => handlePeriodTypeChange(e.target.value)}>
          {PERIOD_TYPES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="dashboard-field">
        Period value
        <input
          value={periodValue}
          onChange={(e) => setPeriodValue(e.target.value)}
          placeholder={periodType === 'week' ? 'e.g. 2026-W28' : 'e.g. 2026-07'}
        />
      </label>

      <label className="dashboard-field">
        Metric
        <select value={metricName} onChange={(e) => setMetricName(e.target.value)}>
          {METRIC_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="dashboard-field">
        Target value
        <input type="number" step="0.01" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
      </label>

      {error && <p className="dashboard-error">{error}</p>}
      {savedAt && !error && <p className="dashboard-success">Saved.</p>}

      <button type="button" onClick={handleSubmit} disabled={!canSubmit}>
        {saving ? 'Saving…' : 'Save target'}
      </button>
    </div>
  )
}

export default SetTargetForm
