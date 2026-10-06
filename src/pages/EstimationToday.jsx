import { useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useCachedQuery } from '../hooks/useCachedQuery'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import EstimationQueues from '../components/EstimationQueues'
import { DayKpiStrip } from '../components/DayReviewHeader'
import DrilldownPanel from '../components/DrilldownPanel'
import { buildRfqPanel } from '../lib/rfqDeskPanels'
import { fetchMyEstimationDecisions } from '../lib/rfqQueries'
import { estimationMonthStats, monthStart } from '../lib/rfqDesk'

// The Estimation Executive's Today (RFQ-DESK.md Step 5) — Harpreet's whole
// working screen, the same shape as the Production Executive's
// (ProductionToday): the greeting bar, a slim "this month" strip of their own
// figures (owner's ruling, Q8), then the two lists. One column at every width
// (owner's ruling, 2026-10-06), so .vip-narrow.
//
// A price revision is NOT started from here (owner's ruling): it starts on the
// lead's RFQs card on Lead Detail, found through Search, and then appears in
// "Waiting for estimation" like any other RFQ.
function EstimationToday() {
  const { employee } = useAuth()
  return (
    <div className="vip-narrow">
      <TodayGreetingHeader employee={employee} />
      <EstimationMonthStrip employee={employee} />
      <EstimationQueues viewer={employee} />
    </div>
  )
}

// Four numbers in the Day Review's KPI tiles (2-up on a phone, 4-up from
// 1024px), counted from the RFQs themselves (estimationMonthStats). Each tile
// opens its popup (owner's ruling, 2026-10-06 — rfqDeskPanels.js); "Typical
// Lixil time" reads the popup's own figure (working time, Sundays out).
function EstimationMonthStrip({ employee }) {
  const [panel, setPanel] = useState(null)
  const now = new Date()
  const sinceISO = monthStart(now).toISOString()
  // The key carries the month, so the strip starts a new month on its own.
  const query = useCachedQuery(
    ['desk', 'my-estimation-month', employee?.id, sinceISO],
    () => fetchMyEstimationDecisions(employee.id, sinceISO),
    { enabled: Boolean(employee?.id) }
  )
  const result = query.result
  const rows = useMemo(() => (result && !result.error ? result.data ?? [] : null), [result])
  const stats = useMemo(
    () => (rows ? estimationMonthStats(rows, employee?.id, new Date(sinceISO)) : null),
    [rows, employee?.id, sinceISO]
  )

  // An additive strip: if it can't load, it isn't there — the lists are the
  // part that matters, and the header pill already says "Not updated".
  if (!stats) return null

  const month = now.toLocaleDateString('en-IN', { month: 'long' })
  const ctx = { range: { start: new Date(sinceISO), end: now }, rangeLabel: `in ${month}`, employeeId: employee?.id }
  const open = (focus) => () => setPanel(buildRfqPanel({ focus, rows, ctx, eyebrow: `${month} · your estimation` }))
  const lixil = buildRfqPanel({ focus: 'myLixilTime', rows, ctx, eyebrow: '' })
  return (
    <>
      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />
      <DayKpiStrip
        kpis={[
          { key: 'raised', label: 'Raised with Lixil', value: stats.raised, sub: `in ${month}`, onClick: open('myLixilRaised') },
          { key: 'quoted', label: 'Quotes recorded', value: stats.quoted, sub: `in ${month}`, onClick: open('myQuotes') },
          { key: 'sentBack', label: 'Sent back', value: stats.sentBack, sub: 'to the exec', onClick: open('myEstSentBack') },
          {
            key: 'lixil',
            label: 'Typical Lixil time',
            value: lixil.value,
            sub: lixil.value === '—' ? 'no quotes yet' : 'raised → quote in',
            onClick: open('myLixilTime'),
          },
        ]}
      />
    </>
  )
}

export default EstimationToday
