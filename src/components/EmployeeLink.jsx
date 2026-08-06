import { useNavigate } from 'react-router-dom'

// A person's name that needs to link to /employees/:id from *inside* a row
// that's already a <Link> to something else (a lead, a party) — a literal
// nested <Link>/<a> would be invalid HTML and break the outer row's click
// target. Navigates via useNavigate + stopPropagation instead. Use a plain
// <Link to={`/employees/${id}`}> wherever there's no outer link to nest
// inside (e.g. LeadActivityTimeline, LeadDetail's Deal owner card).
function EmployeeLink({ id, name, fallback = 'Unassigned', className, style }) {
  const navigate = useNavigate()
  if (!id) return <span className={className} style={style}>{name ?? fallback}</span>
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

export default EmployeeLink
