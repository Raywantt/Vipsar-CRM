import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useCachedQuery } from '../hooks/useCachedQuery'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import EstimationQueues from '../components/EstimationQueues'
import { DayKpiStrip } from '../components/DayReviewHeader'
import { fetchMyEstimationDecisions } from '../lib/rfqQueries'
import { durationLabel, estimationMonthStats, monthStart } from '../lib/rfqDesk'

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

// Four numbers in the Day Review's static KPI tiles (2-up on a phone, 4-up
// from 1024px), counted from the RFQs themselves (estimationMonthStats).
function EstimationMonthStrip({ employee }) {
  const now = new Date()
  const sinceISO = monthStart(now).toISOString()
  // The key carries the month, so the strip starts a new month on its own.
  const query = useCachedQuery(
    ['desk', 'my-estimation-month', employee?.id, sinceISO],
    () => fetchMyEstimationDecisions(employee.id, sinceISO),
    { enabled: Boolean(employee?.id) }
  )
  const result = query.result
  const stats = useMemo(
    () => (result && !result.error ? estimationMonthStats(result.data, employee?.id, new Date(sinceISO)) : null),
    [result, employee?.id, sinceISO]
  )

  // An additive strip: if it can't load, it isn't there — the lists are the
  // part that matters, and the header pill already says "Not updated".
  if (!stats) return null

  const month = now.toLocaleDateString('en-IN', { month: 'long' })
  return (
    <DayKpiStrip
      kpis={[
        { key: 'raised', label: 'Raised with Lixil', value: stats.raised, sub: `in ${month}` },
        { key: 'quoted', label: 'Quotes recorded', value: stats.quoted, sub: `in ${month}` },
        { key: 'sentBack', label: 'Sent back', value: stats.sentBack, sub: 'to the exec' },
        {
          key: 'lixil',
          label: 'Typical Lixil time',
          value: stats.medianLixilMs == null ? '—' : durationLabel(stats.medianLixilMs),
          sub: stats.medianLixilMs == null ? 'no quotes yet' : 'raised → quote in',
        },
      ]}
    />
  )
}

export default EstimationToday
