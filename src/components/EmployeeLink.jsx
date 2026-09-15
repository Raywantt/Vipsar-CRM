import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { canOpenEmployeeProfiles } from '../lib/roles'

// A person's name that needs to link to /employees/:id from *inside* a row
// that's already a <Link> to something else (a lead, a party) — a literal
// nested <Link>/<a> would be invalid HTML and break the outer row's click
// target. Navigates via useNavigate + stopPropagation instead. Use
// EmployeeNameLink below wherever there's no outer link to nest inside (e.g.
// LeadActivityTimeline, LeadDetail's Deal owner card).
//
// Both render PLAIN TEXT for a viewer who can't open employee profiles (a
// business development manager — canOpenEmployeeProfiles, owner's ruling at
// BDM.md Step 2). A link they can see but not follow just bounces them to
// Today, so the check lives here, once, rather than at each call site.
function EmployeeLink({ id, name, fallback = 'Unassigned', className, style }) {
  const navigate = useNavigate()
  const { employee } = useAuth()
  if (!id || !canOpenEmployeeProfiles(employee?.role)) {
    return <span className={className} style={style}>{name ?? fallback}</span>
  }
  return (
    <span
      className={className}
      style={{ color: 'var(--vip-teal)', cursor: 'pointer', ...style }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        navigate(`/employees/${id}`)
      }}
    >
      {name ?? fallback}
    </span>
  )
}

// The plain-<Link> form, for a name that is not inside another link.
export function EmployeeNameLink({ id, name, fallback = 'Unassigned', className }) {
  const { employee } = useAuth()
  if (!id || !canOpenEmployeeProfiles(employee?.role)) {
    return <span className={className}>{name ?? fallback}</span>
  }
  return (
    <Link to={`/employees/${id}`} className={className}>
      {name ?? fallback}
    </Link>
  )
}

export default EmployeeLink
