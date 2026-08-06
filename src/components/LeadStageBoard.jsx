import { Link } from 'react-router-dom'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { stageFg } from '../lib/statusColors'
import { formatCurrencyCompact } from '../lib/format'
import EmployeeLink from './EmployeeLink'

function leadTitle(lead) {
  return lead.parties?.name ?? (lead.sites?.nickname || lead.sites?.locality) ?? '(no party)'
}

// Read-only board — cards link to LeadDetail to actually change stage there,
// reusing the existing stage-change/loss-reason flow instead of
// reimplementing it as drag-and-drop.
function LeadStageBoard({ leads, isOwner }) {
  const columns = LEAD_STAGE_OPTIONS.map((stage) => {
    const stageLeads = leads.filter((lead) => (lead.current_stage ?? 'new') === stage)
    const orderValue = stageLeads.reduce((s, l) => s + Number(l.order_value ?? 0), 0)
    return { stage, leads: stageLeads, orderValue }
  })

  return (
    <div className="vip-board">
      {columns.map(({ stage, leads: stageLeads, orderValue }) => (
        <div key={stage} className="vip-board-col">
          <div className="vip-board-head" style={{ borderTopColor: stageFg(stage) }}>
            <div className="vip-board-head-top">
              <div className="vip-board-title">{stage}</div>
              <div className="vip-board-meta">{stageLeads.length}</div>
            </div>
            <div className="vip-board-meta">{formatCurrencyCompact(orderValue)}</div>
          </div>

          {stageLeads.length === 0 ? (
            <p className="vip-empty">No leads</p>
          ) : (
            stageLeads.map((lead) => (
              <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-board-card">
                <div className="vip-board-card-party">{leadTitle(lead)}</div>
                {lead.sites?.nickname || lead.sites?.locality ? (
                  <div className="vip-board-card-site">{lead.sites.nickname || lead.sites.locality}</div>
                ) : null}
                <div className="vip-board-card-foot">
                  <div className="vip-board-card-value">{formatCurrencyCompact(lead.order_value)}</div>
                  {isOwner && (
                    <div className="vip-board-card-owner">
                      <EmployeeLink id={lead.owner_employee_id} name={lead.employees?.name} />
                    </div>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
      ))}
    </div>
  )
}

export default LeadStageBoard
