import { useLayoutEffect, useMemo, useState } from 'react'
import { useCachedQuery } from '../hooks/useCachedQuery'
import RfqQueueRow from './RfqQueueRow'
import RfqEstimationActions from './RfqEstimationActions'
import { fetchEstimationQueue } from '../lib/rfqQueries'
import { RFQ_STATUS, otherRevisionsWaiting, quoteSummary, revisionLabel, rfqLeadName, sortRfqsByWait } from '../lib/rfqDesk'
import { parseTimestamp } from '../lib/dbTime'
import { errorMessage } from '../lib/errorMessage'

// The Estimation Executive's two lists (RFQ-DESK.md Step 5) — "Waiting for
// estimation" (raise it with Lixil, or send it back) above "With Lixil"
// (record the quote when it comes). Owner's ruling, 2026-10-06: two cards in
// one column at every width, the same rows on a phone and a desktop, like the
// technical queue. Ages turn amber / red at 1 / 2 working days for estimation
// and 5 / 7 for Lixil (RFQ_WAIT_LIMITS, Q7).
//
// ONE read and ONE set of rows for both cards: "Raised with Lixil" changes a
// row's status and it moves to the second card on the spot, with no refetch.
// Each list is longest-waiting-at-this-step first (sortRfqsByWait). Neither is
// hidden when empty — this is the desk's whole screen.

// "10:40 am" today, "4 Oct" before — when an RFQ reached estimation.
function shortWhen(value) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return null
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function firstName(embed) {
  return embed?.name?.trim().split(/\s+/)[0] ?? null
}

// Where an RFQ in "Waiting for estimation" came from.
function estimationNote(rfq) {
  if (rfq.kind === 'price_revision') {
    const by = firstName(rfq.logged_by)
    return `Price revision${by ? ` started by ${by}` : ''}${shortWhen(rfq.raised_at) ? ` · ${shortWhen(rfq.raised_at)}` : ''}`
  }
  const by = firstName(rfq.approver)
  return `Approved${by ? ` by ${by}` : ''}${shortWhen(rfq.approved_at) ? ` · ${shortWhen(rfq.approved_at)}` : ''}`
}

function EstimationQueues({ viewer }) {
  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [flash, setFlash] = useState(null) // { card: 'estimation' | 'lixil', text }

  // Seeded into state in a LAYOUT effect (a remembered list is in the first
  // paint) and re-seeded on every refresh, as TechnicalQueueCard does — rows
  // are keyed by RFQ id, so a half-typed quote survives another row's refresh.
  const query = useCachedQuery(['desk', 'estimation-queue'], fetchEstimationQueue)
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

  const estimation = useMemo(
    () => sortRfqsByWait((rows ?? []).filter((r) => r.status === RFQ_STATUS.WITH_ESTIMATION)),
    [rows]
  )
  const lixil = useMemo(() => sortRfqsByWait((rows ?? []).filter((r) => r.status === RFQ_STATUS.WITH_LIXIL)), [rows])
  const estimationSiblings = useMemo(() => otherRevisionsWaiting(estimation), [estimation])
  const lixilSiblings = useMemo(() => otherRevisionsWaiting(lixil), [lixil])

  function replace(updated) {
    setRows((prev) => (prev ?? []).map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
  }
  function remove(rfqId) {
    setRows((prev) => (prev ?? []).filter((r) => r.id !== rfqId))
  }

  function handleDone(rfq, card) {
    return (action, updated) => {
      const name = `${rfqLeadName(rfq)} (${revisionLabel(rfq)})`
      const exec = rfq.raised_by?.name ?? 'the exec'
      if (action === 'raised_with_lixil') {
        replace(updated)
        setFlash({ card, text: `Raised with Lixil — ${name} is now in With Lixil.` })
      } else if (action === 'quoted') {
        remove(rfq.id)
        setFlash({ card, text: `Quote saved — ${name}: ${quoteSummary(updated) ?? 'recorded'}. ${exec} has been told.` })
      } else if (action === 'sent_back') {
        remove(rfq.id)
        setFlash({ card, text: `Sent back — ${name} is with ${exec}.` })
      } else if (action === 'withdrawn') {
        remove(rfq.id)
        setFlash({ card, text: `Withdrawn — ${name}. The earlier quote still stands.` })
      }
    }
  }

  function handleMovedOn(rfq, card) {
    return (message) => {
      remove(rfq.id)
      setFlash({ card, text: `${rfqLeadName(rfq)}: ${message}` })
    }
  }

  function body(list, siblings, card, emptyText) {
    if (loadError && rows == null) {
      return (
        <p className="vip-error" role="alert">
          Couldn't load your lists: {loadError}
        </p>
      )
    }
    if (rows == null) return <p className="vip-empty">Loading…</p>
    if (list.length === 0) return <p className="vip-empty">{emptyText}</p>
    return (
      <div className="vip-rfq-rows">
        {list.map((rfq) => (
          <RfqQueueRow
            key={rfq.id}
            rfq={rfq}
            others={siblings.get(rfq.id) ?? []}
            note={card === 'estimation' ? estimationNote(rfq) : null}
          >
            <RfqEstimationActions
              rfq={rfq}
              viewer={viewer}
              onDone={handleDone(rfq, card)}
              onMovedOn={handleMovedOn(rfq, card)}
            />
          </RfqQueueRow>
        ))}
      </div>
    )
  }

  function flashFor(card) {
    return flash?.card === card ? (
      <p className="vip-success" role="status" aria-live="polite">
        {flash.text}
      </p>
    ) : null
  }

  return (
    <>
      <section className="vip-card" aria-labelledby="vip-estq-title">
        <div className="vip-card-head">
          <h2 id="vip-estq-title" className="vip-card-title">
            Waiting for estimation
          </h2>
          {rows != null && <span className="vip-rfq-count">{estimation.length}</span>}
        </div>
        {flashFor('estimation')}
        {body(estimation, estimationSiblings, 'estimation', 'Nothing waiting. An RFQ appears here once the technical check approves it.')}
      </section>

      <section className="vip-card" aria-labelledby="vip-lixq-title">
        <div className="vip-card-head">
          <h2 id="vip-lixq-title" className="vip-card-title">
            With Lixil
          </h2>
          {rows != null && <span className="vip-rfq-count">{lixil.length}</span>}
        </div>
        {flashFor('lixil')}
        {body(lixil, lixilSiblings, 'lixil', 'Nothing with Lixil right now.')}
      </section>
    </>
  )
}

export default EstimationQueues
