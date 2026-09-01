import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import DonutChart from './DonutChart'
import FollowUpList from './FollowUpList'
import EmployeeLink from './EmployeeLink'
import { createFollowUp } from '../lib/followUpQueries'
import { errorMessage } from '../lib/errorMessage'
import { todayISO, toISODate } from '../lib/followupDates'

// Slide-over drill-down reused by every clickable Dashboard metric — the KPI
// row, heatmap cells, Funnel/Pipeline, Leads by source, Why we lose, and each
// Needs Attention row. `panel` is one of the shapes built in
// src/lib/drilldownBuilders.js (or src/lib/attention.js for `ageing`) keyed
// by `panel.kind`. Presentational only — no verdict/narrative section exists
// here on purpose.
function StatsGrid({ stats }) {
  if (!stats?.length) return null
  return (
    <div className="vip-dd-stats">
      {stats.map((s) => (
        <div key={s.label} className="vip-dd-stat">
          <div className="vip-dd-stat-label">{s.label}</div>
          <div className="vip-dd-stat-value" style={{ color: s.color }}>
            {s.value}
          </div>
          <div className="vip-dd-stat-sub">{s.sub}</div>
        </div>
      ))}
    </div>
  )
}

function LogBody({ panel }) {
  return (
    <div className="vip-dd-section-stack">
      <div className="vip-dd-section">
        <div className="vip-dd-section-head">
          <div className="vip-dd-section-title">Logging rhythm · last 20 working days</div>
          <div className="vip-dd-hint">pale = nothing logged</div>
        </div>
        <div className="vip-dd-rhythm">
          {panel.rhythm.map((d, i) => (
            <span
              key={i}
              title={d.tip}
              className={d.filled ? 'vip-dd-rhythm-bar vip-dd-rhythm-filled' : 'vip-dd-rhythm-bar'}
              style={{ height: d.h }}
            />
          ))}
        </div>
        <div className="vip-dd-rhythm-range">
          <span>{panel.rhythmFrom}</span>
          <span>{panel.rhythmTo}</span>
        </div>
      </div>

      <div className="vip-dd-section">
        <div className="vip-dd-section-head">
          <div className="vip-dd-section-title">{panel.logTitle}</div>
        </div>
        {panel.log.length === 0 ? (
          <p className="vip-empty">Nothing logged in this window.</p>
        ) : (
          panel.log.map((l) => (
            <div key={l.id} className="vip-dd-log-row">
              <div className="vip-dd-log-when">
                <span>{l.date}</span>
                <span className="vip-dd-log-time">{l.time}</span>
              </div>
              <div className="vip-dd-log-main">
                <div className="vip-dd-log-head">
                  <span className="vip-dd-log-party">{l.party}</span>
                  {l.stage && <span className={l.chipClass}>{l.stage}</span>}
                </div>
                <div className="vip-dd-log-notes">{l.notes}</div>
              </div>
              {l.meta && <div className="vip-dd-log-meta">{l.meta}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const SWIPE_ACTION_W = 78 // px per action button, matches .vip-dd-age-action
const SWIPE_OPEN_X = SWIPE_ACTION_W * 2
const SWIPE_OPEN_THRESHOLD = 0.4 // README: "snap-back on release under 40% travel"

function AgeRowContent({ r }) {
  return (
    <>
      <span className="vip-dd-age-bar" style={{ background: r.color ?? 'var(--vip-lost)' }} />
      <span className="vip-dd-age-main">
        <span className="vip-dd-age-head">
          <span className="vip-dd-age-party">{r.party}</span>
          <span className={r.chipClass}>{r.stage}</span>
        </span>
        <span className="vip-dd-age-last">{r.last}</span>
      </span>
      <span className="vip-dd-age-side">
        <span className="vip-dd-age-days">{r.age}</span>
        <span className="vip-dd-age-value">{r.value}</span>
      </span>
      <span className="vip-dd-age-owner">
        <span className="vip-dd-avatar vip-dd-avatar-sm">{r.initials}</span>
        <EmployeeLink id={r.ownerId} name={r.owner} />
      </span>
    </>
  )
}

// Today's work-queue drill-down only (panel.queueActions, see
// buildAgeingPanel) — a row you can drag left to reveal Log call/Set date,
// or tap (without dragging) to open the lead like a plain ageing row does.
// Touch/mouse position tracked in local state rather than a library; no
// drag library is used anywhere in this app (see CLAUDE.md's Conventions).
function SwipeAgeRow({ r, onLogCall, onRequestDate, busy, message }) {
  const [dragX, setDragX] = useState(0)
  const [open, setOpen] = useState(false)
  const [startX, setStartX] = useState(null)
  const [dragged, setDragged] = useState(false)

  function pointerX(e) {
    return e.touches ? e.touches[0].clientX : e.clientX
  }

  function handleStart(e) {
    setStartX(pointerX(e))
    setDragged(false)
  }

  function handleMove(e) {
    if (startX == null) return
    const delta = pointerX(e) - startX
    if (Math.abs(delta) > 6) setDragged(true)
    const base = open ? -SWIPE_OPEN_X : 0
    setDragX(Math.max(-SWIPE_OPEN_X, Math.min(0, base + delta)))
  }

  function handleEnd() {
    if (startX == null) return
    const shouldOpen = Math.abs(dragX) > SWIPE_OPEN_X * SWIPE_OPEN_THRESHOLD
    setOpen(shouldOpen)
    setDragX(shouldOpen ? -SWIPE_OPEN_X : 0)
    setStartX(null)
  }

  function handleRowClick(e) {
    if (dragged) {
      e.preventDefault()
      return
    }
    if (open) {
      e.preventDefault()
      setOpen(false)
      setDragX(0)
    }
  }

  return (
    <div className="vip-dd-age-swipe">
      <div className="vip-dd-age-actions">
        <button
          type="button"
          className="vip-dd-age-action vip-dd-age-action-call"
          disabled={busy}
          onClick={async () => {
            await onLogCall(r)
            setOpen(false)
            setDragX(0)
          }}
        >
          Log call
        </button>
        <button
          type="button"
          className="vip-dd-age-action vip-dd-age-action-date"
          onClick={() => {
            onRequestDate(r)
            setOpen(false)
            setDragX(0)
          }}
        >
          Set date
        </button>
      </div>
      <Link
        to={`/leads/${r.leadId}`}
        className="vip-dd-age-row vip-dd-age-row-swipe"
        style={{ transform: `translateX(${dragX}px)`, transition: startX == null ? 'transform .18s ease' : 'none' }}
        onMouseDown={handleStart}
        onMouseMove={(e) => e.buttons === 1 && handleMove(e)}
        onMouseUp={handleEnd}
        onMouseLeave={() => startX != null && handleEnd()}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        onClick={handleRowClick}
      >
        <AgeRowContent r={r} />
      </Link>
      {message && <div className="vip-dd-age-msg">{message}</div>}
    </div>
  )
}

function AgeingBody({ panel }) {
  const [rows, setRows] = useState(panel.ageRows)
  const [busyLeadId, setBusyLeadId] = useState(null)
  const [messages, setMessages] = useState({})
  const [dateSheet, setDateSheet] = useState(null) // leadId | 'bulk' | null
  const [dateValue, setDateValue] = useState('')

  useEffect(() => {
    setRows(panel.ageRows)
    setMessages({})
    setDateSheet(null)
  }, [panel])

  async function handleLogCall(r) {
    setBusyLeadId(r.leadId)
    const { error } = await supabase
      .from('activities')
      .insert({ employee_id: panel.viewerEmployeeId, lead_id: r.leadId, activity_type: 'call' })
    setBusyLeadId(null)
    setMessages((m) => ({ ...m, [r.leadId]: error ? `Couldn't log call: ${errorMessage(error)}` : 'Call logged.' }))
  }

  // This used to write leads.next_followup_date directly — a bare date with no
  // reminder, no push and no row in follow_ups, on one lead or on every lead in
  // the bucket at once. The one control in the app whose label literally reads
  // "Set a follow-up" created no follow-up at all, and it reported success
  // regardless because the result was discarded entirely.
  //
  // It creates real reminders now (FOLLOWUPS.md Rule 1.1), and the lead's own
  // date is derived from them by a database trigger (Rule 1.2). Errors are
  // surfaced per row rather than swallowed, and the bulk branch only empties
  // the list for the rows that actually succeeded.
  async function handleSaveDate() {
    if (!dateValue || !dateSheet) return
    const targets = dateSheet === 'bulk' ? rows : rows.filter((r) => r.leadId === dateSheet)
    const assignee = panel.viewerEmployeeId

    const results = await Promise.all(
      targets.map(async (r) => {
        const { error } = await createFollowUp({
          assignedTo: r.ownerId ?? assignee,
          createdBy: assignee,
          leadId: r.leadId,
          title: 'Follow up',
          notes: r.title ? `Set from the ${panel.title ?? 'work queue'} — ${r.title}` : null,
          dueDate: dateValue,
        })
        return { leadId: r.leadId, error }
      })
    )

    const failed = results.filter((x) => x.error)
    if (dateSheet === 'bulk') {
      const failedIds = new Set(failed.map((x) => x.leadId))
      setRows((prev) => prev.filter((r) => failedIds.has(r.leadId)))
      if (failed.length) {
        setMessages((m) => ({ ...m, bulk: `${failed.length} of ${targets.length} couldn't be set.` }))
      }
    } else {
      const err = failed[0]?.error
      setMessages((m) => ({
        ...m,
        [dateSheet]: err ? `Couldn't set the follow-up: ${errorMessage(err)}` : `Reminder set for ${dateValue}.`,
      }))
    }
    setDateSheet(null)
    setDateValue('')
  }

  return (
    <div className="vip-dd-section-stack">
      {panel.ownerRows.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-title">{panel.ownerTitle}</div>
          {panel.ownerRows.map((o) => (
            <div key={o.name} className="vip-dd-owner-row">
              <span className="vip-dd-avatar">{o.initials}</span>
              <span className="vip-dd-owner-name">{o.name}</span>
              <span className="vip-dd-owner-track">
                <span className="vip-dd-owner-fill" style={{ width: o.pct, background: o.color }} />
              </span>
              <span className="vip-dd-owner-count">{o.count}</span>
              <span className="vip-dd-owner-value">{o.value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="vip-dd-section">
        <div className="vip-dd-section-head">
          <div className="vip-dd-section-title">{panel.listTitle}</div>
          <div className="vip-dd-hint">{panel.queueActions ? 'swipe a row to log a call' : panel.listHint}</div>
        </div>
        {rows.length === 0 ? (
          <p className="vip-empty">Nothing in this queue right now.</p>
        ) : panel.queueActions ? (
          rows.map((r) => (
            <SwipeAgeRow
              key={r.leadId}
              r={r}
              busy={busyLeadId === r.leadId}
              message={messages[r.leadId]}
              onLogCall={handleLogCall}
              onRequestDate={(row) => {
                setDateSheet(row.leadId)
                setDateValue('')
              }}
            />
          ))
        ) : (
          rows.map((r) => (
            <Link key={r.leadId} to={`/leads/${r.leadId}`} className="vip-dd-age-row">
              <AgeRowContent r={r} />
            </Link>
          ))
        )}
      </div>

      {dateSheet && (
        <div className="vip-action-panel">
          <span className="vip-action-panel-title">Set follow-up date</span>
          <input
            type="date"
            className="vip-input vip-input-inline"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
          />
          <button type="button" className="vip-action-opt vip-active" disabled={!dateValue} onClick={handleSaveDate}>
            Save
          </button>
          <button type="button" className="vip-action-close" onClick={() => setDateSheet(null)}>
            Cancel
          </button>
        </div>
      )}

      {panel.queueActions && rows.length > 0 && (
        <button type="button" className="vip-btn" onClick={() => { setDateSheet('bulk'); setDateValue('') }}>
          Set a follow-up on all {rows.length}
        </button>
      )}
    </div>
  )
}

function AttainBody({ panel }) {
  return (
    <div className="vip-dd-section-stack">
      {panel.pace && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-title">Cumulative vs target pace</div>
          <svg viewBox="0 0 560 150" className="vip-dd-pace-svg">
            <line x1="0" y1="126" x2="560" y2="126" stroke="var(--vip-line)" strokeWidth="1" />
            <line x1="0" y1="84" x2="560" y2="84" stroke="var(--vip-line-soft)" strokeWidth="1" />
            <line x1="0" y1="42" x2="560" y2="42" stroke="var(--vip-line-soft)" strokeWidth="1" />
            {panel.pace.targetPath && (
              <path d={panel.pace.targetPath} fill="none" stroke="var(--vip-lost)" strokeWidth="2" strokeDasharray="5 4" />
            )}
            <path d={panel.pace.areaPath} fill="var(--vip-teal)" fillOpacity="0.09" />
            <path d={panel.pace.actualPath} fill="none" stroke="var(--vip-teal)" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
          <div className="vip-dd-pace-legend">
            <span>
              <span className="vip-dd-legend-swatch" style={{ background: 'var(--vip-teal)' }} /> Cumulative actual
            </span>
            {panel.pace.targetPath && (
              <span>
                <span className="vip-dd-legend-swatch vip-dd-legend-dash" /> Straight-line pace to target
              </span>
            )}
          </div>
        </div>
      )}

      {panel.contrib?.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-title">{panel.contribTitle}</div>
          {panel.contrib.map((c) => (
            <div key={c.label} className="vip-dd-contrib-row">
              <span className="vip-dd-contrib-label">{c.label}</span>
              <span className="vip-dd-contrib-track">
                <span className="vip-dd-contrib-fill" style={{ width: c.pct }} />
              </span>
              <span className="vip-dd-contrib-value">{c.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Unchanged from the original except that each stage row is now a button —
// clicking one drills one level deeper into that stage's own lead list
// (panel.stageRows[].drill, prebuilt by buildPipelinePanel), pushed onto
// DrilldownPanel's stack so "‹ Back" comes back here.
function PipelineBody({ panel, onDrill }) {
  return (
    <div className="vip-dd-section-stack">
      {panel.stageRows?.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-head">
            <div className="vip-dd-section-title">Where the value is sitting</div>
            <div className="vip-dd-hint">count · value · tap a stage for its leads</div>
          </div>
          {panel.stageRows.map((s) => (
            <button key={s.label} type="button" className="vip-dd-stage-row" onClick={() => s.drill && onDrill(s.drill)}>
              <span className="vip-dd-stage-label">{s.label}</span>
              <span className="vip-dd-stage-track">
                <span className="vip-dd-stage-fill" style={{ width: s.pct, background: s.color }} />
              </span>
              <span className="vip-dd-stage-count">{s.count}</span>
              <span className="vip-dd-stage-value">{s.value}</span>
            </button>
          ))}
        </div>
      )}

      {panel.convRows?.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-head">
            <div className="vip-dd-section-title">Stage-to-stage conversion</div>
            {panel.convRows.some((c) => c.skipped) && (
              <div className="vip-dd-hint">over 100% = leads skipped straight past that stage</div>
            )}
          </div>
          <div className="vip-dd-conv-row">
            {panel.convRows.map((c) => (
              <div
                key={c.label}
                className={c.skipped ? 'vip-dd-conv-card vip-dd-conv-card-skipped' : 'vip-dd-conv-card'}
                title={c.skipped ? 'Some leads reached this stage without ever being logged at the one before it, so this can read above 100%.' : undefined}
              >
                <div className="vip-dd-conv-label">{c.label}</div>
                <div className="vip-dd-conv-pct" style={{ color: c.color }}>
                  {c.pct}
                </div>
                <div className="vip-dd-conv-sub">{c.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel.topLeads?.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-head">
            <div className="vip-dd-section-title">Biggest open leads</div>
            <div className="vip-dd-hint">by value</div>
          </div>
          {panel.topLeads.map((t) => (
            <Link key={t.leadId} to={`/leads/${t.leadId}`} className="vip-dd-lead-row">
              <span className="vip-dd-lead-party">{t.party}</span>
              <span className={t.chipClass}>{t.stage}</span>
              <EmployeeLink id={t.ownerId} name={t.owner} className="vip-dd-lead-owner" />
              <span className="vip-dd-lead-value">{t.value}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// Second level of the pipeline drill-down — every lead at one stage, with an
// owner filter. Same panel chrome/row vocabulary as every other kind (this
// is a normal `panel`, just one DrilldownPanel pushed on the stack), so it
// reads as "the same drill-down screen, one level in" rather than a new UI.
function StageLeadsBody({ panel }) {
  const [ownerFilter, setOwnerFilter] = useState('')

  useEffect(() => {
    setOwnerFilter('')
  }, [panel])

  const rows = ownerFilter ? panel.leadRows.filter((r) => String(r.ownerId) === ownerFilter) : panel.leadRows

  return (
    <div className="vip-dd-section-stack">
      {panel.owners.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-title">Filter by owner</div>
          <select className="vip-select" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
            <option value="">All owners ({panel.leadRows.length})</option>
            {panel.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.count})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="vip-dd-section">
        <div className="vip-dd-section-head">
          <div className="vip-dd-section-title">Leads</div>
          <div className="vip-dd-hint">
            {rows.length} of {panel.leadRows.length} · by value
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="vip-empty">No leads for this owner at this stage.</p>
        ) : (
          rows.map((r) => (
            <Link key={r.leadId} to={`/leads/${r.leadId}`} className="vip-dd-lead-row">
              <span className="vip-dd-lead-party">{r.party}</span>
              <span className={r.chipClass}>{r.stage}</span>
              <EmployeeLink id={r.ownerId} name={r.owner} className="vip-dd-lead-owner" />
              <span className="vip-dd-lead-value">{r.value}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

function WinRateBody({ panel }) {
  return (
    <div className="vip-dd-section-stack">
      <div className="vip-dd-section">
        <div className="vip-dd-section-title">By exec</div>
        {panel.execRows.length === 0 ? (
          <p className="vip-empty">No decided leads in this period.</p>
        ) : (
          panel.execRows.map((e) => (
            <div key={e.name} className="vip-dd-contrib-row">
              <span className="vip-dd-contrib-label">{e.name}</span>
              <span className="vip-dd-hint vip-dd-contrib-hint">
                {e.won}W · {e.lost}L
              </span>
              <span className="vip-dd-contrib-value">{e.rate != null ? `${e.rate}%` : '—'}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ForecastBody({ panel }) {
  return (
    <div className="vip-dd-section-stack">
      {panel.fcBuckets.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-title">Expected to close, by month</div>
          <div className="vip-dd-fc-buckets">
            {panel.fcBuckets.map((b) => (
              <div key={b.label} className="vip-dd-fc-bucket">
                <div className="vip-dd-fc-weighted">{b.weighted}</div>
                <div className="vip-dd-fc-bar-wrap">
                  <div className="vip-dd-fc-bar" style={{ height: b.grossH }}>
                    <div className="vip-dd-fc-bar-fill" style={{ height: b.weightedH }} />
                  </div>
                </div>
                <div className="vip-dd-fc-label">{b.label}</div>
                <div className="vip-dd-hint">gross {b.gross}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="vip-dd-section">
        <div className="vip-dd-fc-head-row">
          <span>Lead</span>
          <span>Owner</span>
          <span>Confidence</span>
          <span>Value</span>
          <span>Est. close</span>
        </div>
        {panel.fcRows.map((f) => (
          <Link key={f.leadId} to={`/leads/${f.leadId}`} className="vip-dd-fc-row">
            <span className="vip-dd-fc-party-col">
              <span className="vip-dd-fc-party">{f.party}</span>
              <span className="vip-dd-hint">{f.sub}</span>
            </span>
            <EmployeeLink id={f.ownerId} name={f.owner} className="vip-dd-fc-owner" />
            <span className="vip-dd-fc-prob">
              <span className="vip-dd-prob-track">
                <span className="vip-dd-prob-fill" style={{ width: f.prob, background: f.probColor }} />
              </span>
              <span style={{ color: f.probColor }}>{f.prob}</span>
            </span>
            <span className="vip-dd-fc-value">{f.value}</span>
            <span className="vip-dd-fc-close" style={{ color: f.closeColor }}>
              {f.close}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function MixBody({ panel }) {
  return (
    <div className="vip-dd-section-stack">
      <div className="vip-dd-mix-row">
        <DonutChart segments={panel.mixRows} size={136} centerValue={panel.mixTotal} centerLabel={panel.mixUnit} />
        <div className="vip-dd-mix-legend">
          {panel.mixRows.map((m) => (
            <div key={m.label} className="vip-dd-mix-legend-row">
              <span className="vip-dd-legend-swatch" style={{ background: m.color }} />
              <span className="vip-dd-mix-legend-label">{m.label}</span>
              <span className="vip-dd-mix-legend-count">{m.count}</span>
              <span className="vip-dd-hint">{m.share}</span>
              <span className="vip-dd-mix-legend-conv" style={{ color: m.convColor }}>{m.conv}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LossBody({ panel }) {
  return (
    <div className="vip-dd-section-stack">
      <div className="vip-dd-section">
        <div className="vip-dd-section-head">
          <div className="vip-dd-section-title">Reason · count · value</div>
        </div>
        {panel.lossRows.map((l) => (
          <div key={l.label} className="vip-dd-stage-row">
            <span className="vip-dd-stage-label">{l.label}</span>
            <span className="vip-dd-stage-track">
              <span className="vip-dd-stage-fill vip-dd-stage-fill-loss" style={{ width: l.pct }} />
            </span>
            <span className="vip-dd-stage-count">{l.count}</span>
            <span className="vip-dd-stage-value">{l.value}</span>
          </div>
        ))}
      </div>

      {panel.compRows.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-title">Lost to competitor</div>
          <div className="vip-dd-comp-row">
            {panel.compRows.map((c) => (
              <div key={c.name} className="vip-dd-comp-card">
                <div className="vip-dd-hint">{c.name}</div>
                <div className="vip-dd-comp-count">{c.count}</div>
                <div className="vip-dd-hint">{c.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="vip-dd-section">
        <div className="vip-dd-section-title">Lost leads</div>
        {panel.lostLeads.map((l) => (
          <Link key={l.leadId} to={`/leads/${l.leadId}`} className="vip-dd-lead-row">
            <span className="vip-dd-lead-party">{l.party}</span>
            <span className="vip-dd-hint">{l.reason}</span>
            <EmployeeLink id={l.ownerId} name={l.owner} className="vip-dd-lead-owner" />
            <span className="vip-dd-lead-value">{l.value}</span>
            <span className="vip-dd-hint">{l.date}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

// Today's two follow-up-based queue rows (Overdue follow-ups / Due today,
// src/pages/Home.jsx) — unlike the `ageing` kind's rows, a follow-up doesn't
// always resolve to a lead (party is optional), so it can't reuse
// AgeingBody's Link-per-row markup. Reuses FollowUpList as-is (mark-done
// checkbox, party link only when a lead_id exists) instead of a third copy
// of that row shape.
function FollowUpBody({ panel }) {
  return (
    <div className="vip-dd-section-stack">
      <div className="vip-dd-section">
        <FollowUpList
          followUps={panel.followUps}
          viewerId={panel.viewerId}
          onMarkDone={panel.onMarkDone}
          onCancel={panel.onCancel}
          onReschedule={panel.onReschedule}
          onLogActivity={panel.onLogActivity}
          lockedIds={panel.lockedIds}
          emptyLabel="Nothing here."
        />
      </div>
    </div>
  )
}

// One exec, one day (Dashboard's Today period — see src/lib/dayReview.js's
// buildDaySheetPanel). Grouped by kind rather than one chronological stream:
// follow-ups → activities → lead changes, in the order a manager actually
// asks (what got missed, what they logged, what they changed). Read-only
// except the Reschedule buttons — no commenting, reassigning or flagging.
const RESCHEDULE_PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: '+2 days', days: 2 },
  { label: '+1 week', days: 7 },
]

function addDaysTo(dateISO, n) {
  const [y, m, d] = dateISO.split('-').map(Number)
  return toISODate(new Date(y, m - 1, d + n))
}

// Caps, then a "+N more" line — the panel summarises a day, it isn't a full
// log viewer. Each block has its own cap because they have different natural
// lengths (§5.3–5.5). A real button, not a static caption: tapping it opens
// the full list as its own sub-panel via onExpand (see DaySheetBody's onDrill
// calls below) — same "‹ Back" stack DrilldownPanel already uses for
// Pipeline's stage → lead-list drill. It does NOT inline-expand in place:
// a busy exec's day can carry 60+ activities, and dumping all of them into
// this same scroll would defeat the point of a day *summary* — this was a
// real, reported problem with the first version of this fix, not a
// hypothetical one. This button was a plain non-interactive <div> before
// either version — styled identically to .vip-dd-more-row elsewhere in this
// app (ClosureForecastCard/LeadsByCategoryCard/NeedsAttentionCard), so it
// looked clickable and never was.
function MoreLine({ shown, total, noun, onExpand }) {
  if (total <= shown) return null
  return (
    <button type="button" className="vip-dd-more-line" onClick={onExpand}>
      +{total - shown} more {noun}
    </button>
  )
}

// The three day-sheet row shapes, each used both in DaySheetBody's own
// capped preview and in DayItemsBody's full list below — one definition per
// shape so the preview and the "+N more" destination can't drift apart.
function CompletedFollowUpRow({ r }) {
  return (
    <div className="vip-day-fu-row">
      <span className="vip-day-fu-dot" />
      {r.leadId ? (
        <Link to={`/leads/${r.leadId}`} className="vip-day-fu-party">
          {r.party}
        </Link>
      ) : (
        <span className="vip-day-fu-party">{r.party}</span>
      )}
      <span className="vip-day-fu-when">{r.closed}</span>
    </div>
  )
}

function ActivityLogRow({ a, expanded, onExpandNotes }) {
  return (
    <div className="vip-day-log-row">
      <span className="vip-day-log-time">{a.time}</span>
      <span className="vip-day-log-main">
        <span className="vip-day-log-head">
          <span className={a.tag.className}>{a.tag.label}</span>
          {a.leadId ? (
            <Link to={`/leads/${a.leadId}`} className="vip-day-log-party">
              {a.party}
            </Link>
          ) : (
            <span className="vip-day-log-party">{a.party}</span>
          )}
        </span>
        {a.notes && (
          <span className="vip-day-log-notes">
            {expanded && a.more ? `${a.notes} ${a.more}` : a.notes}
            {a.more && !expanded && (
              <button type="button" className="vip-day-more" onClick={onExpandNotes}>
                more
              </button>
            )}
          </span>
        )}
      </span>
    </div>
  )
}

function ChangeRow({ c }) {
  return (
    <div className="vip-day-change-row">
      <span className="vip-day-log-time">{c.time}</span>
      <span className="vip-day-log-main">
        {c.leadId ? (
          <Link to={`/leads/${c.leadId}`} className="vip-day-log-party">
            {c.party}
          </Link>
        ) : (
          <span className="vip-day-log-party">{c.party}</span>
        )}
        <span className="vip-day-diff">
          <span className="vip-day-diff-label">{c.label}</span>
          {c.type === 'stage' ? (
            <>
              {c.oldStage && (
                <>
                  <span className={c.oldStage.chipClass}>{c.oldStage.label}</span>
                  <span className="vip-day-diff-arrow">→</span>
                </>
              )}
              <span className={c.newStage.chipClass}>{c.newStage.label}</span>
            </>
          ) : c.type === 'created' ? (
            <span className="vip-day-diff-new">{c.detail ?? 'New lead'}</span>
          ) : (
            <>
              {c.oldText && (
                <>
                  <span className="vip-day-diff-old">{c.oldText}</span>
                  <span className="vip-day-diff-arrow">→</span>
                </>
              )}
              <span className="vip-day-diff-new" style={{ color: c.newColor }}>
                {c.newText ?? '—'}
              </span>
            </>
          )}
        </span>
      </span>
    </div>
  )
}

// A capped block's "+N more" opens this — the full list, on its own,
// pushed onto DrilldownPanel's stack rather than grown in place. Reuses
// the exact same row components DaySheetBody's preview uses.
function DayItemsBody({ panel }) {
  const [expanded, setExpanded] = useState({})
  return (
    <div className="vip-dd-section-stack">
      <div className="vip-dd-section">
        {panel.items.length === 0 ? (
          <p className="vip-empty">Nothing here.</p>
        ) : panel.variant === 'completed' ? (
          panel.items.map((r) => <CompletedFollowUpRow key={r.id} r={r} />)
        ) : panel.variant === 'changes' ? (
          panel.items.map((c) => <ChangeRow key={c.id} c={c} />)
        ) : (
          panel.items.map((a) => (
            <ActivityLogRow
              key={a.id}
              a={a}
              expanded={!!expanded[a.id]}
              onExpandNotes={() => setExpanded((e) => ({ ...e, [a.id]: true }))}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DaySheetBody({ panel, onDrill }) {
  const [rescheduling, setRescheduling] = useState(null) // follow-up id
  const [dateValue, setDateValue] = useState('')
  const [moved, setMoved] = useState({}) // id -> new date, for rows that left
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})

  useEffect(() => {
    setRescheduling(null)
    setMoved({})
    setError(null)
    setExpanded({})
  }, [panel])

  async function handleReschedule(id, dueDate) {
    const { error: err } = await panel.onReschedule(id, dueDate)
    if (err) {
      setError(errorMessage(err))
      return
    }
    // The row leaves the missed group immediately (§5.3) — this panel's own
    // snapshot, not a refetch of the whole day.
    setMoved((m) => ({ ...m, [id]: dueDate }))
    setRescheduling(null)
    setDateValue('')
  }

  const fu = panel.followUps
  const missedRows = fu.missedRows.filter((r) => !moved[r.id])
  const openRows = fu.pendingRows.filter((r) => !moved[r.id])
  const completed = fu.completedRows.slice(0, 3)
  const activities = panel.activities.slice(0, 4)
  const changes = panel.changeRows.slice(0, 5)

  const openLabel = fu.isPast ? 'Missed — needs a new date' : 'Still open'
  const openList = fu.isPast ? missedRows : openRows

  return (
    <div className="vip-dd-section-stack">
      {/* ---- block 1: follow-ups ---- */}
      <div className="vip-dd-section">
        <div className="vip-dd-section-head">
          <div className="vip-dd-section-title">Follow-ups lined up</div>
          <div className="vip-dd-hint">
            {fu.due} due · {fu.done} completed · {fu.isPast ? `${fu.missed} missed` : `${fu.pending} open`}
          </div>
        </div>

        {fu.due === 0 ? (
          <p className="vip-empty">None were due this day.</p>
        ) : (
          <>
            <div className="vip-day-split">
              <span style={{ flex: fu.done, background: 'var(--vip-won)' }} />
              <span style={{ flex: fu.isPast ? fu.missed : fu.pending, background: fu.isPast ? 'var(--vip-lost)' : 'var(--vip-status-warn)' }} />
            </div>

            {openList.length > 0 && (
              <div className="vip-day-missed">
                <span className="vip-day-missed-title">{openLabel}</span>
                {openList.map((r) => (
                  <div key={r.id} className="vip-day-missed-row">
                    <span className="vip-day-missed-main">
                      {r.leadId ? (
                        <Link to={`/leads/${r.leadId}`} className="vip-day-fu-party">
                          {r.party}
                        </Link>
                      ) : (
                        <span className="vip-day-fu-party">{r.party}</span>
                      )}
                      <span className="vip-day-fu-sub">{r.due}</span>
                    </span>
                    {r.stage && <span className={r.stage.chipClass}>{r.stage.label}</span>}
                    <button type="button" className="vip-day-resched" onClick={() => { setRescheduling(r.id); setDateValue('') }}>
                      Reschedule
                    </button>
                  </div>
                ))}
                {rescheduling != null && (
                  <div className="vip-action-panel">
                    <span className="vip-action-panel-title">New date</span>
                    {RESCHEDULE_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="vip-action-opt"
                        onClick={() => handleReschedule(rescheduling, addDaysTo(todayISO(), p.days))}
                      >
                        {p.label}
                      </button>
                    ))}
                    <input type="date" className="vip-input vip-input-inline" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
                    <button type="button" className="vip-action-opt vip-active" disabled={!dateValue} onClick={() => handleReschedule(rescheduling, dateValue)}>
                      Save
                    </button>
                    <button type="button" className="vip-action-close" onClick={() => setRescheduling(null)}>
                      Cancel
                    </button>
                  </div>
                )}
                {error && <p className="vip-error" role="alert">{error}</p>}
              </div>
            )}

            {completed.map((r) => (
              <CompletedFollowUpRow key={r.id} r={r} />
            ))}
            <MoreLine
              shown={completed.length}
              total={fu.completedRows.length}
              noun="completed"
              onExpand={() =>
                onDrill({
                  kind: 'dayItems',
                  variant: 'completed',
                  avatar: panel.avatar,
                  eyebrow: panel.title,
                  title: 'Follow-ups completed',
                  items: fu.completedRows,
                })
              }
            />
          </>
        )}
      </div>

      {/* ---- block 2: activities ---- */}
      <div className="vip-dd-section">
        <div className="vip-dd-section-head">
          <div className="vip-dd-section-title">Activities logged</div>
          <div className="vip-dd-hint">{panel.activities.length} that day</div>
        </div>
        {panel.activities.length === 0 ? (
          <p className="vip-empty">Nothing logged this day.</p>
        ) : (
          <>
            {activities.map((a) => (
              <ActivityLogRow
                key={a.id}
                a={a}
                expanded={!!expanded[a.id]}
                onExpandNotes={() => setExpanded((e) => ({ ...e, [a.id]: true }))}
              />
            ))}
            <MoreLine
              shown={activities.length}
              total={panel.activities.length}
              noun="activities"
              onExpand={() =>
                onDrill({
                  kind: 'dayItems',
                  variant: 'activities',
                  avatar: panel.avatar,
                  eyebrow: panel.title,
                  title: 'Activities logged',
                  items: panel.activities,
                })
              }
            />
          </>
        )}
      </div>

      {/* ---- block 3: lead changes ---- */}
      <div className="vip-dd-section">
        <div className="vip-dd-section-head">
          <div className="vip-dd-section-title">Changes made to leads</div>
          <div className="vip-dd-hint">
            {panel.changeCount > 0
              ? `${panel.changeCount} edit${panel.changeCount === 1 ? '' : 's'} across ${panel.changedLeadCount} lead${panel.changedLeadCount === 1 ? '' : 's'}`
              : panel.createdCount > 0
                ? `${panel.createdCount} lead${panel.createdCount === 1 ? '' : 's'} created · no edits`
                : 'no edits'}
          </div>
        </div>
        {panel.changesUnavailable ? (
          <p className="vip-empty">Change history isn&apos;t available — the audit trail migration hasn&apos;t been run yet.</p>
        ) : panel.changeRows.length === 0 ? (
          // "Nothing was recorded" and "this rep changed nothing" are
          // different facts and must not look the same (§3.3).
          <p className="vip-empty">
            {panel.changeLogStart ? `No changes logged this day. Change history starts ${panel.changeLogStart}.` : 'No changes logged this day.'}
          </p>
        ) : (
          <>
            {changes.map((c) => (
              <ChangeRow key={c.id} c={c} />
            ))}
            <MoreLine
              shown={changes.length}
              total={panel.changeRows.length}
              noun="changes"
              onExpand={() =>
                onDrill({
                  kind: 'dayItems',
                  variant: 'changes',
                  avatar: panel.avatar,
                  eyebrow: panel.title,
                  title: 'Changes made to leads',
                  items: panel.changeRows,
                })
              }
            />
          </>
        )}
      </div>

      <div className="vip-day-foot">
        <span>
          <span className="vip-day-foot-label">Tomorrow</span>
          <span className="vip-day-foot-text">
            {' '}
            {panel.tomorrow.followUps} follow-up{panel.tomorrow.followUps === 1 ? '' : 's'} booked · {panel.tomorrow.siteVisits} site
            visit{panel.tomorrow.siteVisits === 1 ? '' : 's'}
          </span>
        </span>
        <Link to={`/employees/${panel.employeeId}`} className="vip-dd-open-link">
          Open full profile →
        </Link>
      </div>
    </div>
  )
}

const BODIES = {
  log: LogBody,
  ageing: AgeingBody,
  followup: FollowUpBody,
  daySheet: DaySheetBody,
  dayItems: DayItemsBody,
  attain: AttainBody,
  pipeline: PipelineBody,
  stageLeads: StageLeadsBody,
  winrate: WinRateBody,
  forecast: ForecastBody,
  mix: MixBody,
  loss: LossBody,
}

// `panel` (the prop) is always the root of the drill-down; `stack` holds any
// deeper panels a body pushed via onDrill — PipelineBody's stage rows → that
// stage's lead list, and DaySheetBody's "+N more" lines → the full list for
// that one block (dayItems). The deepest one renders, "‹ Back" pops one
// level, ✕ closes the whole thing. Resets whenever the caller opens a
// different root panel.
function DrilldownPanel({ panel, onClose }) {
  const [stack, setStack] = useState([])

  useEffect(() => {
    setStack([])
  }, [panel])

  if (!panel) return null

  const current = stack.length ? stack[stack.length - 1] : panel
  const Body = BODIES[current.kind]

  return (
    <>
      <div className="vip-dd-backdrop" onClick={onClose} />
      <div className="vip-dd-panel">
        {stack.length > 0 && (
          <button type="button" className="vip-dd-back" onClick={() => setStack((s) => s.slice(0, -1))}>
            ‹ Back
          </button>
        )}
        <div className="vip-dd-head">
          {/* The day sheet leads with the exec's own avatar instead of a
              headline figure — it's about a person's day, not one metric. */}
          {current.avatar && <span className="vip-dd-avatar vip-dd-head-avatar">{current.avatar}</span>}
          <div className="vip-dd-head-text">
            <div className="vip-dd-eyebrow">{current.eyebrow}</div>
            <div className="vip-dd-title">{current.title}</div>
            {current.value != null && (
              <div className="vip-dd-value-row">
                <span className="vip-dd-value">{current.value}</span>
                {current.delta && <span className="vip-dd-delta">{current.delta}</span>}
              </div>
            )}
            {current.note && <div className="vip-dd-note">{current.note}</div>}
          </div>
          <button type="button" className="vip-dd-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <StatsGrid stats={current.stats} />

        {Body && <Body panel={current} onDrill={(next) => setStack((s) => [...s, next])} />}
      </div>
    </>
  )
}

export default DrilldownPanel
