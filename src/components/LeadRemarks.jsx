import { useEffect, useState } from 'react'
import { fetchRemarksForLead, createRemark } from '../lib/leadRemarksQueries'
import { parseTimestamp } from '../lib/dbTime'
import { errorMessage } from '../lib/errorMessage'

// General, lead-wide context log — not Lixil-specific. The Lixil intake
// call-notes box (LeadQuickCapture) just writes the first row here; from
// then on it's an ordinary "+ Add remark" any editing role can use, any
// time, so context a coordinator or exec leaves for the next person doesn't
// only exist inside a one-time notification that gets dismissed.
//
// Reuses the Activity timeline's row shape (.vip-timeline-*) rather than
// inventing new CSS — visually it's the same kind of thing: a dated entry
// with a body and an author.

// A naive TIMESTAMP from this schema needs parseTimestamp, not new Date —
// see src/lib/dbTime.js.
function formatWhen(value) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function LeadRemarks({ leadId, employeeId, canAdd }) {
  const [remarks, setRemarks] = useState(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    fetchRemarksForLead(leadId).then(({ data }) => {
      if (active) setRemarks(data ?? [])
    })
    return () => {
      active = false
    }
  }, [leadId])

  async function handleSave() {
    const body = draft.trim()
    if (!body) return
    setSaving(true)
    setError(null)
    const { data, error: saveError } = await createRemark({ leadId, employeeId, body })
    setSaving(false)
    if (saveError) {
      setError(errorMessage(saveError))
      return
    }
    setRemarks((prev) => [data, ...(prev ?? [])])
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <h2 className="vip-card-title">Remarks</h2>
        {canAdd && !adding && (
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={() => setAdding(true)}>
            + Add remark
          </button>
        )}
      </div>

      {adding && (
        <div className="vip-stack-s">
          <textarea
            className="vip-textarea"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Called, very interested in casement windows, budget ~4L, call back after 6pm"
            autoFocus
          />
          {error && (
            <p className="vip-error" role="alert">
              {error}
            </p>
          )}
          <div className="vip-btn-row">
            <button type="button" className="vip-btn vip-btn-sm" onClick={handleSave} disabled={saving || !draft.trim()}>
              {saving ? 'Saving…' : 'Save remark'}
            </button>
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              onClick={() => {
                setAdding(false)
                setDraft('')
                setError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {remarks === null ? (
        <p className="vip-empty">Loading…</p>
      ) : remarks.length === 0 ? (
        <p className="vip-empty">No remarks yet.</p>
      ) : (
        remarks.map((r) => (
          <div key={r.id} className="vip-timeline-item">
            <div className="vip-timeline-when">{formatWhen(r.created_at)}</div>
            <div className="vip-timeline-main">
              <div className="vip-timeline-detail">{r.body}</div>
              <div className="vip-timeline-by">{r.employees?.name ?? 'Someone'}</div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default LeadRemarks
