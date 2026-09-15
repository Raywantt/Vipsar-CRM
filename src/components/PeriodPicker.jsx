import { periodForPreset, periodValueForDate, periodRangeLabel, rangeForPeriodValue, shiftPeriodValue } from '../lib/targetPeriods'

export const PERIOD_TYPES = [
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

// Which week / month / quarter a target is for: a type dropdown, a ‹ range ›
// stepper and a "Jump to current" link. Shared by the exec "Set a target" form
// and Architect Network's BDM targets form, so the two can't drift into two
// different ways of naming a period.
//
// Controlled: the caller owns periodType/periodValue. Changing the type jumps
// to that type's CURRENT period.
function PeriodPicker({ periodType, periodValue, onChange }) {
  function handlePeriodTypeChange(value) {
    onChange({ periodType: value, periodValue: periodForPreset(value).periodValue })
  }

  // Steps by one whole period (± a week/month/quarter) — this plus the date
  // input below REPLACE the old raw "type an ISO week code" text field. That
  // field asked for values like "2026-W37", which isn't just unreadable —
  // it's an easy way to silently save under the wrong period (a one-digit
  // slip lands on this week instead of next week, with nothing on screen to
  // catch it). There's no free text left to mistype: every period is either
  // stepped to or picked from a real calendar date.
  function step(delta) {
    onChange({ periodType, periodValue: shiftPeriodValue(periodType, periodValue, delta) })
  }

  function jumpToDate(dateStr) {
    if (!dateStr) return
    const [y, m, d] = dateStr.split('-').map(Number)
    onChange({ periodType, periodValue: periodValueForDate(periodType, new Date(y, m - 1, d)) })
  }

  const periodRange = rangeForPeriodValue(periodType, periodValue)
  const rangeLabel = periodRangeLabel(periodType, periodValue)
  const isCurrentPeriod = periodValue === periodForPreset(periodType).periodValue

  return (
    <>
      <select
        className="vip-select"
        value={periodType}
        onChange={(e) => handlePeriodTypeChange(e.target.value)}
        aria-label="Target period"
      >
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
          onClick={() => onChange({ periodType, periodValue: periodForPreset(periodType).periodValue })}
        >
          Jump to current {periodType}
        </button>
      )}
    </>
  )
}

export default PeriodPicker
