import { useState } from 'react'
import { METRIC_OPTIONS } from '../lib/targetMetrics'
import { periodForPreset, periodValueForDate, periodRangeLabel, rangeForPeriodValue, shiftPeriodValue } from '../lib/targetPeriods'
import { insertTarget } from '../lib/targetQueries'
import { errorMessage } from '../lib/errorMessage'
import NumPadInput from './NumPadInput'

const PERIOD_TYPES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
]

// The <input type="date"> below always shows the period's own START date,
// read as UTC fields (rangeForPeriodValue builds UTC-midnight Dates) so the
// day the box shows always matches the day periodRangeLabel prints below it,
// regardless of the viewer's own timezone.
function toDateInputValue(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

  // Steps by one whole period (± a week/month/quarter) — this plus the date
  // input below REPLACE the old raw "type an ISO week code" text field. That
  // field asked for values like "2026-W37", which isn't just unreadable —
  // it's an easy way to silently save under the wrong period (a one-digit
  // slip lands on this week instead of next week, with nothing on screen to
  // catch it). There's no free text left to mistype: every period is either
  // stepped to or picked from a real calendar date.
  function step(delta) {
    setPeriodValue((pv) => shiftPeriodValue(periodType, pv, delta))
  }

  function jumpToDate(dateStr) {
    if (!dateStr) return
    const [y, m, d] = dateStr.split('-').map(Number)
    setPeriodValue(periodValueForDate(periodType, new Date(y, m - 1, d)))
  }

  const periodRange = rangeForPeriodValue(periodType, periodValue)
  const rangeLabel = periodRangeLabel(periodType, periodValue)
  const isCurrentPeriod = periodValue === periodForPreset(periodType).periodValue

  const canSubmit = employeeId && periodValue && metricName && targetValue !== '' && !saving

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

      <select className="vip-select" value={periodType} onChange={(e) => handlePeriodTypeChange(e.target.value)}>
        {PERIOD_TYPES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <div className="vip-day-nav">
        <button type="button" className="vip-iconbtn" onClick={() => step(-1)} aria-label={`Previous ${periodType}`}>
          ‹
        </button>
        {/* The readable range ("14 – 20 Sep 2026") is what's shown — a lone
            start date doesn't say anything a person can act on. The real
            <input type="date"> stays fully functional (native picker,
            keyboard/arrow input all still work) but sits invisibly on top of
            the label instead of showing its own raw value underneath it. */}
        <div className="vip-period-picker">
          <span className="vip-period-picker-label">{rangeLabel}</span>
          <input
            type="date"
            className="vip-period-picker-input"
            value={periodRange ? toDateInputValue(periodRange.start) : ''}
            onChange={(e) => jumpToDate(e.target.value)}
            aria-label={`Pick a date in the ${periodType} — currently ${rangeLabel}`}
          />
        </div>
        <button type="button" className="vip-iconbtn" onClick={() => step(1)} aria-label={`Next ${periodType}`}>
          ›
        </button>
      </div>
      {!isCurrentPeriod && (
        <button
          type="button"
          className="vip-btn-link"
          style={{ minHeight: 'auto', padding: 0, alignSelf: 'flex-start' }}
          onClick={() => setPeriodValue(periodForPreset(periodType).periodValue)}
        >
          Jump to current {periodType}
        </button>
      )}

      <div className="vip-grid-2" style={{ gridTemplateColumns: '1fr 90px' }}>
        <select className="vip-select" value={metricName} onChange={(e) => setMetricName(e.target.value)}>
          {METRIC_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <NumPadInput
          variant="decimal"
          label="Target value"
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
