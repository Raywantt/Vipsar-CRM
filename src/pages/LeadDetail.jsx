import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import SiteDetailsSection from '../components/SiteDetailsSection'
import ClientDetailsSection from '../components/ClientDetailsSection'
import AdditionalContactsSection from '../components/AdditionalContactsSection'
import SalesProgressSection from '../components/SalesProgressSection'
import LeadQuickActions from '../components/LeadQuickActions'
import LeadActivityTimeline from '../components/LeadActivityTimeline'
import { fetchActiveSalesExecs } from '../lib/employeeQueries'
import { fetchLeadOwnerHistory } from '../lib/leadOwnerHistory'
import { errorMessage } from '../lib/errorMessage'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { getInitials } from '../lib/initials'
import { formatCurrency, formatCurrencyCompact } from '../lib/format'

const SOURCE_LABELS = {
  scanning: 'Scanning',
  lixil: 'Lixil',
  referral_architect: 'Architect referral',
  referral_other: 'Other referral',
  showroom_walkin: 'Showroom walk-in',
}

const GOOD = '#0f6b6b'
const OK = '#b8791f'
const BAD = '#b4232a'

// Stage-default probability when closure_probability hasn't been set
// explicitly on the lead (DATA_CONTRACT.md §4) — adapted to this app's own
// 7-value LEAD_STAGE_OPTIONS rather than the handoff's generic 6-stage set.
const STAGE_PROBABILITY_DEFAULTS = { new: 10, hot: 25, rfq: 40, quote: 55, negotiation: 70, won: 100, lost: 0 }

const EMPTY = { data: null, error: null }

function shortDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function daysBetween(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

function LeadDetail() {
  const { id } = useParams()
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()

  const [lead, setLead] = useState(null)
  const [party, setParty] = useState(null)
  const [otherParty, setOtherParty] = useState(null)
  const [site, setSite] = useState(null)
  const [siteContacts, setSiteContacts] = useState([])
  const [stageHistory, setStageHistory] = useState([])
  const [activities, setActivities] = useState([])
  const [ownerHistory, setOwnerHistory] = useState([])
  const [activeSalesExecs, setActiveSalesExecs] = useState([])
  const [areas, setAreas] = useState([])
  const [products, setProducts] = useState([])
  const [lastActivityAt, setLastActivityAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  // Mobile-only: which collapsed section (if any) is pushed open as a
  // full-screen editor, and whether the sticky action bar's ⇄ button has
  // opened LeadQuickActions as a sheet. Both unused at ≥1024px, where the
  // desktop rail/inline quick actions render unconditionally instead.
  const [openSection, setOpenSection] = useState(null)
  const [quickActionsSheetOpen, setQuickActionsSheetOpen] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: leadRow, error: leadError } = await supabase
        .from('leads')
        .select('*, employees!owner_employee_id(name, office_location)')
        .eq('id', id)
        .single()

      if (!active) return

      if (leadError) {
        setLoadError(errorMessage(leadError))
        setLoading(false)
        return
      }

      const [
        partyResult,
        otherPartyResult,
        siteResult,
        contactsResult,
        stageHistoryResult,
        activitiesResult,
        ownerHistoryResult,
        activeExecsResult,
        areasResult,
        productsResult,
      ] = await Promise.all([
        leadRow.party_id
          ? supabase.from('parties').select('*').eq('id', leadRow.party_id).single()
          : Promise.resolve(EMPTY),
        leadRow.other_party_id
          ? supabase.from('parties').select('*').eq('id', leadRow.other_party_id).single()
          : Promise.resolve(EMPTY),
        leadRow.site_id
          ? supabase.from('sites').select('*').eq('id', leadRow.site_id).single()
          : Promise.resolve(EMPTY),
        leadRow.site_id
          ? supabase
              .from('site_contacts')
              .select('id, role, party_id, parties(name, party_type)')
              .eq('site_id', leadRow.site_id)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('stage_history')
          .select('id, stage, changed_at, changed_by, employees(name)')
          .eq('lead_id', leadRow.id)
          .order('changed_at', { ascending: true }),
        supabase
          .from('activities')
          .select(
            'id, activity_type, notes, created_at, employee_id, employees!employee_id(name), accompanied_by_employee:employees!accompanied_by(name)'
          )
          .eq('lead_id', leadRow.id)
          .order('created_at', { ascending: false }),
        fetchLeadOwnerHistory(leadRow.id),
        fetchActiveSalesExecs(),
        supabase.from('areas').select('id, area_name, city').order('area_name'),
        supabase.from('products').select('id, name, category').order('name'),
      ])

      if (!active) return

      setLead(leadRow)
      setParty(partyResult.data ?? null)
      setOtherParty(otherPartyResult.data ?? null)
      setSite(siteResult.data ?? null)
      setSiteContacts(contactsResult.data ?? [])
      setStageHistory(stageHistoryResult.data ?? [])
      setActivities(activitiesResult.data ?? [])
      setOwnerHistory(ownerHistoryResult.data ?? [])
      setActiveSalesExecs(activeExecsResult.data ?? [])
      setAreas(areasResult.data ?? [])
      setProducts(productsResult.data ?? [])
      const mostRecent = [...(stageHistoryResult.data ?? []).map((h) => h.changed_at), ...(activitiesResult.data ?? []).map((a) => a.created_at)].sort().pop()
      setLastActivityAt(mostRecent ?? leadRow.created_at)
      setLoading(false)
    }

    load()

    return () => {
      active = false
    }
  }, [id])

  const leadTitle = party?.name ?? site?.nickname ?? site?.locality ?? (lead ? `Lead #${lead.id}` : '')

  useEffect(() => {
    if (!lead) return
    setOverride({ sub: leadTitle })
    return () => setOverride(null)
  }, [lead, leadTitle, setOverride])

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>
  if (loadError) return <p style={{ padding: 24, color: 'crimson' }}>{loadError}</p>
  if (!lead) return <p style={{ padding: 24 }}>Lead not found.</p>

  // RLS already refuses the actual UPDATE for a non-owning sales exec — this
  // is the UI-level mirror of that, so they see a clear read-only notice
  // instead of full edit forms that would just fail silently on save.
  const canEdit = employee?.role === 'owner' || lead.owner_employee_id === employee?.id
  const isOwner = employee?.role === 'owner'

  const stage = lead.current_stage ?? 'new'
  const isWon = stage === 'won'
  const isOpen = !['won', 'lost'].includes(stage)
  const touchDays = daysBetween(lastActivityAt, Date.now())
  const touchColor = touchDays >= 14 ? BAD : touchDays >= 7 ? OK : GOOD
  const isAtRisk = isOpen && touchDays >= 14

  const statusLabel = isWon ? 'Customer' : isAtRisk ? 'At risk' : 'Open lead'
  const statusStyle = isWon ? { bg: '#dbeceb', fg: GOOD } : isAtRisk ? { bg: '#f7dcdd', fg: BAD } : { bg: 'var(--vip-canvas-2)', fg: 'var(--vip-body)' }
  const healthLabel = touchDays >= 14 ? `Stale · ${touchDays}d no touch` : touchDays >= 7 ? `Cooling · ${touchDays}d` : `Active · ${touchDays}d ago`
  const healthStyle = touchDays >= 14 ? { bg: '#f7dcdd', fg: BAD } : touchDays >= 7 ? { bg: '#f6ecdb', fg: OK } : { bg: '#dbeceb', fg: GOOD }

  const leadSubtitle = [
    party?.party_type,
    [site?.nickname || site?.locality, site?.house_no].filter(Boolean).join(', ') || null,
    SOURCE_LABELS[lead.source_type] ?? lead.source_type,
    `created ${shortDate(lead.created_at)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  // Stage stepper — one column per LEAD_STAGE_OPTIONS value (this app's real
  // 7-value stage list, not the handoff's generic 6). 'new' has no explicit
  // stage_history row when a lead has never been touched (DB default, not a
  // logged "change" — same gap SalesFunnelCard already works around), so it
  // falls back to created_at.
  const currentIdx = LEAD_STAGE_OPTIONS.indexOf(stage)
  const stageEnteredAt = (s) => {
    const row = stageHistory.find((h) => h.stage === s)
    if (row) return row.changed_at
    return s === 'new' ? lead.created_at : null
  }
  const stageSteps = LEAD_STAGE_OPTIONS.map((s, i) => ({
    stage: s,
    bar: i < currentIdx ? '#9fb3b3' : i === currentIdx ? (isWon ? GOOD : '#101617') : 'var(--vip-line-soft)',
    weight: i === currentIdx ? 600 : 400,
    meta: i <= currentIdx ? shortDate(stageEnteredAt(s)) ?? 'not yet' : 'not yet',
  }))
  const daysInPipeline = daysBetween(lead.created_at, Date.now())

  const dealValue = Math.max(Number(lead.order_value ?? 0), Number(lead.quote_value ?? 0))
  const probability = lead.closure_probability ?? STAGE_PROBABILITY_DEFAULTS[stage] ?? 0
  const probColor = probability >= 60 ? GOOD : probability >= 35 ? OK : BAD
  const closeSlipped = lead.estimated_close_date && isOpen && new Date(lead.estimated_close_date) < new Date()
  const dealStats = [
    { label: 'Deal value', value: formatCurrency(dealValue), sub: isWon ? 'booked' : 'quoted scope', color: 'var(--vip-ink)' },
    { label: 'Probability', value: `${probability}%`, sub: isWon ? 'closed' : 'stage-weighted', color: probColor },
    { label: 'Expected close', value: closeSlipped ? 'slipped' : shortDate(lead.estimated_close_date) ?? '—', sub: isWon ? 'order booked' : 'target date', color: closeSlipped ? BAD : 'var(--vip-ink)' },
    { label: 'Last touch', value: `${touchDays}d`, sub: `ago · by ${(lead.employees?.name ?? 'unassigned').split(' ')[0]}`, color: touchColor },
  ]

  // Quotes & orders — at most 2 real rows from this app's actual fields
  // (quote_value/quote_sent_at, order_value), not a fabricated document
  // list. Order date is approximated from the stage_history 'won' row,
  // same proxy computeOrderValueActuals already relies on elsewhere.
  const wonAt = stageHistory.find((h) => h.stage === 'won')?.changed_at
  const quoteRows = []
  if (lead.quote_sent) {
    quoteRows.push({
      id: 'Quote',
      what: products.find((p) => p.id === lead.product_id)?.name ?? 'Quote',
      value: formatCurrency(lead.quote_value),
      date: shortDate(lead.quote_sent_at) ?? '—',
      status: isWon ? 'Superseded' : stage === 'negotiation' ? 'In negotiation' : 'Sent',
      color: isWon ? 'var(--vip-faint)' : stage === 'negotiation' ? OK : OK,
    })
  }
  if (lead.order_value) {
    quoteRows.push({
      id: 'Order',
      what: 'Order booked',
      value: formatCurrency(lead.order_value),
      date: shortDate(wonAt) ?? '—',
      status: 'Booked',
      color: GOOD,
    })
  }

  const product = products.find((p) => p.id === lead.product_id)

  // Mobile's collapsed-sections card (see the return below) — one summary
  // line per section, derived from data already loaded above, not a new
  // fetch. Desktop keeps the four full sections inline instead of this card.
  const detailSections = [
    {
      key: 'sales',
      title: 'Sales progress',
      summary: lead.quote_sent ? `quote sent ${shortDate(lead.quote_sent_at)}` : isWon ? 'order booked' : 'not started yet',
    },
    site && {
      key: 'site',
      title: 'Site details',
      summary: [site.locality || site.nickname, site.site_stage].filter(Boolean).join(' · ') || 'no details yet',
    },
    party && { key: 'client', title: 'Client details', summary: party.mobile || 'no mobile on file' },
    site && {
      key: 'contacts',
      title: 'Contacts',
      summary: siteContacts.length > 0 ? `${siteContacts.length} on site` : 'none added yet',
    },
  ].filter(Boolean)
  const SECTION_TITLES = { sales: 'Sales progress', site: 'Site details', client: 'Client details', contacts: 'Contacts' }

  const rail = (
    <div className="vip-stack">
      <div className="vip-card">
        <div className="vip-card-title">Deal owner</div>
        {lead.owner_employee_id ? (
          <Link to={`/employees/${lead.owner_employee_id}`} style={{ display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none' }}>
            <span className="vip-profile-avatar" style={{ width: 38, height: 38, flex: '0 0 38px', borderRadius: 11, fontSize: 12 }}>
              {getInitials(lead.employees?.name)}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--vip-ink)' }}>{lead.employees?.name ?? 'Unassigned'}</span>
              <span style={{ fontSize: 11, color: 'var(--vip-faint)' }}>{lead.employees?.office_location ?? '—'}</span>
            </span>
          </Link>
        ) : (
          <p className="vip-empty">Unassigned.</p>
        )}
        {ownerHistory.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 9, borderTop: '1px solid var(--vip-line-soft)' }}>
            {ownerHistory.map((h) => (
              <span key={h.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, color: 'var(--vip-faint)' }}>
                {h.old ? `Reassigned from ${h.old.name}` : `Assigned to ${h.new?.name}`}
                <b style={{ fontWeight: 500, color: 'var(--vip-muted)', whiteSpace: 'nowrap' }}>{shortDate(h.changed_at)}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="vip-card">
        <div className="vip-card-title">Contact</div>
        {siteContacts.length === 0 ? (
          <p className="vip-empty">No contact captured.</p>
        ) : (
          siteContacts.map((c) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 9, borderBottom: '1px solid var(--vip-line-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--vip-ink)' }}>{c.parties?.name}</span>
                <span style={{ fontSize: 10, color: 'var(--vip-faint)' }}>{c.role}</span>
              </div>
            </div>
          ))
        )}
        {party?.mobile && (
          <a href={`tel:${party.mobile}`} className="vip-mono" style={{ fontSize: 12 }}>
            {party.mobile}
          </a>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            ['Type', party?.party_type ?? '—'],
            ['Site', site?.nickname || site?.locality || '—'],
            ['Source', SOURCE_LABELS[lead.source_type] ?? lead.source_type],
            ['Created', shortDate(lead.created_at)],
            ['Follow-up', shortDate(lead.next_followup_date) ?? 'none set'],
          ].map(([label, value]) => (
            <span key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, color: 'var(--vip-faint)' }}>
              {label}
              <b style={{ fontWeight: 600, color: 'var(--vip-ink)' }}>{value}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  )

  const mainContent = (
    <div className="vip-stack">
      <div className="vip-profile-band">
        <div className="vip-profile-id">
          <div className="vip-profile-avatar">{getInitials(leadTitle)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <div className="vip-profile-name-row">
              <span className="vip-profile-name">{leadTitle}</span>
              <span className="vip-pill" style={{ background: statusStyle.bg, color: statusStyle.fg }}>{statusLabel}</span>
              <span className="vip-pill" style={{ background: healthStyle.bg, color: healthStyle.fg }}>{healthLabel}</span>
            </div>
            {leadSubtitle && <span className="vip-profile-sub">{leadSubtitle}</span>}
          </div>
        </div>
      </div>

      {/* Desktop: unchanged inline row + always-visible quick actions. Mobile
          gets its own sticky bottom bar + a quick-actions sheet instead (see
          the bottom of this component's return) — same underlying data and
          the exact same LeadQuickActions component, just relocated. */}
      <div className="vip-only-desktop">
        <div className="vip-btn-row">
          {employee?.role !== 'owner' && (
            <a className="vip-btn vip-btn-sm" href="/activity">
              Log activity
            </a>
          )}
          {party?.mobile ? (
            <a className="vip-btn vip-btn-secondary vip-btn-sm" href={`tel:${party.mobile}`}>
              Call client
            </a>
          ) : (
            <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" disabled>
              Call client
            </button>
          )}
        </div>

        {canEdit && (
          <LeadQuickActions
            lead={lead}
            isOwner={isOwner}
            activeSalesExecs={activeSalesExecs}
            onStageChanged={(updatedLead, historyRow) => {
              setLead((prev) => ({ ...prev, ...updatedLead }))
              if (historyRow) setStageHistory((prev) => [...prev, historyRow])
            }}
            onFollowUpSaved={(updatedLead) => setLead((prev) => ({ ...prev, ...updatedLead }))}
            onOwnerReassigned={(updatedLead, historyRow) => {
              setLead((prev) => ({ ...prev, ...updatedLead }))
              if (historyRow) setOwnerHistory((prev) => [...prev, historyRow])
            }}
          />
        )}
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <div className="vip-card-title">Deal progress</div>
          <span className="vip-card-note">{isWon ? `closed won · ${shortDate(wonAt) ?? ''}` : `stage ${currentIdx + 1} of ${LEAD_STAGE_OPTIONS.length} · ${daysInPipeline}d in pipeline`}</span>
        </div>
        <div className="vip-stepper">
          {stageSteps.map((s) => (
            <div key={s.stage} className="vip-stepper-col">
              <div className="vip-stepper-bar" style={{ background: s.bar }} />
              <span className="vip-stepper-label" style={{ fontWeight: s.weight, color: 'var(--vip-ink)' }}>{s.stage}</span>
              <span className="vip-stepper-meta">{s.meta}</span>
            </div>
          ))}
        </div>
        <div className="vip-dd-stats">
          {dealStats.map((d) => (
            <div key={d.label} className="vip-dd-stat">
              <span className="vip-dd-stat-label">{d.label}</span>
              <span className="vip-dd-stat-value" style={{ color: d.color }}>{d.value}</span>
              <span className="vip-dd-stat-sub">{d.sub}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <div className="vip-card-title">Quotes &amp; orders</div>
          <span className="vip-card-note">{quoteRows.length === 1 ? '1 document' : `${quoteRows.length} documents`}</span>
        </div>
        {quoteRows.length === 0 ? (
          <p className="vip-empty">No quotes or orders yet.</p>
        ) : (
          <>
            <div className="vip-linegrid-head" style={{ gridTemplateColumns: '64px minmax(0,1.4fr) 84px 64px 84px' }}>
              <span>Ref</span>
              <span>Scope</span>
              <span>Value</span>
              <span>Date</span>
              <span style={{ textAlign: 'right' }}>Status</span>
            </div>
            {quoteRows.map((q) => (
              <div key={q.id} className="vip-linegrid-row" style={{ gridTemplateColumns: '64px minmax(0,1.4fr) 84px 64px 84px' }}>
                <span className="vip-mono">{q.id}</span>
                <span style={{ fontSize: 12, color: 'var(--vip-ink)' }}>{q.what}</span>
                <span className="vip-num" style={{ fontSize: 11, color: 'var(--vip-body)' }}>{q.value}</span>
                <span style={{ fontSize: 11, color: 'var(--vip-faint)' }}>{q.date}</span>
                <span style={{ fontSize: 10, fontWeight: 600, textAlign: 'right', color: q.color }}>{q.status}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="vip-card">
        <div className="vip-card-head">
          <div className="vip-card-title">Products in scope</div>
        </div>
        {!product ? (
          <p className="vip-empty">No product specified yet.</p>
        ) : (
          <div className="vip-bar-row">
            <div style={{ flex: '0 0 150px', fontSize: 12, color: 'var(--vip-ink)' }}>{product.name}</div>
            <div className="vip-bar-track vip-thick">
              <div className="vip-bar-fill" style={{ width: '100%', background: isWon ? GOOD : lead.quote_sent ? '#5f9a9a' : 'var(--vip-line)' }} />
            </div>
            <div className="vip-bar-value" style={{ flex: '0 0 60px' }}>{formatCurrencyCompact(dealValue)}</div>
            <div style={{ flex: '0 0 60px', textAlign: 'right', fontSize: 10, color: 'var(--vip-faint)' }}>{isWon ? 'ordered' : lead.quote_sent ? 'quoted' : 'pending'}</div>
          </div>
        )}
      </div>

      <LeadActivityTimeline activities={activities} stageHistory={stageHistory} ownerHistory={ownerHistory} />
    </div>
  )

  // Mobile-only sticky bar, replacing the desktop btn-row in mainContent —
  // Log activity/Call client are available to every viewer (not gated by
  // canEdit, matching the original unconditional btn-row), the ⇄
  // quick-actions button only for canEdit (opens LeadQuickActions as a sheet).
  const mobileActionBar = (
    <div className="vip-only-mobile">
      <div className="vip-sticky-footer">
        <div className="vip-lead-actionbar">
          {employee?.role !== 'owner' && (
            <a className="vip-btn" href="/activity">
              Log activity
            </a>
          )}
          {party?.mobile ? (
            <a className="vip-btn vip-btn-secondary" href={`tel:${party.mobile}`}>
              Call client
            </a>
          ) : (
            <button type="button" className="vip-btn vip-btn-secondary" disabled>
              Call client
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="vip-lead-actionbar-toggle"
              onClick={() => setQuickActionsSheetOpen(true)}
              aria-label="Quick actions"
            >
              ⇄
            </button>
          )}
        </div>
      </div>
    </div>
  )

  if (!canEdit) {
    return (
      <>
        <div className="vip-narrow vip-pad-sticky-footer">
          {mainContent}
          <p className="vip-empty">
            This lead belongs to {lead.employees?.name ?? 'another sales exec'} — you can view the summary above, but
            only they or an owner can make changes to it.
          </p>
        </div>
        {mobileActionBar}
      </>
    )
  }

  const salesProgressEditor = (
    <SalesProgressSection
      lead={lead}
      products={products}
      onSaved={(updated) => setLead((prev) => ({ ...prev, ...updated }))}
    />
  )
  const siteDetailsEditor = site && <SiteDetailsSection site={site} areas={areas} onSaved={setSite} />
  const clientDetailsEditor = party && <ClientDetailsSection party={party} onSaved={setParty} />
  const contactsEditor = site && (
    <AdditionalContactsSection
      site={site}
      otherParty={otherParty}
      siteContacts={siteContacts}
      onContactAdded={(contact) => setSiteContacts((prev) => [...prev, contact])}
    />
  )
  const quickActionsProps = {
    lead,
    isOwner,
    activeSalesExecs,
    onStageChanged: (updatedLead, historyRow) => {
      setLead((prev) => ({ ...prev, ...updatedLead }))
      if (historyRow) setStageHistory((prev) => [...prev, historyRow])
    },
    onFollowUpSaved: (updatedLead) => setLead((prev) => ({ ...prev, ...updatedLead })),
    onOwnerReassigned: (updatedLead, historyRow) => {
      setLead((prev) => ({ ...prev, ...updatedLead }))
      if (historyRow) setOwnerHistory((prev) => [...prev, historyRow])
    },
  }

  return (
    <>
      <div className="vip-cols vip-pad-sticky-footer">
        {mainContent}
        <div className="vip-stack">
          {rail}

          {/* Desktop: the four sections stay inline, always editable, as
              before. Mobile: one card of tap-to-expand summary rows instead
              (see the full-screen editor overlay below). */}
          <div className="vip-only-desktop">
            {salesProgressEditor}
            {siteDetailsEditor}
            {clientDetailsEditor}
            {contactsEditor}
          </div>

          <div className="vip-card vip-only-mobile">
            {detailSections.map((s) => (
              <button key={s.key} type="button" className="vip-detail-row" onClick={() => setOpenSection(s.key)}>
                <span className="vip-detail-row-title">{s.title}</span>
                <span className="vip-detail-row-summary">{s.summary} ›</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {openSection && (
        <>
          <div className="vip-dd-backdrop" onClick={() => setOpenSection(null)} />
          <div className="vip-dd-panel">
            <div className="vip-dd-head">
              <div className="vip-dd-head-text">
                <div className="vip-dd-title">{SECTION_TITLES[openSection]}</div>
              </div>
              <button type="button" className="vip-dd-close" onClick={() => setOpenSection(null)} aria-label="Close">
                ✕
              </button>
            </div>
            {openSection === 'sales' && salesProgressEditor}
            {openSection === 'site' && siteDetailsEditor}
            {openSection === 'client' && clientDetailsEditor}
            {openSection === 'contacts' && contactsEditor}
          </div>
        </>
      )}

      {mobileActionBar}

      {quickActionsSheetOpen && (
        <>
          <div className="vip-sheet-backdrop" onClick={() => setQuickActionsSheetOpen(false)} />
          <div className="vip-sheet">
            <div className="vip-sheet-handle" />
            <LeadQuickActions {...quickActionsProps} />
          </div>
        </>
      )}
    </>
  )
}

export default LeadDetail
