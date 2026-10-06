import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  RFQ_SEGMENT_OPTIONS,
  segmentsLabel,
  revisionLabel,
  rfqStepSince,
  daysAgoLabel,
  rfqHeadline,
  quoteSummary,
  sortRfqsNewestFirst,
  canWithdrawRfq,
  latestDeskQuote,
  isDeskLive,
  isRfqOpen,
  sortRfqsOldestFirst,
  workingDaysWaited,
  rfqWaitLevel,
  rfqWaitLabel,
  durationLabel,
  otherRevisionsWaiting,
  technicalMonthStats,
  monthStart,
  isRfqMovedOnError,
  RFQ_NOTE_MAX,
  sortRfqsByWait,
  estimationMonthStats,
  canStartPriceRevision,
  quoteProblem,
  rfqRaisedDay,
  rfqLeadName,
  latestDeskRfqByLead,
  quoteSentToClient,
  rfqBackWithExec,
  loggedWhileDeskLive,
} from './rfqDesk'

const SQL = readFileSync(resolve(process.cwd(), 'Schema/migration_rfq_desk.sql'), 'utf8')

// Every ARRAY['…'] literal the migration checks segments against.
function sqlSegmentArrays() {
  return [...SQL.matchAll(/segments\s*<@\s*ARRAY\[([^\]]+)\]/g)].map((m) =>
    m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
  )
}

describe('product segments are one closed list on both sides', () => {
  it('finds the CHECK in the migration (activities and rfqs)', () => {
    expect(sqlSegmentArrays().length).toBeGreaterThanOrEqual(2)
  })

  it('offers exactly the values every CHECK allows, no more and no fewer', () => {
    const js = RFQ_SEGMENT_OPTIONS.map((o) => o.value).sort()
    for (const arr of sqlSegmentArrays()) expect([...arr].sort()).toEqual(js)
  })

  it('labels a combination in list order, joined the way the sheets write it', () => {
    expect(segmentsLabel(['in16', 'windows'])).toBe('Windows + IN16')
    expect(segmentsLabel([])).toBeNull()
  })
})

describe('revisionLabel', () => {
  it('calls the first RFQ Fresh and the rest R1, R2…', () => {
    expect(revisionLabel({ kind: 'fresh', revision: 0 })).toBe('Fresh')
    expect(revisionLabel({ kind: 'revised', revision: 2 })).toBe('R2')
  })

  it('names a price revision and the number it re-quotes', () => {
    expect(revisionLabel({ kind: 'price_revision', revision: 1 })).toBe('R1 price revision')
    expect(revisionLabel({ kind: 'price_revision', revision: 0 })).toBe('Price revision')
  })
})

describe('rfqStepSince', () => {
  const base = {
    raised_at: '2026-10-01T05:00:00+00:00',
    approved_at: '2026-10-02T05:00:00+00:00',
    lixil_raised_at: '2026-10-03T05:00:00+00:00',
    quote_received_at: '2026-10-04T05:00:00+00:00',
  }
  it('reads the start of the step the RFQ is on now', () => {
    expect(rfqStepSince({ ...base, status: 'with_technical' })).toBe(base.raised_at)
    expect(rfqStepSince({ ...base, status: 'with_estimation' })).toBe(base.approved_at)
    expect(rfqStepSince({ ...base, status: 'with_lixil' })).toBe(base.lixil_raised_at)
    expect(rfqStepSince({ ...base, status: 'quoted' })).toBe(base.quote_received_at)
  })

  it('lets a price revision (no approval) fall back to when it was raised', () => {
    expect(rfqStepSince({ raised_at: base.raised_at, approved_at: null, status: 'with_estimation' })).toBe(base.raised_at)
  })
})

describe('daysAgoLabel / rfqHeadline', () => {
  const now = new Date(2026, 9, 6, 10, 0) // 6 Oct 2026, 10:00 local

  it('counts calendar days, not 24-hour blocks', () => {
    expect(daysAgoLabel(new Date(2026, 9, 6, 9, 0), now)).toBe('today')
    expect(daysAgoLabel(new Date(2026, 9, 5, 18, 0), now)).toBe('1 day')
    expect(daysAgoLabel(new Date(2026, 9, 2, 12, 0), now)).toBe('4 days')
    expect(daysAgoLabel(null, now)).toBeNull()
  })

  it('reads a waiting step as its age and a finished one as "ago"', () => {
    expect(rfqHeadline({ kind: 'revised', revision: 1, status: 'with_technical', raised_at: new Date(2026, 9, 4, 9) }, now)).toBe(
      'R1 · Technical check · 2 days'
    )
    expect(rfqHeadline({ kind: 'fresh', revision: 0, status: 'quoted', quote_received_at: new Date(2026, 9, 3, 9) }, now)).toBe(
      'Fresh · Quote in · 3 days ago'
    )
    expect(rfqHeadline({ kind: 'fresh', revision: 0, status: 'sent_back', sent_back_at: new Date(2026, 9, 6, 9) }, now)).toBe(
      'Fresh · Sent back · today'
    )
  })
})

describe('quoteSummary', () => {
  it('gives value, Lixil reference and quote date for a quoted RFQ only', () => {
    expect(quoteSummary({ status: 'quoted', quote_value: 420000, quote_ref: 'R26-118', quote_date: '2026-10-03' })).toBe(
      '₹4,20,000 · R26-118 · 3 Oct'
    )
    expect(quoteSummary({ status: 'with_lixil', quote_value: null })).toBeNull()
  })
})

describe('sortRfqsNewestFirst', () => {
  it('orders by raised_at, then id, newest first, without touching the input', () => {
    const input = [
      { id: 1, raised_at: '2026-10-01T05:00:00+00:00' },
      { id: 3, raised_at: '2026-10-02T05:00:00+00:00' },
      { id: 2, raised_at: '2026-10-02T05:00:00+00:00' },
    ]
    expect(sortRfqsNewestFirst(input).map((r) => r.id)).toEqual([3, 2, 1])
    expect(input.map((r) => r.id)).toEqual([1, 3, 2])
  })
})

// Mirrors rfq_withdraw() in migration_rfq_desk.sql STEP 8.
describe('canWithdrawRfq', () => {
  const rfq = { status: 'with_technical', raised_by_employee_id: 26, logged_by_employee_id: 25 }

  it('lets the credited exec, whoever logged it, and the owner withdraw', () => {
    expect(canWithdrawRfq(rfq, { id: 26, role: 'sales_executive' })).toBe(true)
    expect(canWithdrawRfq(rfq, { id: 25, role: 'sales_coordinator' })).toBe(true)
    expect(canWithdrawRfq(rfq, { id: 3, role: 'owner' })).toBe(true)
  })

  it('refuses anyone else, including the desk', () => {
    expect(canWithdrawRfq(rfq, { id: 43, role: 'sales_manager' })).toBe(false)
    expect(canWithdrawRfq(rfq, { id: 48, role: 'production_executive' })).toBe(false)
  })

  it('works only while the RFQ is with the technical check or estimation', () => {
    const owner = { id: 3, role: 'owner' }
    expect(canWithdrawRfq({ ...rfq, status: 'with_estimation' }, owner)).toBe(true)
    for (const status of ['with_lixil', 'quoted', 'sent_back', 'withdrawn']) {
      expect(canWithdrawRfq({ ...rfq, status }, owner)).toBe(false)
    }
  })

  it('never matches on a missing id (the NULL trap the SQL COALESCEs away)', () => {
    expect(canWithdrawRfq({ status: 'with_technical', raised_by_employee_id: null, logged_by_employee_id: null }, { id: null, role: 'sales_executive' })).toBe(false)
  })
})

describe('latestDeskQuote', () => {
  it('picks the most recently received quote and ignores everything unquoted', () => {
    const rfqs = [
      { id: 1, status: 'quoted', quote_received_at: '2026-10-01T05:00:00+00:00' },
      { id: 2, status: 'quoted', quote_received_at: '2026-10-04T05:00:00+00:00' },
      { id: 3, status: 'with_lixil', quote_received_at: null },
    ]
    expect(latestDeskQuote(rfqs).id).toBe(2)
    expect(latestDeskQuote([{ id: 3, status: 'sent_back' }])).toBeNull()
    expect(latestDeskQuote(null)).toBeNull()
  })
})

describe('isDeskLive / isRfqOpen', () => {
  const now = new Date('2026-10-06T10:00:00Z')
  it('is on only once live_from is set and has arrived', () => {
    expect(isDeskLive({ live_from: null }, now)).toBe(false)
    expect(isDeskLive(null, now)).toBe(false)
    expect(isDeskLive({ live_from: '2026-10-06T03:56:49+00:00' }, now)).toBe(true)
    expect(isDeskLive({ live_from: '2026-10-07T00:00:00+00:00' }, now)).toBe(false)
  })

  it('treats the three waiting steps as open', () => {
    expect(['with_technical', 'with_estimation', 'with_lixil'].every((status) => isRfqOpen({ status }))).toBe(true)
    expect(['quoted', 'sent_back', 'withdrawn'].some((status) => isRfqOpen({ status }))).toBe(false)
  })
})

// ---- Step 4: the technical check's queue ----

describe('sortRfqsOldestFirst', () => {
  it('is the exact reverse of newest-first, ties by id', () => {
    const input = [
      { id: 3, raised_at: '2026-10-02T05:00:00+00:00' },
      { id: 1, raised_at: '2026-10-01T05:00:00+00:00' },
      { id: 2, raised_at: '2026-10-02T05:00:00+00:00' },
    ]
    expect(sortRfqsOldestFirst(input).map((r) => r.id)).toEqual([1, 2, 3])
  })
})

// 2026-10-03 is a Saturday, 10-04 a Sunday, 10-05 a Monday.
describe('workingDaysWaited (Sundays do not count — owner, Q7)', () => {
  const mondayMorning = new Date(2026, 9, 5, 10, 0)

  it('is 0 on the day it arrived, however many hours ago', () => {
    expect(workingDaysWaited(new Date(2026, 9, 5, 0, 5), mondayMorning)).toBe(0)
  })

  it('reads a Saturday-evening RFQ as 1 working day on Monday morning, not 2', () => {
    expect(workingDaysWaited(new Date(2026, 9, 3, 18, 0), mondayMorning)).toBe(1)
  })

  it('reads a Friday RFQ as 2 working days on Monday', () => {
    expect(workingDaysWaited(new Date(2026, 9, 2, 15, 0), mondayMorning)).toBe(2)
  })

  it('reads one raised on a Sunday as 1 on Monday', () => {
    expect(workingDaysWaited(new Date(2026, 9, 4, 11, 0), mondayMorning)).toBe(1)
  })

  it('counts a whole week as six', () => {
    expect(workingDaysWaited(new Date(2026, 8, 28, 9, 0), mondayMorning)).toBe(6)
  })

  it('returns null for no date', () => {
    expect(workingDaysWaited(null, mondayMorning)).toBeNull()
  })
})

describe('rfqWaitLevel / rfqWaitLabel at the technical check', () => {
  const now = new Date(2026, 9, 5, 10, 0) // Monday
  const at = (d) => ({ status: 'with_technical', raised_at: d })

  it('is plain under a working day, amber at 1, red at 2', () => {
    expect(rfqWaitLevel(at(new Date(2026, 9, 5, 8, 0)), now)).toBe('ok')
    expect(rfqWaitLevel(at(new Date(2026, 9, 3, 18, 0)), now)).toBe('warn')
    expect(rfqWaitLevel(at(new Date(2026, 9, 2, 18, 0)), now)).toBe('late')
  })

  it('colours no finished step — only the three waiting steps have limits', () => {
    expect(rfqWaitLevel({ status: 'quoted', quote_received_at: new Date(2026, 8, 1) }, now)).toBeNull()
    expect(rfqWaitLevel({ status: 'sent_back', sent_back_at: new Date(2026, 8, 1) }, now)).toBeNull()
    expect(rfqWaitLevel({ status: 'withdrawn', withdrawn_at: new Date(2026, 8, 1) }, now)).toBeNull()
  })

  it('labels in the same unit as its colour once a working day has passed', () => {
    expect(rfqWaitLabel(at(new Date(2026, 9, 5, 7, 30)), now)).toBe('2h')
    expect(rfqWaitLabel(at(new Date(2026, 9, 5, 9, 45)), now)).toBe('15m')
    expect(rfqWaitLabel(at(new Date(2026, 9, 3, 18, 0)), now)).toBe('1 working day')
    expect(rfqWaitLabel(at(new Date(2026, 9, 1, 18, 0)), now)).toBe('3 working days')
  })
})

describe('durationLabel', () => {
  it('reads minutes, then hours up to two days, then days', () => {
    expect(durationLabel(20000)).toBe('<1m')
    expect(durationLabel(45 * 60000)).toBe('45m')
    expect(durationLabel(5 * 3600000)).toBe('5h')
    expect(durationLabel(47 * 3600000)).toBe('47h')
    expect(durationLabel(72 * 3600000)).toBe('3d')
    expect(durationLabel(null)).toBeNull()
  })
})

describe('otherRevisionsWaiting', () => {
  it('names, for each RFQ, the other ones of the same lead in the queue', () => {
    const queue = [
      { id: 1, lead_id: 10, revision: 1 },
      { id: 2, lead_id: 10, revision: 2 },
      { id: 3, lead_id: 11, revision: 0 },
    ]
    const map = otherRevisionsWaiting(queue)
    expect(map.get(1).map((r) => r.id)).toEqual([2])
    expect(map.get(2).map((r) => r.id)).toEqual([1])
    expect(map.has(3)).toBe(false)
  })
})

describe('technicalMonthStats', () => {
  const me = 48
  const since = new Date('2026-10-01T00:00:00+05:30')
  const rows = [
    // approved this month, 2h after it was raised
    { id: 1, raised_at: '2026-10-02T04:00:00+00:00', approved_by: me, approved_at: '2026-10-02T06:00:00+00:00' },
    // approved this month, later bounced at estimation this month: counts as both
    {
      id: 2,
      raised_at: '2026-10-03T04:00:00+00:00',
      approved_by: me,
      approved_at: '2026-10-03T08:00:00+00:00',
      sent_back_by: 49,
      sent_back_from: 'estimation',
      sent_back_at: '2026-10-04T04:00:00+00:00',
    },
    // sent back by me from the technical check, 1h after raised
    { id: 3, raised_at: '2026-10-05T04:00:00+00:00', sent_back_by: me, sent_back_from: 'technical', sent_back_at: '2026-10-05T05:00:00+00:00' },
    // approved LAST month, bounced this month: a bounce, not this month's approval
    {
      id: 4,
      raised_at: '2026-09-29T04:00:00+00:00',
      approved_by: me,
      approved_at: '2026-09-29T06:00:00+00:00',
      sent_back_by: 49,
      sent_back_from: 'estimation',
      sent_back_at: '2026-10-01T06:00:00+00:00',
    },
    // someone else's approval
    { id: 5, raised_at: '2026-10-02T04:00:00+00:00', approved_by: 3, approved_at: '2026-10-02T05:00:00+00:00' },
  ]

  it('counts approvals, send-backs and bounces in the period, for this person only', () => {
    const s = technicalMonthStats(rows, me, since)
    expect(s.approved).toBe(2)
    expect(s.sentBack).toBe(1)
    expect(s.bounced).toBe(2)
  })

  it('takes the median of raised → decision over the decisions in the period', () => {
    // 2h, 4h, 1h → median 2h
    expect(technicalMonthStats(rows, me, since).medianCheckMs).toBe(2 * 3600000)
  })

  it('has no typical time when nothing was decided', () => {
    expect(technicalMonthStats([], me, since)).toEqual({ approved: 0, sentBack: 0, bounced: 0, medianCheckMs: null })
    expect(technicalMonthStats(rows, null, since).approved).toBe(0)
  })
})

describe('monthStart', () => {
  it('is local midnight on the 1st', () => {
    const d = monthStart(new Date(2026, 9, 6, 15, 30))
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 1, 0])
  })
})

describe('isRfqMovedOnError / RFQ_NOTE_MAX', () => {
  it('treats a status mismatch or a vanished RFQ as moved on, and nothing else', () => {
    expect(isRfqMovedOnError({ code: '23514' })).toBe(true)
    expect(isRfqMovedOnError({ code: 'P0002' })).toBe(true)
    expect(isRfqMovedOnError({ code: '42501' })).toBe(false)
    expect(isRfqMovedOnError(null)).toBe(false)
  })

  it('stops the note at the length rfq_send_back refuses beyond', () => {
    expect(SQL).toContain(`char_length(v_note) > ${RFQ_NOTE_MAX} THEN`)
  })
})

// ---- Step 5: estimation and Lixil ----

describe('wait limits for estimation and Lixil (owner, Q7)', () => {
  const now = new Date(2026, 9, 12, 10, 0) // Monday 12 Oct
  it('estimation is amber at 1 working day, red at 2 — from the approval, not the raise', () => {
    const base = { status: 'with_estimation', raised_at: new Date(2026, 8, 1) }
    expect(rfqWaitLevel({ ...base, approved_at: new Date(2026, 9, 12, 8) }, now)).toBe('ok')
    expect(rfqWaitLevel({ ...base, approved_at: new Date(2026, 9, 10, 17) }, now)).toBe('warn') // Sat → Mon
    expect(rfqWaitLevel({ ...base, approved_at: new Date(2026, 9, 9, 17) }, now)).toBe('late') // Fri → Mon
  })

  it('Lixil is amber at 5 working days, red at 7', () => {
    const at = (d) => ({ status: 'with_lixil', lixil_raised_at: d })
    expect(rfqWaitLevel(at(new Date(2026, 9, 8, 12)), now)).toBe('ok') // Thu → Mon: 3
    expect(rfqWaitLevel(at(new Date(2026, 9, 6, 12)), now)).toBe('warn') // Tue → Mon: 5
    expect(rfqWaitLevel(at(new Date(2026, 9, 3, 12)), now)).toBe('late') // Sat → Mon: 7
  })
})

describe('sortRfqsByWait', () => {
  it('orders by when the RFQ reached its current step, not when it was raised', () => {
    const rows = [
      { id: 1, status: 'with_estimation', raised_at: '2026-10-01T05:00:00+00:00', approved_at: '2026-10-06T05:00:00+00:00' },
      { id: 2, status: 'with_estimation', raised_at: '2026-10-05T05:00:00+00:00', approved_at: '2026-10-05T09:00:00+00:00' },
      { id: 3, status: 'with_estimation', kind: 'price_revision', raised_at: '2026-10-04T05:00:00+00:00', approved_at: null },
    ]
    expect(sortRfqsByWait(rows).map((r) => r.id)).toEqual([3, 2, 1])
  })
})

describe('estimationMonthStats', () => {
  const me = 49
  const since = new Date('2026-10-01T00:00:00+05:30')
  const rows = [
    // raised with Lixil and quoted this month: 2 days of Lixil time
    {
      id: 1,
      lixil_raised_by: me,
      lixil_raised_at: '2026-10-02T05:00:00+00:00',
      quote_received_by: me,
      quote_received_at: '2026-10-04T05:00:00+00:00',
    },
    // raised last month, quoted this month: a quote, not a raise
    {
      id: 2,
      lixil_raised_by: me,
      lixil_raised_at: '2026-09-29T05:00:00+00:00',
      quote_received_by: me,
      quote_received_at: '2026-10-03T05:00:00+00:00',
    },
    // sent back from estimation this month
    { id: 3, sent_back_by: me, sent_back_from: 'estimation', sent_back_at: '2026-10-05T05:00:00+00:00' },
    // someone else's raise
    { id: 4, lixil_raised_by: 3, lixil_raised_at: '2026-10-02T05:00:00+00:00' },
  ]

  it('counts raises, quotes and send-backs in the period, for this person only', () => {
    const s = estimationMonthStats(rows, me, since)
    expect([s.raised, s.quoted, s.sentBack]).toEqual([1, 2, 1])
  })

  it('takes the median Lixil time over the quotes recorded in the period', () => {
    // 2 days and 4 days → 3 days
    expect(estimationMonthStats(rows, me, since).medianLixilMs).toBe(3 * 86400000)
  })

  it('has no Lixil time without quotes', () => {
    expect(estimationMonthStats([], me, since)).toEqual({ raised: 0, quoted: 0, sentBack: 0, medianLixilMs: null })
  })
})

// Mirrors rfq_start_price_revision() in migration_rfq_desk.sql STEP 8.
describe('canStartPriceRevision', () => {
  const quoted = { id: 1, status: 'quoted', kind: 'fresh', quote_received_at: '2026-10-04T05:00:00+00:00' }

  it('is for the Estimation Executive and the owner, on a lead with a quote', () => {
    expect(canStartPriceRevision([quoted], 'estimation_executive')).toBe(true)
    expect(canStartPriceRevision([quoted], 'owner')).toBe(true)
    expect(canStartPriceRevision([quoted], 'production_executive')).toBe(false)
    expect(canStartPriceRevision([quoted], 'sales_executive')).toBe(false)
    expect(canStartPriceRevision([{ ...quoted, status: 'with_lixil' }], 'estimation_executive')).toBe(false)
  })

  it('is not offered while a price revision is already open', () => {
    for (const status of ['with_estimation', 'with_lixil']) {
      expect(canStartPriceRevision([quoted, { id: 2, kind: 'price_revision', status }], 'owner')).toBe(false)
    }
    // a finished or withdrawn one doesn't block the next
    expect(canStartPriceRevision([quoted, { id: 2, kind: 'price_revision', status: 'withdrawn' }], 'owner')).toBe(true)
  })

  it('reads the SQL the same way', () => {
    expect(SQL).toContain("kind = 'price_revision'")
    expect(SQL).toMatch(/status IN \('with_estimation', 'with_lixil'\)\) THEN\s+RAISE EXCEPTION 'A price revision is already open/)
  })
})

// Mirrors rfq_record_quote()'s own refusals.
describe('quoteProblem / rfqRaisedDay', () => {
  const rfq = { raised_at: new Date(2026, 9, 3, 18, 0) } // 3 Oct, local
  const today = '2026-10-06'
  const ok = { ref: 'R26-118', value: '420000', date: '2026-10-05' }

  it('accepts a complete quote', () => {
    expect(quoteProblem(ok, rfq, today)).toBeNull()
    expect(quoteProblem({ ...ok, date: today }, rfq, today)).toBeNull()
    expect(quoteProblem({ ...ok, date: '2026-10-03' }, rfq, today)).toBeNull()
  })

  it("asks for Lixil's reference and a value above zero", () => {
    expect(quoteProblem({ ...ok, ref: '  ' }, rfq, today)).toMatch(/reference/)
    expect(quoteProblem({ ...ok, value: '' }, rfq, today)).toMatch(/value/)
    expect(quoteProblem({ ...ok, value: '0' }, rfq, today)).toMatch(/value/)
    expect(quoteProblem({ ...ok, value: '-5' }, rfq, today)).toMatch(/value/)
  })

  it('refuses a future date and one before the RFQ was raised', () => {
    expect(quoteProblem({ ...ok, date: '2026-10-07' }, rfq, today)).toMatch(/future/)
    expect(quoteProblem({ ...ok, date: '2026-10-02' }, rfq, today)).toMatch(/before the RFQ was raised \(2026-10-03\)/)
  })

  it('reads the raised day in local time', () => {
    expect(rfqRaisedDay(rfq)).toBe('2026-10-03')
    expect(rfqRaisedDay({ raised_at: null })).toBeNull()
  })
})

describe('rfqLeadName', () => {
  it("names the lead through leadName.js's chain, else by number", () => {
    expect(rfqLeadName({ lead_id: 7, leads: { id: 7, parties: { name: 'Sharma' }, sites: null } })).toBe('Sharma')
    expect(rfqLeadName({ lead_id: 7, leads: null })).toBe('Lead #7')
  })
})

// ---- Step 6 ----

// A TIMESTAMPTZ string for a LOCAL wall-clock time, so the day tests hold in
// any timezone the suite runs in.
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h, 0).toISOString()

describe('latestDeskRfqByLead (mirrors the RPC latest_desk CTE)', () => {
  it("keeps each lead's newest RFQ by raised_at, then id, skipping withdrawn ones", () => {
    const rows = [
      { id: 1, lead_id: 10, status: 'quoted', raised_at: at(2026, 10, 1) },
      { id: 2, lead_id: 10, status: 'withdrawn', raised_at: at(2026, 10, 5) },
      { id: 3, lead_id: 20, status: 'sent_back', raised_at: at(2026, 10, 2) },
      { id: 4, lead_id: 20, status: 'with_technical', raised_at: at(2026, 10, 2) },
    ]
    const map = latestDeskRfqByLead(rows)
    // A withdrawn price revision leaves the quote before it in charge.
    expect(map.get(10).id).toBe(1)
    // Same raised_at: the higher id wins, as ORDER BY raised_at DESC, id DESC.
    expect(map.get(20).id).toBe(4)
    expect(latestDeskRfqByLead(null).size).toBe(0)
  })

  it('is the same ordering the SQL uses', () => {
    const sql = readFileSync(resolve(process.cwd(), 'Schema/migration_rfq_desk_reporting.sql'), 'utf8')
    expect(sql).toContain("WHERE r.status <> 'withdrawn'")
    expect(sql).toContain('ORDER BY r.lead_id, r.raised_at DESC, r.id DESC')
  })
})

describe('quoteSentToClient', () => {
  const rfq = { status: 'quoted', quote_received_at: at(2026, 10, 6) }

  it('is sent once the lead is marked sent on or after the day the quote came in', () => {
    expect(quoteSentToClient({ quote_sent: true, quote_sent_at: '2026-10-06' }, rfq)).toBe(true)
    expect(quoteSentToClient({ quote_sent: true, quote_sent_at: '2026-10-08' }, rfq)).toBe(true)
  })

  it("an earlier quote's sent date doesn't cover a newer quote", () => {
    expect(quoteSentToClient({ quote_sent: true, quote_sent_at: '2026-10-05' }, rfq)).toBe(false)
  })

  it('not marked sent is not sent', () => {
    expect(quoteSentToClient({ quote_sent: false, quote_sent_at: null }, rfq)).toBe(false)
    expect(quoteSentToClient({ quote_sent: true, quote_sent_at: null }, rfq)).toBe(false)
    expect(quoteSentToClient(null, rfq)).toBe(false)
  })
})

describe('rfqBackWithExec', () => {
  it('a sent-back RFQ is back with the exec, from when it was sent back', () => {
    expect(rfqBackWithExec({ status: 'sent_back', sent_back_at: at(2026, 10, 3) }, {})).toEqual({
      kind: 'sent_back',
      at: at(2026, 10, 3),
    })
  })

  it("a quote is back with the exec until it is sent to the client", () => {
    const rfq = { status: 'quoted', quote_received_at: at(2026, 10, 4) }
    expect(rfqBackWithExec(rfq, { quote_sent: false })).toEqual({ kind: 'quote_in', at: at(2026, 10, 4) })
    expect(rfqBackWithExec(rfq, { quote_sent: true, quote_sent_at: '2026-10-04' })).toBeNull()
  })

  it('an RFQ still with the desk or Lixil is not the exec’s delay', () => {
    for (const status of ['with_technical', 'with_estimation', 'with_lixil']) {
      expect(rfqBackWithExec({ status, raised_at: at(2026, 9, 1) }, {})).toBeNull()
    }
    expect(rfqBackWithExec(undefined, {})).toBeNull()
  })
})

describe('loggedWhileDeskLive (which rule an RFQ Raised counts under)', () => {
  const liveFrom = at(2026, 10, 10, 9)

  it('an RFQ logged at or after the cutover counts by its approval, not here', () => {
    expect(loggedWhileDeskLive({ created_at: at(2026, 10, 10, 9) }, liveFrom)).toBe(true)
    expect(loggedWhileDeskLive({ created_at: at(2026, 10, 12) }, liveFrom)).toBe(true)
  })

  it('one logged before the cutover still counts by its logging day', () => {
    expect(loggedWhileDeskLive({ created_at: at(2026, 10, 9) }, liveFrom)).toBe(false)
  })

  it('reads a naive activities.created_at as UTC, like parseTimestamp everywhere', () => {
    // 2026-10-10 03:31 UTC is 09:01 IST — after a 09:00 IST cutover.
    const cutover = '2026-10-10T03:30:00+00:00'
    expect(loggedWhileDeskLive({ created_at: '2026-10-10T03:31:00' }, cutover)).toBe(true)
    expect(loggedWhileDeskLive({ created_at: '2026-10-10T03:29:00' }, cutover)).toBe(false)
  })

  it('with the desk off nothing is', () => {
    expect(loggedWhileDeskLive({ created_at: at(2026, 10, 12) }, null)).toBe(false)
  })
})
