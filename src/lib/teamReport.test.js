import { describe, it, expect } from 'vitest'
import {
  REPORT_MEASURES,
  attainment,
  buildTeamReport,
  dataSpanFor,
  importDatedCounts,
  listReportPeriods,
  orderedMeasures,
  periodFigures,
  reportPeople,
} from './teamReport'
import { buildTeamReportWorkbook, sheetNamesFor, teamReportFileName } from './teamReportFile'
import {
  computeActivityActuals,
  computeOrderValueActuals,
  computeScanningLeadsActuals,
} from '../components/TargetsVsActualsCard'
import { weekPeriodValue } from './targetPeriods'

// Monday 12 Oct 2026, mid-afternoon — the current week is 12–18 Oct (W42).
const NOW = new Date(2026, 9, 12, 15, 0)
// Timestamps sit mid-morning UTC, so the day is the same whichever way a rule
// parses them (the lead and order rules read naive stamps as local time).
const at = (day) => `2026-10-${String(day).padStart(2, '0')}T06:00:00`

const A = 1 // an exec
const B = 2 // another exec
const BDM = 9

const DATA = {
  liveFrom: '2026-10-06T00:00:00+00:00',
  activities: [
    { activity_type: 'call', employee_id: A, created_at: at(5) },
    { activity_type: 'call', employee_id: A, created_at: at(9) },
    { activity_type: 'call', employee_id: A, created_at: '2026-09-30T06:00:00' }, // the week before
    { activity_type: 'site_visit', employee_id: A, created_at: at(6) },
    { activity_type: 'client_meeting_new', employee_id: A, created_at: at(6) },
    { activity_type: 'client_meeting_old', employee_id: A, created_at: at(7) },
    { activity_type: 'client_meeting_old', employee_id: A, created_at: at(8) },
    { activity_type: 'architect_meeting', employee_id: A, created_at: at(8) },
    // Logged while the desk is live: counts through its approval, not here.
    { activity_type: 'rfq_raised', rfq_kind: 'fresh', employee_id: A, created_at: at(7) },
    { activity_type: 'rfq_raised', rfq_kind: 'revised', employee_id: A, created_at: at(8) },
    // Logged before the desk went live: counts by the day it was logged.
    { activity_type: 'rfq_raised', rfq_kind: null, employee_id: B, created_at: at(5) },
    { activity_type: 'architect_meeting', employee_id: BDM, created_at: at(7) },
    { activity_type: 'call', employee_id: BDM, created_at: at(7) },
  ],
  counted: [{ raised_by_employee_id: A, approved_at: '2026-10-08T07:00:00+00:00' }],
  leads: [
    { id: 101, source_type: 'scanning', owner_employee_id: A, bdm_employee_id: null, created_at: at(6) },
    { id: 102, source_type: 'referral_architect', owner_employee_id: A, bdm_employee_id: BDM, created_at: at(7) },
    { id: 103, source_type: 'referral_other', owner_employee_id: B, bdm_employee_id: null, created_at: at(8) },
    // A BDM pool lead: no owner yet, so it reaches the BDM's row only.
    { id: 104, source_type: 'scanning', owner_employee_id: null, bdm_employee_id: BDM, created_at: at(9) },
    { id: 105, source_type: 'scanning', owner_employee_id: A, bdm_employee_id: null, created_at: '2026-09-30T06:00:00' },
  ],
  // Newest first, as the read returns it.
  won: [
    { lead_id: 10, changed_at: at(9), leads: { owner_employee_id: A, bdm_employee_id: BDM, order_value: 500000 } },
    { lead_id: 12, changed_at: at(8), leads: null }, // a row RLS hid
    { lead_id: 11, changed_at: at(7), leads: { owner_employee_id: B, bdm_employee_id: null, order_value: 250000 } },
    // Lead 10's older win — superseded by the newer one above.
    { lead_id: 10, changed_at: '2026-09-01T06:00:00', leads: { owner_employee_id: A, bdm_employee_id: BDM, order_value: 500000 } },
  ],
  targets: [
    { employee_id: A, metric_name: 'call', target_value: 5, period_type: 'week', period_value: '2026-W41' },
    { employee_id: A, metric_name: 'call', target_value: 4, period_type: 'week', period_value: '2026-W40' },
    { employee_id: B, metric_name: 'order_value', target_value: 1000000, period_type: 'week', period_value: '2026-W41' },
    { employee_id: BDM, metric_name: 'bdm_architect_meetings', target_value: 3, period_type: 'week', period_value: '2026-W41' },
  ],
}

const [W42, W41, W40] = listReportPeriods('week', 3, NOW)

describe('listReportPeriods', () => {
  it('lists the newest week first, Monday to Sunday, the current one flagged', () => {
    expect([W42.key, W41.key, W40.key]).toEqual(['2026-W42', '2026-W41', '2026-W40'])
    expect(W42.key).toBe(weekPeriodValue(NOW))
    expect(W42.isCurrent).toBe(true)
    expect(W41.isCurrent).toBe(false)
    expect(W41.start).toEqual(new Date(2026, 9, 5))
    expect(W41.end).toEqual(new Date(2026, 9, 11, 23, 59, 59, 999))
    expect(W41.label).toBe('5 – 11 Oct')
    expect(W41.targetValue).toBe('2026-W41')
  })

  it('keys months and quarters the way targets are stored, and years by number with no target period', () => {
    const months = listReportPeriods('month', 2, NOW)
    expect(months.map((p) => p.key)).toEqual(['2026-10', '2026-09'])
    expect(months[1].end).toEqual(new Date(2026, 8, 30, 23, 59, 59, 999))
    const quarters = listReportPeriods('quarter', 3, NOW)
    expect(quarters.map((p) => p.key)).toEqual(['2026-Q4', '2026-Q3', '2026-Q2'])
    expect(quarters[0].fullLabel).toBe('Q4 2026 (Oct – Dec)')
    const years = listReportPeriods('year', 2, NOW)
    expect(years.map((p) => p.key)).toEqual(['2026', '2025'])
    expect(years[0].targetValue).toBeNull()
  })

  it('fetches a span that covers every listed period', () => {
    const span = dataSpanFor([W42, W41, W40])
    expect(span.start <= W40.start).toBe(true)
    expect(span.end >= W42.end).toBe(true)
  })
})

describe('periodFigures — each figure is the Dashboard rule for that period', () => {
  const figures = periodFigures(W41, DATA)

  it('counts an exec’s week', () => {
    expect(figures(A, 'sales')).toEqual({
      scanning_leads: 1,
      referral_leads: 0,
      architect_leads: 1,
      calls: 2,
      site_visits: 1,
      new_meetings: 1,
      old_meetings: 2,
      architect_meetings: 1,
      fresh_rfqs: 1, // the approval, not the logging
      revised_rfqs: 1,
      order_value: 500000,
    })
  })

  it('counts an RFQ logged before the desk went live by the day it was logged', () => {
    expect(figures(B, 'sales').fresh_rfqs).toBe(1)
    expect(figures(B, 'sales').referral_leads).toBe(1)
    expect(figures(B, 'sales').order_value).toBe(250000)
  })

  it('matches the Targets card’s own functions for the same period', () => {
    const acts = DATA.activities.filter((a) => {
      const d = new Date(`${a.created_at}Z`)
      return d >= W41.start && d <= W41.end
    })
    const counted = DATA.counted
    const card = computeActivityActuals(acts, true, { liveFrom: DATA.liveFrom, counted })
    expect(figures(A, 'sales').calls).toBe(card.get(A).call)
    expect(figures(A, 'sales').fresh_rfqs).toBe(card.get(A).rfq_raised)
    expect(figures(B, 'sales').fresh_rfqs).toBe(card.get(B).rfq_raised)
    expect(figures(A, 'sales').scanning_leads).toBe(computeScanningLeadsActuals(DATA.leads, W41, true).get(A))
    expect(figures(A, 'sales').order_value).toBe(computeOrderValueActuals(DATA.won, W41, true).get(A))
  })

  it('credits a BDM’s row by "brought in by", pool leads included', () => {
    const bdm = figures(BDM, 'bdm')
    expect(bdm.architect_leads).toBe(1) // lead 102, also on the exec's row
    expect(bdm.scanning_leads).toBe(1) // the pool lead
    expect(bdm.order_value).toBe(500000) // lead 10, also the exec's
    expect(bdm.calls).toBe(1)
    expect(bdm.architect_meetings).toBe(1)
  })
})

describe('buildTeamReport', () => {
  const people = [
    { id: A, name: 'Amar', role: 'sales_executive', section: 'sales' },
    { id: B, name: 'Bela', role: 'sales_executive', section: 'sales' },
    { id: BDM, name: 'Dev', role: 'business_development_manager', section: 'bdm' },
  ]
  const report = buildTeamReport({ periods: [W41, W40], people, measures: REPORT_MEASURES, data: DATA })

  it('shows periods oldest first', () => {
    expect(report.periods.map((p) => p.key)).toEqual(['2026-W40', '2026-W41'])
  })

  it('totals a person over the ticked periods, beside each period’s target', () => {
    const amar = report.sections[0].rows[0]
    expect(amar.cells.calls.values).toEqual([1, 2])
    expect(amar.cells.calls.total).toBe(3)
    expect(amar.cells.calls.targets).toEqual([4, 5])
    expect(amar.cells.calls.targetTotal).toBe(9)
    expect(amar.cells.scanning_leads.values).toEqual([1, 1])
    // Site visits carry a target metric since 2026-10-19; none is set here.
    expect(amar.cells.site_visits.targets).toEqual([null, null])
    expect(amar.cells.site_visits.targetTotal).toBeNull()
    // Revised RFQs still have no target metric.
    expect(amar.cells.revised_rfqs.targets).toBeNull()
  })

  it('gives no total target unless every period has one', () => {
    const bela = report.sections[0].rows[1]
    expect(bela.cells.order_value.targets).toEqual([null, 1000000])
    expect(bela.cells.order_value.targetTotal).toBeNull()
    expect(bela.cells.calls.targets).toEqual([null, null])
    expect(bela.cells.calls.targetTotal).toBeNull()
  })

  it('reads a BDM’s architect-meeting target from their own metric', () => {
    const dev = report.sections[1].rows[0]
    expect(dev.cells.architect_meetings.targets).toEqual([null, 3])
    expect(dev.cells.calls.targets).toBeNull()
  })

  it('keeps BDMs out of the team total, in a total of their own', () => {
    expect(report.sections.map((s) => s.key)).toEqual(['sales', 'bdm'])
    expect(report.sections[0].total.order_value.total).toBe(750000)
    expect(report.sections[0].total.calls.values).toEqual([1, 2])
    expect(report.sections[1].total.order_value.total).toBe(500000)
    expect(report.notes.some((n) => n.key === 'bdm-total')).toBe(true)
  })

  it('reads only the measures asked for, in deal-flow order', () => {
    const m = orderedMeasures(['order_value', 'calls', 'nonsense'])
    expect(m.map((x) => x.key)).toEqual(['calls', 'order_value'])
    const small = buildTeamReport({ periods: [W41], people: people.slice(0, 1), measures: m, data: DATA })
    expect(Object.keys(small.sections[0].rows[0].cells)).toEqual(['calls', 'order_value'])
    expect(small.sections).toHaveLength(1)
  })

  it('says when a ticked period is still running', () => {
    const live = buildTeamReport({ periods: [W42], people: people.slice(0, 1), measures: REPORT_MEASURES, data: DATA })
    expect(live.notes.some((n) => n.key === 'current')).toBe(true)
    expect(report.notes.some((n) => n.key === 'current')).toBe(false)
  })
})

describe('attainment', () => {
  it('is a whole percent, or null with no target', () => {
    expect(attainment(3, 9)).toBe(33)
    expect(attainment(5, 0)).toBeNull()
    expect(attainment(5, null)).toBeNull()
  })
})

describe('importDatedCounts', () => {
  it('counts only the import-dated rows the shown figures include', () => {
    const data = {
      leads: [
        // Stamped at the moment the sheet was loaded: an import date.
        { id: 1, source_type: 'scanning', owner_employee_id: A, created_at: '2026-10-06T10:15:00', external_reference_id: 'legacy-1' },
        // The sheet's own date (midnight): a real date.
        { id: 2, source_type: 'scanning', owner_employee_id: A, created_at: '2026-10-06T00:00:00', external_reference_id: 'legacy-2' },
        // Someone not on the report.
        { id: 3, source_type: 'scanning', owner_employee_id: 77, created_at: '2026-10-06T10:15:00', external_reference_id: 'legacy-3' },
      ],
      won: [],
    }
    const people = [{ id: A, section: 'sales' }]
    expect(importDatedCounts({ periods: [W41], people, measures: REPORT_MEASURES, data })).toEqual({ leads: 1, wins: 0 })
    // Lead measures not chosen: nothing to footnote.
    expect(importDatedCounts({ periods: [W41], people, measures: orderedMeasures(['calls']), data }).leads).toBe(0)
  })
})

describe('reportPeople — the Dashboard’s own scoping', () => {
  const execs = [
    { id: 2, name: 'Zed', role: 'sales_executive', coordinator_id: 50, manager_id: 3 },
    { id: 1, name: 'Amar', role: 'sales_executive', coordinator_id: 51, manager_id: null },
    { id: 3, name: 'Mona', role: 'sales_manager', coordinator_id: null, manager_id: null },
  ]
  const bdms = [{ id: 9, name: 'Dev' }]

  it('gives the owner everyone in sales, then the BDMs in their own section', () => {
    const people = reportPeople({ viewer: { id: 100, role: 'owner' }, execs, bdms })
    expect(people.map((p) => [p.name, p.section])).toEqual([
      ['Amar', 'sales'],
      ['Mona', 'sales'],
      ['Zed', 'sales'],
      ['Dev', 'bdm'],
    ])
  })

  it('gives a coordinator their own team only', () => {
    expect(reportPeople({ viewer: { id: 50, role: 'sales_coordinator' }, execs, bdms }).map((p) => p.id)).toEqual([2])
  })

  it('gives a manager themselves first, then their reports', () => {
    expect(reportPeople({ viewer: { id: 3, name: 'Mona', role: 'sales_manager' }, execs, bdms }).map((p) => p.id)).toEqual([3, 2])
  })

  it('gives anyone else nobody', () => {
    expect(reportPeople({ viewer: { id: 1, role: 'sales_executive' }, execs, bdms })).toEqual([])
    expect(reportPeople({ viewer: null, execs, bdms })).toEqual([])
  })
})

describe('the workbook', () => {
  it('names sheets the way Excel allows, unique ignoring case', () => {
    const names = sheetNamesFor(['Vishal Kumar', 'vishal kumar', 'A/B:C*?', 'x'.repeat(40), 'Summary', ''], ['Summary', 'About this report'])
    expect(names[0]).toBe('Vishal Kumar')
    expect(names[1]).toBe('vishal kumar (2)')
    expect(names[2]).toBe('A B C')
    expect(names[3]).toHaveLength(31)
    expect(names[4]).toBe('Summary (2)')
    expect(names[5]).toBe('Person')
  })

  it('holds a Summary, one sheet per person and About this report, in that order', () => {
    const people = [
      { id: A, name: 'Amar', role: 'sales_executive', section: 'sales' },
      { id: B, name: 'Bela', role: 'sales_executive', section: 'sales' },
    ]
    const report = buildTeamReport({ periods: [W41, W40], people, measures: REPORT_MEASURES, data: DATA })
    const sheets = buildTeamReportWorkbook(report, { periodType: 'week', exportedBy: 'Owner', exportedAt: NOW })
    expect(sheets.map((s) => s.sheet)).toEqual(['Summary', 'Amar', 'Bela', 'About this report'])

    // Summary: a header, one row per person, the team total.
    const summary = sheets[0]
    expect(summary.data).toHaveLength(1 + 2 + 1)
    expect(summary.data[1][0].value).toBe('Amar')
    expect(summary.data.every((row) => row.length === summary.data[0].length)).toBe(true)

    // Amar's sheet: a target line and a % line under Calls only.
    const amar = sheets[1].data.map((row) => row[0]?.value)
    const calls = amar.indexOf('Calls')
    expect(amar[calls + 1]).toBe('   Target')
    expect(amar[calls + 2]).toBe('   % of target')
    expect(amar.filter((v) => v === '   Target')).toHaveLength(1)
    expect(sheets[1].data[calls + 2].at(-1).value).toBe(33) // 3 of 9

    // Bela has an order-value target in one week only: a line, no total.
    const bela = sheets[2].data
    const ov = bela.findIndex((row) => row[0]?.value === 'Order value booked')
    expect(bela[ov + 1][0].value).toBe('   Target')
    expect(bela[ov + 1].at(-1)).toBeNull()
  })

  it('names the file by period count, and by the person when there is one', () => {
    expect(teamReportFileName({ periodType: 'week', periodCount: 4, people: [{}, {}], date: NOW })).toBe(
      'VIPSAR Team report – 4 weeks – 12 Oct 2026.xlsx'
    )
    expect(teamReportFileName({ periodType: 'month', periodCount: 1, people: [{ name: 'Vishal Kumar' }], date: NOW })).toBe(
      'VIPSAR Team report – Vishal Kumar – 1 month – 12 Oct 2026.xlsx'
    )
  })
})
