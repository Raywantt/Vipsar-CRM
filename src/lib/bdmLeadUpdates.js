// Shapes the BDM Dashboard's "Handed over" and "Closed" cards (BDM.md Step 3 —
// owner's ruling: two period-scoped list cards on the Dashboard, not
// dismissable notifications). Pure: no network, so the rules are testable.
// Rows arrive newest-first from src/lib/bdmQueries.js.

// One row per lead handed out of the pool in the period, newest first.
// Only leads tagged to THIS BDM — RLS already guarantees that for a BDM
// session, but the builder doesn't lean on who happens to be calling.
export function buildHandedOverRows(historyRows, bdmId) {
  const seen = new Set()
  const rows = []
  for (const h of historyRows ?? []) {
    if (!h.leads || h.leads.bdm_employee_id !== bdmId) continue
    if (seen.has(h.lead_id)) continue
    seen.add(h.lead_id)
    rows.push({
      key: `handed-${h.id}`,
      leadId: h.lead_id,
      lead: h.leads,
      execName: h.new?.name ?? null,
      at: h.changed_at,
    })
  }
  return rows
}

// One row per lead that closed in the period, newest first — its most recent
// won/lost change inside the period. A lead whose CURRENT stage no longer
// matches that change (reopened since, or flipped won↔lost) is left out: the
// card answers "which of my leads are closed", and a reopened lead isn't.
//
// Won shows the booked order_value (the won prompt requires one, so a gap
// means an old lead — rendered as no figure rather than ₹0). Lost shows the
// most recent loss reason on file for that lead.
export function buildClosedRows(stageRows, lossRows, bdmId) {
  const reasonByLead = new Map()
  for (const r of lossRows ?? []) {
    if (!reasonByLead.has(r.lead_id)) reasonByLead.set(r.lead_id, r)
  }

  const seen = new Set()
  const rows = []
  for (const s of stageRows ?? []) {
    const lead = s.leads
    if (!lead || lead.bdm_employee_id !== bdmId) continue
    if (seen.has(s.lead_id)) continue
    seen.add(s.lead_id)
    if (lead.current_stage !== s.stage) continue

    const loss = s.stage === 'lost' ? reasonByLead.get(s.lead_id) ?? null : null
    rows.push({
      key: `closed-${s.id}`,
      leadId: s.lead_id,
      lead,
      outcome: s.stage,
      at: s.changed_at,
      value: s.stage === 'won' ? lead.order_value ?? null : null,
      reason: loss?.reason ?? null,
      competitor: loss?.competitor_name ?? null,
      ownerName: lead.owner_employee_id === bdmId ? 'You' : lead.employees?.name ?? null,
    })
  }
  return rows
}
