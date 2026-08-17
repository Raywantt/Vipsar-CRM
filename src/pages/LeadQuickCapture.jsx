import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import PartySearchOrCreate from '../components/PartySearchOrCreate'
import { fetchMyTeamExecs } from '../lib/employeeQueries'
import { TERRITORY_OPTIONS, territoryLabel } from '../lib/territoryOptions'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { errorMessage } from '../lib/errorMessage'

// Which party types the "Other's name" field offers. 'firm' (shown as
// "architect firm") is scanning-only for now, at the owner's direction — the
// referral case is theirs to look at later, so don't widen this without asking.
const OTHER_PARTY_TYPES = ['architect', 'builder', 'pmc', 'other']
const OTHER_PARTY_TYPES_SCANNING = ['architect', 'firm', 'builder', 'pmc', 'other']

const SOURCE_OPTIONS = [
  { value: 'scanning', label: 'Scanning' },
  { value: 'lixil', label: 'Lixil' },
  { value: 'referral_architect', label: 'Referral' },
]

const SOURCE_LABELS = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.value, o.label]))

function LeadQuickCapture() {
  const { employee } = useAuth()
  const isCoordinator = employee?.role === 'sales_coordinator'

  const [sourceType, setSourceType] = useState(null)
  const [officeTerritory, setOfficeTerritory] = useState(null)
  const [clientParty, setClientParty] = useState(null)
  const [clientAddress, setClientAddress] = useState('')
  const [siteNickname, setSiteNickname] = useState('')
  const [siteStage, setSiteStage] = useState('')
  const [customSiteStage, setCustomSiteStage] = useState('')
  const [otherParty, setOtherParty] = useState(null)
  // A coordinator owns no leads of their own — this picks who the lead is
  // actually for, and that exec's id is what gets written to
  // owner_employee_id (never the coordinator's). Deliberately not reset by
  // resetForm/"Capture another lead": a coordinator entering several leads
  // in a row is almost always doing it for the same exec who just called in.
  const [teamExecs, setTeamExecs] = useState([])
  const [teamExecsLoaded, setTeamExecsLoaded] = useState(!isCoordinator)
  const [forExec, setForExec] = useState(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [createdLead, setCreatedLead] = useState(null)

  useEffect(() => {
    if (!isCoordinator) return
    let active = true
    fetchMyTeamExecs(employee?.id).then(({ data }) => {
      if (!active) return
      setTeamExecs(data ?? [])
      setTeamExecsLoaded(true)
    })
    return () => {
      active = false
    }
  }, [isCoordinator, employee?.id])

  const ownerEmployeeId = isCoordinator ? forExec?.id ?? null : employee?.id ?? null

  // The architect-firm options, the client address box and the site stage
  // dropdown are scanning-only.
  const isScanning = sourceType === 'scanning'

  // Resolved here rather than at submit time so the same value gates the Save
  // button and gets written — a required field whose emptiness is computed
  // twice is a field that eventually disagrees with its own button. Gated on
  // isScanning so a stage picked and then abandoned by switching source can't
  // be written by a lead that never showed the field.
  const resolvedSiteStage = !isScanning
    ? null
    : siteStage === 'other'
      ? customSiteStage.trim() || null
      : siteStage || null

  const canSubmit =
    Boolean(sourceType) &&
    Boolean(officeTerritory) &&
    Boolean(clientParty || siteNickname.trim() || otherParty) &&
    (!isScanning || Boolean(resolvedSiteStage)) &&
    (!isCoordinator || Boolean(forExec)) &&
    !submitting

  function resetForm() {
    setSourceType(null)
    setOfficeTerritory(null)
    setClientParty(null)
    setClientAddress('')
    setSiteNickname('')
    setSiteStage('')
    setCustomSiteStage('')
    setOtherParty(null)
    setSubmitError(null)
    setWarnings([])
    setCreatedLead(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError(null)
    setWarnings([])
    setSubmitting(true)

    // A site stage is enough on its own to justify a site row — site_stage
    // lives on sites, and there is deliberately no leads.site_stage to fall
    // back on: the Dashboard's "Leads by site stage" card, Site Visit's stage
    // update in ActivityLog and Lead Detail's Site details all read and write
    // this one column, so a second copy on leads would fork one fact into two
    // that disagree. nickname is nullable, and the rep can name the site later
    // from Lead Detail — which is also where the rest of its fields get filled.
    let siteId = null
    if (siteNickname.trim() || resolvedSiteStage) {
      const { data, error } = await supabase
        .from('sites')
        .insert({
          nickname: siteNickname.trim() || null,
          site_stage: resolvedSiteStage,
          discovered_via: sourceType,
          discovered_by: ownerEmployeeId,
        })
        .select('id')
        .single()

      if (error) {
        setSubmitError(`Couldn't save the site: ${errorMessage(error)}`)
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
        owner_employee_id: ownerEmployeeId,
        source_type: sourceType,
        office_territory: officeTerritory,
        referred_by_party_id: referredByPartyId,
        other_party_id: otherParty?.id ?? null,
      })
      .select('id, source_type, office_territory, site_id, party_id, referred_by_party_id, other_party_id')
      .single()

    if (leadError) {
      setSubmitting(false)
      setSubmitError(
        siteId
          ? `Site was saved (id ${siteId}), but the lead failed: ${errorMessage(leadError)}`
          : `Couldn't save the lead: ${errorMessage(leadError)}`
      )
      return
    }

    // The address lands on the client party, so it's a separate write that runs
    // only once the lead exists — same "side effects after the main insert, a
    // failure warns instead of blocking" shape ActivityLog.jsx already uses.
    //
    // Running it AFTER the insert is load-bearing, not incidental: both of the
    // parties policies that can authorise this write reach it through the lead
    // (a coordinator via coordinator_team_update's is_my_team_member check on
    // the lead's owner, an exec via team_scoped_select for the .select() below).
    // Moving it earlier would silently fail for a coordinator.
    const nextWarnings = []
    const address = clientAddress.trim()

    if (isScanning && address) {
      if (!clientParty) {
        nextWarnings.push(
          "The address wasn't saved — it attaches to the client record, and this lead has no client name on it."
        )
      } else {
        // .select() is mandatory here. parties UPDATE is "own data (created_by)
        // or owner role", so editing a client another rep added matches zero
        // rows — and an RLS-rejected UPDATE with no .select() returns no error
        // at all, just a silent no-op. See CLAUDE.md's Conventions.
        const { data: updatedParty, error: addressError } = await supabase
          .from('parties')
          .update({ address })
          .eq('id', clientParty.id)
          .select('id')

        if (addressError) {
          nextWarnings.push(`The lead saved, but the address didn't: ${errorMessage(addressError)}`)
        } else if (!updatedParty?.length) {
          nextWarnings.push(
            `The lead saved, but the address didn't — ${clientParty.name} was added by someone else, so you can't edit that record.`
          )
        }
      }
    }

    setWarnings(nextWarnings)
    setSubmitting(false)
    setCreatedLead(lead)
  }

  if (createdLead) {
    return (
      <div className="vip-card vip-narrow">
        <p className="vip-success" role="status" aria-live="polite" style={{ fontSize: 15, fontWeight: 600 }}>
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
          {createdLead.office_territory && (
            <div>
              <div className="vip-fact-label">Territory</div>
              <div className="vip-fact-value">{territoryLabel(createdLead.office_territory)}</div>
            </div>
          )}
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
          {resolvedSiteStage && (
            <div>
              <div className="vip-fact-label">Site stage</div>
              <div className="vip-fact-value">{resolvedSiteStage}</div>
            </div>
          )}
        </div>
        {warnings.map((w) => (
          <p key={w} className="vip-error" role="alert">
            {w}
          </p>
        ))}
        <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={resetForm}>
          Capture another lead
        </button>
      </div>
    )
  }

  return (
    <form className="vip-form vip-narrow vip-pad-sticky-footer" onSubmit={handleSubmit}>
      {isCoordinator && (
        <label className="vip-field">
          Who is this for? *
          {teamExecsLoaded && teamExecs.length === 0 ? (
            <p className="vip-form-note">You have no sales executives assigned to you yet.</p>
          ) : (
            <select
              className="vip-select"
              value={forExec?.id ?? ''}
              onChange={(e) => setForExec(teamExecs.find((ex) => String(ex.id) === e.target.value) ?? null)}
            >
              <option value="">{teamExecsLoaded ? '— Select an exec —' : 'Loading your team…'}</option>
              {teamExecs.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      {/* Source first — the only required field, see the mobile handoff's
          reordering rationale (README's New Lead section). */}
      <div className="vip-stack-s">
        <div className="vip-field-label">Where from *</div>
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

      {/* Territory is asked for every source, not just scanning — a lead has
          both a source and an office, and they're independent facts. Its own
          row rather than folded into "Where from" for that reason. */}
      <div className="vip-stack-s">
        <div className="vip-field-label">Office territory *</div>
        <div className="vip-choice-grid">
          {TERRITORY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={officeTerritory === opt.value ? 'vip-choice vip-active' : 'vip-choice'}
              onClick={() => setOfficeTerritory(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <PartySearchOrCreate
        label="Client name"
        defaultPartyType="client"
        typeOptions={['client']}
        onSelect={setClientParty}
        createdByEmployeeId={ownerEmployeeId}
      />

      {isScanning && (
        <label className="vip-field">
          Address <span className="vip-field-hint">optional, saved against the client above</span>
          <input
            className="vip-input"
            value={clientAddress}
            onChange={(e) => setClientAddress(e.target.value)}
            placeholder="e.g. H.No 42, Sarabha Nagar"
          />
        </label>
      )}

      <label className="vip-field">
        Site nickname
        <input
          className="vip-input"
          value={siteNickname}
          onChange={(e) => setSiteNickname(e.target.value)}
          placeholder="e.g. site in front of Verka factory in Sarabha Nagar"
        />
      </label>

      {/* Scanning-only and required: a rep standing at a site they just
          scanned can see what stage it's at, which is the whole point of
          asking here rather than waiting for the first Site Visit. Same
          preset-plus-Other… shape as Lead Detail's Site details dropdown,
          off the one shared SITE_STAGE_OPTIONS list. */}
      {isScanning && (
        <>
          <label className="vip-field">
            Site stage *
            <select className="vip-select" value={siteStage} onChange={(e) => setSiteStage(e.target.value)}>
              <option value="">— Select a stage —</option>
              {SITE_STAGE_OPTIONS.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
              <option value="other">Other…</option>
            </select>
          </label>
          {siteStage === 'other' && (
            <label className="vip-field">
              Describe stage *
              <input
                className="vip-input"
                value={customSiteStage}
                onChange={(e) => setCustomSiteStage(e.target.value)}
                placeholder="e.g. shuttering"
              />
            </label>
          )}
        </>
      )}

      <PartySearchOrCreate
        label="Other's name (architect / PMC / anyone else)"
        defaultPartyType="architect"
        typeOptions={isScanning ? OTHER_PARTY_TYPES_SCANNING : OTHER_PARTY_TYPES}
        showFirmName={isScanning}
        onSelect={setOtherParty}
        createdByEmployeeId={ownerEmployeeId}
      />

      {submitError && <p className="vip-error" role="alert">{submitError}</p>}

      <div className="vip-form-note">
        Duplicate check runs on the name and mobile you type. Pick the existing record if it shows up.
      </div>

      <div className="vip-sticky-footer">
        <button className="vip-btn" type="submit" disabled={!canSubmit}>
          {submitting ? 'Saving…' : 'Save lead'}
        </button>
      </div>
    </form>
  )
}

export default LeadQuickCapture
