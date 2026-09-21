import { useEffect, useState } from 'react'
import { fetchLeadsNeedingAttention, fetchLeadsForBreakdown, fetchLastActivityPerLead, fetchStageHistoryForFunnel } from '../lib/dashboardQueries'
import { computeAttentionBuckets, computeAttentionBucketsFromRpc, buildLastStageChangeByLead } from '../lib/attention'

// The Needs Attention buckets for a Today screen — Home (a rep, or a
// manager's "My day"), OwnerToday and TeamTodayPanel (coordinator, and a
// manager's "My team").
//
// WHY THIS EXISTS (2026-09-21). All three screens used to download every lead,
// every activity and every stage change the viewer can see — ~4,700 rows in 6
// paged requests for the owner — just to work out these buckets in the
// browser. Today is what the whole team opens at 10am, so those downloads
// were the heart of the morning burst that took the database down
// ("current transaction is aborted"). leads_needing_attention() answers the
// same question in Postgres in ONE request (Schema/migration_needs_attention_
// rpc.sql, verified identical to the client-side path bucket-for-bucket, and
// the Dashboard's own fast path since 2026-09-05). Measured alone on live
// data: ~0.7-1.1s for one request vs ~1.8s for the six it replaces.
//
// ROLES NEED NO BRANCHING HERE. The function is SECURITY INVOKER, so RLS
// scopes it exactly as it scoped the three downloads: everything for an
// owner, the team for a coordinator, own + team for a manager, own for a rep.
// `onlyOwnerId` is the one extra filter, and it is Home's own existing rule
// ("my queue" means leads I own, even for a manager who can see a team).
//
// FAILS SOFT, the Dashboard's way: if the function errors (or doesn't exist
// in some environment), the original download-everything path runs instead,
// so the buckets still appear — just slower.
//
// Returns null while loading, then the buckets array from attention.js.
export function useAttentionBuckets(employeeId, { onlyOwnerId = null } = {}) {
  const [buckets, setBuckets] = useState(null)

  useEffect(() => {
    if (!employeeId) return
    let active = true

    async function load() {
      const { data, error } = await fetchLeadsNeedingAttention()
      if (!active) return
      if (!error && data) {
        const rows = onlyOwnerId == null ? data : data.filter((r) => r.owner_id === onlyOwnerId)
        setBuckets(computeAttentionBucketsFromRpc(rows))
        return
      }

      // Fallback — the exact computation these screens ran before.
      const [leadsRes, activityRes, stageRes] = await Promise.all([
        fetchLeadsForBreakdown(),
        fetchLastActivityPerLead(),
        fetchStageHistoryForFunnel(),
      ])
      if (!active) return
      const lastActivityByLead = new Map()
      ;(activityRes.data ?? []).forEach((row) => {
        const existing = lastActivityByLead.get(row.lead_id)
        if (!existing || new Date(row.created_at) > new Date(existing)) lastActivityByLead.set(row.lead_id, row.created_at)
      })
      const leads = leadsRes.data ?? []
      setBuckets(
        computeAttentionBuckets(
          onlyOwnerId == null ? leads : leads.filter((l) => l.owner_employee_id === onlyOwnerId),
          lastActivityByLead,
          buildLastStageChangeByLead(stageRes.data)
        )
      )
    }

    load()
    return () => {
      active = false
    }
  }, [employeeId, onlyOwnerId])

  return buckets
}
