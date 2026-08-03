import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { LOSS_REASON_OPTIONS } from '../lib/lossReasonOptions'
import { stageFg } from '../lib/statusColors'

function LeadStageSection({ lead, onStageChanged }) {
  const { employee } = useAuth()

  const currentIsCustom = Boolean(lead.current_stage) && !LEAD_STAGE_OPTIONS.includes(lead.current_stage)
  const [customOpen, setCustomOpen] = useState(currentIsCustom)
  const [customStage, setCustomStage] = useState(currentIsCustom ? lead.current_stage : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const [lossPromptOpen, setLossPromptOpen] = useState(false)
  const [lossReason, setLossReason] = useState('')
  const [lossCompetitor, setLossCompetitor] = useState('')
  const [savingLoss, setSavingLoss] = useState(false)
  const [lossError, setLossError] = useState(null)
  const [lossSaved, setLossSaved] = useState(false)

  async function applyStage(resolvedStage) {
    if (!resolvedStage || resolvedStage === lead.current_stage || saving) return

    setSaving(true)
    setError(null)
    setSavedAt(null)
    setLossSaved(false)

    const { data: updatedLead, error: leadError } = await supabase
      .from('leads')
      .update({ current_stage: resolvedStage })
      .eq('id', lead.id)
      .select()
      .single()

    if (leadError) {
      setSaving(false)
      setError(leadError.message)
      return
    }

    const { data: historyRow, error: historyError } = await supabase
      .from('stage_history')
      .insert({ lead_id: lead.id, stage: resolvedStage, changed_by: employee?.id ?? null })
      .select('id, stage, changed_at, employees(name)')
      .single()

    setSaving(false)

    if (historyError) {
      setError(`Stage updated, but logging history failed: ${historyError.message}`)
    } else {
      setSavedAt(Date.now())
    }

    onStageChanged(updatedLead, historyError ? null : historyRow)

    if (resolvedStage === 'lost') {
      setLossReason('')
      setLossCompetitor('')
      setLossError(null)
      setLossSaved(false)
      setLossPromptOpen(true)
    } else {
      setLossPromptOpen(false)
    }
  }

  async function handleSaveLossReason() {
    setSavingLoss(true)
    setLossError(null)

    const { error } = await supabase.from('loss_reasons').insert({
      lead_id: lead.id,
      reason: lossReason,
      competitor_name: lossCompetitor.trim() || null,
    })

    setSavingLoss(false)

    if (error) {
      setLossError(error.message)
      return
    }

    setLossPromptOpen(false)
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
            disabled={saving}
            onClick={() => {
              setCustomOpen(false)
              applyStage(stage)
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
            disabled={!customStage.trim() || saving}
            onClick={() => applyStage(customStage.trim())}
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
            This lead is marked <strong>lost</strong> — why?
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
          <button
            type="button"
            className="vip-btn vip-btn-sm"
            onClick={handleSaveLossReason}
            disabled={!lossReason || savingLoss}
          >
            {savingLoss ? 'Saving…' : 'Save reason'}
          </button>
        </div>
      )}
      {lossSaved && <p className="vip-success">Loss reason saved.</p>}
    </div>
  )
}

export default LeadStageSection
