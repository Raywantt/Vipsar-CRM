import { useState } from 'react'
import { TargetRow, targetFor } from './TargetsVsActualsCard'
import BdmTargetsForm from './BdmTargetsForm'
import { BDM_METRIC_OPTIONS } from '../lib/targetMetrics'
import { ARCHITECT_MEETING_DAYS } from '../lib/architectStats'
import { formatCurrencyCompact } from '../lib/format'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// One business development manager on the owner's Architect Network (BDM.md
// Step 6). Owner's ruling: their three targets vs actuals with "+ Set
// targets", then the figures that say how their pipeline is doing.
//
// `summary` is summariseBdm(...) (src/lib/architectNetwork.js) — built from the
// same rules the BDM's own Dashboard runs, so the owner and the BDM can't read
// two different numbers for one thing. Any figure still loading is null and
// renders "…"; a figure that is genuinely nothing renders "—" rather than a
// confident ₹0 (UI-DESIGN.md §5).
//
// Two halves side by side from 1024px (targets | figures), stacked on a phone.
// "Right now" figures and period figures sit in one grid, so each tile's sub
// line names which it is.
function BdmNetworkCard({ bdm, summary, targets, targetPeriod, rangeLabel, onOpenArchitects, onTargetsSaved }) {
  const [formOpen, setFormOpen] = useState(false)
  const s = summary
  const loading = '…'

  const closed = s.closed
  const tiles = [
    {
      key: 'open',
      label: 'Open pipeline',
      value: s.openValue == null ? loading : s.openValue ? formatCurrencyCompact(s.openValue) : '—',
      sub: s.openCount == null ? 'right now' : `${plural(s.openCount, 'open lead', 'open leads')} · now`,
    },
    {
      key: 'pool',
      label: 'Waiting in pool',
      value: s.waitingCount == null ? loading : String(s.waitingCount),
      sub: 'not yet assigned · now',
    },
    {
      key: 'handed',
      label: 'Handed over',
      value: s.handedOverCount == null ? loading : String(s.handedOverCount),
      sub: `assigned ${rangeLabel}`,
    },
    {
      key: 'won',
      label: 'Won',
      value: closed == null ? loading : closed.wonCount ? formatCurrencyCompact(closed.wonValue) : '—',
      sub: closed == null ? rangeLabel : `${plural(closed.wonCount, 'lead', 'leads')} ${rangeLabel}`,
    },
    {
      key: 'winrate',
      label: 'Win rate',
      value: closed == null ? loading : closed.winRate == null ? '—' : `${closed.winRate}%`,
      sub:
        closed == null
          ? rangeLabel
          : closed.winRate == null
            ? `nothing closed ${rangeLabel}`
            : `${closed.wonCount} won · ${closed.lostCount} lost`,
    },
  ]

  const toMeetCount = s.toMeet ? s.toMeet.length : null

  return (
    <section className="vip-card vip-net-bdm" aria-label={bdm.name}>
      <div className="vip-card-head">
        <h2 className="vip-card-title">{bdm.name}</h2>
        <span className="vip-bdm-list-count">
          {s.portfolioCount == null ? '' : `${plural(s.portfolioCount, 'architect', 'architects')} in portfolio`}
        </span>
      </div>

      <div className="vip-net-bdm-body">
        <div className="vip-stack-s">
          <div className="vip-dd-eyebrow">Targets · {rangeLabel}</div>
          {targetPeriod ? (
            targets == null || s.actuals == null ? (
              <p className="vip-empty">Loading…</p>
            ) : (
              BDM_METRIC_OPTIONS.map((m) => (
                <TargetRow
                  key={m.value}
                  showActualWithoutTarget
                  row={{ label: m.label, actual: s.actuals[m.value] ?? 0, target: targetFor(targets, bdm.id, m.value), metric: m.value }}
                />
              ))
            )
          ) : (
            <p className="vip-form-note vip-net-note">
              Targets are set per week, month or quarter — pick one of those above to see them.
            </p>
          )}

          {formOpen ? (
            <BdmTargetsForm
              // Remounts per open, so each open re-seeds from the period on screen.
              bdm={bdm}
              displayPeriod={targetPeriod}
              onSaved={onTargetsSaved}
              onCancel={() => setFormOpen(false)}
            />
          ) : (
            <button type="button" className="vip-btn-link vip-net-set-targets" onClick={() => setFormOpen(true)}>
              + Set targets
            </button>
          )}
        </div>

        <div className="vip-dd-stats vip-net-bdm-stats">
          {tiles.map((t) => (
            <div key={t.key} className="vip-dd-stat">
              <span className="vip-dd-stat-label">{t.label}</span>
              <span className="vip-dd-stat-value">{t.value}</span>
              <span className="vip-dd-stat-sub">{t.sub}</span>
            </div>
          ))}
          {/* The one tile with a list behind it — the same "Architects to meet"
              panel the BDM's own Dashboard tile opens. */}
          <button
            type="button"
            className="vip-dd-stat vip-net-stat-btn"
            onClick={onOpenArchitects}
            disabled={toMeetCount == null}
          >
            <span className="vip-dd-stat-label">Architects to meet</span>
            <span className="vip-dd-stat-value">{toMeetCount == null ? loading : String(toMeetCount)}</span>
            <span className="vip-dd-stat-sub">
              no meeting in {ARCHITECT_MEETING_DAYS}+ days{toMeetCount ? ' ›' : ''}
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}

export default BdmNetworkCard
