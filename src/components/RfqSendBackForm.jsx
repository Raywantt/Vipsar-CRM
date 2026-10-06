import { useState } from 'react'
import { RFQ_NOTE_MAX } from '../lib/rfqDesk'

// Send an RFQ back to the exec, with an optional note (RFQ-DESK.md §3 — no
// reason list in v1). The ONE form both desk steps use: the technical check
// (RfqReviewActions) and estimation (RfqEstimationActions). The caller does
// the write — onSubmit(note) — and owns `busy`.
function RfqSendBackForm({ rfq, busy, onSubmit, onCancel }) {
  const [note, setNote] = useState('')
  const execName = rfq.raised_by?.name ?? null
  const loggedBy =
    rfq.logged_by_employee_id != null && rfq.logged_by_employee_id !== rfq.raised_by_employee_id ? rfq.logged_by?.name : null
  // Sent back from estimation, it re-enters at the technical check like any
  // revision — and the Production Executive who approved it is told.
  const fromEstimation = rfq.status === 'with_estimation'

  return (
    <div className="vip-rfq-sendback-form">
      <label className="vip-field">
        Note for {execName ?? 'the exec'} (optional)
        <textarea
          className="vip-textarea"
          rows={3}
          maxLength={RFQ_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What needs fixing — e.g. sill height is over Lixil's limit"
          disabled={busy}
        />
      </label>
      <p className="vip-rfq-facts">
        {execName ?? 'The exec'}
        {loggedBy ? ` (and ${loggedBy}, who logged it)` : ''} is told, with your note
        {fromEstimation && rfq.approver?.name ? `, and so is ${rfq.approver.name}, who approved it` : ''}. A corrected
        revision comes back to the technical check.
      </p>
      <div className="vip-btn-row vip-rfq-review-row">
        <button type="button" className="vip-btn vip-btn-sm vip-rfq-action" disabled={busy} onClick={() => onSubmit(note)}>
          {busy ? 'Sending…' : 'Send back'}
        </button>
        <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm vip-rfq-action" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default RfqSendBackForm
