import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { LEAD_STAGE_OPTIONS, stageLabel } from '../lib/leadStageOptions'
import { LOSS_REASON_OPTIONS } from '../lib/lossReasonOptions'
import { createFollowUp } from '../lib/followUpQueries'
import { stageFg } from '../lib/statusColors'
import { errorMessage } from '../lib/errorMessage'

function LeadStageSection({ lead, leadTitle, onStageChanged }) {
  const { employee } = useAuth()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const [lossPromptOpen, setLossPromptOpen] = useState(false)
  // The stage a 'lost' selection is waiting on — held here instead of
  // applied immediately, so a lead can't end up 'lost' with no reason on
  // file (see requestStage/handleConfirmLost below; DECISIONS.md's "no
  // skip-for-now escape hatch" rule).
  const [pendingStage, setPendingStage] = useState(null)
  const [lossReason, setLossReason] = useState('')
  const [lossCompetitor, setLossCompetitor] = useState('')
  const [savingLoss, setSavingLoss] = useState(false)
  const [lossError, setLossError] = useState(null)
  const [lossSaved, setLossSaved] = useState(false)

  // 'on_hold' is gated the same way 'lost' is — a reason and a follow-up
  // date must be captured and saved as a real reminder (reusing the
  // Follow-ups table/push pipeline) before the stage itself is touched.
  const [onHoldPromptOpen, setOnHoldPromptOpen] = useState(false)
  const [onHoldReason, setOnHoldReason] = useState('')
  const [onHoldDueDate, setOnHoldDueDate] = useState('')
  const [savingOnHold, setSavingOnHold] = useState(false)
  const [onHoldError, setOnHoldError] = useState(null)
  const [onHoldSaved, setOnHoldSaved] = useState(false)

  // 'won' is gated the same way — a deal shouldn't close out with no
  // order value on file (the gap that used to leave order_value writable
  // only from the Booking Update activity, contributing ₹0 to every booked
  // figure if a lead was won without one ever being logged that way).
  // Pre-filled from whatever's already on the lead (order_value, falling
  // back to quote_value) so re-confirming an already-booked deal is a
  // one-click accept, not a re-type.
  const [wonPromptOpen, setWonPromptOpen] = useState(false)
  const [wonOrderValue, setWonOrderValue] = useState('')
  const [savingWon, setSavingWon] = useState(false)
  const [wonError, setWonError] = useState(null)
  const [wonSaved, setWonSaved] = useState(false)

  // Writes current_stage (+ any extraFields, e.g. next_followup_date) and
  // stage_history together. Called directly for any stage that needs no
  // extra gating; for 'lost'/'on_hold' it's only called once their own
  // reason/date has already been saved.
  async function applyStage(resolvedStage, extraFields = {}) {
    if (!resolvedStage || resolvedStage === lead.current_stage || saving) return

    setSaving(true)
    setError(null)
    setSavedAt(null)

    const { data: updatedLead, error: leadError } = await supabase
      .from('leads')
      .update({ current_stage: resolvedStage, ...extraFields })
      .eq('id', lead.id)
      .select()
      .single()

    if (leadError) {
      setSaving(false)
      setError(errorMessage(leadError))
      return
    }

    const { data: historyRow, error: historyError } = await supabase
      .from('stage_history')
      .insert({ lead_id: lead.id, stage: resolvedStage, changed_by: employee?.id ?? null })
      .select('id, stage, changed_at, employees(name)')
      .single()

    setSaving(false)

    if (historyError) {
      setError(`Stage updated, but logging history failed: ${errorMessage(historyError)}`)
    } else {
      setSavedAt(Date.now())
    }

    onStageChanged(updatedLead, historyError ? null : historyRow)
  }

  // Entry point for every stage chip and the custom "Set" button. 'lost'
  // and 'on_hold' are withheld from applyStage until their own prompt is
  // confirmed — every other stage still applies immediately, unchanged.
  function requestStage(resolvedStage) {
    if (!resolvedStage || resolvedStage === lead.current_stage || saving || savingLoss || savingOnHold || savingWon)
      return

    // Picking a different chip discards whichever prompt is currently open
    // (lost/on_hold/won) instead of leaving it lingering on screen — nothing
    // was written for it yet (that's the whole point of gating), so there's
    // nothing to undo, just state to clear. Without this, choosing e.g. RFQ
    // while the lost-reason prompt was still open applied RFQ immediately
    // but left the lost prompt (and its pendingStage) sitting there, so a
    // stray later "Save & mark lost" click could still flip the lead back
    // to lost even though the board now showed RFQ.
    if (lossPromptOpen) cancelLossPrompt()
    if (onHoldPromptOpen) cancelOnHoldPrompt()
    if (wonPromptOpen) cancelWonPrompt()

    if (resolvedStage === 'lost') {
      setPendingStage(resolvedStage)
      setLossReason('')
      setLossCompetitor('')
      setLossError(null)
      setLossSaved(false)
      setLossPromptOpen(true)
      return
    }
    if (resolvedStage === 'on_hold') {
      setOnHoldReason('')
      setOnHoldDueDate('')
      setOnHoldError(null)
      setOnHoldSaved(false)
      setOnHoldPromptOpen(true)
      return
    }
    if (resolvedStage === 'won') {
      setWonOrderValue(lead.order_value ?? lead.quote_value ?? '')
      setWonError(null)
      setWonSaved(false)
      setWonPromptOpen(true)
      return
    }
    applyStage(resolvedStage)
  }

  function cancelLossPrompt() {
    setLossPromptOpen(false)
    setPendingStage(null)
    setLossReason('')
    setLossCompetitor('')
    setLossError(null)
  }

  function cancelOnHoldPrompt() {
    setOnHoldPromptOpen(false)
    setOnHoldReason('')
    setOnHoldDueDate('')
    setOnHoldError(null)
  }

  function cancelWonPrompt() {
    setWonPromptOpen(false)
    setWonOrderValue('')
    setWonError(null)
  }

  // The reason is written first — if it fails, the lead's stage is never
  // touched, so nothing can end up 'lost' without a reason on file.
  async function handleConfirmLost() {
    if (!lossReason || savingLoss) return
    setSavingLoss(true)
    setLossError(null)

    const { error } = await supabase.from('loss_reasons').insert({
      lead_id: lead.id,
      reason: lossReason,
      competitor_name: lossCompetitor.trim() || null,
    })

    if (error) {
      setSavingLoss(false)
      setLossError(errorMessage(error))
      return
    }

    await applyStage(pendingStage)

    setSavingLoss(false)
    setLossPromptOpen(false)
    setPendingStage(null)
    setLossSaved(true)
  }

  // Same ordering guarantee as handleConfirmLost above: the follow-up
  // (reason + compulsory due date) is written first, and the stage only
  // changes once that succeeds — so a lead can't end up 'on_hold' with no
  // reason or reminder on file. assignedTo falls back to the acting
  // employee for the rare unassigned-lead case (follow_ups.assigned_to is
  // NOT NULL).
  async function handleConfirmOnHold() {
    if (!onHoldReason.trim() || !onHoldDueDate || savingOnHold) return
    setSavingOnHold(true)
    setOnHoldError(null)

    const { error } = await createFollowUp({
      assignedTo: lead.owner_employee_id ?? employee?.id,
      createdBy: employee?.id ?? null,
      partyId: lead.party_id ?? null,
      leadId: lead.id,
      activityType: 'other',
      title: `On hold — ${leadTitle ?? 'lead'}`,
      notes: onHoldReason.trim(),
      dueDate: onHoldDueDate,
      dueTime: null,
    })

    if (error) {
      setSavingOnHold(false)
      setOnHoldError(errorMessage(error))
      return
    }

    await applyStage('on_hold', { next_followup_date: onHoldDueDate })

    setSavingOnHold(false)
    setOnHoldPromptOpen(false)
    setOnHoldSaved(true)
  }

  // Order value is written together with the stage change itself (unlike
  // lost/on_hold, there's no separate table to insert into first) — a deal
  // can't end up 'won' with no order value on file, closing the gap where
  // order_value was only ever writable from the Booking Update activity.
  async function handleConfirmWon() {
    const value = Number(wonOrderValue)
    if (wonOrderValue === '' || !Number.isFinite(value) || value <= 0 || savingWon) return
    setSavingWon(true)
    setWonError(null)

    await applyStage('won', { order_value: value })

    setSavingWon(false)
    setWonPromptOpen(false)
    setWonSaved(true)
  }

  return (
    <div className="vip-card">
      <div className="vip-card-title">Stage</div>

      <div className="vip-chip-wrap">
        {LEAD_STAGE_OPTIONS.map((stage) => (
          <button
            key={stage}
            type="button"
            className="vip-chip-select"
            style={{ color: stageFg(stage) }}
            aria-pressed={stage === lead.current_stage}
            disabled={saving || savingLoss || savingOnHold || savingWon}
            onClick={() => requestStage(stage)}
          >
            {stageLabel(stage)}
          </button>
        ))}
      </div>

      {error && <p className="vip-error" role="alert">{error}</p>}
      {savedAt && !error && <p className="vip-success" role="status" aria-live="polite">Stage updated.</p>}

      {lossPromptOpen && (
        <div className="vip-section-split vip-stack-s">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--vip-body)' }}>
            Marking this lead <strong>lost</strong> — why? A reason is required before the stage is saved.
          </p>
          <select className="vip-select" value={lossReason} onChange={(e) => setLossReason(e.target.value)}>
            <option value="">— Select reason —</option>
            {LOSS_REASON_OPTIONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
          <input
            className="vip-input"
            value={lossCompetitor}
            onChange={(e) => setLossCompetitor(e.target.value)}
            placeholder="Competitor name (optional)"
          />
          {lossError && <p className="vip-error" role="alert">{lossError}</p>}
          <div className="vip-btn-row">
            <button
              type="button"
              className="vip-btn vip-btn-sm"
              style={{ width: 'auto', flex: '0 0 auto' }}
              onClick={handleConfirmLost}
              disabled={!lossReason || savingLoss}
            >
              {savingLoss ? 'Saving…' : 'Save & mark lost'}
            </button>
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              style={{ width: 'auto', flex: '0 0 auto' }}
              onClick={cancelLossPrompt}
              disabled={savingLoss}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {lossSaved && !lossPromptOpen && <p className="vip-success" role="status" aria-live="polite">Loss reason saved.</p>}

      {onHoldPromptOpen && (
        <div className="vip-section-split vip-stack-s">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--vip-body)' }}>
            Putting this lead <strong>on hold</strong> — why, and when should it be followed up?
          </p>
          <textarea
            className="vip-textarea"
            rows={3}
            value={onHoldReason}
            onChange={(e) => setOnHoldReason(e.target.value)}
            placeholder="Reason (e.g. client wants time to think, site paused for external factors)"
          />
          <input
            type="date"
            className="vip-input"
            value={onHoldDueDate}
            onChange={(e) => setOnHoldDueDate(e.target.value)}
          />
          {onHoldError && <p className="vip-error" role="alert">{onHoldError}</p>}
          <div className="vip-btn-row">
            <button
              type="button"
              className="vip-btn vip-btn-sm"
              style={{ width: 'auto', flex: '0 0 auto' }}
              onClick={handleConfirmOnHold}
              disabled={!onHoldReason.trim() || !onHoldDueDate || savingOnHold}
            >
              {savingOnHold ? 'Saving…' : 'Save & put on hold'}
            </button>
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              style={{ width: 'auto', flex: '0 0 auto' }}
              onClick={cancelOnHoldPrompt}
              disabled={savingOnHold}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {onHoldSaved && !onHoldPromptOpen && <p className="vip-success" role="status" aria-live="polite">On hold — reminder saved.</p>}

      {wonPromptOpen && (
        <div className="vip-section-split vip-stack-s">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--vip-body)' }}>
            Marking this lead <strong>won</strong> — what was the deal worth? An order value is required before the
            stage is saved.
          </p>
          <input
            className="vip-input"
            type="number"
            step="0.01"
            min="0"
            value={wonOrderValue}
            onChange={(e) => setWonOrderValue(e.target.value)}
            placeholder="Order value"
          />
          {wonError && <p className="vip-error" role="alert">{wonError}</p>}
          <div className="vip-btn-row">
            <button
              type="button"
              className="vip-btn vip-btn-sm"
              style={{ width: 'auto', flex: '0 0 auto' }}
              onClick={handleConfirmWon}
              disabled={wonOrderValue === '' || Number(wonOrderValue) <= 0 || savingWon}
            >
              {savingWon ? 'Saving…' : 'Save & mark won'}
            </button>
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              style={{ width: 'auto', flex: '0 0 auto' }}
              onClick={cancelWonPrompt}
              disabled={savingWon}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {wonSaved && !wonPromptOpen && <p className="vip-success" role="status" aria-live="polite">Order value saved.</p>}
    </div>
  )
}

export default LeadStageSection
