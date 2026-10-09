import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import { EmployeeNameLink } from '../components/EmployeeLink'
import ShowMoreRows from '../components/ShowMoreRows'
import BdmChip from '../components/BdmChip'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { fetchFirmBundle } from '../lib/screenQueries'
import { fetchActiveBdms } from '../lib/bdmQueries'
import { buildFirmProfile, FIRM_MONTHS, FIRM_QUIET_DAYS } from '../lib/firmProfile'
import { lastMetLabel } from '../lib/architectStats'
import { firmLabel } from '../lib/firmLabel'
import { ROLES, roleLabel } from '../lib/roles'
import { getInitials } from '../lib/initials'
import { leadDisplayName } from '../lib/leadName'
import { stageLabel } from '../lib/leadStageOptions'
import { stageChipClass, TONE_WARN_INK } from '../lib/statusColors'
import { dealValueOrNull } from '../lib/pipelineValue'
import { isPoolLead } from '../lib/poolLeads'
import { formatCurrencyCompact, formatDateShort } from '../lib/format'
import { errorMessage } from '../lib/errorMessage'

const MEETING_ROWS = 8
const LEAD_ROWS = 10
const ARCHITECT_ROWS = 10
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A short tag beside a person's name. Every role is spelled out here (unlike
// Day Review, where a plain exec stays quiet) because this list mixes BDMs,
// managers and execs and the point of it is to say which is which.
const ROLE_TAGS = {
  [ROLES.BDM]: 'BDM',
  [ROLES.SALES_MANAGER]: 'MGR',
  [ROLES.SALES_EXECUTIVE]: 'EXEC',
  [ROLES.OWNER]: 'OWNER',
  [ROLES.SALES_COORDINATOR]: 'COORD',
}

function RoleTag({ role }) {
  const text = ROLE_TAGS[role]
  if (!text) return null
  return (
    <span className="vip-role-tag" title={roleLabel(role)}>
      {text}
    </span>
  )
}

// A meeting note can run long; the full text is on the activity itself.
function excerpt(text, max = 120) {
  if (!text) return null
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const money = (v) => (v ? formatCurrencyCompact(v) : '—')

// "Nothing yet", shared so props keep one identity across renders. Never mutated.
const NO_ROWS = []

// The people figures, in column order. `blank` rows show "—" at desktop and drop
// out of the phone's flowing line, the way the architect directory's blanks do.
const PEOPLE_COLUMNS = [
  { key: 'portfolio', label: 'Portfolio', unit: 'in portfolio', value: (p) => p.portfolio },
  { key: 'brought', label: 'Brought in', unit: 'brought in', value: (p) => p.brought },
  { key: 'owned', label: 'Owns', unit: (p) => (p.owned === 1 ? 'lead owned' : 'leads owned'), value: (p) => p.owned },
  { key: 'open', label: 'Open', unit: 'open', value: (p) => p.openValue, money: true },
  { key: 'won', label: 'Won', unit: 'won', value: (p) => p.wonValue, money: true },
  { key: 'visits', label: 'Visits', unit: (p) => (p.visits === 1 ? 'site visit' : 'site visits'), value: (p) => p.visits },
  {
    key: 'clientMeetings',
    label: 'Client mtgs',
    unit: (p) => (p.clientMeetings === 1 ? 'client meeting' : 'client meetings'),
    value: (p) => p.clientMeetings,
  },
  {
    key: 'architectMeetings',
    label: 'Arch. mtgs',
    unit: (p) => (p.architectMeetings === 1 ? 'architect meeting' : 'architect meetings'),
    value: (p) => p.architectMeetings,
  },
]

// /firms/:id (a firm that is a real record) and /firms/by-name?name= (a firm that
// exists only as text typed on its architects) — the owner's page behind a row of
// Architect Network's Firms tab (canSeeArchitectNetwork, same gate as the tab).
//
// Read-only, and built from the architects AT the firm: a firm has no figures of
// its own, so every number is the pooled answer for them, from the reducers the
// Firms tab and the architect pages already use (src/lib/firmProfile.js), and
// the tiles can't read differently from the row that opened this page. Which
// people are shown, and why, is firmProfile.js's buildFirmPeople.
function FirmProfile() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()
  const firmId = /^\d+$/.test(id ?? '') ? Number(id) : null
  const firmName = firmId == null ? searchParams.get('name') ?? '' : null

  const [meetingsShown, setMeetingsShown] = useState(MEETING_ROWS)
  const [leadsShown, setLeadsShown] = useState(LEAD_ROWS)
  const [architectsShown, setArchitectsShown] = useState(ARCHITECT_ROWS)

  // INSTANT OPEN — the firm, its architects, meetings, leads and the visits on
  // them in one remembered answer; the key carries which firm.
  const bundleQuery = useCachedQuery(
    ['firm', firmId ?? 'name', firmName ?? '-'],
    () => fetchFirmBundle(firmId, firmName),
    { enabled: Boolean(employee?.id) }
  )
  const bundle = bundleQuery.result
  const loading = bundle === undefined
  const loadError = bundle?.error
    ? errorMessage(bundle.error)
    : bundle?.data?.partialError
      ? errorMessage(bundle.data.partialError)
      : null

  // A BDM seen only through a portfolio tag is named from the roster (the same
  // remembered read Architect Network's own tabs make).
  const bdmsQuery = useCachedQuery(['bdm', 'active-bdms'], fetchActiveBdms)
  const bdmNames = useMemo(() => new Map((bdmsQuery.result?.data ?? []).map((b) => [b.id, b.name])), [bdmsQuery.result])

  const data = bundle?.data ?? null
  const architects = data?.architects ?? NO_ROWS
  const profile = useMemo(
    () =>
      data
        ? buildFirmProfile({
            architects: data.architects,
            meetings: data.meetings,
            leads: data.leads,
            activities: data.activities,
            bdmNames,
          })
        : null,
    [data, bdmNames]
  )

  // The firm's name as written: the record's, else the first architect's own
  // label (the route carries the lower-cased text, the Firms tab the original).
  const title = data?.firm?.name ?? firmLabel(architects[0]) ?? firmName ?? ''

  useEffect(() => {
    if (!title) return
    setOverride({ title: 'Firm', sub: title })
    return () => setOverride(null)
  }, [title, setOverride])

  if (loading) return <p className="vip-state-msg">Loading…</p>
  if (bundle.error) return <p className="vip-state-msg-error">{loadError}</p>
  if (firmId != null && !data.firm) return <p className="vip-state-msg-error">Firm not found.</p>
  if (firmId != null && data.firm.party_type !== 'firm') {
    return <p className="vip-state-msg">{data.firm.name} isn't a firm, so there's no firm page for it.</p>
  }
  if (firmId == null && architects.length === 0) {
    return <p className="vip-state-msg">No architect is listed under that firm name.</p>
  }

  const { stats, stages, timeline } = profile
  const typedOnly = firmId == null
  const topMonth = Math.max(0, ...timeline.strip.map((m) => m.count))

  const tiles = [
    { label: 'Leads sent', value: String(stats.referred), sub: `${stats.openCount} open` },
    { label: 'Open pipeline', value: money(stats.openValue), sub: 'quoted, active' },
    { label: 'Won value', value: money(stats.wonValue), sub: `${stats.wonCount} won` },
    {
      label: 'Win rate',
      value: stats.winRate == null ? '—' : `${stats.winRate}%`,
      sub: stats.winRate == null ? 'nothing decided yet' : `${stats.wonCount} won · ${stats.lostCount} lost`,
    },
  ]
  const tiles2 = [
    {
      label: 'Architects',
      value: String(architects.length),
      sub: profile.inPortfolio ? `${profile.inPortfolio} in a BDM's portfolio` : 'none in a portfolio',
    },
    { label: 'Meetings', value: String(profile.meetingCount), sub: lastMetLabel(profile.lastMeetingDays) },
    {
      label: 'Latest lead',
      value: timeline.latestAt ? formatDateShort(timeline.latestAt) : '—',
      sub: timeline.latestAt
        ? `${timeline.latestDays === 0 ? 'today' : `${timeline.latestDays}d ago`}${timeline.quiet ? ' · gone quiet' : ''}`
        : 'no lead yet',
      warn: timeline.quiet,
    },
    {
      label: 'First lead',
      value: timeline.firstAt ? formatDateShort(timeline.firstAt) : '—',
      sub: timeline.total ? plural(timeline.total, 'lead in all', 'leads in all') : 'no lead yet',
    },
  ]

  const subBits = [plural(architects.length, 'architect', 'architects')]
  if (data.firm?.address) subBits.push(data.firm.address)
  if (data.firm?.mobile) subBits.push(data.firm.mobile)

  return (
    <div className="vip-wide vip-stack">
      <div className="vip-profile-band">
        <div className="vip-profile-id">
          <div className="vip-profile-avatar">{getInitials(title)}</div>
          <div className="vip-profile-id-meta">
            <div className="vip-profile-name-row">
              <h2 className="vip-profile-name">{title}</h2>
            </div>
            <span className="vip-profile-sub">{subBits.join(' · ')}</span>
          </div>
        </div>
      </div>

      {typedOnly && (
        <p className="vip-form-note vip-net-note">
          This firm is only a name typed on its architects — there is no saved firm record behind it. Setting a firm from
          an architect's page links them to a real one.
        </p>
      )}

      {loadError && (
        <p className="vip-error" role="alert">
          {loadError}
        </p>
      )}

      <div className="vip-dd-stats vip-arch-stats">
        {tiles.map((t) => (
          <div key={t.label} className="vip-dd-stat">
            <span className="vip-dd-stat-label">{t.label}</span>
            <span className="vip-dd-stat-value">{t.value}</span>
            <span className="vip-dd-stat-sub">{t.sub}</span>
          </div>
        ))}
      </div>
      <div className="vip-dd-stats vip-arch-stats">
        {tiles2.map((t) => (
          <div key={t.label} className="vip-dd-stat">
            <span className="vip-dd-stat-label">{t.label}</span>
            <span className="vip-dd-stat-value">{t.value}</span>
            <span className="vip-dd-stat-sub" style={t.warn ? { color: TONE_WARN_INK } : undefined}>
              {t.sub}
            </span>
          </div>
        ))}
      </div>

      <div className="vip-report-grid">
        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Where the leads stand</h2>
            <span className="vip-bdm-list-count">{stats.referred}</span>
          </div>
          {stages.length === 0 ? (
            <p className="vip-empty">No lead has come through this firm yet.</p>
          ) : (
            <div className="vip-stack-s">
              {stages.map((r) => (
                <div key={r.stage} className="vip-bar-row vip-firm-stage-row">
                  <div className="vip-bar-label">{stageLabel(r.stage)}</div>
                  <div className="vip-bar-track vip-thick">
                    <div
                      className={r.stage === 'lost' ? 'vip-bar-fill vip-loss' : r.stage === 'won' ? 'vip-bar-fill vip-navy' : 'vip-bar-fill'}
                      style={{ width: `${r.share * 100}%` }}
                    />
                  </div>
                  <div className="vip-bar-count">{r.count}</div>
                  <div className="vip-bar-value vip-bar-value-wide">{money(r.value)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Leads over time</h2>
            <span className="vip-bdm-list-count">last {FIRM_MONTHS} months</span>
          </div>
          {timeline.total === 0 ? (
            <p className="vip-empty">No lead has come through this firm yet.</p>
          ) : (
            <>
              <div className="vip-firm-months" role="list" aria-label={`Leads per month, last ${FIRM_MONTHS} months`}>
                {timeline.strip.map((m, i) => (
                  <div
                    key={m.key}
                    role="listitem"
                    className={`vip-firm-month${m.count === 0 ? '' : m.count >= 2 ? ' vip-firm-month-2' : ' vip-firm-month-1'}`}
                    title={`${MONTHS_SHORT[m.month]} ${m.year}: ${plural(m.count, 'lead', 'leads')}`}
                  >
                    <span className="vip-firm-month-n">{m.count || '·'}</span>
                    <span className="vip-firm-month-l">{MONTHS_SHORT[m.month]}</span>
                    <span className="vip-firm-month-y">{i === 0 || m.month === 0 ? String(m.year).slice(2) : ''}</span>
                  </div>
                ))}
              </div>
              <p className="vip-form-note vip-net-note">
                {topMonth === 0 ? 'None in these months. ' : ''}
                {timeline.earlier > 0 ? `${plural(timeline.earlier, 'earlier lead', 'earlier leads')} before that. ` : ''}
                {timeline.quiet ? `No new lead in ${FIRM_QUIET_DAYS}+ days. ` : ''}
                {timeline.importDated > 0
                  ? `${plural(timeline.importDated, 'lead carries', 'leads carry')} the day a spreadsheet was loaded, not the day it arrived, so its month may be off.`
                  : ''}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <h2 className="vip-card-title">Who handles this firm</h2>
          <span className="vip-bdm-list-count">{profile.people.length}</span>
        </div>
        {profile.people.length === 0 ? (
          <p className="vip-empty">Nobody has a portfolio, a lead, a visit or a meeting with this firm yet.</p>
        ) : (
          <div className="vip-net-dir" role="table" aria-label="People connected to this firm">
            <div className="vip-net-dir-row vip-net-people-row vip-net-dir-headrow" role="row">
              <span role="columnheader">Person</span>
              {PEOPLE_COLUMNS.map((c) => (
                <span key={c.key} role="columnheader" className="vip-net-dir-num">
                  {c.label}
                </span>
              ))}
            </div>
            {profile.people.map((p) => (
              <div key={p.id} className="vip-net-dir-row vip-net-people-row" role="row">
                <span role="cell" className="vip-net-dir-name">
                  <EmployeeNameLink id={p.id} name={p.name} fallback="Someone" />
                  <RoleTag role={p.role} />
                </span>
                {PEOPLE_COLUMNS.map((c) => {
                  const v = c.value(p)
                  const unit = typeof c.unit === 'function' ? c.unit(p) : c.unit
                  return (
                    <span key={c.key} role="cell" className={v ? 'vip-net-dir-num' : 'vip-net-dir-num vip-net-dir-blank'}>
                      <b>{v ? (c.money ? formatCurrencyCompact(v) : v) : '—'}</b>
                      <span className="vip-net-dir-unit"> {unit}</span>
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        )}
        <p className="vip-form-note vip-net-note vip-firm-people-note">
          A BDM through the portfolio or the leads they brought in; execs and managers through the leads they own, the
          site visits and client meetings they logged on them, and meetings with the firm's architects. Calls aren't counted.
        </p>
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <h2 className="vip-card-title">Architects at this firm</h2>
          <span className="vip-bdm-list-count">{profile.architectRows.length}</span>
        </div>
        {profile.architectRows.length === 0 ? (
          <p className="vip-empty">No architect is linked to this firm.</p>
        ) : (
          <div className="vip-net-dir" role="table" aria-label="Architects at this firm">
            <div className="vip-net-dir-row vip-net-firmarch-row vip-net-dir-headrow" role="row">
              <span role="columnheader">Architect</span>
              <span role="columnheader">Portfolio</span>
              <span role="columnheader">Last meeting</span>
              <span role="columnheader" className="vip-net-dir-num">Leads</span>
              <span role="columnheader" className="vip-net-dir-num">Open</span>
              <span role="columnheader" className="vip-net-dir-num">Won</span>
            </div>
            {profile.architectRows.slice(0, architectsShown).map((r) => (
              <Link key={r.id} to={`/architects/${r.id}`} className="vip-net-dir-row vip-net-firmarch-row" role="row">
                <span role="cell" className="vip-net-dir-name">
                  {r.name}
                </span>
                <span role="cell">
                  {r.bdmName ? (
                    <span className="vip-portfolio-tag vip-net-dir-tag">With {r.bdmName}</span>
                  ) : (
                    <span className="vip-net-dir-none">Not with a BDM</span>
                  )}
                </span>
                <span role="cell" className="vip-net-dir-met">
                  {lastMetLabel(r.lastMetDays)}
                </span>
                <span role="cell" className="vip-net-dir-num">
                  <b>{r.referred}</b>
                  <span className="vip-net-dir-unit"> {r.referred === 1 ? 'lead' : 'leads'}</span>
                </span>
                <span role="cell" className={r.openValue ? 'vip-net-dir-num' : 'vip-net-dir-num vip-net-dir-blank'}>
                  <b>{money(r.openValue)}</b>
                  <span className="vip-net-dir-unit"> open</span>
                </span>
                <span role="cell" className={r.wonValue ? 'vip-net-dir-num' : 'vip-net-dir-num vip-net-dir-blank'}>
                  <b>{money(r.wonValue)}</b>
                  <span className="vip-net-dir-unit"> won</span>
                </span>
              </Link>
            ))}
            <ShowMoreRows
              shown={Math.min(architectsShown, profile.architectRows.length)}
              total={profile.architectRows.length}
              noun="architects"
              onShowMore={() => setArchitectsShown((n) => n + ARCHITECT_ROWS)}
            />
          </div>
        )}
      </div>

      <div className="vip-report-grid">
        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Meetings</h2>
            <span className="vip-bdm-list-count">{profile.meetingCount}</span>
          </div>
          {profile.meetings.length === 0 ? (
            <p className="vip-empty">No architect meetings logged.</p>
          ) : (
            <div className="vip-bdm-list">
              {profile.meetings.slice(0, meetingsShown).map((m) => (
                <div key={m.id} className="vip-bdm-list-row">
                  <div className="vip-bdm-list-main">
                    <Link to={`/architects/${m.party_id}`} className="vip-bdm-list-lead">
                      {m.architectName}
                    </Link>
                    <span className="vip-bdm-list-meta">
                      <EmployeeNameLink id={m.employee_id} name={m.employees?.name} fallback="Someone" />
                      <RoleTag role={m.employees?.role} />
                      {m.notes ? ` · ${excerpt(m.notes)}` : ''}
                    </span>
                  </div>
                  <span className="vip-bdm-list-date">{formatDateShort(m.created_at)}</span>
                </div>
              ))}
              <ShowMoreRows
                shown={Math.min(meetingsShown, profile.meetings.length)}
                total={profile.meetings.length}
                noun="meetings"
                onShowMore={() => setMeetingsShown((n) => n + MEETING_ROWS)}
              />
            </div>
          )}
        </div>

        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Referred leads</h2>
            <span className="vip-bdm-list-count">{profile.leads.length}</span>
          </div>
          {profile.leads.length === 0 ? (
            <p className="vip-empty">No leads through this firm.</p>
          ) : (
            <div className="vip-bdm-list">
              {profile.leads.slice(0, leadsShown).map((l) => {
                const value = dealValueOrNull(l)
                const stage = l.current_stage ?? 'calling'
                return (
                  <div key={l.id} className="vip-bdm-list-row">
                    <div className="vip-bdm-list-main">
                      <span className="vip-firm-lead-line">
                        <Link to={`/leads/${l.id}`} className="vip-bdm-list-lead">
                          {leadDisplayName(l)}
                        </Link>
                        <BdmChip bdmEmployeeId={l.bdm_employee_id} />
                      </span>
                      <span className="vip-bdm-list-meta vip-arch-lead-meta">
                        <span className={stageChipClass(stage)}>{stageLabel(stage)}</span>
                        {isPoolLead(l) ? (
                          <span>Awaiting assignment</span>
                        ) : (
                          <EmployeeNameLink id={l.owner_employee_id} name={l.employees?.name} />
                        )}
                        {l.architectName && <span>via {l.architectName}</span>}
                      </span>
                    </div>
                    <span className="vip-bdm-list-date">{value != null ? formatCurrencyCompact(value) : '—'}</span>
                  </div>
                )
              })}
              <ShowMoreRows
                shown={Math.min(leadsShown, profile.leads.length)}
                total={profile.leads.length}
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

export default FirmProfile
