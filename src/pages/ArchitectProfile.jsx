import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import { EmployeeNameLink } from '../components/EmployeeLink'
import ShowMoreRows from '../components/ShowMoreRows'
import ArchitectFollowUpsCard from '../components/ArchitectFollowUpsCard'
import { fetchOpenFollowUpsForParty } from '../lib/followUpQueries'
import { fetchArchitect, fetchArchitectMeetings, fetchLeadsForArchitects, updateArchitectPortfolio } from '../lib/architectQueries'
import { fetchActiveBdms } from '../lib/bdmQueries'
import { ARCHITECT_MEETING_DAYS, architectIdForLead, summariseArchitectLeads } from '../lib/architectStats'
import { isPoolLead } from '../lib/poolLeads'
import { isBdm } from '../lib/roles'
import { firmLabel } from '../lib/firmLabel'
import { getInitials } from '../lib/initials'
import { leadDisplayName } from '../lib/leadName'
import { stageLabel } from '../lib/leadStageOptions'
import { stageChipClass, TONE_GOOD, TONE_GOOD_SOFT, TONE_NEUTRAL, TONE_NEUTRAL_SOFT } from '../lib/statusColors'
import { dealValueOrNull } from '../lib/pipelineValue'
import { formatCurrencyCompact, formatDateShort } from '../lib/format'
import { errorMessage } from '../lib/errorMessage'

const MEETING_ROWS = 8
const LEAD_ROWS = 10

// A meeting note can run long; the full text is on the activity itself.
function excerpt(text, max = 120) {
  if (!text) return null
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

// /architects/:id — one architect (BDM.md Step 4). Every role may open it
// (owner's ruling), and every figure is what the VIEWER's own access returns:
// a BDM sees the leads they brought in and their own meetings, an owner sees
// everything, a rep sees their own. Rather than pretend otherwise, anyone but
// the owner is told so in one line under the stats.
//
// "Referred" = the leads this architect sourced, attributed the same way Lead
// Detail's "via Architect" line is (architectIdForLead). The next meeting is
// an ordinary follow-up (Step 7) — the card above Meetings.
function ArchitectProfile() {
  const { id } = useParams()
  const architectId = Number(id)
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()
  const viewerIsBdm = isBdm(employee?.role)
  const viewerIsOwner = employee?.role === 'owner'

  const [architect, setArchitect] = useState(null)
  const [meetings, setMeetings] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [meetingsShown, setMeetingsShown] = useState(MEETING_ROWS)
  const [leadsShown, setLeadsShown] = useState(LEAD_ROWS)

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    setLoading(true)
    setLoadError(null)
    fetchArchitect(architectId).then(async ({ data, error }) => {
      if (!active) return
      if (error || !data) {
        setLoadError(error ? errorMessage(error) : null)
        setArchitect(null)
        setLoading(false)
        return
      }
      setArchitect(data)
      if (data.party_type !== 'architect') {
        setLoading(false)
        return
      }
      const [meetingsRes, leadsRes] = await Promise.all([
        fetchArchitectMeetings([architectId]),
        // Pool leads are company-figure-excluded for everyone but a BDM
        // (poolLeads.js) — this page's stats are figures too.
        fetchLeadsForArchitects([architectId], viewerIsBdm),
      ])
      if (!active) return
      const firstError = meetingsRes.error ?? leadsRes.error
      if (firstError) setLoadError(errorMessage(firstError))
      setMeetings(meetingsRes.data ?? [])
      // The query matches either slot; keep only leads this architect is the
      // one credited for (a lead naming two architects counts for the referrer).
      setLeads((leadsRes.data ?? []).filter((l) => architectIdForLead(l) === architectId))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [architectId, employee?.id, viewerIsBdm])

  useEffect(() => {
    if (!architect) return
    setOverride({ title: 'Architect', sub: architect.name })
    return () => setOverride(null)
  }, [architect, setOverride])

  // ---- Owner only: move this architect between portfolios (BDM.md Step 6) ----
  // One at a time, here, by the owner's ruling. The database is the boundary
  // (bdm_parties_before_write reverts anyone else's change); this control is
  // simply not offered to anyone else.
  const [bdms, setBdms] = useState(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTo, setMoveTo] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState(null)
  const [moveSaved, setMoveSaved] = useState(null)

  useEffect(() => {
    if (!viewerIsOwner || !moveOpen || bdms) return
    let active = true
    fetchActiveBdms().then(({ data, error }) => {
      if (!active) return
      if (error) setMoveError(errorMessage(error))
      setBdms(data ?? [])
    })
    return () => {
      active = false
    }
  }, [viewerIsOwner, moveOpen, bdms])

  function openMove() {
    setMoveTo(architect.bdm_employee_id == null ? '' : String(architect.bdm_employee_id))
    setMoveError(null)
    setMoveSaved(null)
    setMoveOpen(true)
  }

  async function handleMove() {
    const target = moveTo === '' ? null : Number(moveTo)
    setMoving(true)
    setMoveError(null)
    const { data, error } = await updateArchitectPortfolio(architect.id, target)
    setMoving(false)
    if (error) return setMoveError(errorMessage(error))
    setArchitect(data)
    setMoveOpen(false)
    setMoveSaved(data.bdm_employee_id == null ? 'Moved out of every BDM portfolio.' : `Moved to ${data.bdm?.name ?? 'the BDM'}'s portfolio.`)
  }

  if (loading) return <p className="vip-state-msg">Loading…</p>
  if (!architect) return <p className="vip-state-msg-error">{loadError ?? 'Architect not found.'}</p>
  if (architect.party_type !== 'architect') {
    return <p className="vip-state-msg">{architect.name} isn't an architect, so there's no architect page for them.</p>
  }

  const stats = summariseArchitectLeads(leads)
  const inMyPortfolio = architect.bdm_employee_id != null && architect.bdm_employee_id === employee?.id
  const portfolio = inMyPortfolio
    ? { label: 'In your portfolio', bg: TONE_GOOD_SOFT, fg: TONE_GOOD }
    : architect.bdm_employee_id != null
      ? { label: `With ${architect.bdm?.name ?? 'a BDM'}`, bg: TONE_GOOD_SOFT, fg: TONE_GOOD }
      : { label: 'Not with a BDM', bg: TONE_NEUTRAL_SOFT, fg: TONE_NEUTRAL }

  const subParts = [
    firmLabel(architect),
    architect.bdm_since ? `in portfolio since ${formatDateShort(architect.bdm_since)}` : null,
  ].filter(Boolean)

  const statTiles = [
    { label: 'Leads referred', value: String(stats.referred), sub: `${stats.openCount} open` },
    { label: 'Open pipeline', value: formatCurrencyCompact(stats.openValue), sub: 'quoted, active' },
    { label: 'Won value', value: formatCurrencyCompact(stats.wonValue), sub: `${stats.wonCount} won` },
    {
      label: 'Win rate',
      value: stats.winRate == null ? '—' : `${stats.winRate}%`,
      sub: stats.winRate == null ? 'nothing decided yet' : `${stats.wonCount} won · ${stats.lostCount} lost`,
    },
  ]

  return (
    <div className="vip-wide vip-stack">
      <div className="vip-profile-band">
        <div className="vip-profile-id">
          <div className="vip-profile-avatar">{getInitials(architect.name)}</div>
          <div className="vip-profile-id-meta">
            <div className="vip-profile-name-row">
              <h2 className="vip-profile-name">{architect.name}</h2>
              <span className="vip-pill" style={{ background: portfolio.bg, color: portfolio.fg }}>
                {portfolio.label}
              </span>
              {viewerIsOwner && !moveOpen && (
                <button type="button" className="vip-btn-link vip-portfolio-change" onClick={openMove}>
                  Change
                </button>
              )}
            </div>
            <span className="vip-profile-sub">
              {subParts.join(' · ')}
              {architect.mobile && (
                <>
                  {subParts.length ? ' · ' : ''}
                  <a href={`tel:${architect.mobile}`} className="vip-mono">
                    {architect.mobile}
                  </a>
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      {viewerIsOwner && moveOpen && (
        <div className="vip-card vip-stack-s vip-portfolio-move">
          <label className="vip-field">
            Portfolio
            <select
              className="vip-select"
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              disabled={bdms == null || moving}
            >
              <option value="">Not with a BDM</option>
              {(bdms ?? []).map((b) => (
                <option key={b.id} value={String(b.id)}>
                  With {b.name}
                </option>
              ))}
            </select>
          </label>
          <p className="vip-form-note vip-net-note">
            Moving restarts the {ARCHITECT_MEETING_DAYS}-day meeting clock. Their meetings and referred leads stay as they
            are; only who looks after the architect from now on changes.
          </p>
          {moveError && (
            <p className="vip-error" role="alert">
              {moveError}
            </p>
          )}
          <div className="vip-btn-row">
            <button
              type="button"
              className="vip-btn vip-btn-dark vip-btn-sm"
              onClick={handleMove}
              disabled={
                bdms == null || moving || moveTo === (architect.bdm_employee_id == null ? '' : String(architect.bdm_employee_id))
              }
            >
              {moving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={() => setMoveOpen(false)} disabled={moving}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {moveSaved && (
        <p className="vip-success" role="status" aria-live="polite">
          {moveSaved}
        </p>
      )}

      {loadError && (
        <p className="vip-error" role="alert">
          {loadError}
        </p>
      )}

      <div className="vip-dd-stats vip-arch-stats">
        {statTiles.map((t) => (
          <div key={t.label} className="vip-dd-stat">
            <span className="vip-dd-stat-label">{t.label}</span>
            <span className="vip-dd-stat-value">{t.value}</span>
            <span className="vip-dd-stat-sub">{t.sub}</span>
          </div>
        ))}
      </div>
      {!viewerIsOwner && (
        <p className="vip-form-note vip-arch-scope-note">
          Counts only the leads and meetings you have access to.
        </p>
      )}

      {/* Open follow-ups with this architect — their next meeting (BDM.md
          Step 7). Whose rows is RLS's call: the viewer's own, or everyone's
          for the owner. Above the pair, full width, so Meetings | Referred
          leads stays an even two; hidden when there are none. */}
      <ArchitectFollowUpsCard
        employee={employee}
        load={() => fetchOpenFollowUpsForParty(architectId)}
        loadKey={architectId}
      />

      <div className="vip-report-grid">
        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Meetings</h2>
            <span className="vip-bdm-list-count">{meetings.length}</span>
          </div>
          {meetings.length === 0 ? (
            <p className="vip-empty">No architect meetings logged.</p>
          ) : (
            <div className="vip-bdm-list">
              {meetings.slice(0, meetingsShown).map((m) => (
                <div key={m.id} className="vip-bdm-list-row">
                  <div className="vip-bdm-list-main">
                    <span className="vip-bdm-list-lead">
                      <EmployeeNameLink id={m.employee_id} name={m.employees?.name} fallback="Someone" />
                    </span>
                    {m.notes && <span className="vip-bdm-list-meta">{excerpt(m.notes)}</span>}
                  </div>
                  <span className="vip-bdm-list-date">{formatDateShort(m.created_at)}</span>
                </div>
              ))}
              <ShowMoreRows
                shown={Math.min(meetingsShown, meetings.length)}
                total={meetings.length}
                noun="meetings"
                onShowMore={() => setMeetingsShown((n) => n + MEETING_ROWS)}
              />
            </div>
          )}
        </div>

        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Referred leads</h2>
            <span className="vip-bdm-list-count">{leads.length}</span>
          </div>
          {leads.length === 0 ? (
            <p className="vip-empty">No leads through this architect{viewerIsOwner ? '' : ' that you can see'}.</p>
          ) : (
            <div className="vip-bdm-list">
              {leads.slice(0, leadsShown).map((l) => {
                const value = dealValueOrNull(l)
                const stage = l.current_stage ?? 'calling'
                return (
                  <div key={l.id} className="vip-bdm-list-row">
                    <div className="vip-bdm-list-main">
                      <Link to={`/leads/${l.id}`} className="vip-bdm-list-lead">
                        {leadDisplayName(l)}
                      </Link>
                      <span className="vip-bdm-list-meta vip-arch-lead-meta">
                        <span className={stageChipClass(stage)}>{stageLabel(stage)}</span>
                        {isPoolLead(l) ? (
                          <span>Awaiting assignment</span>
                        ) : (
                          <EmployeeNameLink id={l.owner_employee_id} name={l.employees?.name} />
                        )}
                      </span>
                    </div>
                    <span className="vip-bdm-list-date">{value != null ? formatCurrencyCompact(value) : '—'}</span>
                  </div>
                )
              })}
              <ShowMoreRows
                shown={Math.min(leadsShown, leads.length)}
                total={leads.length}
                noun="leads"
                onShowMore={() => setLeadsShown((n) => n + LEAD_ROWS)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ArchitectProfile
