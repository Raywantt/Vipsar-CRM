import { Link } from 'react-router-dom'
import { revisionLabel, rfqLeadName, rfqProductsLabel, rfqStepSince, rfqWaitLabel, rfqWaitLevel } from '../lib/rfqDesk'
import { useProductMap } from '../hooks/useProductMap'
import { territoryLabel } from '../lib/territoryOptions'
import { stageChipClass } from '../lib/statusColors'
import { stageLabel } from '../lib/leadStageOptions'
import { parseTimestamp } from '../lib/dbTime'

// One RFQ in a desk queue — the technical check's (TechnicalQueueCard) and
// estimation's two lists (EstimationQueues) render the same row, so a fact
// shown in one can't be missing from the other. The actions are the caller's
// `children` (RfqReviewActions / RfqEstimationActions); `note` is an optional
// line about where the RFQ came from ("Approved by Harjot · 10:40 am").
//
// What a row says, and why (RFQ-DESK.md §3 Step 4 rulings): the lead, how long
// it has waited at THIS step (amber / red per RFQ_WAIT_LIMITS, working days),
// its revision, the exec and the office (the old sheets were split LDH / JLD),
// who logged it if not the exec, windows + segments, the lead's stage only
// when it is Won / Lost / On hold (the RFQ stays in the queue — Step 1
// ruling — and the desk decides), and the other revisions of the same lead
// waiting in the same list.

const FLAGGED_STAGES = new Set(['won', 'lost', 'on_hold'])

// "Sat 4 Oct, 6:10 pm" — the exact time behind the waiting age, on hover.
function sinceTitle(value) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return undefined
  return `Since ${d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
}

function RfqQueueRow({ rfq, others = [], note, children }) {
  const productMap = useProductMap()
  const level = rfqWaitLevel(rfq)
  const age = rfqWaitLabel(rfq)
  const stage = rfq.leads?.current_stage
  const loggedBy =
    rfq.logged_by_employee_id != null && rfq.logged_by_employee_id !== rfq.raised_by_employee_id ? rfq.logged_by?.name : null
  const who = [rfq.raised_by?.name ?? null, rfq.leads?.office_territory ? territoryLabel(rfq.leads.office_territory) : null]
    .filter(Boolean)
    .join(' · ')
  const scope = [
    rfq.window_count ? `${rfq.window_count} ${rfq.window_count === 1 ? 'window' : 'windows'}` : null,
    rfqProductsLabel(rfq, productMap),
  ].filter(Boolean)

  return (
    <div className="vip-rfq-row vip-rfq-qrow">
      <div className="vip-rfq-qrow-head">
        <Link to={`/leads/${rfq.lead_id}`} className="vip-rfq-qrow-lead">
          {rfqLeadName(rfq)}
        </Link>
        {age && (
          <span className={`vip-rfq-wait vip-rfq-wait-${level ?? 'ok'}`} title={sinceTitle(rfqStepSince(rfq))}>
            waiting {age}
          </span>
        )}
      </div>
      <div className="vip-rfq-qrow-meta">
        <span className="vip-rfq-rev">{revisionLabel(rfq)}</span>
        {who && <span className="vip-rfq-facts">{who}</span>}
        {FLAGGED_STAGES.has(stage) && <span className={stageChipClass(stage)}>Lead {stageLabel(stage)}</span>}
      </div>
      {loggedBy && rfq.kind !== 'price_revision' && <div className="vip-rfq-facts">Logged by {loggedBy}</div>}
      <div className="vip-rfq-facts">{scope.length ? scope.join(' · ') : 'No window count or product given'}</div>
      {note && <div className="vip-rfq-facts">{note}</div>}
      {others.length > 0 && (
        <div className="vip-rfq-also">Also waiting for this lead: {others.map(revisionLabel).join(', ')}</div>
      )}
      {children}
    </div>
  )
}

export default RfqQueueRow
