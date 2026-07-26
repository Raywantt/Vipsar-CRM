import { Link } from 'react-router-dom'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { formatCurrency } from '../lib/format'
import '../pages/Dashboard.css'

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
    <div className="dashboard-board">
      {columns.map(({ stage, leads: stageLeads, orderValue }) => (
        <div key={stage} className="dashboard-board-column">
          <div className="dashboard-board-column-header">
            <span className="dashboard-board-column-title">{stage}</span>
            <span className="dashboard-board-column-meta">
              {stageLeads.length} · {formatCurrency(orderValue)}
            </span>
          </div>

          <div className="dashboard-board-cards">
            {stageLeads.length === 0 ? (
              <p className="dashboard-empty">No leads</p>
            ) : (
              stageLeads.map((lead) => (
                <Link key={lead.id} to={`/leads/${lead.id}`} className="dashboard-board-card">
                  <span className="dashboard-board-card-title">{leadTitle(lead)}</span>
                  <span className="dashboard-board-card-value">{formatCurrency(lead.order_value)}</span>
                  {isOwner && <span className="dashboard-board-card-owner">{lead.employees?.name ?? 'Unassigned'}</span>}
                </Link>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default LeadStageBoard
