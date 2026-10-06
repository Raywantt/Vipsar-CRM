import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useCachedQuery } from '../hooks/useCachedQuery'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import TechnicalQueueCard from '../components/TechnicalQueueCard'
import { DayKpiStrip } from '../components/DayReviewHeader'
import { fetchMyTechnicalDecisions } from '../lib/rfqQueries'
import { durationLabel, monthStart, technicalMonthStats } from '../lib/rfqDesk'
import { TONE_WARN } from '../lib/statusColors'

// The Production Executive's Today (RFQ-DESK.md Step 4) — Harjot's whole
// working screen. Top to bottom:
//   * the greeting bar, which carries "An RFQ you approved was sent back"
//     (RfqUpdatesCard's rfq_bounced alerts, mounted inside the header like
//     every Today line);
//   * a slim "this month" strip of their own figures (owner's ruling,
//     2026-10-06 — Q8: a strip on Today, the full figures stay on the owner's
//     RFQ Desk, Step 7);
//   * the review queue.
// One column at every width (owner's ruling): the queue is a single list, so
// .vip-narrow is the honest width class for it.
function ProductionToday() {
  const { employee } = useAuth()
  return (
    <div className="vip-narrow">
      <TodayGreetingHeader employee={employee} />
      <TechnicalMonthStrip employee={employee} />
      <TechnicalQueueCard viewer={employee} />
    </div>
  )
}

// Four numbers, the Day Review's static KPI tiles (2-up on a phone, 4-up from
// 1024px). Counted from the RFQs themselves (technicalMonthStats), so an
// approval made this morning is in it as soon as the queue drops the row.
function TechnicalMonthStrip({ employee }) {
  const now = new Date()
  const sinceISO = monthStart(now).toISOString()
  // The key carries the month, so the strip starts a new month on its own.
  const query = useCachedQuery(
    ['desk', 'my-technical-month', employee?.id, sinceISO],
    () => fetchMyTechnicalDecisions(employee.id, sinceISO),
    { enabled: Boolean(employee?.id) }
  )
  const result = query.result
  const stats = useMemo(
    () => (result && !result.error ? technicalMonthStats(result.data, employee?.id, new Date(sinceISO)) : null),
    [result, employee?.id, sinceISO]
  )

  // An additive strip: if it can't load, it isn't there — the queue is the
  // part that matters, and the header pill already says "Not updated".
  if (!stats) return null

  const month = now.toLocaleDateString('en-IN', { month: 'long' })
  const tiles = [
    { key: 'approved', label: 'Approved', value: stats.approved, sub: `in ${month}` },
    { key: 'sentBack', label: 'Sent back', value: stats.sentBack, sub: 'to the exec' },
    {
      key: 'bounced',
      label: 'Sent back later',
      value: stats.bounced,
      sub: 'by estimation, after you approved',
      // Amber, not red: a bounce is the miss the owner wants visible
      // (RFQ-DESK.md §3), a "look at this", not a lost deal.
      color: stats.bounced > 0 ? TONE_WARN : undefined,
    },
    {
      key: 'check',
      label: 'Typical check',
      value: stats.medianCheckMs == null ? '—' : durationLabel(stats.medianCheckMs),
      sub: stats.medianCheckMs == null ? 'nothing checked yet' : 'raised → your decision',
    },
  ]

  return <DayKpiStrip kpis={tiles} />
}

export default ProductionToday
