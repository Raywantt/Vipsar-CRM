import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { stageFg } from '../lib/statusColors'

const MS_PER_DAY = 1000 * 60 * 60 * 24

// stage_history logs only the *destination* of each explicit stage change
// — never the stage a lead started in, since `leads.current_stage DEFAULT
// 'new'` is never itself an "update". So a lead that went straight
// new -> lost has exactly one history row ('lost') and would silently
// undercount 'new' otherwise. Every lead's reached-set is seeded with both
// 'new' (true for all of them, by schema default) and its own current
// stage (from `leads`, already RLS-scoped the normal way), then widened
// with whatever's actually in stage_history. Avg-days-in-stage is
// unaffected by any of this — it only reflects actual logged transitions,
// which is the correct thing to measure there.
// Exported so the pipeline/funnel drill-down (src/lib/drilldownBuilders.js)
// can reuse the exact same reached-count/avg-days-in-stage numbers this card
// shows, instead of a second computation that could drift from it.
export function computeFunnel(stageHistory, leads) {
  // stage_history SELECT is open to everyone (unlike leads/activities), so
  // a sales exec's rows for leads they don't own come back with
  // `leads: null` (RLS on the embedded relation) — drop those to get the
  // same "own data or owner role" scoping every other card gets for free.
  // Same trick TargetsVsActualsCard's computeOrderValueActuals already uses.
  const visibleHistory = stageHistory.filter((row) => row.leads)

  const reachedByLead = new Map()
  leads.forEach((lead) => {
    reachedByLead.set(lead.id, new Set(['new', lead.current_stage ?? 'new']))
  })
  visibleHistory.forEach((row) => {
    if (!reachedByLead.has(row.lead_id)) reachedByLead.set(row.lead_id, new Set())
    reachedByLead.get(row.lead_id).add(row.stage)
  })

  const reachedCount = new Map(LEAD_STAGE_OPTIONS.map((s) => [s, 0]))
  reachedByLead.forEach((stages) => {
    stages.forEach((stage) => {
      if (reachedCount.has(stage)) reachedCount.set(stage, reachedCount.get(stage) + 1)
    })
  })

  const byLeadHistory = new Map()
  visibleHistory.forEach((row) => {
    if (!byLeadHistory.has(row.lead_id)) byLeadHistory.set(row.lead_id, [])
    byLeadHistory.get(row.lead_id).push(row)
  })

  const stageDurations = new Map(LEAD_STAGE_OPTIONS.map((s) => [s, { totalDays: 0, transitions: 0 }]))
  byLeadHistory.forEach((rows) => {
    const sorted = [...rows].sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at))
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]
      const next = sorted[i + 1]
      if (!stageDurations.has(current.stage)) continue
      const days = (new Date(next.changed_at) - new Date(current.changed_at)) / MS_PER_DAY
      const entry = stageDurations.get(current.stage)
      entry.totalDays += days
      entry.transitions += 1
    }
  })

  return LEAD_STAGE_OPTIONS.map((stage) => {
    const duration = stageDurations.get(stage)
    return {
      stage,
      reached: reachedCount.get(stage),
      avgDays: duration.transitions > 0 ? duration.totalDays / duration.transitions : null,
    }
  })
}

function SalesFunnelCard({ stageHistory, leads, onOpenPanel }) {
  const rows = computeFunnel(stageHistory, leads)
  const hasData = rows.some((r) => r.reached > 0)
  const maxReached = Math.max(1, ...rows.map((r) => r.reached))

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">Sales funnel</div>
        {onOpenPanel && (
          <button type="button" className="vip-dd-open-link" onClick={onOpenPanel}>
            Details ›
          </button>
        )}
      </div>

      {!hasData ? (
        <p className="vip-empty">No leads yet.</p>
      ) : (
        rows.map(({ stage, reached, avgDays }) => (
          <div key={stage} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: 'var(--vip-ink)', textTransform: 'capitalize' }}>{stage}</div>
              <div className="vip-bar-value" style={{ flex: '0 0 auto' }}>
                {reached} · {avgDays == null ? '—' : `${avgDays.toFixed(1)}d`}
              </div>
            </div>
            <div className="vip-bar-track vip-funnel">
              <div
                className="vip-bar-fill"
                style={{ width: `${(reached / maxReached) * 100}%`, background: stageFg(stage) }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default SalesFunnelCard
