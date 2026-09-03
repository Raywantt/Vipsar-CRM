import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyManagedExecs } from '../lib/employeeQueries'
import TeamTodayPanel from '../components/TeamTodayPanel'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import { errorMessage } from '../lib/errorMessage'
import Home from './Home'

// The sales manager's Today screen — the one place the role's two halves sit
// side by side.
//
// TWO TABS, NOT ONE MERGED SCREEN (the owner's choice, 2026-09-03, from four
// options). A manager is a working rep AND a supervisor, and the two jobs
// have genuinely different shapes: the rep half is a personal action list
// (my follow-ups, my stale leads, my target), the team half is an oversight
// read (who logged what, which of my execs is behind). Merging them produces
// a screen where "3 overdue" could mean either, which is worse than one more
// tap. Neither half is compressed to make room for the other.
//
// DEFAULT IS "MY DAY", also the owner's choice: personal work first, team
// review a deliberate tap. Deliberately NOT persisted — the answer to "where
// should this land each time they open it" was a fixed default, not
// "remember the last choice", so a manager always starts on their own work.
//
// NEITHER HALF IS REBUILT HERE. "My day" renders the real Home — the exact
// sales-executive Today screen, embedded — rather than a manager-flavoured
// copy of it, so a manager's personal day can never drift from an exec's.
// "My team" renders TeamTodayPanel, the same component the coordinator's
// Today screen is now built from. This file is the tab switch and the roster
// fetch, and almost nothing else.
//
// The one substantive difference from the coordinator's team view is
// attentionKeys: all five buckets, not two (the owner's ruling). A manager
// carries their own quota, so quotes going quiet and close dates slipping on
// their team's deals are their problem in a way they are not a
// coordinator's.
const MANAGER_ATTENTION_KEYS = ['stale', 'silent_quotes', 'followups_overdue', 'slipped', 'pending_rfq']

function ManagerToday() {
  const { employee } = useAuth()

  const [tab, setTab] = useState('day')
  const [execs, setExecs] = useState([])
  const [execsLoaded, setExecsLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)

  // The roster is fetched on mount rather than when the team tab is first
  // opened, so the tab's own count is honest before it is tapped — and
  // because `employees` SELECT is open to every active employee, this is a
  // single small query, not something worth deferring.
  useEffect(() => {
    if (!employee?.id) return
    let active = true
    fetchMyManagedExecs(employee.id).then(({ data, error }) => {
      if (!active) return
      if (error) setLoadError(errorMessage(error))
      setExecs(data ?? [])
      setExecsLoaded(true)
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <TodayGreetingHeader employee={employee} />

      <div className="vip-seg" role="tablist" aria-label="My day or my team">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'day'}
          className={tab === 'day' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
          onClick={() => setTab('day')}
        >
          My day
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'team'}
          className={tab === 'team' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
          onClick={() => setTab('team')}
        >
          My team{execsLoaded && execs.length > 0 ? ` (${execs.length})` : ''}
        </button>
      </div>

      {tab === 'day' ? (
        <Home embedded />
      ) : !execsLoaded ? (
        <p className="vip-empty">Loading your team…</p>
      ) : loadError ? (
        <p className="vip-error" role="alert">{loadError}</p>
      ) : execs.length === 0 ? (
        <div className="vip-card">
          <div className="vip-card-title">No sales executives report to you yet</div>
          <p className="vip-form-note" style={{ marginTop: 0 }}>
            Ask the owner to assign your team in Profile → Manage employees, then check back here. Your own leads and
            activities are unaffected — they're on the My day tab.
          </p>
        </div>
      ) : (
        <TeamTodayPanel
          employee={employee}
          execs={execs}
          attentionKeys={MANAGER_ATTENTION_KEYS}
          attentionTitle="Needs your team's attention"
          // The fourth "assign a follow-up" entry point: swipe a red-flag row
          // in the drill-down and set a date on that lead without navigating
          // away. It creates a real follow_up assigned to the LEAD'S OWNER
          // (so the rep gets the push), created_by this manager, which is why
          // FollowUpList shows it to them as "Assigned by {name}".
          rowActions
        />
      )}
    </div>
  )
}

export default ManagerToday
