import { useBdmRoster } from '../hooks/useBdmRoster'
import { getInitials } from '../lib/initials'

// The small badge marking which BDM brought a lead in — dropped in wherever
// a lead's name renders, company-wide (the owner's ruling: every role who
// can already see the lead should see this too, same as any other fact on
// the row). Reuses .vip-role-tag, the same quiet outline badge Day Review
// and the attainment heatmap already use for a manager's "MGR" tag, rather
// than inventing a second visual vocabulary for "this row carries an
// attribute". Renders nothing for a lead with no bdm_employee_id, or while
// the roster hasn't loaded yet / has no match (a deactivated BDM).
//
// Fetches its own roster (useBdmRoster) rather than taking one as a prop —
// this app's lead-row renderers are nested several components deep in
// places (Dashboard -> DrilldownPanel -> AgeingBody, for one), and threading
// a bdms array through every intermediate layer just to reach this leaf
// would touch far more files than the badge itself. The roster is cached,
// so many chips on one screen still cost one request, not one each.
function BdmChip({ bdmEmployeeId }) {
  const bdms = useBdmRoster()
  if (!bdmEmployeeId) return null
  const bdm = bdms.find((b) => b.id === bdmEmployeeId)
  if (!bdm) return null
  return (
    <span className="vip-role-tag" title={`Brought in by ${bdm.name}`}>
      {getInitials(bdm.name)}
    </span>
  )
}

export default BdmChip
