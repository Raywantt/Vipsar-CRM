import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import SiteDetailsSection from '../components/SiteDetailsSection'
import ClientDetailsSection from '../components/ClientDetailsSection'
import AdditionalContactsSection from '../components/AdditionalContactsSection'
import SalesProgressSection from '../components/SalesProgressSection'
import LeadStageSection from '../components/LeadStageSection'
import LeadActivityTimeline from '../components/LeadActivityTimeline'
import { stageChipClass } from '../lib/statusColors'
import { formatCurrency } from '../lib/format'

const SOURCE_LABELS = {
  scanning: 'Scanning',
  lixil: 'Lixil',
  referral_architect: 'Architect referral',
  referral_other: 'Other referral',
  showroom_walkin: 'Showroom walk-in',
}

const EMPTY = { data: null, error: null }

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
  const [areas, setAreas] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setLoadError(null)

      const { data: leadRow, error: leadError } = await supabase
        .from('leads')
        .select('*, employees!owner_employee_id(name)')
        .eq('id', id)
        .single()

      if (!active) return

      if (leadError) {
        setLoadError(leadError.message)
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
          .select('id, stage, changed_at, employees(name)')
          .eq('lead_id', leadRow.id)
          .order('changed_at', { ascending: true }),
        supabase
          .from('activities')
          .select(
            'id, activity_type, notes, created_at, employees!employee_id(name), accompanied_by_employee:employees!accompanied_by(name)'
          )
          .eq('lead_id', leadRow.id)
          .order('created_at', { ascending: false }),
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
      setAreas(areasResult.data ?? [])
      setProducts(productsResult.data ?? [])
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

  const leadSubtitle = site
    ? [site.nickname || site.locality, site.house_no].filter(Boolean).join(', ')
    : [party?.party_type, party?.mobile].filter(Boolean).join(' · ')
  const stage = lead.current_stage ?? 'new'

  return (
    <div className="vip-narrow">
      <div className="vip-card">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <div className="vip-mono">LEAD-{String(lead.id).padStart(4, '0')}</div>
            <div style={{ fontFamily: 'var(--vip-display)', fontWeight: 600, fontSize: 20, color: 'var(--vip-ink)' }}>
              {leadTitle}
            </div>
            {leadSubtitle && <div className="vip-row-sub">{leadSubtitle}</div>}
          </div>
          <span className={stageChipClass(stage)}>{stage}</span>
        </div>

        <div className="vip-facts">
          <div>
            <div className="vip-fact-label">Order value</div>
            <div className="vip-fact-value vip-num">{formatCurrency(lead.order_value)}</div>
          </div>
          <div>
            <div className="vip-fact-label">Owner</div>
            <div className="vip-fact-value">{lead.employees?.name ?? 'Unassigned'}</div>
          </div>
          <div>
            <div className="vip-fact-label">Source</div>
            <div className="vip-fact-value">{SOURCE_LABELS[lead.source_type] ?? lead.source_type}</div>
          </div>
          <div>
            <div className="vip-fact-label">Created</div>
            <div className="vip-fact-value">{new Date(lead.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
          </div>
        </div>
      </div>

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
        <LeadStageSection
          lead={lead}
          onStageChanged={(updatedLead, historyRow) => {
            setLead((prev) => ({ ...prev, ...updatedLead }))
            if (historyRow) setStageHistory((prev) => [...prev, historyRow])
          }}
        />
      )}

      <LeadActivityTimeline activities={activities} stageHistory={stageHistory} />

      {canEdit ? (
        <>
          <SalesProgressSection
            lead={lead}
            products={products}
            onSaved={(updated) => setLead((prev) => ({ ...prev, ...updated }))}
          />

          {site && <SiteDetailsSection site={site} areas={areas} onSaved={setSite} />}

          {party && <ClientDetailsSection party={party} onSaved={setParty} />}

          {site && (
            <AdditionalContactsSection
              site={site}
              otherParty={otherParty}
              siteContacts={siteContacts}
              onContactAdded={(contact) => setSiteContacts((prev) => [...prev, contact])}
            />
          )}
        </>
      ) : (
        <p className="vip-empty">
          This lead belongs to {lead.employees?.name ?? 'another sales exec'} — you can view the summary above, but
          only they or an owner can make changes to it.
        </p>
      )}
    </div>
  )
}

export default LeadDetail
