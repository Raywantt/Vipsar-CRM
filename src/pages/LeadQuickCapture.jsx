import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import PartySearchOrCreate from '../components/PartySearchOrCreate'
import { fetchMyTeamExecs } from '../lib/employeeQueries'
import { setPartyFirm } from '../lib/partyQueries'
import { TERRITORY_OPTIONS, territoryLabel } from '../lib/territoryOptions'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { SOURCE_TYPE_OPTIONS, SOURCE_TYPE_LABELS } from '../lib/sourceTypeOptions'
import { errorMessage } from '../lib/errorMessage'

// Which party types the "Other's name" field offers. 'firm' (shown as
// "architect firm") is scanning-only for now, at the owner's direction — the
// referral case is theirs to look at later, so don't widen this without asking.
//
// On an architect referral 'architect' comes out of the list: the architect is
// the referrer, captured by the "Referral from" field above it, so offering the
// type here again is just a second place to record the same person — and one
// that wouldn't reach referred_by_party_id.
const OTHER_PARTY_TYPES = ['architect', 'builder', 'pmc', 'other']
const OTHER_PARTY_TYPES_SCANNING = ['architect', 'firm', 'builder', 'pmc', 'other']
const OTHER_PARTY_TYPES_ARCH_REFERRAL = ['builder', 'pmc', 'other']

// Who a general referral can come from. Deliberately excludes 'architect' —
// that's what the Architect referral source is for, and allowing it here would
// let the same thing be logged two ways, blurring the split the whole source
// exists to make. On an architect referral the picker is locked to 'architect'
// (a single-value list hides the Type dropdown entirely).
const REFERRER_TYPES = ['client', 'builder', 'pmc', 'other']
const REFERRER_TYPES_ARCHITECT = ['architect']

// Which sources a rep can pick at capture. Currently that's all of them:
// showroom_walkin used to be excluded here (it existed in older data but
// nothing wrote it) and came back as "Walk-in" at the owner's request. The
// filter is kept rather than reading SOURCE_TYPE_OPTIONS directly, because it
// stays the one seam a future capture-only exclusion goes through — the
// canonical list has to serve the dashboard, which needs every value.
const CAPTURE_SOURCES = ['scanning', 'lixil', 'referral_other', 'referral_architect', 'showroom_walkin']
const SOURCE_OPTIONS = SOURCE_TYPE_OPTIONS.filter((o) => CAPTURE_SOURCES.includes(o.value))

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
  const [referralFrom, setReferralFrom] = useState(null)
  // A real 'firm' party, not a typed name — see setPartyFirm/the firm link
  // migration. Serves both architect paths on this screen: the referrer on an
  // architect referral, and the "Other's name" party when it's an architect.
  const [firmParty, setFirmParty] = useState(null)
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

  // The architect-firm options, the client address box, the site nickname and
  // the site stage dropdown are all scanning-only. Site nickname earns its
  // place there and nowhere else: a rep who just walked past a site can
  // describe it ("in front of the Verka factory"), while a Lixil or referral
  // lead arrives as a person on the phone with no site seen yet.
  const isScanning = sourceType === 'scanning'
  const isArchReferral = sourceType === 'referral_architect'
  const isReferral = isArchReferral || sourceType === 'referral_other'
  // A walk-in is the narrowest source on this form: someone standing in the
  // showroom, so there is no site to describe, nobody who referred them and no
  // third party involved. It asks for the client and their address, and every
  // other field is hidden — hence the required client name below (with no
  // site nickname, referrer or other party offered, it's the only thing that
  // can satisfy the lead_needs_an_anchor CHECK).
  const isWalkIn = sourceType === 'showroom_walkin'
  // The address box is shared by the two sources that meet the client in
  // person. One flag read by the field and by the write below, so the question
  // asked and the value saved can't drift apart.
  const asksAddress = isScanning || isWalkIn

  // Resolved here rather than at submit time so the same value gates the Save
  // button and gets written — a required field whose emptiness is computed
  // twice is a field that eventually disagrees with its own button. Gated on
  // the source so a value picked and then abandoned by switching source can't
  // be written by a lead that never showed the field.
  const resolvedSiteStage = !isScanning
    ? null
    : siteStage === 'other'
      ? customSiteStage.trim() || null
      : siteStage || null

  const resolvedReferralFrom = isReferral ? referralFrom : null

  // Whichever party on this form is an individual architect — the referrer on
  // an architect referral, or "Other's name" anywhere else. At most one can be
  // at a time: the two fields never both offer the 'architect' type (an
  // architect referral drops it from Other's name, and no other source offers
  // it on the referrer), so one firm field serves both paths. A 'firm' party
  // is excluded on purpose — it already IS the firm.
  const architectParty = [resolvedReferralFrom, otherParty].find((p) => p?.party_type === 'architect') ?? null

  const canSubmit =
    Boolean(sourceType) &&
    Boolean(officeTerritory) &&
    Boolean(clientParty || (isScanning && siteNickname.trim()) || resolvedReferralFrom || otherParty) &&
    (!isScanning || Boolean(resolvedSiteStage)) &&
    (!isReferral || Boolean(resolvedReferralFrom)) &&
    (!isWalkIn || Boolean(clientParty)) &&
    (!isCoordinator || Boolean(forExec)) &&
    !submitting

  // Changing the source clears the referrer rather than leaving it resolved-
  // away in state. Switching Referral → Architect referral swaps the picker's
  // typeOptions underneath a party that's already chosen, and the picked party
  // isn't re-validated against the new list the way PartySearchOrCreate's own
  // create-form type is — so a 'client' referrer could otherwise survive onto
  // an architect referral. The `key` on that picker remounts it to match.
  function selectSource(value) {
    setSourceType(value)
    setReferralFrom(null)
    setFirmParty(null)
    // "Other's name" is hidden entirely on a walk-in, so unlike every other
    // field on this form its input can unmount with a party still held here.
    // PartySearchOrCreate is uncontrolled (initialSelected is a seed, not a
    // value), so it would come back blank on remount while this state still
    // carried the old party — a lead writing an other_party_id the rep can't
    // see. Clearing on any source change is the cheap fix; the cost is that
    // switching between two sources that both show the field re-asks for it.
    setOtherParty(null)
  }

  // The firm belongs to the architect, not the lead — so it follows whoever is
  // selected, pre-filled from their stored link. This is the "type a known
  // architect and their firm comes up on its own" behaviour. Keyed on the id
  // so re-picking the same architect doesn't wipe an edit in progress.
  useEffect(() => {
    setFirmParty(architectParty?.firm ?? null)
  }, [architectParty?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function resetForm() {
    setSourceType(null)
    setOfficeTerritory(null)
    setClientParty(null)
    setClientAddress('')
    setSiteNickname('')
    setSiteStage('')
    setCustomSiteStage('')
    setReferralFrom(null)
    setFirmParty(null)
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

    // EVERY lead gets a site row, even when nothing about the site was asked.
    // This is load-bearing, not tidiness: SiteDetailsSection and
    // AdditionalContactsSection only ever UPDATE an existing row and are
    // rendered as `site && …`, and ActivityLog's Site Visit stage picker is
    // gated on `selectedLead.sites?.id` — nothing anywhere in the app can
    // create a site after capture. A lead saved without one could therefore
    // never get a stage, locality, area or site contact for the rest of its
    // life. Since site nickname is now scanning-only, that would be every
    // Lixil and referral lead.
    //
    // site_stage lives on sites and there is deliberately no leads.site_stage
    // to fall back on: Dashboard's "Leads by site stage" card, Site Visit's
    // stage update and Lead Detail's Site details all read and write this one
    // column, so a second copy on leads would fork one fact into two that
    // disagree. Both columns are nullable — an unnamed, unstaged site is an
    // honest empty record the rep fills in from Lead Detail after the first
    // visit, not a guess made at capture about a site nobody has seen.
    const { data: siteRow, error: siteError } = await supabase
      .from('sites')
      .insert({
        nickname: isScanning ? siteNickname.trim() || null : null,
        site_stage: resolvedSiteStage,
        discovered_via: sourceType,
        discovered_by: ownerEmployeeId,
      })
      .select('id')
      .single()

    if (siteError) {
      setSubmitError(`Couldn't save the site: ${errorMessage(siteError)}`)
      setSubmitting(false)
      return
    }
    const siteId = siteRow.id

    const partyId = clientParty?.id ?? resolvedReferralFrom?.id ?? otherParty?.id ?? null
    // The referrer is the referrer on both referral sources, whether or not a
    // client is on the lead yet. This replaces the older rule that only linked
    // one when an architect-referral lead had BOTH a client and an "other"
    // party — that was a workaround for there being no field meaning "who
    // referred this", which is now exactly what this field means.
    const referredByPartyId = resolvedReferralFrom?.id ?? null

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
      // The site always exists by this point, so it's always orphaned when the
      // lead fails — surfacing its id is the only trace of it the rep gets;
      // nothing auto-cleans it up (no transaction wraps the two inserts).
      setSubmitError(`Site was saved (id ${siteId}), but the lead failed: ${errorMessage(leadError)}`)
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

    if (asksAddress && address) {
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

    // The firm is a property of the architect, not of this lead, so the link
    // is written onto their party row. setPartyFirm owns the no-op and
    // silent-RLS-rejection handling — see src/lib/partyQueries.js.
    if (architectParty) {
      const firmWarning = await setPartyFirm({
        partyId: architectParty.id,
        partyName: architectParty.name,
        firmId: firmParty?.id ?? null,
        currentFirmId: architectParty.firm?.id ?? null,
      })
      if (firmWarning) nextWarnings.push(`The lead saved, but ${firmWarning}`)
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
            <div className="vip-fact-value">{SOURCE_TYPE_LABELS[createdLead.source_type]}</div>
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
          {resolvedReferralFrom && (
            <div>
              <div className="vip-fact-label">Referral from</div>
              <div className="vip-fact-value">{resolvedReferralFrom.name}</div>
            </div>
          )}
          {architectParty && firmParty && (
            <div>
              <div className="vip-fact-label">Firm</div>
              <div className="vip-fact-value">{firmParty.name}</div>
            </div>
          )}
          {otherParty && (
            <div>
              <div className="vip-fact-label">Other</div>
              <div className="vip-fact-value">{otherParty.name}</div>
            </div>
          )}
          {isScanning && siteNickname && (
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

  // Rendered under whichever field produced the architect — see its two call
  // sites below. key'd on the architect's id so the picker re-seeds when a
  // different architect is chosen (initialSelected is a seed, not a controlled
  // value); that re-seed is what makes a known architect's firm appear on its
  // own.
  const firmField = architectParty && (
    <PartySearchOrCreate
      key={architectParty.id}
      label="Firm"
      hint={`optional, saved against ${architectParty.name}`}
      defaultPartyType="firm"
      typeOptions={['firm']}
      initialSelected={architectParty.firm ?? null}
      onSelect={setFirmParty}
      createdByEmployeeId={ownerEmployeeId}
    />
  )

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
        {/* .vip-choice-grid-5, NOT .vip-choice-grid — five options don't
            divide the latter's 2- and 4-column tracks, so the fifth would sit
            as an orphan half (phone) or quarter (desktop) button. Applied
            alone, like every grid in this family: pairing two of them puts two
            `display` declarations on one element at equal specificity. */}
        <div className="vip-choice-grid-5">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={sourceType === opt.value ? 'vip-choice vip-active' : 'vip-choice'}
              onClick={() => selectSource(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Territory is asked for every source, not just scanning — a lead has
          both a source and an office, and they're independent facts. Its own
          row rather than folded into "Where from" for that reason.

          .vip-choice-grid-5, NOT .vip-choice-grid — TERRITORY_OPTIONS grew a
          fifth value ('others') alongside the four named offices, the same
          5-option case the source tap-select above already needed its own
          class for. Applied alone, same cascade-trap reasoning as always. */}
      <div className="vip-stack-s">
        <div className="vip-field-label">Office territory *</div>
        <div className="vip-choice-grid-5">
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

      {/* Required only on a walk-in, where it's the lead's one anchor. The
          marker is a marker: canSubmit above does the enforcing. */}
      <PartySearchOrCreate
        label="Client name"
        required={isWalkIn}
        defaultPartyType="client"
        typeOptions={['client']}
        onSelect={setClientParty}
        createdByEmployeeId={ownerEmployeeId}
      />

      {asksAddress && (
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

      {/* Both referral sources ask who sent the lead. On an architect referral
          the picker is locked to party_type 'architect' (a single-value
          typeOptions list hides the Type dropdown), so a name typed here is
          created as a real architect party — which is what makes it show up
          as one everywhere else in the app, not just on this lead.

          key={sourceType} remounts the picker when the source flips between
          the two referral kinds: the offered types change, and a party already
          selected isn't re-validated against the new list. selectSource()
          clears the parent's own copy for the same reason. */}
      {isReferral && (
        <PartySearchOrCreate
          key={sourceType}
          label="Referral from"
          required
          defaultPartyType={isArchReferral ? 'architect' : 'client'}
          typeOptions={isArchReferral ? REFERRER_TYPES_ARCHITECT : REFERRER_TYPES}
          onSelect={setReferralFrom}
          createdByEmployeeId={ownerEmployeeId}
        />
      )}

      {/* The firm sits directly under whichever field produced the architect
          — the referrer here, "Other's name" further down. Only one of those
          two can be an architect at a time (see architectParty), so exactly
          one of these renders. */}
      {isArchReferral && firmField}

      {/* Scanning-only: a rep who walked past a site can describe it, while a
          Lixil or referral lead arrives as a phone call about a site nobody
          has seen. The site row itself is still created for every lead (see
          handleSubmit) — it's just unnamed until Lead Detail fills it in. */}
      {isScanning && (
        <label className="vip-field">
          Site nickname
          <input
            className="vip-input"
            value={siteNickname}
            onChange={(e) => setSiteNickname(e.target.value)}
            placeholder="e.g. site in front of Verka factory in Sarabha Nagar"
          />
        </label>
      )}

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

      {/* On an architect referral the label drops "architect" along with the
          type — the architect is the referrer above, and a field still
          offering them here would read as a second place to put the same
          person. PartySearchOrCreate clamps defaultPartyType into whatever
          list is offered, so 'architect' falling out of range is handled. */}
      {!isWalkIn && (
        <PartySearchOrCreate
          label={
            isArchReferral
              ? "Other's name (builder / PMC / anyone else)"
              : "Other's name (architect / PMC / anyone else)"
          }
          defaultPartyType="architect"
          typeOptions={
            isScanning
              ? OTHER_PARTY_TYPES_SCANNING
              : isArchReferral
                ? OTHER_PARTY_TYPES_ARCH_REFERRAL
                : OTHER_PARTY_TYPES
          }
          onSelect={setOtherParty}
          createdByEmployeeId={ownerEmployeeId}
        />
      )}

      {/* firmField is already null on a walk-in (it needs an architect, and
          neither field that can produce one renders), so this needs no gate. */}
      {!isArchReferral && firmField}

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
