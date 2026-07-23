import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import PartySearchOrCreate from '../components/PartySearchOrCreate'
import './LeadQuickCapture.css'

const SOURCE_OPTIONS = [
  { value: 'scanning', label: 'Scanning' },
  { value: 'lixil', label: 'Lixil' },
  { value: 'referral_architect', label: 'Referral' },
]

const SOURCE_LABELS = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label]))

function LeadQuickCapture() {
  const { employee, signOut } = useAuth()

  const [sourceType, setSourceType] = useState(null)
  const [clientParty, setClientParty] = useState(null)
  const [siteNickname, setSiteNickname] = useState('')
  const [otherParty, setOtherParty] = useState(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [createdLead, setCreatedLead] = useState(null)

  const canSubmit =
    Boolean(sourceType) && Boolean(clientParty || siteNickname.trim() || otherParty) && !submitting

  function resetForm() {
    setSourceType(null)
    setClientParty(null)
    setSiteNickname('')
    setOtherParty(null)
    setSubmitError(null)
    setCreatedLead(null)
  }

  async function handleSubmit() {
    setSubmitError(null)
    setSubmitting(true)

    let siteId = null
    if (siteNickname.trim()) {
      const { data, error } = await supabase
        .from('sites')
        .insert({
          nickname: siteNickname.trim(),
          discovered_via: sourceType,
          discovered_by: employee?.id ?? null,
        })
        .select('id')
        .single()

      if (error) {
        setSubmitError(`Couldn't save the site: ${error.message}`)
        setSubmitting(false)
        return
      }
      siteId = data.id
    }

    const partyId = clientParty?.id ?? otherParty?.id ?? null
    const referredByPartyId =
      sourceType === 'referral_architect' && clientParty && otherParty ? otherParty.id : null

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert({
        site_id: siteId,
        party_id: partyId,
        owner_employee_id: employee?.id ?? null,
        source_type: sourceType,
        referred_by_party_id: referredByPartyId,
      })
      .select('id, source_type, site_id, party_id, referred_by_party_id')
      .single()

    setSubmitting(false)

    if (leadError) {
      setSubmitError(
        siteId
          ? `Site was saved (id ${siteId}), but the lead failed: ${leadError.message}`
          : `Couldn't save the lead: ${leadError.message}`
      )
      return
    }

    setCreatedLead(lead)
  }

  if (createdLead) {
    return (
      <main className="lead-capture">
        <h1>Lead captured</h1>
        <ul className="lead-capture-summary">
          <li>Lead ID: {createdLead.id}</li>
          <li>Source: {SOURCE_LABELS[createdLead.source_type]}</li>
          {clientParty && <li>Client: {clientParty.name}</li>}
          {otherParty && <li>Other: {otherParty.name}</li>}
          {siteNickname && <li>Site: {siteNickname}</li>}
        </ul>
        <button type="button" onClick={resetForm}>
          Capture another lead
        </button>
      </main>
    )
  }

  return (
    <main className="lead-capture">
      <div className="lead-capture-header">
        <h1>New Lead</h1>
        <button type="button" onClick={signOut}>
          Log out
        </button>
      </div>

      <div className="lead-capture-source">
        {SOURCE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={
              sourceType === opt.value
                ? 'lead-capture-source-btn lead-capture-source-btn-active'
                : 'lead-capture-source-btn'
            }
            onClick={() => setSourceType(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <PartySearchOrCreate label="Client name" defaultPartyType="client" onSelect={setClientParty} />

      <label className="lead-capture-field">
        Site nickname
        <input
          value={siteNickname}
          onChange={(e) => setSiteNickname(e.target.value)}
          placeholder="e.g. site in front of Verka factory in Sarabha Nagar"
        />
      </label>

      <PartySearchOrCreate
        label="Other's name (architect / PMC / anyone else)"
        defaultPartyType="architect"
        onSelect={setOtherParty}
      />

      {submitError && <p className="lead-capture-error">{submitError}</p>}

      <p className="lead-capture-hint">Fill in at least one of Client name, Site nickname, or Other's name.</p>

      <button type="button" className="lead-capture-submit" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? 'Saving…' : 'Create Lead'}
      </button>
    </main>
  )
}

export default LeadQuickCapture
