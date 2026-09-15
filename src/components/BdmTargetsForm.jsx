import { useEffect, useState } from 'react'
import { BDM_METRIC_OPTIONS } from '../lib/targetMetrics'
import { periodForPreset, periodRangeLabel } from '../lib/targetPeriods'
import { fetchTargetsForPeriod, insertTarget } from '../lib/targetQueries'
import { targetInputsFrom, targetWrites } from '../lib/architectNetwork'
import { errorMessage } from '../lib/errorMessage'
import NumPadInput from './NumPadInput'
import PeriodPicker from './PeriodPicker'

// "+ Set targets" on a BDM's Architect Network card (BDM.md Step 6) — the only
// place in the app a business development manager's targets are set. Owner's
// ruling: all three at once, for one week / month / quarter, one Save.
//
// Same period rules as the exec SetTargetForm, for the same reasons: it opens
// on the period the page is SHOWING (seeded, not controlled — see there), it
// names the period it saved for, and says so when that isn't the one on
// screen. The boxes prefill from what's already on file for the period the
// picker points at, so the form doubles as "Already set for {period}"; a blank
// box leaves that target alone (there is no delete here), and a box whose
// number hasn't changed isn't written.
function BdmTargetsForm({ bdm, displayPeriod = null, onSaved, onCancel }) {
  const [period, setPeriod] = useState(() => displayPeriod ?? periodForPreset('month'))
  const [onFile, setOnFile] = useState(null)
  const [inputs, setInputs] = useState(() => targetInputsFrom([], bdm.id))
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)

  // Debounced like SetTargetForm's own "Already set" read, so stepping several
  // periods fires one request. Re-seeds the boxes from what that period holds.
  useEffect(() => {
    let active = true
    setOnFile(null)
    const t = setTimeout(() => {
      fetchTargetsForPeriod(period).then(({ data, error: fetchError }) => {
        if (!active) return
        const rows = fetchError ? [] : (data ?? []).filter((r) => r.employee_id === bdm.id)
        setOnFile(rows)
        setInputs(targetInputsFrom(rows, bdm.id))
        if (fetchError) setError(errorMessage(fetchError))
      })
    }, 250)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [period.periodType, period.periodValue, bdm.id, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const rangeLabel = periodRangeLabel(period.periodType, period.periodValue)
  const { writes, invalid } = targetWrites(inputs, onFile ?? [], bdm.id)
  const setCount = onFile ? onFile.length : 0
  const canSave = onFile != null && writes.length > 0 && invalid.length === 0 && !saving

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(null)
    const results = await Promise.all(
      writes.map((w) => insertTarget({ employeeId: bdm.id, periodType: period.periodType, periodValue: period.periodValue, ...w }))
    )
    setSaving(false)
    const failed = results.find((r) => r.error)
    // Some boxes may have saved before one failed: re-read either way, so the
    // boxes show what is really on file rather than what was typed.
    setReloadKey((k) => k + 1)
    if (failed) {
      setError(errorMessage(failed.error))
    } else {
      setSaved({ ...period, rangeLabel })
    }
    onSaved?.()
  }

  const offScreenNote =
    saved &&
    displayPeriod &&
    (saved.periodType !== displayPeriod.periodType || saved.periodValue !== displayPeriod.periodValue)
      ? ` The card is showing ${periodRangeLabel(displayPeriod.periodType, displayPeriod.periodValue)}, so it won't appear there.`
      : null

  return (
    <div className="vip-section-split vip-stack-s">
      <div className="vip-net-form-title">Set targets for {bdm.name}</div>

      <PeriodPicker periodType={period.periodType} periodValue={period.periodValue} onChange={setPeriod} />

      <div className="vip-field-hint">
        {onFile == null
          ? 'Checking what is already set…'
          : setCount === 0
            ? `Nothing set for ${rangeLabel} yet.`
            : `${setCount} of ${BDM_METRIC_OPTIONS.length} already set for ${rangeLabel} — shown below. Leave a box empty to skip it.`}
      </div>

      <div className="vip-net-target-inputs">
        {BDM_METRIC_OPTIONS.map((m) => (
          <label key={m.value} className="vip-field">
            {m.label}
            <NumPadInput
              variant="integer"
              label={m.label}
              type="number"
              min="0"
              step="1"
              value={inputs[m.value] ?? ''}
              disabled={onFile == null}
              onChange={(e) => setInputs((prev) => ({ ...prev, [m.value]: e.target.value }))}
            />
          </label>
        ))}
      </div>

      {invalid.length > 0 && (
        <p className="vip-error" role="alert">
          Targets are whole numbers — check{' '}
          {invalid.map((v) => BDM_METRIC_OPTIONS.find((m) => m.value === v)?.label).join(', ')}.
        </p>
      )}
      {error && (
        <p className="vip-error" role="alert">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="vip-success" role="status" aria-live="polite">
          Saved for {saved.rangeLabel}.{offScreenNote}
        </p>
      )}

      <div className="vip-btn-row">
        <button type="button" className="vip-btn vip-btn-dark vip-btn-sm" onClick={handleSave} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save targets'}
        </button>
        {onCancel && (
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={onCancel} disabled={saving}>
            Close
          </button>
        )}
      </div>
    </div>
  )
}

export default BdmTargetsForm
