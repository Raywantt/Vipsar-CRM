import { rangeForPreset, periodSpanLabel, offsetForDate, STEP_UNIT_LABELS } from '../lib/dateRanges'
import { toISODate, todayISO } from '../lib/followupDates'

// The ‹ › bar under the Week / 15D / Month / Quarter buttons — Today's day
// stepper (DayDateBar) for a whole period. One tap steps one whole week, month,
// quarter or 15 days back; › is disabled on the current period.
//
// The current period is "Live" (it is still running, so its figures are to
// date); a past one is "Final" and shows the complete period. The middle slot
// prints the period in words ("14 – 20 Sep", "September 2026") and layers an
// invisible native date input over it — the same trick PeriodPicker uses — so
// tapping it opens the platform's own picker and any day jumps to the period
// that contains it. `max` stops a future day being picked as well as typed.
//
// Controlled: the caller owns `offset` (usePeriodOffset).
function PeriodStepper({ preset, offset, onOffsetChange }) {
  const range = rangeForPreset(preset, null, null, offset)
  if (!range) return null

  const isCurrent = offset === 0
  const unit = STEP_UNIT_LABELS[preset]
  const label = periodSpanLabel(preset, range)

  function jumpTo(dateStr) {
    if (!dateStr) return
    const [y, m, d] = dateStr.split('-').map(Number)
    onOffsetChange(offsetForDate(preset, new Date(y, m - 1, d)))
  }

  return (
    <div className="vip-day-bar vip-period-stepper">
      <div className="vip-day-nav">
        <button type="button" className="vip-iconbtn" onClick={() => onOffsetChange(offset + 1)} aria-label={`Previous ${unit}`}>
          ‹
        </button>
        <div className="vip-period-picker">
          <span className="vip-period-picker-label">{label}</span>
          <input
            type="date"
            className="vip-period-picker-input"
            value={toISODate(range.start)}
            max={todayISO()}
            onChange={(e) => jumpTo(e.target.value)}
            aria-label={`Pick a day to jump to its ${unit === '15 days' ? '15-day window' : unit} — currently ${label}`}
          />
        </div>
        <button
          type="button"
          className="vip-iconbtn"
          onClick={() => onOffsetChange(offset - 1)}
          disabled={isCurrent}
          aria-label={`Next ${unit}`}
        >
          ›
        </button>
      </div>
      <span className="vip-day-stamp">
        {isCurrent ? (
          <>
            <span className="vip-day-live-dot" />
            Live · {preset === '15d' ? 'up to today' : 'to date'}
          </>
        ) : (
          `Final · full ${unit}`
        )}
      </span>
    </div>
  )
}

export default PeriodStepper
