import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import './SearchOrCreate.css'

const LOSS_REASON_OPTIONS = ['price', 'competitor', 'timeline', 'budget_cut', 'site_delay', 'other']

function LeadStageSection({ lead, stageHistory, onStageChanged }) {
  const { employee } = useAuth()

  const [selectedStage, setSelectedStage] = useState(
    lead.current_stage && LEAD_STAGE_OPTIONS.includes(lead.current_stage)
      ? lead.current_stage
      : lead.current_stage
        ? 'other'
        : ''
  )
  const [customStage, setCustomStage] = useState(
    lead.current_stage && !LEAD_STAGE_OPTIONS.includes(lead.current_stage) ? lead.current_stage : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const [lossPromptOpen, setLossPromptOpen] = useState(false)
  const [lossReason, setLossReason] = useState('')
  const [lossCompetitor, setLossCompetitor] = useState('')
  const [savingLoss, setSavingLoss] = useState(false)
  const [lossError, setLossError] = useState(null)
  const [lossSaved, setLossSaved] = useState(false)

  const resolvedStage = selectedStage === 'other' ? customStage.trim() : selectedStage
  const canUpdate = Boolean(resolvedStage) && resolvedStage !== lead.current_stage && !saving

  async function handleUpdateStage() {
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
    <section className="lead-section">
      <h2>Stage</h2>

      <label className="search-or-create-field">
        Current stage
        <select value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)}>
          <option value="">— Select stage —</option>
          {LEAD_STAGE_OPTIONS.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
          <option value="other">Other…</option>
        </select>
      </label>
      {selectedStage === 'other' && (
        <label className="search-or-create-field">
          Describe stage
          <input value={customStage} onChange={(e) => setCustomStage(e.target.value)} />
        </label>
      )}

      {error && <p className="search-or-create-error">{error}</p>}
      {savedAt && !error && <p className="lead-section-success">Stage updated.</p>}

      <button type="button" onClick={handleUpdateStage} disabled={!canUpdate}>
        {saving ? 'Updating…' : 'Update stage'}
      </button>

      {lossPromptOpen && (
        <div className="lead-section-suggestion">
          <p>
            This lead is marked <strong>lost</strong> — why?
          </p>
          <label className="search-or-create-field">
            Reason
            <select value={lossReason} onChange={(e) => setLossReason(e.target.value)}>
              <option value="">— Select reason —</option>
              {LOSS_REASON_OPTIONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          <label className="search-or-create-field">
            Competitor name (optional)
            <input value={lossCompetitor} onChange={(e) => setLossCompetitor(e.target.value)} />
          </label>
          {lossError && <p className="search-or-create-error">{lossError}</p>}
          <div className="search-or-create-actions">
            <button type="button" onClick={handleSaveLossReason} disabled={!lossReason || savingLoss}>
              {savingLoss ? 'Saving…' : 'Save reason'}
            </button>
          </div>
        </div>
      )}
      {lossSaved && <p className="lead-section-success">Loss reason saved.</p>}

      {stageHistory.length > 0 && (
        <div>
          <p className="lead-section-subhead">History</p>
          <ul className="lead-detail-contacts">
            {stageHistory.map((h) => (
              <li key={h.id}>
                {h.stage} — {h.employees?.name ?? 'Unknown'} — {new Date(h.changed_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default LeadStageSection
