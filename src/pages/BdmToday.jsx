import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCachedQuery } from '../hooks/useCachedQuery'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import FollowUpForm from '../components/FollowUpForm'
import FollowUpList from '../components/FollowUpList'
import DrilldownPanel from '../components/DrilldownPanel'
import { DayKpiStrip } from '../components/DayReviewHeader'
import { fetchDueFollowUpsForEmployee, markFollowUpDone, cancelFollowUp, rescheduleFollowUp, logActivityPathFor, reminderSavedMessage, lockedFollowUpIds } from '../lib/followUpQueries'
import { fetchPortfolioArchitects, fetchArchitectMeetings } from '../lib/architectQueries'
import { countWaitingPoolLeads } from '../lib/bdmQueries'
import { architectsToMeet, lastMeetingByArchitect, lastMetLabel, ARCHITECT_MEETING_DAYS } from '../lib/architectStats'
import { firmLabel } from '../lib/firmLabel'
import { formatCurrencyCompact } from '../lib/format'
import { fetchDayReview } from '../lib/dayReviewQueries'
import { buildDayRows, buildSignificantEntries, buildDaySheetPanel } from '../lib/dayReview'
import { todayISO } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'

// How many "Architects to meet" rows Today shows before handing off to My
// Architects. A long list here would push the follow-ups — the day's actual
// commitments — off a phone screen.
const ARCHITECT_ROWS = 5

// The business development manager's Today (BDM.md Step 4). Owner's rulings on
// the order: greeting (with the one-line "N updates on your leads", mounted in
// TodayGreetingHeader) → a line when leads are still waiting for the owner →
// "Done today" KPIs + recap (the same fetchDayReview/dayReview.js pipeline
// Home.jsx uses for an exec — scopeToEmployee() filters purely by
// employee/assigned-to id, so it needs no BDM-specific branching: it already
// shows exactly the activities this BDM logged and the follow-ups closed
// against their own id) → Follow-ups due (one card, overdue first) →
// Architects to meet (portfolio architects with no meeting in
// ARCHITECT_MEETING_DAYS, the clock starting at the later of the last meeting
// and bdm_since).
//
// Deliberately not here: pipeline figures and targets (the BDM Dashboard,
// Step 5) and scheduled meetings (Step 7).
function BdmToday() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  const [followUps, setFollowUps] = useState(null)
  const [followUpError, setFollowUpError] = useState(null)
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [savedNote, setSavedNote] = useState(null)
  const [panel, setPanel] = useState(null)

  // Remembered on the device (instant open — src/lib/queryClient.js): a
  // repeat open paints these at once and refreshes behind the "Updating…"
  // pill. Day-scoped ones are keyed by the day.
  const enabled = Boolean(employee?.id)
  const today = todayISO()

  const waitingQuery = useCachedQuery(
    ['today', 'bdm-waiting', employee?.id],
    () => countWaitingPoolLeads(employee.id).then(({ count, error }) => ({ data: count ?? 0, error })),
    { enabled }
  )
  const waitingCount = waitingQuery.result?.error ? 0 : (waitingQuery.result?.data ?? 0)

  // Seeded into state because the row actions edit the list in place;
  // re-seeded whenever the query refreshes.
  const followUpsQuery = useCachedQuery(
    ['today', 'due-follow-ups', employee?.id, today],
    () => fetchDueFollowUpsForEmployee(employee.id),
    { enabled }
  )
  useEffect(() => {
    const res = followUpsQuery.result
    if (!res) return
    setFollowUpError(res.error ? errorMessage(res.error) : null)
    setFollowUps(res.data ?? [])
  }, [followUpsQuery.result])

  // The portfolio and its meetings in one query. Meetings are kept as the
  // raw rows (a Map can't be stored) and reduced to "last met" below.
  const architectsQuery = useCachedQuery(
    ['today', 'bdm-architects', employee?.id],
    async () => {
      const { data, error } = await fetchPortfolioArchitects(employee.id)
      if (error) return { data: null, error }
      const meetings = await fetchArchitectMeetings(data.map((a) => a.id))
      return { data: { architects: data, meetings: meetings.data ?? [], meetingsError: meetings.error ?? null }, error: null }
    },
    { enabled }
  )
  const architectsResult = architectsQuery.result
  const architects = architectsResult ? (architectsResult.error ? [] : architectsResult.data.architects) : null
  const lastMetById = useMemo(
    () => lastMeetingByArchitect(architectsResult?.data?.meetings ?? []),
    [architectsResult]
  )
  const architectsError = useMemo(() => {
    if (!architectsResult) return null
    if (architectsResult.error) return errorMessage(architectsResult.error)
    return architectsResult.data.meetingsError ? errorMessage(architectsResult.data.meetingsError) : null
  }, [architectsResult])

  // "Done today" — same one-day-bounded fetch Home.jsx runs for an exec.
  const dayQuery = useCachedQuery(['today', 'day-review', today], () => fetchDayReview(today), { enabled })
  const dayData = dayQuery.result ?? null

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
    const path = logActivityPathFor(f)
    if (path) navigate(path)
  }

  const toMeet = architects ? architectsToMeet(architects, lastMetById) : []

  const myDay = dayData && employee ? buildDayRows([employee], dayData, false)[0] : null
  const entries = dayData && employee ? buildSignificantEntries(employee, dayData) : []

  const doneTiles = myDay
    ? [
        { key: 'activities', label: 'Activities', value: String(myDay.total), sub: `${myDay.calls} calls · ${myDay.visits} visits` },
        {
          key: 'followups',
          label: 'Follow-ups',
          value: null,
          done: myDay.done,
          missed: myDay.pending,
          missedIsPending: true,
          sub: myDay.pending > 0 ? `${myDay.pending} still open` : 'all clear',
        },
        { key: 'touched', label: 'Leads touched', value: String(myDay.touched), sub: `${myDay.newLeads} new · ${myDay.changes} changes` },
        {
          key: 'quotes',
          label: 'Quotes sent',
          value: String(myDay.quotes),
          sub: myDay.quotesValue > 0 ? formatCurrencyCompact(myDay.quotesValue) : 'none today',
        },
      ]
    : []

  function openMyDaySheet() {
    if (!dayData || !employee) return
    setPanel(
      buildDaySheetPanel({
        employee,
        data: dayData,
        dateISO: todayISO(),
        isPast: false,
        changesUnavailable: dayData.changesUnavailable,
        changeLogStart: null,
        onReschedule: rescheduleFollowUp,
      })
    )
  }

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

      {doneTiles.length > 0 && (
        <div className="vip-card">
          <h2 className="vip-card-title">Done today</h2>
          <DayKpiStrip kpis={doneTiles} />
        </div>
      )}

      {/* An even pair: side by side from 1024px, stacked (follow-ups first) on a
          phone. */}
      <div className="vip-report-grid">
        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Follow-ups due</h2>
            <button type="button" className="vip-btn-link" onClick={() => { setSavedNote(null); setAddingFollowUp((v) => !v) }}>
              {addingFollowUp ? 'Cancel' : '+ Add reminder'}
            </button>
          </div>

          {addingFollowUp && (
            <FollowUpForm
              assignedTo={employee.id}
              createdBy={employee.id}
              onSaved={(row) => {
                if (row.due_date <= todayISO()) setFollowUps((prev) => [...(prev ?? []), row])
                setSavedNote(reminderSavedMessage(row))
                setAddingFollowUp(false)
              }}
              onCancel={() => setAddingFollowUp(false)}
            />
          )}

          {savedNote && !addingFollowUp && (
            <p className="vip-success" role="status" aria-live="polite">
              {savedNote}
            </p>
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
              lockedIds={lockedFollowUpIds(followUps)}
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

      {/* Recap: what's already been logged today, the quietest section — same
          layout as Home's "Today's activity" card. */}
      {entries.length > 0 && (
        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Today's activity</h2>
            {myDay?.firstActivityAt && <span className="vip-card-note">since {myDay.firstActivityAt}</span>}
          </div>
          {entries.map((e) => (
            <div key={e.id} className="vip-day-entry">
              <span className="vip-day-entry-dot" style={{ background: e.color }} />
              {e.accompanied ? (
                <span className="vip-day-entry-stack">
                  <span className="vip-day-entry-text">{e.text}</span>
                  <span className="vip-day-entry-sub">
                    <span className="vip-accompanied-tag">Accompanied</span>
                    <span className="vip-day-entry-sub-text">{e.withText}</span>
                  </span>
                </span>
              ) : e.leadId ? (
                <Link to={`/leads/${e.leadId}`} className="vip-day-entry-text">
                  {e.text}
                </Link>
              ) : (
                <span className="vip-day-entry-text">{e.text}</span>
              )}
              <span className="vip-day-entry-time">{e.time}</span>
            </div>
          ))}
          <button type="button" className="vip-day-entry-link" onClick={openMyDaySheet}>
            See everything I logged today
          </button>
        </div>
      )}

      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />
    </div>
  )
}

export default BdmToday
