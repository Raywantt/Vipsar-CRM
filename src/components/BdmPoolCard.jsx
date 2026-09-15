import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { fetchPoolLeads, fetchPossibleDuplicates } from '../lib/bdmQueries'
import { assignLeadOwner, ALREADY_ASSIGNED_CODE } from '../lib/leadOwnerHistory'
import { sourcingArchitect, waitingLabel } from '../lib/poolLeads'
import { leadDisplayName } from '../lib/leadName'
import { parseTimestamp } from '../lib/dbTime'
import { SOURCE_TYPE_LABELS } from '../lib/sourceTypeOptions'
import { errorMessage } from '../lib/errorMessage'

// The owner's BDM pool (BDM.md Step 3) — every lead a business development
// manager sent to the owner, waiting to be assigned to a sales executive.
//
// Owner's rulings this card carries:
//   * Top of the owner's Today, full width, and hidden completely when the
//     pool is empty (no "nothing waiting" state to design around).
//   * It is the ONLY place a pool lead shows — company figures leave them
//     out until assigned (src/lib/poolLeads.js), which the card says, so a
//     lead missing from the pipeline total doesn't read as a bug.
//   * Duplicate hint = another lead whose client has the same mobile.
//   * Waiting age is plain text — the 24-hour nudge is a push to owners
//     (the Edge Function), not a red label.
//   * No Reject: architects only hand over qualified leads.
//   * This card replaces the in-app notification for a new pool lead; the
//     push still goes out, but AssignedLeadsCard doesn't list the same leads
//     a second time above it.
//
// Assign is two taps (pick, then confirm) rather than Lead Detail's one-tap
// owner grid: here a list of several leads sits under the owner's thumb, and
// a mis-tap would hand a lead to the wrong person with a push already sent.
function BdmPoolCard({ execs }) {
  const { employee } = useAuth()
  const [leads, setLeads] = useState(null)
  const [duplicates, setDuplicates] = useState(new Map())
  const [loadError, setLoadError] = useState(null)
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    let active = true
    fetchPoolLeads().then(async ({ data, error }) => {
      if (!active) return
      if (error) {
        setLoadError(errorMessage(error))
        setLeads([])
        return
      }
      setLeads(data ?? [])
      if (data?.length) {
        const dupRes = await fetchPossibleDuplicates(data)
        if (active && !dupRes.error) setDuplicates(dupRes.data)
      }
    })
    return () => {
      active = false
    }
  }, [])

  function removeLead(leadId) {
    setLeads((prev) => (prev ?? []).filter((l) => l.id !== leadId))
  }

  // A lead assigned from this card may be another row's duplicate match —
  // found live: the remaining row kept saying "(also waiting here)" about a
  // lead that had just been handed to an exec. Rewrite that match in place
  // rather than refetching the whole pool.
  function markAssignedInDuplicates(leadId, exec) {
    setDuplicates(
      (prev) =>
        new Map(
          [...prev].map(([key, matches]) => [
            key,
            matches.map((c) =>
              c.id === leadId ? { ...c, owner_employee_id: exec.id, employees: { name: exec.name } } : c
            ),
          ])
        )
    )
  }

  // Nothing waiting (or not loaded yet): no card at all. A load failure still
  // says so — silently hiding a broken pool would strand leads.
  if (loadError) {
    return (
      <p className="vip-error" role="alert">
        Couldn't load leads waiting for assignment: {loadError}
      </p>
    )
  }
  if (!leads?.length) {
    return flash ? (
      <p className="vip-success" role="status" aria-live="polite">
        {flash}
      </p>
    ) : null
  }

  return (
    <section className="vip-card vip-pool-card" aria-labelledby="vip-pool-title">
      <div className="vip-card-head">
        <h2 id="vip-pool-title" className="vip-card-title">
          BDM leads to assign
        </h2>
        <span className="vip-pool-count">{leads.length}</span>
      </div>
      <p className="vip-pool-note">Not counted in your pipeline until assigned.</p>

      {flash && (
        <p className="vip-success" role="status" aria-live="polite">
          {flash}
        </p>
      )}

      <div className="vip-pool-rows">
        {leads.map((lead) => (
          <PoolRow
            key={lead.id}
            lead={lead}
            duplicates={duplicates.get(lead.id) ?? []}
            execs={execs}
            changedBy={employee?.id ?? null}
            onAssigned={(message, exec) => {
              setFlash(message)
              markAssignedInDuplicates(lead.id, exec)
              removeLead(lead.id)
            }}
            onGone={(message) => {
              setFlash(message)
              removeLead(lead.id)
            }}
          />
        ))}
      </div>
    </section>
  )
}

function PoolRow({ lead, duplicates, execs, changedBy, onAssigned, onGone }) {
  const [picking, setPicking] = useState(false)
  const [choice, setChoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const name = leadDisplayName({ id: lead.id, parties: lead.parties, sites: lead.sites })
  const architect = sourcingArchitect(lead.referrer, lead.other)
  const waited = waitingLabel(parseTimestamp(lead.created_at))
  const meta = [
    architect ? `via ${architect.name}` : null,
    lead.bdm?.name ? `from ${lead.bdm.name}` : null,
    SOURCE_TYPE_LABELS[lead.source_type] ?? null,
  ]
    .filter(Boolean)
    .join(' · ')

  async function confirmAssign() {
    const exec = execs.find((e) => String(e.id) === String(choice))
    if (!exec || saving) return
    setSaving(true)
    setError(null)
    const { error: assignError, historyError } = await assignLeadOwner({
      leadId: lead.id,
      oldOwnerId: null,
      newOwnerId: exec.id,
      changedBy,
      requireUnassigned: true,
    })
    setSaving(false)

    if (assignError) {
      if (assignError.code === ALREADY_ASSIGNED_CODE) {
        // Another owner got there first. Nothing was written by this click;
        // the lead is no longer in the pool, so it leaves this card too — and
        // says why, or the row vanishing reads as this click having worked.
        onGone(`${name} was already assigned by another owner — nothing changed.`)
        return
      }
      setError(errorMessage(assignError))
      return
    }
    onAssigned(
      historyError
        ? `${name} assigned to ${exec.name}, but its ownership history wasn't saved: ${errorMessage(historyError)}`
        : `${name} assigned to ${exec.name}.`,
      exec
    )
  }

  return (
    <div className="vip-pool-row">
      <div className="vip-pool-row-main">
        <Link to={`/leads/${lead.id}`} className="vip-pool-lead">
          {name}
        </Link>
        {meta && <span className="vip-pool-meta">{meta}</span>}
        <span className="vip-pool-tags">
          {lead.joinery_received && <span className="vip-pool-tag">Joinery received</span>}
          {waited && <span className="vip-pool-wait">Waiting {waited}</span>}
        </span>
        {duplicates.slice(0, 1).map((dup) => (
          <Link key={dup.id} to={`/leads/${dup.id}`} className="vip-pool-dup">
            Possible duplicate: same client mobile as {leadDisplayName(dup)}
            {dup.employees?.name ? ` (${dup.employees.name})` : dup.owner_employee_id == null ? ' (also waiting here)' : ''}
            {duplicates.length > 1 ? ` and ${duplicates.length - 1} more` : ''} ›
          </Link>
        ))}
      </div>

      <div className="vip-pool-actions">
        {!picking ? (
          <button
            type="button"
            className="vip-btn vip-btn-sm"
            onClick={() => setPicking(true)}
            disabled={!execs?.length}
          >
            Assign
          </button>
        ) : (
          <>
            <label className="vip-sr-only" htmlFor={`vip-pool-exec-${lead.id}`}>
              Assign {name} to
            </label>
            <select
              id={`vip-pool-exec-${lead.id}`}
              className="vip-select"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={saving}
            >
              <option value="">— Pick a sales executive —</option>
              {execs.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <div className="vip-btn-row">
              <button
                type="button"
                className="vip-btn vip-btn-secondary vip-btn-sm"
                onClick={() => {
                  setPicking(false)
                  setChoice('')
                  setError(null)
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="button" className="vip-btn vip-btn-sm" onClick={confirmAssign} disabled={!choice || saving}>
                {saving ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="vip-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

export default BdmPoolCard
