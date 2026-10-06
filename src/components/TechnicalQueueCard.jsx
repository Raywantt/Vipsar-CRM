import { useLayoutEffect, useMemo, useState } from 'react'
import { useCachedQuery } from '../hooks/useCachedQuery'
import RfqQueueRow from './RfqQueueRow'
import RfqReviewActions from './RfqReviewActions'
import { fetchTechnicalQueue } from '../lib/rfqQueries'
import { otherRevisionsWaiting, revisionLabel, rfqLeadName, sortRfqsOldestFirst } from '../lib/rfqDesk'
import { errorMessage } from '../lib/errorMessage'

// The Production Executive's review queue (RFQ-DESK.md Step 4) — every RFQ
// waiting at the technical check, oldest first, each with Approve / Send back.
//
// Owner's rulings (2026-10-06): one column at every width, the same rows on a
// phone and a desktop (like the BDM pool card); the waiting age turns amber at
// 1 working day and red at 2, Sundays not counted (rfqWaitLevel in
// rfqDesk.js, Q7); Approve is two taps (RfqReviewActions). Each row is the
// shared RfqQueueRow (estimation's lists render the same one).
//
// Never hidden when empty, unlike the BDM pool: this is the desk's whole
// screen, and "nothing waiting" is the answer to the question it opens with.
function TechnicalQueueCard({ viewer }) {
  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [flash, setFlash] = useState(null)

  // Remembered on the device like the rest of Today, and seeded into state
  // because each decision takes its row out at once. A LAYOUT effect, so a
  // remembered queue is in the first paint (CLAUDE.md, Instant open). Every
  // refresh re-seeds: a decision made elsewhere (the owner covering, a
  // withdrawal) drops the row here too. Rows are keyed by RFQ id, so a note
  // half-typed on one row survives another row's refresh.
  const query = useCachedQuery(['desk', 'technical-queue'], fetchTechnicalQueue)
  useLayoutEffect(() => {
    const res = query.result
    if (!res) return
    if (res.error) {
      setLoadError(errorMessage(res.error))
      return
    }
    setLoadError(null)
    setRows(res.data ?? [])
  }, [query.result])

  const sorted = useMemo(() => sortRfqsOldestFirst(rows ?? []), [rows])
  const siblings = useMemo(() => otherRevisionsWaiting(sorted), [sorted])

  function remove(rfqId, message) {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== rfqId))
    setFlash(message)
  }

  return (
    <section className="vip-card" aria-labelledby="vip-techq-title">
      <div className="vip-card-head">
        <h2 id="vip-techq-title" className="vip-card-title">
          Waiting for your technical check
        </h2>
        {rows != null && <span className="vip-rfq-count">{rows.length}</span>}
      </div>

      {flash && (
        <p className="vip-success" role="status" aria-live="polite">
          {flash}
        </p>
      )}

      {loadError && rows == null ? (
        <p className="vip-error" role="alert">
          Couldn't load the queue: {loadError}
        </p>
      ) : rows == null ? (
        <p className="vip-empty">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="vip-empty">Nothing waiting. A new RFQ appears here as soon as someone logs it.</p>
      ) : (
        <div className="vip-rfq-rows">
          {sorted.map((rfq) => (
            <RfqQueueRow key={rfq.id} rfq={rfq} others={siblings.get(rfq.id) ?? []}>
              <RfqReviewActions
                rfq={rfq}
                viewer={viewer}
                onDone={(action, updated) => {
                  const name = rfqLeadName(rfq)
                  remove(
                    rfq.id,
                    action === 'approved'
                      ? `Approved — ${name} (${revisionLabel(updated)}) is with estimation.`
                      : `Sent back — ${name} (${revisionLabel(updated)}) is with ${rfq.raised_by?.name ?? 'the exec'}.`
                  )
                }}
                onMovedOn={(message) => remove(rfq.id, `${rfqLeadName(rfq)}: ${message}`)}
              />
            </RfqQueueRow>
          ))}
        </div>
      )}
    </section>
  )
}

export default TechnicalQueueCard
