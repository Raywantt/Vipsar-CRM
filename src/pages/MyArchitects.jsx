import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { fetchPortfolioArchitects, fetchArchitectMeetings, fetchLeadsForArchitects } from '../lib/architectQueries'
import { daysSince, groupArchitectsByFirm, lastMeetingByArchitect, lastMetLabel, leadStatsByArchitect } from '../lib/architectStats'
import { firmLabel } from '../lib/firmLabel'
import { formatCurrencyCompact } from '../lib/format'
import { errorMessage } from '../lib/errorMessage'

// My Architects (/architects) — the business development manager's portfolio
// (BDM.md Step 4). Owner's ruling: grouped by firm, "No firm" last. Each row:
// last meeting, leads referred, open pipeline, and a link to the profile.
//
// One firm card per group in an auto-fill grid: a portfolio's firm count is
// open-ended, the same reason My Team's grid is auto-fit rather than a fixed
// column count.
function MyArchitects() {
  const { employee } = useAuth()

  const [architects, setArchitects] = useState(null)
  const [lastMetById, setLastMetById] = useState(new Map())
  const [statsById, setStatsById] = useState(new Map())
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    fetchPortfolioArchitects(employee.id).then(async ({ data, error }) => {
      if (!active) return
      if (error) {
        setLoadError(errorMessage(error))
        setArchitects([])
        return
      }
      const ids = data.map((a) => a.id)
      // A BDM's own pool leads count here: they're this BDM's pipeline.
      const [meetingsRes, leadsRes] = await Promise.all([fetchArchitectMeetings(ids), fetchLeadsForArchitects(ids, true)])
      if (!active) return
      const firstError = meetingsRes.error ?? leadsRes.error
      if (firstError) setLoadError(errorMessage(firstError))
      setLastMetById(lastMeetingByArchitect(meetingsRes.data))
      setStatsById(leadStatsByArchitect(leadsRes.data))
      setArchitects(data)
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matching = (architects ?? []).filter(
      (a) => !term || a.name?.toLowerCase().includes(term) || firmLabel(a)?.toLowerCase().includes(term)
    )
    return groupArchitectsByFirm(matching)
  }, [architects, search])

  const firmCount = groups.filter((g) => g.key !== 'none').length
  const shownCount = groups.reduce((s, g) => s + g.architects.length, 0)

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      {architects === null ? (
        <p className="vip-empty">Loading your architects…</p>
      ) : (
        <>
          {loadError && (
            <p className="vip-error" role="alert">
              {loadError}
            </p>
          )}

          {architects.length === 0 ? (
            <div className="vip-card">
              <p className="vip-empty">
                No architects in your portfolio yet. Add one from <Link to="/leads/new">+ New</Link> → Architect.
              </p>
            </div>
          ) : (
            <>
              <div className="vip-arch-toolbar">
                <label className="vip-field vip-arch-search">
                  <span className="vip-sr-only">Search architects by name or firm</span>
                  <input
                    className="vip-input"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or firm"
                  />
                </label>
                <span className="vip-arch-toolbar-count">
                  {shownCount} architect{shownCount === 1 ? '' : 's'} · {firmCount} firm{firmCount === 1 ? '' : 's'}
                </span>
              </div>

              {groups.length === 0 ? (
                <p className="vip-empty">No architects match "{search.trim()}".</p>
              ) : (
                <div className="vip-arch-firm-grid">
                  {groups.map((g) => (
                    <section key={g.key} className="vip-card vip-arch-firm" aria-label={g.firmName ?? 'No firm'}>
                      <div className="vip-card-head">
                        <h2 className="vip-card-title">{g.firmName ?? 'No firm'}</h2>
                        <span className="vip-arch-toolbar-count">
                          {g.architects.length} architect{g.architects.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="vip-arch-list">
                        {g.architects.map((a) => {
                          const lastMet = lastMetById.get(a.id)
                          const metDays = lastMet ? daysSince(lastMet) : null
                          const stats = statsById.get(a.id)
                          return (
                            <Link key={a.id} to={`/architects/${a.id}`} className="vip-arch-row">
                              <span className="vip-arch-row-main">
                                <span className="vip-arch-row-name">{a.name}</span>
                                <span className="vip-arch-row-meta">
                                  {[
                                    lastMetLabel(metDays),
                                    `${stats?.referred ?? 0} lead${stats?.referred === 1 ? '' : 's'}`,
                                    stats?.openValue ? `${formatCurrencyCompact(stats.openValue)} open` : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </span>
                              <span className="vip-bdm-updates-chevron" aria-hidden="true">
                                ›
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default MyArchitects
