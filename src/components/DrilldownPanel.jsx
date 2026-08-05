import { Link } from 'react-router-dom'
import DonutChart from './DonutChart'

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

function AgeingBody({ panel }) {
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
          <div className="vip-dd-hint">{panel.listHint}</div>
        </div>
        {panel.ageRows.length === 0 ? (
          <p className="vip-empty">Nothing in this queue right now.</p>
        ) : (
          panel.ageRows.map((r) => (
            <Link key={r.leadId} to={`/leads/${r.leadId}`} className="vip-dd-age-row">
              <span className="vip-dd-age-bar" style={{ background: r.color ?? '#b4232a' }} />
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
                <span>{r.owner}</span>
              </span>
            </Link>
          ))
        )}
      </div>
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
              <path d={panel.pace.targetPath} fill="none" stroke="#b4232a" strokeWidth="2" strokeDasharray="5 4" />
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

function PipelineBody({ panel }) {
  return (
    <div className="vip-dd-section-stack">
      {panel.stageRows?.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-head">
            <div className="vip-dd-section-title">Where the value is sitting</div>
            <div className="vip-dd-hint">count · value</div>
          </div>
          {panel.stageRows.map((s) => (
            <div key={s.label} className="vip-dd-stage-row">
              <span className="vip-dd-stage-label">{s.label}</span>
              <span className="vip-dd-stage-track">
                <span className="vip-dd-stage-fill" style={{ width: s.pct, background: s.color }} />
              </span>
              <span className="vip-dd-stage-count">{s.count}</span>
              <span className="vip-dd-stage-value">{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {panel.convRows?.length > 0 && (
        <div className="vip-dd-section">
          <div className="vip-dd-section-title">Stage-to-stage conversion</div>
          <div className="vip-dd-conv-row">
            {panel.convRows.map((c) => (
              <div key={c.label} className="vip-dd-conv-card">
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
              <span className="vip-dd-lead-owner">{t.owner}</span>
              <span className="vip-dd-lead-value">{t.value}</span>
            </Link>
          ))}
        </div>
      )}
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
              <span className="vip-dd-hint" style={{ flex: '0 0 90px' }}>
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
          <span style={{ flex: 1 }}>Lead</span>
          <span style={{ flex: '0 0 72px' }}>Owner</span>
          <span style={{ flex: '0 0 92px' }}>Confidence</span>
          <span style={{ flex: '0 0 58px', textAlign: 'right' }}>Value</span>
          <span style={{ flex: '0 0 62px', textAlign: 'right' }}>Est. close</span>
        </div>
        {panel.fcRows.map((f) => (
          <Link key={f.leadId} to={`/leads/${f.leadId}`} className="vip-dd-fc-row">
            <span className="vip-dd-fc-party-col">
              <span className="vip-dd-fc-party">{f.party}</span>
              <span className="vip-dd-hint">{f.sub}</span>
            </span>
            <span className="vip-dd-fc-owner">{f.owner}</span>
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
              <span style={{ color: m.convColor, fontWeight: 600, fontSize: 11 }}>{m.conv}</span>
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
            <span className="vip-dd-lead-owner">{l.owner}</span>
            <span className="vip-dd-lead-value">{l.value}</span>
            <span className="vip-dd-hint">{l.date}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

const BODIES = {
  log: LogBody,
  ageing: AgeingBody,
  attain: AttainBody,
  pipeline: PipelineBody,
  winrate: WinRateBody,
  forecast: ForecastBody,
  mix: MixBody,
  loss: LossBody,
}

function DrilldownPanel({ panel, onClose }) {
  if (!panel) return null
  const Body = BODIES[panel.kind]

  return (
    <>
      <div className="vip-dd-backdrop" onClick={onClose} />
      <div className="vip-dd-panel">
        <div className="vip-dd-head">
          <div className="vip-dd-head-text">
            <div className="vip-dd-eyebrow">{panel.eyebrow}</div>
            <div className="vip-dd-title">{panel.title}</div>
            <div className="vip-dd-value-row">
              <span className="vip-dd-value">{panel.value}</span>
              {panel.delta && <span className="vip-dd-delta">{panel.delta}</span>}
            </div>
            {panel.note && <div className="vip-dd-note">{panel.note}</div>}
          </div>
          <button type="button" className="vip-dd-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <StatsGrid stats={panel.stats} />

        {Body && <Body panel={panel} />}
      </div>
    </>
  )
}

export default DrilldownPanel
