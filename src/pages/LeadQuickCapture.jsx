import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import PartySearchOrCreate from '../components/PartySearchOrCreate'

const SOURCE_OPTIONS = [
  { value: 'scanning', label: 'Scanning' },
  { value: 'lixil', label: 'Lixil' },
  { value: 'referral_architect', label: 'Referral' },
]

const SOURCE_LABELS = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label]))

function LeadQuickCapture() {
  const { employee } = useAuth()

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

  async function handleSubmit(event) {
    event.preventDefault()
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
        other_party_id: otherParty?.id ?? null,
      })
      .select('id, source_type, site_id, party_id, referred_by_party_id, other_party_id')
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
      <div className="vip-card">
        <p className="vip-success" style={{ fontSize: 15, fontWeight: 600 }}>
          Lead captured.
        </p>
        <div className="vip-facts" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div>
            <div className="vip-fact-label">Lead ID</div>
            <div className="vip-fact-value">
              <Link to={`/leads/${createdLead.id}`}>{createdLead.id}</Link>
            </div>
          </div>
          <div>
            <div className="vip-fact-label">Source</div>
            <div className="vip-fact-value">{SOURCE_LABELS[createdLead.source_type]}</div>
          </div>
          {clientParty && (
            <div>
              <div className="vip-fact-label">Client</div>
              <div className="vip-fact-value">{clientParty.name}</div>
            </div>
          )}
          {otherParty && (
            <div>
              <div className="vip-fact-label">Other</div>
              <div className="vip-fact-value">{otherParty.name}</div>
            </div>
          )}
          {siteNickname && (
            <div>
              <div className="vip-fact-label">Site</div>
              <div className="vip-fact-value">{siteNickname}</div>
            </div>
          )}
        </div>
        <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={resetForm}>
          Capture another lead
        </button>
      </div>
    )
  }

  return (
    <form className="vip-form" onSubmit={handleSubmit}>
      <div className="vip-lede">Fill any one. Details later.</div>

      <PartySearchOrCreate
        label="Client name"
        defaultPartyType="client"
        typeOptions={['client']}
        onSelect={setClientParty}
      />

      <label className="vip-field">
        Site nickname
        <input
          className="vip-input"
          value={siteNickname}
          onChange={(e) => setSiteNickname(e.target.value)}
          placeholder="e.g. site in front of Verka factory in Sarabha Nagar"
        />
      </label>

      <PartySearchOrCreate
        label="Other's name (architect / PMC / anyone else)"
        defaultPartyType="architect"
        typeOptions={['architect', 'builder', 'pmc', 'other']}
        onSelect={setOtherParty}
      />

      <div className="vip-stack-s">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vip-ink)' }}>Where from *</div>
        <div className="vip-choice-row">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={sourceType === opt.value ? 'vip-choice vip-active' : 'vip-choice'}
              onClick={() => setSourceType(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {submitError && <p className="vip-error">{submitError}</p>}

      <button className="vip-btn" type="submit" disabled={!canSubmit}>
        {submitting ? 'Saving…' : 'Save lead'}
      </button>
      <div className="vip-form-note">
        Duplicate check runs on the name and mobile you type. Pick the existing record if it shows up.
      </div>
    </form>
  )
}

export default LeadQuickCapture
