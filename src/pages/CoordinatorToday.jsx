import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyTeamExecs } from '../lib/employeeQueries'
import TeamTodayPanel from '../components/TeamTodayPanel'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import { errorMessage } from '../lib/errorMessage'

// The sales coordinator's Today screen.
//
// Its body moved into TeamTodayPanel (2026-09-03) when the sales manager
// arrived needing the same screen with a different roster and a wider set of
// red flags. Nothing about what a coordinator sees changed in that move: the
// panel's defaults ARE this screen's old behaviour — the same two attention
// buckets ('stale', 'followups_overdue'), in the same order, with the same
// copy. What is left here is the only part that was ever coordinator-specific:
// which execs make up "my team".
//
// The two-bucket default is the Phase 4 spec's own scope, not an oversight —
// this is an oversight view of a whole team, not one rep's actionable list.
// A manager passes all five explicitly.
function CoordinatorToday() {
  const { employee } = useAuth()

  const [employees, setEmployees] = useState([])
  const [employeesLoaded, setEmployeesLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    fetchMyTeamExecs(employee.id).then(({ data, error }) => {
      if (!active) return
      if (error) setLoadError(errorMessage(error))
      setEmployees(data ?? [])
      setEmployeesLoaded(true)
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <TodayGreetingHeader employee={employee} />

      {!employeesLoaded ? (
        <p className="vip-empty">Loading your team…</p>
      ) : loadError ? (
        <p className="vip-error" role="alert">{loadError}</p>
      ) : employees.length === 0 ? (
        <div className="vip-card">
          <div className="vip-card-title">No sales executives are assigned to you yet</div>
          <p className="vip-form-note" style={{ marginTop: 0 }}>
            Ask the owner to set up your team in Profile → Manage employees, then check back here.
          </p>
        </div>
      ) : (
        <TeamTodayPanel employee={employee} execs={employees} />
      )}
    </div>
  )
}

export default CoordinatorToday
