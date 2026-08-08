import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { LOSS_REASON_OPTIONS } from '../lib/lossReasonOptions'
import { stageFg } from '../lib/statusColors'
import { errorMessage } from '../lib/errorMessage'

function LeadStageSection({ lead, onStageChanged }) {
  const { employee } = useAuth()

  const currentIsCustom = Boolean(lead.current_stage) && !LEAD_STAGE_OPTIONS.includes(lead.current_stage)
  const [customOpen, setCustomOpen] = useState(currentIsCustom)
  const [customStage, setCustomStage] = useState(currentIsCustom ? lead.current_stage : '')
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

  // Writes current_stage + stage_history together. Called directly for any
  // non-'lost' stage; for 'lost' it's only ever called from
  // handleConfirmLost, after the reason has already been saved.
  async function applyStage(resolvedStage) {
    if (!resolvedStage || resolvedStage === lead.current_stage || saving) return

    setSaving(true)
    setError(null)
    setSavedAt(null)

    const { data: updatedLead, error: leadError } = await supabase
      .from('leads')
      .update({ current_stage: resolvedStage })
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

  // Entry point for every stage chip and the custom "Set" button. 'lost' is
  // withheld from applyStage until a reason is captured and saved — every
  // other stage still applies immediately, unchanged.
  function requestStage(resolvedStage) {
    if (!resolvedStage || resolvedStage === lead.current_stage || saving || savingLoss) return
    if (resolvedStage === 'lost') {
      setPendingStage(resolvedStage)
      setLossReason('')
      setLossCompetitor('')
      setLossError(null)
      setLossSaved(false)
      setLossPromptOpen(true)
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
            disabled={saving || savingLoss}
            onClick={() => {
              setCustomOpen(false)
              requestStage(stage)
            }}
          >
            {stage}
          </button>
        ))}
        <button
          type="button"
          className="vip-chip-select"
          style={{ color: 'var(--vip-muted)' }}
          aria-pressed={currentIsCustom}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Other…
        </button>
      </div>

      {customOpen && (
        <div className="vip-section-split" style={{ display: 'flex', gap: 8 }}>
          <input
            className="vip-input"
            value={customStage}
            onChange={(e) => setCustomStage(e.target.value)}
            placeholder="Describe stage"
          />
          <button
            type="button"
            className="vip-btn vip-btn-secondary vip-btn-sm"
            style={{ width: 'auto', flex: '0 0 auto' }}
            disabled={!customStage.trim() || saving || savingLoss}
            onClick={() => requestStage(customStage.trim())}
          >
            Set
          </button>
        </div>
      )}

      {error && <p className="vip-error">{error}</p>}
      {savedAt && !error && <p className="vip-success">Stage updated.</p>}

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
          {lossError && <p className="vip-error">{lossError}</p>}
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
      {lossSaved && !lossPromptOpen && <p className="vip-success">Loss reason saved.</p>}
    </div>
  )
}

export default LeadStageSection
