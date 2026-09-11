import { useEffect, useState } from 'react'
import { METRIC_OPTIONS, METRIC_LABELS } from '../lib/targetMetrics'
import { periodForPreset, periodValueForDate, periodRangeLabel, rangeForPeriodValue, shiftPeriodValue } from '../lib/targetPeriods'
import { insertTarget, fetchTargetsForPeriod } from '../lib/targetQueries'
import { formatCurrencyCompact } from '../lib/format'
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

// displayPeriod is { periodType, periodValue } for the period the Targets
// vs. actuals table above this form is currently showing — or null if the
// caller doesn't know. A target may legitimately be set for any period, not
// just that one, so this is never a restriction; it only decides whether the
// confirmation has to explain that the saved target won't show up above.
// order_value is money, every other metric is a count — same split
// TargetsVsActualsCard's own formatValue makes, just not exported from a
// component file for one caller.
function formatTargetValue(metric, value) {
  return metric === 'order_value' ? formatCurrencyCompact(Number(value)) : Math.round(Number(value))
}

function SetTargetForm({ employees, displayPeriod = null, onCreated, onCancel }) {
  const [employeeId, setEmployeeId] = useState('')
  // Opens on the period the table above is SHOWING, not a hardcoded Week.
  //
  // Both defaults cost the same one dropdown change when they guess wrong,
  // but they fail differently, which is the whole reason for this: a
  // hardcoded Week default silently writes a WEEKLY target while the owner is
  // looking at monthly ones — a row landing under a period nobody is looking
  // at, the same shape as the bug this form's merge already shipped once (see
  // mergeTargetRow). Seeding from displayPeriod can only ever land a target
  // under the period already on screen, where a mistake is visible
  // immediately in the heatmap and fixable in one action.
  //
  // Seeded, not controlled: these are useState initialisers, so changing the
  // dashboard's own range while this form is open deliberately does NOT move
  // the period under someone mid-entry — the "Saved for …, the table above is
  // showing …" line covers that case. The form remounts on every open (the
  // card renders it or the button, never both), so each open re-seeds.
  const [periodType, setPeriodType] = useState(displayPeriod?.periodType ?? 'week')
  const [periodValue, setPeriodValue] = useState(
    displayPeriod?.periodValue ?? periodForPreset('week').periodValue
  )
  const [metricName, setMetricName] = useState(METRIC_OPTIONS[0].value)
  const [targetValue, setTargetValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // What's ALREADY on file for whatever period the stepper is pointing at.
  //
  // This is the only place in the app that can answer "what have I set for
  // next week?" — every other screen's Week/Month/Quarter is anchored to
  // now() (dateRanges.js, and periodForPreset's own default), so the heatmap
  // can only ever show the CURRENT period. Without this, a target set for a
  // future period is invisible everywhere until that period arrives, and the
  // only evidence it saved is a confirmation line that disappears on the next
  // save. Scoped to the stepper's period, NOT the dashboard's.
  const [periodTargets, setPeriodTargets] = useState([])
  const [loadingPeriodTargets, setLoadingPeriodTargets] = useState(true)
  // Bumped after a successful save so the list below re-reads. Safe to refetch
  // straight away: supabaseFetch drops the read cache after any successful
  // non-GET, so the upsert has already invalidated `targets:<type>:<value>`.
  const [reloadKey, setReloadKey] = useState(0)

  // The period that was actually SAVED, snapshotted at save time — not read
  // back off `periodValue`, which the owner may well step again afterwards
  // (setting several weeks in a row is the normal way this form gets used),
  // which would leave the confirmation describing a period nothing was
  // written to.
  const [saved, setSaved] = useState(null)

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

  // Debounced so walking several weeks forward with the › button fires one
  // request at the end rather than one per click. RLS scopes this to whatever
  // the viewer may read, same as every other targets query.
  useEffect(() => {
    if (!periodValue) return undefined
    let active = true
    setLoadingPeriodTargets(true)
    const t = setTimeout(() => {
      fetchTargetsForPeriod({ periodType, periodValue }).then(({ data, error }) => {
        if (!active) return
        setPeriodTargets(error ? [] : data ?? [])
        setLoadingPeriodTargets(false)
      })
    }, 250)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [periodType, periodValue, reloadKey])

  const periodRange = rangeForPeriodValue(periodType, periodValue)
  const rangeLabel = periodRangeLabel(periodType, periodValue)
  const isCurrentPeriod = periodValue === periodForPreset(periodType).periodValue

  // Null unless we BOTH know what's on screen and it isn't what was saved —
  // a caller that passes no displayPeriod gets the plain confirmation rather
  // than a sentence with a blank period in it.
  const offScreenNote =
    saved &&
    displayPeriod &&
    (saved.periodType !== displayPeriod.periodType || saved.periodValue !== displayPeriod.periodValue)
      ? ` The table above is showing ${periodRangeLabel(displayPeriod.periodType, displayPeriod.periodValue)}, so it won't appear there.`
      : null

  // Only ever rows for employees this card actually offers — RLS already
  // scopes the query, but a coordinator/manager's roster is narrowed further
  // client-side, and the list below should say the same thing the table does.
  const visibleIds = new Set(employees.map((e) => e.id))
  const inScope = periodTargets.filter((t) => visibleIds.has(t.employee_id))
  // Once a person is picked this answers "what does THIS person already have
  // for this period" — the question you're about to act on. Before that it's
  // a one-line count, which is still enough to confirm a save landed.
  const selectedId = employeeId ? Number(employeeId) : null
  const forSelected = selectedId == null ? [] : inScope.filter((t) => t.employee_id === selectedId)
  const peopleWithTargets = new Set(inScope.map((t) => t.employee_id)).size

  const canSubmit = employeeId && periodValue && metricName && targetValue !== '' && !saving

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    setSaved(null)

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

    setSaved({ periodType, periodValue, rangeLabel })
    setReloadKey((k) => k + 1)
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

      {/* What's already on file for the period the stepper points at. The
          heatmap above can only ever show the CURRENT period, so for any
          other one this is the only place a saved target is visible at all —
          and it's what makes re-entering a target legible as a REPLACEMENT
          rather than something that may or may not have worked. */}
      <div className="vip-stack-s">
        <div className="vip-field-hint">Already set for {rangeLabel}</div>
        {loadingPeriodTargets ? (
          <div className="vip-kv-row"><span>checking…</span></div>
        ) : selectedId == null ? (
          <div className="vip-kv-row">
            <span>
              {inScope.length === 0
                ? 'Nothing set for this period yet.'
                : `${inScope.length} target${inScope.length === 1 ? '' : 's'} across ${peopleWithTargets} ${peopleWithTargets === 1 ? 'person' : 'people'}. Pick someone to see theirs.`}
            </span>
          </div>
        ) : forSelected.length === 0 ? (
          <div className="vip-kv-row"><span>Nothing set for this person yet.</span></div>
        ) : (
          METRIC_OPTIONS.filter((m) => forSelected.some((t) => t.metric_name === m.value)).map((m) => {
            const row = forSelected.find((t) => t.metric_name === m.value)
            return (
              <div className="vip-kv-row" key={m.value}>
                <span>{METRIC_LABELS[m.value] ?? m.value}</span>
                <b>{formatTargetValue(m.value, row.target_value)}</b>
              </div>
            )
          })
        )}
      </div>

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
      {/* Names the period it saved for, always — a bare "Saved." next to a
          period stepper is exactly the message that let a target saved for
          next week read as a target saved for this one. When that period
          isn't the one the table above is showing, say so outright rather
          than letting the owner conclude the save silently failed. */}
      {saved && !error && (
        <p className="vip-success" role="status" aria-live="polite">
          Saved for {saved.rangeLabel}.{offScreenNote}
        </p>
      )}

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
