import { describe, it, expect } from 'vitest'
import {
  bouncedAfterApproval,
  buildRfqLanes,
  inRange,
  median,
  priceRevisionSummary,
  rfqVolume,
  sendBacksByExec,
  shareLabel,
  slowestTenth,
  turnaroundByStep,
  turnaroundLabel,
  waitingOnExec,
  workingMs,
} from './rfqDeskReport'

// Local-time instants, so the Sunday arithmetic doesn't depend on the
// machine's zone. 2026-10-04 is a Sunday.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()
const HOUR = 3600000
const DAY = 24 * HOUR

const october = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31, 23, 59, 59, 999) }

function rfq(o = {}) {
  return {
    id: 1,
    lead_id: 100,
    kind: 'fresh',
    revision: 0,
    status: 'with_technical',
    raised_at: at(2026, 10, 5, 10),
    raised_by_employee_id: 26,
    raised_by: { name: 'Vishal Kumar' },
    ...o,
  }
}

describe('workingMs — Sundays taken out', () => {
  it('is plain elapsed time on working days', () => {
    expect(workingMs(at(2026, 10, 5, 10), at(2026, 10, 5, 15))).toBe(5 * HOUR)
  })
  it('drops a whole Sunday in between', () => {
    // Sat 18:00 → Mon 10:00 = 40h elapsed, 24h of it Sunday
    expect(workingMs(at(2026, 10, 3, 18), at(2026, 10, 5, 10))).toBe(16 * HOUR)
  })
  it('drops the part of a Sunday an RFQ started or ended in', () => {
    expect(workingMs(at(2026, 10, 4, 20), at(2026, 10, 5, 2))).toBe(2 * HOUR)
  })
  it('is null without both ends and 0 when the end is not after the start', () => {
    expect(workingMs(null, at(2026, 10, 5))).toBeNull()
    expect(workingMs(at(2026, 10, 5, 10), at(2026, 10, 5, 9))).toBe(0)
  })
})

describe('median and the slowest 1 in 10', () => {
  it('takes the middle, or the mean of the two middles', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })
  it('is a real value (nearest rank) — the slowest one under ten', () => {
    expect(slowestTenth([5, 1, 9])).toBe(9)
    expect(slowestTenth([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])).toBe(18)
    expect(slowestTenth([])).toBeNull()
  })
})

describe('turnaroundLabel', () => {
  it('reads hours under a day and working days from a day', () => {
    expect(turnaroundLabel(null)).toBe('—')
    expect(turnaroundLabel(20 * 60000)).toBe('<1h')
    expect(turnaroundLabel(5 * HOUR)).toBe('5h')
    expect(turnaroundLabel(DAY)).toBe('1 day')
    expect(turnaroundLabel(1.44 * DAY)).toBe('1.4 days')
    expect(turnaroundLabel(12.4 * DAY)).toBe('12 days')
  })
})

describe('inRange', () => {
  it('includes both ends of the period', () => {
    expect(inRange(october.start.toISOString(), october)).toBe(true)
    expect(inRange(october.end.toISOString(), october)).toBe(true)
    expect(inRange(at(2026, 9, 30, 23), october)).toBe(false)
    expect(inRange(null, october)).toBe(false)
  })
})

describe('the live lanes', () => {
  it('puts each open RFQ in its step, longest wait at that step first', () => {
    const lanes = buildRfqLanes([
      rfq({ id: 1, status: 'with_technical', raised_at: at(2026, 10, 6, 9) }),
      rfq({ id: 2, status: 'with_technical', raised_at: at(2026, 10, 5, 9) }),
      rfq({ id: 3, status: 'with_estimation', approved_at: at(2026, 10, 6, 8) }),
      rfq({ id: 4, status: 'with_lixil', lixil_raised_at: at(2026, 10, 2) }),
      rfq({ id: 5, status: 'sent_back' }),
    ])
    expect(lanes.with_technical.map((r) => r.id)).toEqual([2, 1])
    expect(lanes.with_estimation.map((r) => r.id)).toEqual([3])
    expect(lanes.with_lixil.map((r) => r.id)).toEqual([4])
  })
})

describe('sent back, waiting on the exec', () => {
  it("counts a sent-back RFQ only while it is the lead's newest", () => {
    const sentA = rfq({ id: 1, lead_id: 100, status: 'sent_back', sent_back_at: at(2026, 10, 5, 12) })
    const sentB = rfq({ id: 2, lead_id: 200, status: 'sent_back', raised_at: at(2026, 10, 4), sent_back_at: at(2026, 10, 4, 12) })
    // lead 100 has a newer revision (quoted, which the live read doesn't carry
    // as a full row) — answered
    const later = [{ id: 9, lead_id: 100, status: 'quoted', raised_at: at(2026, 10, 6) }]
    expect(waitingOnExec([sentA, sentB], later).map((r) => r.id)).toEqual([2])
  })
  it('ignores a withdrawn newer RFQ and puts the longest waiting first', () => {
    const sentA = rfq({ id: 1, lead_id: 100, status: 'sent_back', sent_back_at: at(2026, 10, 5, 12) })
    const sentB = rfq({ id: 2, lead_id: 200, status: 'sent_back', sent_back_at: at(2026, 10, 3, 12) })
    expect(waitingOnExec([sentA, sentB], []).map((r) => r.id)).toEqual([2, 1])
  })
})

describe('turnaround by step', () => {
  it('counts each RFQ in the period its step ended in, in working time', () => {
    const rows = [
      // approved 3h after raising, Lixil 5h after approval, quote 2 days later
      rfq({
        id: 1,
        status: 'quoted',
        raised_at: at(2026, 10, 5, 9),
        approved_at: at(2026, 10, 5, 12),
        lixil_raised_at: at(2026, 10, 5, 17),
        quote_received_at: at(2026, 10, 7, 17),
      }),
      // sent back by the technical check after 1h
      rfq({ id: 2, status: 'sent_back', sent_back_from: 'technical', raised_at: at(2026, 10, 6, 9), sent_back_at: at(2026, 10, 6, 10) }),
      // sent back by estimation 2h after approval (approval still counts for technical)
      rfq({
        id: 3,
        status: 'sent_back',
        sent_back_from: 'estimation',
        raised_at: at(2026, 10, 6, 9),
        approved_at: at(2026, 10, 6, 11),
        sent_back_at: at(2026, 10, 6, 13),
      }),
      // decided in September — not this period
      rfq({ id: 4, status: 'with_estimation', raised_at: at(2026, 9, 29, 9), approved_at: at(2026, 9, 29, 10) }),
    ]
    const [technical, estimation, lixil, endToEnd] = turnaroundByStep(rows, october)
    expect(technical).toMatchObject({ key: 'technical', count: 3, medianMs: 2 * HOUR, slowMs: 3 * HOUR })
    expect(estimation).toMatchObject({ count: 2, medianMs: 3.5 * HOUR })
    expect(lixil).toMatchObject({ count: 1, medianMs: 2 * DAY })
    expect(endToEnd).toMatchObject({ count: 1, medianMs: 2 * DAY + 8 * HOUR })
  })
  it('times a price revision from its start at estimation and leaves it out of the technical and end-to-end steps', () => {
    const rows = [
      rfq({
        kind: 'price_revision',
        status: 'quoted',
        raised_at: at(2026, 10, 5, 9),
        lixil_raised_at: at(2026, 10, 5, 10),
        quote_received_at: at(2026, 10, 5, 15),
      }),
    ]
    const [technical, estimation, lixil, endToEnd] = turnaroundByStep(rows, october)
    expect(technical.count).toBe(0)
    expect(estimation).toMatchObject({ count: 1, medianMs: HOUR })
    expect(lixil.count).toBe(1)
    expect(endToEnd.count).toBe(0)
  })
})

describe('volume', () => {
  it('splits what was raised in the period by kind and counts quotes that came in', () => {
    const v = rfqVolume(
      [
        rfq({ id: 1 }),
        rfq({ id: 2, kind: 'revised', status: 'withdrawn' }),
        rfq({ id: 3, kind: 'price_revision' }),
        rfq({ id: 4, raised_at: at(2026, 9, 20), status: 'quoted', quote_received_at: at(2026, 10, 2) }),
      ],
      october
    )
    expect(v).toEqual({ raised: 2, fresh: 1, revised: 1, priceRevisions: 1, withdrawn: 1, quotes: 1 })
  })
})

describe('send-backs by exec', () => {
  it('takes the RFQs each exec raised in the period, highest share first, none-sent-back last', () => {
    const rows = [
      rfq({ id: 1, raised_by_employee_id: 1, raised_by: { name: 'Asha' }, status: 'sent_back', sent_back_from: 'technical' }),
      rfq({ id: 2, raised_by_employee_id: 1, raised_by: { name: 'Asha' }, status: 'quoted' }),
      rfq({ id: 3, raised_by_employee_id: 2, raised_by: { name: 'Bala' }, status: 'sent_back', sent_back_from: 'estimation' }),
      rfq({ id: 4, raised_by_employee_id: 3, raised_by: { name: 'Chet' }, status: 'with_technical' }),
      rfq({ id: 5, raised_by_employee_id: 3, raised_by: { name: 'Chet' }, kind: 'price_revision' }),
      rfq({ id: 6, raised_by_employee_id: 4, raised_by: { name: 'Dev' }, raised_at: at(2026, 9, 1), status: 'sent_back', sent_back_from: 'technical' }),
    ]
    const table = sendBacksByExec(rows, october)
    expect(table.map((r) => [r.name, r.raised, r.technical, r.estimation])).toEqual([
      ['Bala', 1, 0, 1],
      ['Asha', 2, 1, 0],
      ['Chet', 1, 0, 0],
    ])
    expect(table[1].share).toBe(0.5)
  })
})

describe('sent back by estimation after approval', () => {
  it('lists the bounces in the period, newest first, against every approval in it', () => {
    const rows = [
      rfq({ id: 1, approved_at: at(2026, 10, 5, 11), status: 'sent_back', sent_back_from: 'estimation', sent_back_at: at(2026, 10, 5, 15) }),
      rfq({ id: 2, approved_at: at(2026, 10, 6, 11), status: 'sent_back', sent_back_from: 'estimation', sent_back_at: at(2026, 10, 6, 15) }),
      rfq({ id: 3, approved_at: at(2026, 10, 6, 12), status: 'with_lixil' }),
      rfq({ id: 4, status: 'sent_back', sent_back_from: 'technical', sent_back_at: at(2026, 10, 6, 15) }),
    ]
    const { list, approved } = bouncedAfterApproval(rows, october)
    expect(list.map((r) => r.id)).toEqual([2, 1])
    expect(approved).toBe(3)
  })
})

describe('price revisions', () => {
  it('counts those started in the period by where they are now', () => {
    const rows = [
      rfq({ id: 1, kind: 'price_revision', status: 'quoted' }),
      rfq({ id: 2, kind: 'price_revision', status: 'withdrawn' }),
      rfq({ id: 3, kind: 'price_revision', status: 'with_lixil' }),
      rfq({ id: 4, kind: 'price_revision', status: 'quoted', raised_at: at(2026, 9, 2) }),
      rfq({ id: 5 }),
    ]
    expect(priceRevisionSummary(rows, october)).toEqual({ started: 3, quoted: 1, withdrawn: 1, open: 1 })
  })
})

describe('shareLabel', () => {
  it('rounds to a whole percent and says — with nothing to divide', () => {
    expect(shareLabel(1, 3)).toBe('33%')
    expect(shareLabel(0, 0)).toBe('—')
  })
})
