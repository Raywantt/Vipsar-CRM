import { ROLES, roleLabel } from '../lib/roles'
import { useState } from 'react'

// "What the team did today" — one row per sales exec, nine columns under
// three group headers, sorted by activity volume so quiet days sink to the
// bottom on their own. Desktop is the real table; below 1024px the same rows
// become stacked cards (the design handoff called the table desktop-only, but
// Dashboard is a mobile tab in this app and the owner works from a phone —
// see CLAUDE.md's Day Review section).
//
// Deliberately NOT a scored leaderboard: raw counts only, no weighting, no
// composite index, no ranking badge. Sorting is the only ordering.

const COLUMNS = [
  { key: 'total', label: 'Total', groupStart: true, strong: true },
  { key: 'calls', label: 'Calls' },
  { key: 'visits', label: 'Visits' },
  { key: 'touched', label: 'Touched', groupStart: true },
  { key: 'newLeads', label: 'New' },
  { key: 'changes', label: 'Changes' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'done', label: 'Done/miss', groupStart: true, pair: true },
  { key: 'tomorrow', label: 'Tomorrow' },
]

// A zero reads as an em-dash rather than a 0 — nine columns of zeroes is
// noise, and the eye needs the real numbers to stand out. The Total column
// and the done/missed pair always print a real figure, since "0 activities"
// and "0 done" are the point rather than clutter.

// A sales manager sells alongside the execs and is ranked with them, so their
// row sits in this table like any other — the badge is the only thing marking
// that they also supervise. Renders nothing for a plain sales_executive, so
// the common case stays visually quiet; the full role name is on the tooltip
// rather than in the cell, because the name column is 190px and a spelled-out
// "Sales Manager" would push real names to an ellipsis.
function RoleTag({ role }) {
  if (role !== ROLES.SALES_MANAGER) return null
  return (
    <span className="vip-role-tag" title={roleLabel(role)}>
      MGR
    </span>
  )
}

function Cell({ value, dash }) {
  if (value === 0 && dash) return <span className="vip-daycell-dash">—</span>
  return <span>{value}</span>
}

// done / missed — or done / pending while the day is still running. An open
// follow-up isn't a miss at 10 am, so it stays amber until the day is over
// and only then turns red (see splitFollowUps in dayReview.js).
function DoneMissCell({ row, isPast }) {
  const second = isPast ? row.missed : row.pending
  const title = isPast
    ? `${row.done} completed, ${row.missed} missed`
    : `${row.done} completed, ${second} still pending — the day isn't over`
  return (
    <span title={title}>
      <span className="vip-daycell-done">{row.done}</span>
      <span className="vip-daycell-sep"> / </span>
      <span className={isPast ? 'vip-daycell-missed' : 'vip-daycell-pending'}>{second}</span>
    </span>
  )
}

function sortRows(rows, sortKey, dir) {
  return rows.slice().sort((a, b) => {
    const diff = a[sortKey] - b[sortKey]
    if (diff !== 0) return dir === 'desc' ? -diff : diff
    return a.name.localeCompare(b.name)
  })
}

function DayReviewCard({ rows, totals, isPast, onOpenExec, selectedExecId }) {
  const [sortKey, setSortKey] = useState('total')
  const [dir, setDir] = useState('desc')

  function toggleSort(key) {
    if (key === sortKey) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setDir('desc')
    }
  }

  const sorted = sortRows(rows, sortKey, dir)

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">What the team did today</div>
        <span className="vip-card-note vip-only-desktop">Sorted by {COLUMNS.find((c) => c.key === sortKey).label.toLowerCase()} · click a row for the full day</span>
        <span className="vip-card-note vip-only-mobile">Tap for the full day</span>
      </div>

      {rows.length === 0 ? (
        <p className="vip-empty">No sales executives to show.</p>
      ) : (
        <>
          {/* ---- desktop: the real table ---- */}
          <div className="vip-only-desktop">
            <div className="vip-daytable">
              <div className="vip-daytable-groups">
                <span />
                <span className="vip-daytable-group">Activity</span>
                <span className="vip-daytable-group">Leads</span>
                <span className="vip-daytable-group">Follow-ups</span>
              </div>

              <div className="vip-daytable-row vip-daytable-head">
                <span className="vip-daytable-collabel">Sales exec</span>
                {COLUMNS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={c.groupStart ? 'vip-daytable-sort vip-daytable-groupstart' : 'vip-daytable-sort'}
                    onClick={() => toggleSort(c.key)}
                    aria-label={`Sort by ${c.label}`}
                  >
                    {c.label}
                    {sortKey === c.key && <span className="vip-daytable-arrow">{dir === 'desc' ? '↓' : '↑'}</span>}
                  </button>
                ))}
              </div>

              {sorted.map((row) => (
                <button
                  key={row.employeeId}
                  type="button"
                  className={
                    selectedExecId === row.employeeId
                      ? 'vip-daytable-row vip-daytable-exec vip-daytable-selected'
                      : 'vip-daytable-row vip-daytable-exec'
                  }
                  onClick={() => onOpenExec(row.employeeId)}
                >
                  <span className="vip-daytable-name">
                    <span className={row.total === 0 ? 'vip-dd-avatar vip-daytable-avatar-quiet' : 'vip-dd-avatar'}>{row.initials}</span>
                    <span className={row.total === 0 ? 'vip-daytable-quiet' : undefined}>{row.name}</span>
                    <RoleTag role={row.role} />
                  </span>
                  {COLUMNS.map((c) => (
                    <span
                      key={c.key}
                      className={[
                        'vip-daytable-cell',
                        c.groupStart ? 'vip-daytable-groupstart' : '',
                        c.strong ? 'vip-daytable-total' : '',
                        c.strong && row.total === 0 ? 'vip-daytable-quiet' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {c.pair ? <DoneMissCell row={row} isPast={isPast} /> : <Cell value={row[c.key]} dash={!c.strong} />}
                    </span>
                  ))}
                </button>
              ))}

              <div className="vip-daytable-row vip-daytable-totals">
                <span className="vip-daytable-collabel">Team total</span>
                {COLUMNS.map((c) => (
                  <span key={c.key} className={c.groupStart ? 'vip-daytable-cell vip-daytable-groupstart' : 'vip-daytable-cell'}>
                    {c.pair ? <DoneMissCell row={totals} isPast={isPast} /> : totals[c.key]}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ---- mobile: the same rows as stacked cards ---- */}
          <div className="vip-only-mobile vip-daycards">
            {sorted.map((row) => (
              <button key={row.employeeId} type="button" className="vip-daycard" onClick={() => onOpenExec(row.employeeId)}>
                <span className="vip-daycard-head">
                  <span className={row.total === 0 ? 'vip-dd-avatar vip-daytable-avatar-quiet' : 'vip-dd-avatar'}>{row.initials}</span>
                  <span className={row.total === 0 ? 'vip-daycard-name vip-daytable-quiet' : 'vip-daycard-name'}>
                    {row.name}
                    <RoleTag role={row.role} />
                  </span>
                  <span className={row.total === 0 ? 'vip-daycard-total vip-daytable-quiet' : 'vip-daycard-total'}>{row.total}</span>
                  <span className="vip-daycard-chevron">›</span>
                </span>
                <span className="vip-daycard-stats">
                  <span>
                    {row.calls} calls · {row.visits} visits
                  </span>
                  <span>
                    {row.touched} touched · {row.changes} changes
                  </span>
                  <span>
                    <DoneMissCell row={row} isPast={isPast} /> follow-ups
                  </span>
                </span>
              </button>
            ))}
            <div className="vip-daycard-totals">
              <span>Team total</span>
              <span>
                {totals.total} activities · {totals.touched} leads touched · <DoneMissCell row={totals} isPast={isPast} />
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default DayReviewCard
