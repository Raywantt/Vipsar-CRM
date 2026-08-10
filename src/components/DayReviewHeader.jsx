import { nextDayISO, prevDayISO } from '../lib/dayReviewQueries'
import { todayISO } from '../lib/followupDates'

// Date navigation + the four day KPIs. The pane accepts an arbitrary past
// date, not just today (decision #21) — changing it reloads every number on
// the page, including Tomorrow, which becomes "the chosen date + 1".
//
// A plain <input type="date"> rather than a custom popover: it's the native
// picker on every device, it's what LeadStageSection's On Hold panel already
// uses for the same "any date, near or far" job, and `max` stops a future
// date being typed as well as clicked.

function DayDateBar({ dateISO, onDateChange, updatedAt }) {
  const today = todayISO()
  const isToday = dateISO === today
  const [y, m, d] = dateISO.split('-').map(Number)
  const label = new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

  return (
    <div className="vip-day-bar">
      <div className="vip-day-nav">
        <button type="button" className="vip-iconbtn" onClick={() => onDateChange(prevDayISO(dateISO))} aria-label="Previous day">
          ‹
        </button>
        <input
          type="date"
          className="vip-input vip-day-date"
          value={dateISO}
          max={today}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
          aria-label="Day being reviewed"
        />
        <button
          type="button"
          className="vip-iconbtn"
          onClick={() => onDateChange(nextDayISO(dateISO))}
          disabled={isToday}
          aria-label="Next day"
        >
          ›
        </button>
      </div>
      <span className="vip-day-stamp">
        {isToday ? (
          <>
            <span className="vip-day-live-dot" />
            Live · updated {updatedAt}
          </>
        ) : (
          `Final · ${label}`
        )}
      </span>
    </div>
  )
}

// These REPLACE the standing Dashboard KPIs for this period rather than
// re-filtering them — an open-pipeline total or a month's attainment means
// nothing over eight hours (§4.2 of the handoff).
function DayKpiStrip({ kpis }) {
  return (
    <div className="vip-dd-kpi-grid vip-dd-kpi-grid-4">
      {kpis.map((k) => (
        <div key={k.key} className="vip-dd-kpi-tile vip-dd-kpi-static">
          <span className="vip-dd-kpi-label">{k.label}</span>
          <span className="vip-dd-kpi-value" style={{ color: k.color }}>
            {k.value != null ? (
              k.value
            ) : (
              <>
                <span className="vip-daycell-done">{k.done}</span>
                <span className="vip-daycell-sep"> / </span>
                <span className={k.missedIsPending ? 'vip-daycell-pending' : 'vip-daycell-missed'}>{k.missed}</span>
              </>
            )}
          </span>
          <span className="vip-dd-kpi-sub">{k.sub}</span>
        </div>
      ))}
    </div>
  )
}

export { DayDateBar, DayKpiStrip }
