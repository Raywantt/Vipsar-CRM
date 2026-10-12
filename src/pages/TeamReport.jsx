import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { fetchActiveSalesExecs } from '../lib/employeeQueries'
import { fetchActiveBdms } from '../lib/bdmQueries'
import { fetchTeamReportData } from '../lib/teamReportQueries'
import {
  MEASURE_GROUPS,
  REPORT_MEASURES,
  REPORT_PERIOD_TYPES,
  attainment,
  buildTeamReport,
  chronological,
  dataSpanFor,
  listReportPeriods,
  orderedMeasures,
  periodCountLabel,
  periodTypeInfo,
  reportPeople,
} from '../lib/teamReport'
import { buildTeamReportWorkbook, periodHeading, teamReportBlob, teamReportFileName } from '../lib/teamReportFile'
import { saveBlob } from '../lib/leadExportFile'
import { formatCurrencyCompact } from '../lib/format'
import { todayISO } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'

// The Team Report (/team-report, 2026-10-12) — owner, sales coordinator and
// sales manager (canSeeTeamReport). The numbers of the people who work for
// the viewer, for the weeks / months / quarters / years they tick, as a
// briefing on screen and as an Excel download (Summary + a sheet per person).
// The rules are src/lib/teamReport.js's; the file is teamReportFile.js's.
//
// ONE page at both widths: the choices, the Summary table (whole team, totals
// over the ticked periods), then one person's period-by-period sheet with
// their targets — the two sheets the owner picked for the file, in the same
// order. Both tables scroll sideways inside their card on a phone, the name
// column pinned; the page itself never does.

// Per device (localStorage): the period type, the measures ticked and the
// people UNticked — stored that way round so someone who joins the team is
// ticked by default. Ticked periods are not remembered: they're relative to
// today, so a remembered "these four weeks" would be wrong next week.
const PREFS_KEY = 'vip-team-report'
const DEFAULT_PREFS = { periodType: 'week', measures: REPORT_MEASURES.map((m) => m.key), hiddenPeople: [] }

function readPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw)
    return {
      periodType: REPORT_PERIOD_TYPES.some((t) => t.value === p.periodType) ? p.periodType : DEFAULT_PREFS.periodType,
      measures: Array.isArray(p.measures) ? p.measures : DEFAULT_PREFS.measures,
      hiddenPeople: Array.isArray(p.hiddenPeople) ? p.hiddenPeople : [],
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function usePrefs() {
  const [prefs, setPrefs] = useState(readPrefs)
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      // Private mode / quota: the choices just won't outlive the visit.
    }
  }, [prefs])
  return [prefs, (patch) => setPrefs((p) => ({ ...p, ...patch }))]
}

function defaultTicks(periods, type) {
  return new Set(periods.slice(0, periodTypeInfo(type).ticked).map((p) => p.key))
}

// A figure for a table cell: a zero is an em-dash (the Day Review's rule — present,
// not a number the eye should stop on) except where `showZero` (a total row).
function FigureCell({ value, money, showZero = false, sub = null }) {
  const isZero = !value
  return (
    <td className={isZero && !showZero ? 'vip-trep-zero' : undefined}>
      {isZero && !showZero ? '—' : money ? formatCurrencyCompact(Math.round(value)) : value}
      {sub && <span className="vip-trep-cellsub">{sub}</span>}
    </td>
  )
}

// "of 40 · 88%" under an actual with a target.
function targetLine(actual, target, money) {
  if (target == null) return null
  const pct = attainment(actual, target)
  const of = money ? formatCurrencyCompact(Math.round(target)) : Math.round(target)
  return pct == null ? `of ${of}` : `of ${of} · ${pct}%`
}

// A row of toggle chips — the periods, the people and the measures all tick
// this way (aria-pressed, a ✓ so the state isn't colour alone).
function ToggleChip({ pressed, onClick, children, title }) {
  return (
    <button type="button" className="vip-chip-select vip-trep-chip" aria-pressed={pressed} onClick={onClick} title={title}>
      {pressed && (
        <span className="vip-trep-tick" aria-hidden="true">
          ✓
        </span>
      )}
      {children}
    </button>
  )
}

// People and Measures open in place from a one-line summary — the list of
// periods is what changes most, so it's the one always open.
function Expander({ id, label, summary, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="vip-trep-block">
      <button type="button" className="vip-trep-expander" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className="vip-trep-label">{label}</span>
        <span className="vip-trep-expander-sum">{summary}</span>
        <span className="vip-trep-expander-cue" aria-hidden="true">
          {open ? 'Done' : 'Change'}
        </span>
      </button>
      {open && (
        <div id={id} className="vip-trep-expander-body">
          {children}
        </div>
      )}
    </div>
  )
}

function countSummary(chosen, total, noun) {
  if (chosen === total) return `All ${total} ${noun}`
  return `${chosen} of ${total} ${noun}`
}

function TeamReport() {
  const { employee } = useAuth()
  const role = employee?.role
  const isOwner = role === 'owner'
  const [prefs, setPrefs] = usePrefs()
  const periodType = prefs.periodType
  const typeInfo = periodTypeInfo(periodType)

  // ---- The periods on offer, and which are ticked ----
  const [listSize, setListSize] = useState(typeInfo.listSize)
  const today = todayISO()
  // today: the list moves on at midnight even if the screen stays open.
  const listed = useMemo(() => listReportPeriods(periodType, listSize), [periodType, listSize, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const [ticked, setTicked] = useState(() => defaultTicks(listed, periodType))
  const tickedPeriods = useMemo(() => listed.filter((p) => ticked.has(p.key)), [listed, ticked])

  function choosePeriodType(type) {
    if (type === periodType) return
    const info = periodTypeInfo(type)
    setPrefs({ periodType: type })
    setListSize(info.listSize)
    setTicked(defaultTicks(listReportPeriods(type, info.listSize), type))
  }

  function togglePeriod(key) {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ---- People ----
  const execsQuery = useCachedQuery(['dash', 'active-execs'], fetchActiveSalesExecs)
  const bdmsQuery = useCachedQuery(['bdm', 'active-bdms'], fetchActiveBdms, { enabled: isOwner })
  const rosterError = execsQuery.result?.error ?? (isOwner ? bdmsQuery.result?.error : null) ?? null
  const rosterReady = execsQuery.result !== undefined && (!isOwner || bdmsQuery.result !== undefined)
  const everyone = useMemo(
    () =>
      reportPeople({
        viewer: employee,
        execs: execsQuery.result?.data ?? [],
        bdms: isOwner ? bdmsQuery.result?.data ?? [] : [],
      }),
    [employee, execsQuery.result, bdmsQuery.result, isOwner]
  )
  const hidden = useMemo(() => new Set(prefs.hiddenPeople), [prefs.hiddenPeople])
  const people = useMemo(() => everyone.filter((p) => !hidden.has(p.id)), [everyone, hidden])

  function togglePerson(id) {
    setPrefs({ hiddenPeople: hidden.has(id) ? prefs.hiddenPeople.filter((x) => x !== id) : [...prefs.hiddenPeople, id] })
  }

  // ---- Measures ----
  const measures = useMemo(() => orderedMeasures(prefs.measures), [prefs.measures])
  function toggleMeasure(key) {
    const on = new Set(prefs.measures)
    if (on.has(key)) on.delete(key)
    else on.add(key)
    setPrefs({ measures: REPORT_MEASURES.filter((m) => on.has(m.key)).map((m) => m.key) })
  }

  // ---- The data: one read covering every LISTED period, so ticking never fetches ----
  const span = dataSpanFor(listed)
  const spanStartISO = span.start.toISOString()
  const spanEndISO = span.end.toISOString()
  const targetValues = useMemo(() => listed.map((p) => p.targetValue).filter(Boolean), [listed])
  const dataQuery = useCachedQuery(['team-report', periodType, spanStartISO, spanEndISO], () =>
    fetchTeamReportData(periodType, spanStartISO, spanEndISO, targetValues)
  )
  const dataRes = dataQuery.result
  const dataError = dataRes?.error ?? null
  const data = dataRes && !dataRes.error ? dataRes.data : null

  const report = useMemo(() => {
    if (!data || !tickedPeriods.length || !people.length || !measures.length) return null
    return buildTeamReport({ periods: tickedPeriods, people, measures, data })
  }, [data, tickedPeriods, people, measures])

  // ---- One person's sheet ----
  const [personId, setPersonId] = useState(null)
  const reportRows = useMemo(() => (report ? report.sections.flatMap((s) => s.rows) : []), [report])
  const person = reportRows.find((r) => r.id === personId) ?? reportRows[0] ?? null
  const personRef = useRef(null)
  function openPerson(id) {
    setPersonId(id)
    // On a phone the sheet is a screen further down; bring it up.
    requestAnimationFrame(() => personRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  // ---- Download ----
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)
  async function download() {
    if (!report) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const now = new Date()
      const sheets = buildTeamReportWorkbook(report, { periodType, exportedBy: employee?.name, exportedAt: now })
      const blob = await teamReportBlob(sheets)
      saveBlob(blob, teamReportFileName({ periodType, periodCount: report.periods.length, people: reportRows, date: now }))
    } catch (err) {
      setDownloadError(errorMessage(err))
    } finally {
      setDownloading(false)
    }
  }

  // Whose profile a name may link to: the owner anyone in sales; a manager
  // themselves and their reports (every sales row on their report). A
  // coordinator can't open an exec's profile (EmployeeProfile bounces them),
  // and a BDM has no profile page — plain text for both.
  const linksName = (row) => row.section !== 'bdm' && (isOwner || role === 'sales_manager')

  const nothingTicked = !tickedPeriods.length || !people.length || !measures.length
  const choiceLine = [
    periodCountLabel(periodType, tickedPeriods.length),
    `${people.length} ${people.length === 1 ? 'person' : 'people'}`,
    `${measures.length} ${measures.length === 1 ? 'measure' : 'measures'}`,
  ].join(' · ')

  const groups = MEASURE_GROUPS.map((g) => ({ ...g, measures: measures.filter((m) => m.group === g.key) })).filter(
    (g) => g.measures.length
  )
  const spanText = tickedPeriods.length ? spanLabel(chronological(tickedPeriods)) : ''

  return (
    <div className="vip-wide vip-stack">
      <section className="vip-card vip-trep-setup" aria-label="What the report covers">
        <div className="vip-trep-block">
          <span className="vip-trep-label" id="vip-trep-period-label">
            Period
          </span>
          <div className="vip-seg vip-seg-outline vip-trep-seg" role="radiogroup" aria-labelledby="vip-trep-period-label">
            {REPORT_PERIOD_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={periodType === t.value}
                className={periodType === t.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                onClick={() => choosePeriodType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="vip-trep-chips" role="group" aria-label={`Which ${typeInfo.plural}`}>
            {listed.map((p) => (
              <ToggleChip key={p.key} pressed={ticked.has(p.key)} onClick={() => togglePeriod(p.key)} title={p.fullLabel}>
                {p.label}
                {p.isCurrent && <span className="vip-trep-chip-note">so far</span>}
              </ToggleChip>
            ))}
            <button type="button" className="vip-btn-link vip-trep-older" onClick={() => setListSize((n) => n + typeInfo.listSize)}>
              Show older
            </button>
          </div>
          <div className="vip-trep-quick">
            <button type="button" className="vip-btn-link" onClick={() => setTicked(new Set(listed.map((p) => p.key)))}>
              Tick all
            </button>
            <button type="button" className="vip-btn-link" onClick={() => setTicked(new Set())} disabled={!ticked.size}>
              Clear
            </button>
          </div>
        </div>

        <Expander
          id="vip-trep-people"
          label="People"
          summary={rosterReady ? countSummary(people.length, everyone.length, everyone.length === 1 ? 'person' : 'people') : 'Loading…'}
        >
          {['sales', 'bdm'].map((section) => {
            const list = everyone.filter((p) => p.section === section)
            if (!list.length) return null
            return (
              <div key={section} className="vip-trep-subgroup">
                {isOwner && <div className="vip-trep-sublabel">{section === 'bdm' ? 'Business development managers' : 'Sales team'}</div>}
                <div className="vip-trep-chips">
                  {list.map((p) => (
                    <ToggleChip key={p.id} pressed={!hidden.has(p.id)} onClick={() => togglePerson(p.id)}>
                      {p.name}
                      {p.id === employee?.id && <span className="vip-trep-chip-note">you</span>}
                    </ToggleChip>
                  ))}
                </div>
              </div>
            )
          })}
        </Expander>

        <Expander id="vip-trep-measures" label="Measures" summary={countSummary(measures.length, REPORT_MEASURES.length, 'measures')}>
          {MEASURE_GROUPS.map((g) => (
            <div key={g.key} className="vip-trep-subgroup">
              <div className="vip-trep-sublabel">{g.label}</div>
              <div className="vip-trep-chips">
                {REPORT_MEASURES.filter((m) => m.group === g.key).map((m) => (
                  <ToggleChip key={m.key} pressed={prefs.measures.includes(m.key)} onClick={() => toggleMeasure(m.key)}>
                    {m.label}
                  </ToggleChip>
                ))}
              </div>
            </div>
          ))}
        </Expander>

        <div className="vip-trep-actions">
          <span className="vip-trep-choice">{nothingTicked ? 'Tick at least one period, person and measure.' : choiceLine}</span>
          <button type="button" className="vip-export-btn" onClick={download} disabled={!report || downloading}>
            {downloading ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
        {downloadError && (
          <p className="vip-error" role="alert">
            Couldn't build the file: {downloadError}
          </p>
        )}
      </section>

      {rosterError || dataError ? (
        <p className="vip-error" role="alert">
          Couldn't load the figures: {errorMessage(rosterError ?? dataError)}
        </p>
      ) : nothingTicked ? null : !report ? (
        <section className="vip-card">
          <p className="vip-empty">{rosterReady && !everyone.length ? 'There is nobody on your team yet.' : 'Loading the figures…'}</p>
        </section>
      ) : (
        <>
          <section className="vip-card" aria-labelledby="vip-trep-summary">
            <div className="vip-card-head">
              <h2 id="vip-trep-summary" className="vip-card-title">
                Summary
              </h2>
              <span className="vip-card-note">{spanText}</span>
            </div>
            <p className="vip-trep-hint">Totals over the {periodCountLabel(periodType, report.periods.length)} ticked. Tap a person for their {typeInfo.plural}.</p>
            <div className="vip-trep-table-wrap">
              <table className="vip-trep-table">
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2} className="vip-trep-namecol">
                      Person
                    </th>
                    {groups.map((g) => (
                      <th key={g.key} scope="colgroup" colSpan={g.measures.length} className="vip-trep-group">
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {groups.flatMap((g) =>
                      g.measures.map((m) => (
                        <th key={m.key} scope="col" title={m.label}>
                          {m.short}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                {report.sections.map((section) => (
                  <tbody key={section.key}>
                    {report.sections.length > 1 && (
                      <tr className="vip-trep-section">
                        <th scope="colgroup" colSpan={measures.length + 1}>
                          {/* The label sticks, not the cell: a cell spanning the
                              whole row scrolls away with it on a phone. */}
                          <span className="vip-trep-section-label">{section.label}</span>
                        </th>
                      </tr>
                    )}
                    {section.rows.map((r) => (
                      <tr
                        key={r.id}
                        className={person?.id === r.id ? 'vip-trep-click vip-trep-picked' : 'vip-trep-click'}
                        onClick={() => openPerson(r.id)}
                      >
                        <th scope="row" className="vip-trep-namecol">
                          <div className="vip-trep-namecell">
                            <span className="vip-trep-name">
                              {linksName(r) ? (
                                <Link to={`/employees/${r.id}`} onClick={(e) => e.stopPropagation()}>
                                  {r.name}
                                </Link>
                              ) : (
                                r.name
                              )}
                              {r.role === 'sales_manager' && isOwner && <span className="vip-role-tag">MGR</span>}
                              {r.id === employee?.id && <span className="vip-trep-you">you</span>}
                            </span>
                            <button
                              type="button"
                              className="vip-trep-rowbtn"
                              aria-label={`${r.name}'s ${typeInfo.plural}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                openPerson(r.id)
                              }}
                            >
                              ›
                            </button>
                          </div>
                        </th>
                        {measures.map((m) => (
                          <FigureCell key={m.key} value={r.cells[m.key].total} money={m.money} />
                        ))}
                      </tr>
                    ))}
                    <tr className="vip-trep-total">
                      <th scope="row" className="vip-trep-namecol">
                        {section.totalLabel}
                      </th>
                      {measures.map((m) => (
                        <FigureCell key={m.key} value={section.total[m.key].total} money={m.money} showZero />
                      ))}
                    </tr>
                  </tbody>
                ))}
              </table>
            </div>
          </section>

          {person && (
            <section className="vip-card vip-trep-person" ref={personRef} aria-labelledby="vip-trep-person-title">
              <div className="vip-card-head vip-trep-person-head">
                <h2 id="vip-trep-person-title" className="vip-card-title">
                  {typeInfo.label} by {typeInfo.label.toLowerCase()}
                </h2>
                {reportRows.length > 1 && (
                  <select
                    className="vip-select vip-trep-person-select"
                    value={person.id}
                    onChange={(e) => setPersonId(Number(e.target.value))}
                    aria-label="Whose figures"
                  >
                    {reportRows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="vip-trep-person-name">
                {person.name}
                {person.section === 'bdm' && <span className="vip-role-tag">BDM</span>}
              </div>
              <div className="vip-trep-table-wrap">
                <table className="vip-trep-table vip-trep-table-person">
                  <thead>
                    <tr>
                      <th scope="col" className="vip-trep-namecol">
                        Measure
                      </th>
                      {report.periods.map((p) => (
                        <th key={p.key} scope="col" title={p.fullLabel}>
                          {periodHeading(p)}
                        </th>
                      ))}
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measures.map((m) => {
                      const cell = person.cells[m.key]
                      const hasTargets = cell.targets?.some((t) => t != null)
                      return (
                        <tr key={m.key}>
                          <th scope="row" className="vip-trep-namecol">
                            {m.label}
                          </th>
                          {cell.values.map((v, i) => (
                            <FigureCell
                              key={report.periods[i].key}
                              value={v}
                              money={m.money}
                              showZero={hasTargets && cell.targets[i] != null}
                              sub={hasTargets ? targetLine(v, cell.targets[i], m.money) : null}
                            />
                          ))}
                          <FigureCell
                            value={cell.total}
                            money={m.money}
                            showZero
                            sub={hasTargets ? targetLine(cell.total, cell.targetTotal, m.money) : null}
                          />
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="vip-card vip-trep-notes" aria-labelledby="vip-trep-notes-title">
            <h2 id="vip-trep-notes-title" className="vip-card-title">
              How these are counted
            </h2>
            <ul>
              {report.notes.map((n) => (
                <li key={n.key}>{n.text}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "15 Sep – 12 Oct 2026": first ticked period's start to the last one's end.
function spanLabel(periods) {
  const first = periods[0]
  const last = periods[periods.length - 1]
  if (periods.length === 1) return first.fullLabel
  if (first.type === 'year') return `${first.label} – ${last.label}`
  if (first.type === 'month' || first.type === 'quarter') return `${first.label} – ${last.label}`
  // The app's own month names ("Sep"), not the browser's ("Sept").
  const fmt = (d, withYear) => `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`
  return `${fmt(first.start, first.start.getFullYear() !== last.end.getFullYear())} – ${fmt(last.end, true)}`
}

export default TeamReport
