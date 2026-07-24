import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import SiteDetailsSection from '../components/SiteDetailsSection'
import ClientDetailsSection from '../components/ClientDetailsSection'
import AdditionalContactsSection from '../components/AdditionalContactsSection'
import SalesProgressSection from '../components/SalesProgressSection'
import LeadStageSection from '../components/LeadStageSection'
import './LeadDetail.css'

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

  const [lead, setLead] = useState(null)
  const [party, setParty] = useState(null)
  const [otherParty, setOtherParty] = useState(null)
  const [site, setSite] = useState(null)
  const [siteContacts, setSiteContacts] = useState([])
  const [stageHistory, setStageHistory] = useState([])
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

      const [partyResult, otherPartyResult, siteResult, contactsResult, stageHistoryResult, areasResult, productsResult] =
        await Promise.all([
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
      setAreas(areasResult.data ?? [])
      setProducts(productsResult.data ?? [])
      setLoading(false)
    }

    load()

    return () => {
      active = false
    }
  }, [id])

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>
  if (loadError) return <p style={{ padding: 24, color: 'crimson' }}>{loadError}</p>
  if (!lead) return <p style={{ padding: 24 }}>Lead not found.</p>

  // RLS already refuses the actual UPDATE for a non-owning sales exec — this
  // is the UI-level mirror of that, so they see a clear read-only notice
  // instead of full edit forms that would just fail silently on save.
  const canEdit = employee?.role === 'owner' || lead.owner_employee_id === employee?.id

  return (
    <main className="lead-detail">
      <Link to="/leads/new" className="lead-detail-back">
        ← New lead
      </Link>
      <h1>Lead #{lead.id}</h1>

      <ul className="lead-detail-summary">
        <li>Source: {SOURCE_LABELS[lead.source_type] ?? lead.source_type}</li>
        <li>Stage: {lead.current_stage ?? 'new'}</li>
        <li>Owner: {lead.employees?.name ?? 'Unassigned'}</li>
        {party && (
          <li>
            Party: {party.name} ({party.party_type})
            {party.mobile ? ` — ${party.mobile}` : ''}
          </li>
        )}
        {site && (
          <li>
            Site: {site.nickname || site.locality || `#${site.id}`}
            {site.house_no ? `, ${site.house_no}` : ''}
          </li>
        )}
        <li>Created: {new Date(lead.created_at).toLocaleDateString()}</li>
      </ul>

      {canEdit ? (
        <>
          <LeadStageSection
            lead={lead}
            stageHistory={stageHistory}
            onStageChanged={(updatedLead, historyRow) => {
              setLead((prev) => ({ ...prev, ...updatedLead }))
              if (historyRow) setStageHistory((prev) => [...prev, historyRow])
            }}
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

          <SalesProgressSection
            lead={lead}
            products={products}
            onSaved={(updated) => setLead((prev) => ({ ...prev, ...updated }))}
          />
        </>
      ) : (
        <p className="lead-detail-readonly">
          This lead belongs to {lead.employees?.name ?? 'another sales exec'} — you can view the summary above, but
          only they or an owner can make changes to it.
        </p>
      )}
    </main>
  )
}

export default LeadDetail
