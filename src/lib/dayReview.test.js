import { describe, it, expect } from 'vitest'
import { buildDayRows, buildDayTotals, buildDayKpis, buildDaySheetPanel, priorStageMap } from './dayReview'
import { dayBounds, nextDayISO, prevDayISO } from './dayReviewQueries'
import { parseTimestamp, formatClockTime } from './dbTime'

const RAJAN = { id: 1, name: 'Rajan Sharma', role: 'sales_executive', office_location: 'Ludhiana' }
const PREETI = { id: 2, name: 'Preeti Bhalla', role: 'sales_executive' }
const EMPLOYEES = [RAJAN, PREETI]

// Zone-less strings, exactly as PostgREST returns a `timestamp without time
// zone` column — these are UTC wall clock (see dbTime.js).
const lead = (id, name) => ({ id, parties: { name }, sites: null })

function emptyData(over = {}) {
  return {
    activities: [],
    changes: [],
    stageChanges: [],
    priorStages: [],
    newLeads: [],
    followUps: [],
    tomorrowFollowUps: [],
    quotesSent: [],
    ...over,
  }
}

describe('parseTimestamp', () => {
  it('reads a zone-less Postgres timestamp as UTC, not local', () => {
    // The whole point: without the appended Z this is parsed as local time and
    // every timestamp in the app renders 5.5h early in IST.
    expect(parseTimestamp('2026-08-10T11:30:00').toISOString()).toBe('2026-08-10T11:30:00.000Z')
  })

  it('leaves a string that already carries a zone alone', () => {
    expect(parseTimestamp('2026-08-10T11:30:00Z').toISOString()).toBe('2026-08-10T11:30:00.000Z')
    expect(parseTimestamp('2026-08-10T17:00:00+05:30').toISOString()).toBe('2026-08-10T11:30:00.000Z')
  })

  it('handles the space-separated form and passes Dates through', () => {
    expect(parseTimestamp('2026-08-10 11:30:00').toISOString()).toBe('2026-08-10T11:30:00.000Z')
    const d = new Date('2026-08-10T11:30:00Z')
    expect(parseTimestamp(d)).toBe(d)
  })

  it('returns null for empty input rather than an Invalid Date', () => {
    expect(parseTimestamp(null)).toBeNull()
    expect(formatClockTime(null)).toBeNull()
  })
})

describe('dayBounds', () => {
  it('spans local midnight to local end-of-day', () => {
    const { start, end } = dayBounds('2026-08-10')
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(7)
    expect(start.getDate()).toBe(10)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(end.getDate()).toBe(10)
    expect(end.getHours()).toBe(23)
    expect(end.getMinutes()).toBe(59)
  })

  it('steps across month and year boundaries', () => {
    expect(nextDayISO('2026-08-31')).toBe('2026-09-01')
    expect(prevDayISO('2026-01-01')).toBe('2025-12-31')
    expect(nextDayISO('2026-12-31')).toBe('2027-01-01')
  })
})

describe('buildDayRows', () => {
  it('attributes each column to the acting employee', () => {
    const data = emptyData({
      activities: [
        { id: 1, employee_id: 1, activity_type: 'call', lead_id: 10, created_at: '2026-08-10T05:00:00', leads: lead(10, 'Kalsi') },
        { id: 2, employee_id: 1, activity_type: 'site_visit', lead_id: 11, created_at: '2026-08-10T06:00:00', leads: lead(11, 'Anand') },
        { id: 3, employee_id: 2, activity_type: 'call', lead_id: 12, created_at: '2026-08-10T07:00:00', leads: lead(12, 'Verma') },
      ],
      quotesSent: [{ id: 11, owner_employee_id: 1, quote_value: 840000 }],
    })

    const [rajan, preeti] = buildDayRows(EMPLOYEES, data, false)
    expect(rajan.total).toBe(2)
    expect(rajan.calls).toBe(1)
    expect(rajan.visits).toBe(1)
    expect(rajan.quotes).toBe(1)
    expect(preeti.total).toBe(1)
    expect(preeti.calls).toBe(1)
    expect(preeti.quotes).toBe(0)
  })

  it('credits a new lead to its creator, not its current owner', () => {
    // The reassignment case the created_by_employee_id column exists for: this
    // lead was made by Rajan and now belongs to Preeti.
    const data = emptyData({
      newLeads: [{ id: 20, created_by_employee_id: 1, owner_employee_id: 2, quote_value: null }],
    })
    const [rajan, preeti] = buildDayRows(EMPLOYEES, data, false)
    expect(rajan.newLeads).toBe(1)
    expect(preeti.newLeads).toBe(0)
  })

  it('counts stage moves as changes but never counts creations', () => {
    const data = emptyData({
      changes: [
        { id: 1, changed_by: 1, lead_id: 10, field: 'created', changed_at: '2026-08-10T05:00:00Z', leads: lead(10, 'Kalsi') },
        { id: 2, changed_by: 1, lead_id: 10, field: 'quote_value', old_value: '610000', new_value: '840000', changed_at: '2026-08-10T06:00:00Z', leads: lead(10, 'Kalsi') },
      ],
      stageChanges: [
        { id: 5, changed_by: 1, lead_id: 11, stage: 'rfq', changed_at: '2026-08-10T07:00:00', leads: { id: 11, owner_employee_id: 1, parties: { name: 'Anand' } } },
      ],
    })
    const [rajan] = buildDayRows(EMPLOYEES, data, false)
    expect(rajan.changes).toBe(2) // quote_value + the stage move, not `created`
  })

  it('drops a stage row whose lead embed came back null under RLS', () => {
    const data = emptyData({
      stageChanges: [{ id: 5, changed_by: 1, lead_id: 99, stage: 'rfq', changed_at: '2026-08-10T07:00:00', leads: null }],
    })
    expect(buildDayRows(EMPLOYEES, data, false)[0].changes).toBe(0)
  })

  it('counts each touched lead once however many ways it was touched', () => {
    const data = emptyData({
      activities: [{ id: 1, employee_id: 1, activity_type: 'call', lead_id: 10, created_at: '2026-08-10T05:00:00', leads: lead(10, 'Kalsi') }],
      changes: [{ id: 2, changed_by: 1, lead_id: 10, field: 'quote_value', changed_at: '2026-08-10T06:00:00Z', leads: lead(10, 'Kalsi') }],
      stageChanges: [{ id: 5, changed_by: 1, lead_id: 10, stage: 'rfq', changed_at: '2026-08-10T07:00:00', leads: { id: 10, owner_employee_id: 1 } }],
      newLeads: [{ id: 10, created_by_employee_id: 1 }],
    })
    expect(buildDayRows(EMPLOYEES, data, false)[0].touched).toBe(1)
  })

  describe('the pending vs missed rule', () => {
    const data = emptyData({
      followUps: [
        { id: 1, assigned_to: 1, status: 'done', done_at: '2026-08-10T04:34:00', title: 'a' },
        { id: 2, assigned_to: 1, status: 'open', title: 'b' },
        { id: 3, assigned_to: 1, status: 'open', title: 'c' },
      ],
    })

    it('leaves an open follow-up PENDING while the day is still running', () => {
      const [rajan] = buildDayRows(EMPLOYEES, data, false)
      expect(rajan.done).toBe(1)
      expect(rajan.pending).toBe(2)
      expect(rajan.missed).toBe(0)
    })

    it('rolls pending into MISSED once the day has passed', () => {
      const [rajan] = buildDayRows(EMPLOYEES, data, true)
      expect(rajan.done).toBe(1)
      expect(rajan.pending).toBe(0)
      expect(rajan.missed).toBe(2)
    })
  })

  it('gives a zero-activity exec real zeros rather than dropping the row', () => {
    const [, preeti] = buildDayRows(EMPLOYEES, emptyData(), true)
    expect(preeti.total).toBe(0)
    expect(preeti.name).toBe('Preeti Bhalla')
  })
})

describe('buildDayTotals', () => {
  it('sums every column across execs', () => {
    const data = emptyData({
      activities: [
        { id: 1, employee_id: 1, activity_type: 'call', lead_id: 10, created_at: '2026-08-10T05:00:00', leads: lead(10, 'K') },
        { id: 2, employee_id: 2, activity_type: 'site_visit', lead_id: 11, created_at: '2026-08-10T06:00:00', leads: lead(11, 'A') },
      ],
    })
    const totals = buildDayTotals(buildDayRows(EMPLOYEES, data, false))
    expect(totals.total).toBe(2)
    expect(totals.calls).toBe(1)
    expect(totals.visits).toBe(1)
  })
})

describe('buildDayKpis', () => {
  const data = emptyData({
    activities: [
      { id: 1, employee_id: 1, activity_type: 'call', lead_id: 10, created_at: '2026-08-10T05:00:00', leads: lead(10, 'Kalsi') },
      { id: 2, employee_id: 1, activity_type: 'office_day', lead_id: null, created_at: '2026-08-10T06:00:00', leads: null },
    ],
    stageChanges: [
      { id: 5, changed_by: 1, lead_id: 12, stage: 'won', changed_at: '2026-08-10T07:00:00', leads: { id: 12, owner_employee_id: 1, order_value: 1460000, parties: { name: 'Khurana' } } },
    ],
    newLeads: [{ id: 20, created_by_employee_id: 1, quote_value: 264000 }],
  })

  it('breaks activities down by type, with everything else as "other"', () => {
    const [activities] = buildDayKpis(data, buildDayRows(EMPLOYEES, data, false), false)
    expect(activities.value).toBe('2')
    expect(activities.sub).toBe('1 calls · 0 visits · 1 other')
  })

  it('reports won deals with their value and the leads involved', () => {
    const won = buildDayKpis(data, buildDayRows(EMPLOYEES, data, false), false).find((k) => k.key === 'won')
    expect(won.value).toBe('1')
    expect(won.sub).toContain('₹14.6L')
    expect(won.sub).toContain('Khurana')
  })

  it('says "still open" today and "were due" for a past day', () => {
    const withFollowUps = emptyData({
      followUps: [
        { id: 1, assigned_to: 1, status: 'done', title: 'a' },
        { id: 2, assigned_to: 1, status: 'open', title: 'b' },
      ],
    })
    const live = buildDayKpis(withFollowUps, buildDayRows(EMPLOYEES, withFollowUps, false), false).find((k) => k.key === 'followups')
    expect(live.sub).toBe('2 due · 1 still open')
    expect(live.missedIsPending).toBe(true)

    const past = buildDayKpis(withFollowUps, buildDayRows(EMPLOYEES, withFollowUps, true), true).find((k) => k.key === 'followups')
    expect(past.sub).toBe('2 were due')
    expect(past.missed).toBe(1)
  })
})

describe('buildDaySheetPanel', () => {
  const base = {
    employee: RAJAN,
    dateISO: '2026-08-10',
    isPast: true,
    changesUnavailable: false,
    changeLogStart: null,
    onReschedule: () => {},
  }

  it('merges log and stage changes into one time-ordered list', () => {
    const data = emptyData({
      changes: [
        { id: 2, changed_by: 1, lead_id: 11, field: 'quote_value', old_value: '610000', new_value: '840000', changed_at: '2026-08-10T09:36:00Z', leads: lead(11, 'Anand Builders') },
      ],
      stageChanges: [
        { id: 5, changed_by: 1, lead_id: 10, stage: 'rfq', changed_at: '2026-08-10T06:22:00', leads: { id: 10, owner_employee_id: 1, parties: { name: 'Kalsi Traders' } } },
      ],
      priorStages: [{ lead_id: 10, stage: 'calling', changed_at: '2026-08-01T06:00:00' }],
    })

    const panel = buildDaySheetPanel({ ...base, data })
    expect(panel.changeRows.map((r) => r.party)).toEqual(['Kalsi Traders', 'Anand Builders'])
    expect(panel.changeRows[0].oldStage.label).toBe('Calling')
    expect(panel.changeRows[1].oldText).toBe('₹6.1L')
    expect(panel.changeRows[1].newText).toBe('₹8.4L')
    expect(panel.changeCount).toBe(2)
  })

  it('uses the most recent prior stage when a lead has several', () => {
    // The query returns newest-first; the first one seen per lead wins.
    const map = priorStageMap([
      { lead_id: 10, stage: 'measurements', changed_at: '2026-08-09T00:00:00' },
      { lead_id: 10, stage: 'calling', changed_at: '2026-08-01T00:00:00' },
    ])
    expect(map.get(10)).toBe('measurements')
  })

  it('drops the worked-span clause entirely when nothing was logged', () => {
    const panel = buildDaySheetPanel({ ...base, data: emptyData() })
    expect(panel.note).not.toContain('logged')
    expect(panel.note).toContain('Sales Executive')
  })

  it('shows the logged span from first to last activity', () => {
    const data = emptyData({
      activities: [
        { id: 1, employee_id: 1, activity_type: 'call', lead_id: 10, created_at: '2026-08-10T11:10:00Z', leads: lead(10, 'K') },
        { id: 2, employee_id: 1, activity_type: 'call', lead_id: 11, created_at: '2026-08-10T03:42:00Z', leads: lead(11, 'A') },
      ],
    })
    // 03:42Z and 11:10Z — the earlier one must lead, regardless of fetch order.
    expect(buildDaySheetPanel({ ...base, data }).note).toMatch(/logged .+ – .+/)
    expect(buildDaySheetPanel({ ...base, data }).activities[0].party).toBe('A')
  })

  it('splits missed from completed only for a past day', () => {
    const data = emptyData({
      followUps: [
        { id: 1, assigned_to: 1, status: 'done', done_at: '2026-08-10T04:34:00', title: 'a', leads: lead(10, 'Gill Infra') },
        { id: 2, assigned_to: 1, status: 'open', title: 'b', leads: lead(11, 'Sandhu Steels') },
      ],
    })
    const past = buildDaySheetPanel({ ...base, data })
    expect(past.followUps.missedRows.map((r) => r.party)).toEqual(['Sandhu Steels'])
    expect(past.followUps.completedRows.map((r) => r.party)).toEqual(['Gill Infra'])

    const live = buildDaySheetPanel({ ...base, isPast: false, data })
    expect(live.followUps.missedRows).toEqual([])
    expect(live.followUps.pendingRows.map((r) => r.party)).toEqual(['Sandhu Steels'])
  })

  it('keeps only the first line of a note, with the rest available', () => {
    const data = emptyData({
      activities: [
        { id: 1, employee_id: 1, activity_type: 'site_visit', lead_id: 10, notes: 'Met Mr. Kalsi at the yard.\nSlab work starts next month.', created_at: '2026-08-10T06:00:00', leads: lead(10, 'Kalsi') },
      ],
    })
    const [row] = buildDaySheetPanel({ ...base, data }).activities
    expect(row.notes).toBe('Met Mr. Kalsi at the yard.')
    expect(row.more).toBe('Slab work starts next month.')
  })

  it('counts tomorrow\'s booked follow-ups and site visits', () => {
    const data = emptyData({
      tomorrowFollowUps: [
        { id: 1, assigned_to: 1, activity_type: 'site_visit', title: 'a' },
        { id: 2, assigned_to: 1, activity_type: 'call', title: 'b' },
        { id: 3, assigned_to: 2, activity_type: 'site_visit', title: 'not mine' },
      ],
    })
    const panel = buildDaySheetPanel({ ...base, data })
    expect(panel.tomorrow).toEqual({ followUps: 2, siteVisits: 1 })
  })
})
