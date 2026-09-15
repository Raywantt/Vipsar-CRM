import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import FollowUpForm from '../components/FollowUpForm'
import FollowUpList from '../components/FollowUpList'
import { fetchDueFollowUpsForEmployee, markFollowUpDone, cancelFollowUp, rescheduleFollowUp } from '../lib/followUpQueries'
import { fetchPortfolioArchitects, fetchArchitectMeetings } from '../lib/architectQueries'
import { countWaitingPoolLeads } from '../lib/bdmQueries'
import { architectsToMeet, lastMeetingByArchitect, lastMetLabel, ARCHITECT_MEETING_DAYS } from '../lib/architectStats'
import { firmLabel } from '../lib/firmLabel'
import { todayISO } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'

// How many "Architects to meet" rows Today shows before handing off to My
// Architects. A long list here would push the follow-ups — the day's actual
// commitments — off a phone screen.
const ARCHITECT_ROWS = 5

// The business development manager's Today (BDM.md Step 4). Owner's rulings on
// the order: greeting (with the one-line "N updates on your leads", mounted in
// TodayGreetingHeader) → a line when leads are still waiting for the owner →
// Follow-ups due (one card, overdue first) → Architects to meet (portfolio
// architects with no meeting in ARCHITECT_MEETING_DAYS, the clock starting at
// the later of the last meeting and bdm_since).
//
// Deliberately not here: pipeline figures and targets (the BDM Dashboard,
// Step 5) and scheduled meetings (Step 7).
function BdmToday() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  const [waitingCount, setWaitingCount] = useState(0)

  const [followUps, setFollowUps] = useState(null)
  const [followUpError, setFollowUpError] = useState(null)
  const [addingFollowUp, setAddingFollowUp] = useState(false)

  const [architects, setArchitects] = useState(null)
  const [lastMetById, setLastMetById] = useState(new Map())
  const [architectsError, setArchitectsError] = useState(null)

  useEffect(() => {
    if (!employee?.id) return
    let active = true

    countWaitingPoolLeads(employee.id).then(({ count, error }) => {
      if (active && !error) setWaitingCount(count ?? 0)
    })

    fetchDueFollowUpsForEmployee(employee.id).then(({ data, error }) => {
      if (!active) return
      if (error) setFollowUpError(errorMessage(error))
      setFollowUps(data ?? [])
    })

    fetchPortfolioArchitects(employee.id).then(async ({ data, error }) => {
      if (!active) return
      if (error) {
        setArchitectsError(errorMessage(error))
        setArchitects([])
        return
      }
      const meetings = await fetchArchitectMeetings(data.map((a) => a.id))
      if (!active) return
      if (meetings.error) setArchitectsError(errorMessage(meetings.error))
      setLastMetById(lastMeetingByArchitect(meetings.data))
      setArchitects(data)
    })

    return () => {
      active = false
    }
  }, [employee?.id])

  async function handleMarkDone(id) {
    const { data, error } = await markFollowUpDone(id)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    setFollowUps((prev) => (prev ?? []).filter((f) => f.id !== data.id))
  }

  async function handleReschedule(id, dueDate) {
    const { error } = await rescheduleFollowUp(id, dueDate)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    setFollowUps((prev) => (prev ?? []).filter((f) => f.id !== id))
  }

  async function handleCancel(id, reason) {
    const { error } = await cancelFollowUp(id, reason)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    setFollowUps((prev) => (prev ?? []).filter((f) => f.id !== id))
  }

  // Same hand-off Home uses: Log Activity with the lead and type pre-filled,
  // which closes the reminder when the activity saves.
  function handleLogActivityFor(f) {
    const params = new URLSearchParams({ lead: String(f.lead_id), followup: String(f.id) })
    if (f.activity_type && f.activity_type !== 'other') params.set('type', f.activity_type)
    navigate(`/activity?${params.toString()}`)
  }

  const toMeet = architects ? architectsToMeet(architects, lastMetById) : []

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <TodayGreetingHeader employee={employee} />

      {waitingCount > 0 && (
        <Link to="/dashboard?tab=leads" className="vip-bdm-waiting">
          <span className="vip-bdm-waiting-text">
            {waitingCount === 1
              ? '1 of your leads is waiting for the owner to assign'
              : `${waitingCount} of your leads are waiting for the owner to assign`}
          </span>
          <span className="vip-bdm-updates-chevron" aria-hidden="true">
            ›
          </span>
        </Link>
      )}

      {/* An even pair: side by side from 1024px, stacked (follow-ups first) on a
          phone. */}
      <div className="vip-report-grid">
        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Follow-ups due</h2>
            <button type="button" className="vip-btn-link" onClick={() => setAddingFollowUp((v) => !v)}>
              {addingFollowUp ? 'Cancel' : '+ Add reminder'}
            </button>
          </div>

          {addingFollowUp && (
            <FollowUpForm
              assignedTo={employee.id}
              createdBy={employee.id}
              onSaved={(row) => {
                if (row.due_date <= todayISO()) setFollowUps((prev) => [...(prev ?? []), row])
                setAddingFollowUp(false)
              }}
              onCancel={() => setAddingFollowUp(false)}
            />
          )}

          {followUpError && (
            <p className="vip-error" role="alert">
              {followUpError}
            </p>
          )}

          {followUps === null ? (
            <p className="vip-empty">Loading…</p>
          ) : followUps.length === 0 ? (
            <p className="vip-empty">Nothing due. Reminders show up here on the day they're due.</p>
          ) : (
            // fetchDueFollowUpsForEmployee orders by due date ascending, so
            // overdue reminders already come first; FollowUpList marks them.
            <FollowUpList
              followUps={followUps}
              viewerId={employee.id}
              onMarkDone={handleMarkDone}
              onCancel={handleCancel}
              onReschedule={handleReschedule}
              onLogActivity={handleLogActivityFor}
              emptyLabel="Nothing due."
            />
          )}
        </div>

        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Architects to meet</h2>
            {toMeet.length > 0 && <span className="vip-day-head-count">{toMeet.length}</span>}
          </div>
          <p className="vip-arch-card-sub">In your portfolio, no meeting in {ARCHITECT_MEETING_DAYS}+ days</p>

          {architectsError && (
            <p className="vip-error" role="alert">
              {architectsError}
            </p>
          )}

          {architects === null ? (
            <p className="vip-empty">Loading…</p>
          ) : architects.length === 0 ? (
            <p className="vip-empty">
              No architects in your portfolio yet. Add one from <Link to="/leads/new">+ New</Link> → Architect.
            </p>
          ) : toMeet.length === 0 ? (
            <p className="vip-empty">
              You've met every architect in your portfolio in the last {ARCHITECT_MEETING_DAYS} days.
            </p>
          ) : (
            <div className="vip-arch-list">
              {toMeet.slice(0, ARCHITECT_ROWS).map((row) => (
                <Link key={row.architect.id} to={`/architects/${row.architect.id}`} className="vip-arch-row">
                  <span className="vip-arch-row-main">
                    <span className="vip-arch-row-name">{row.architect.name}</span>
                    <span className="vip-arch-row-meta">
                      {[
                        firmLabel(row.architect),
                        lastMetLabel(row.lastMetDays),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="vip-arch-row-days">{row.clockDays}d</span>
                  <span className="vip-bdm-updates-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
              {toMeet.length > ARCHITECT_ROWS && (
                <Link to="/architects" className="vip-day-entry-link">
                  +{toMeet.length - ARCHITECT_ROWS} more · My Architects
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default BdmToday
