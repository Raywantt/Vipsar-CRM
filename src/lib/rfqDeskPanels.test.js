import { describe, it, expect } from 'vitest'
import { buildRfqPanel, RFQ_FOCUS_KEYS, statusWords } from './rfqDeskPanels'
import { bouncedAfterApproval, priceRevisionSummary, rfqVolume, turnaroundByStep } from './rfqDeskReport'
import { estimationMonthStats, technicalMonthStats } from './rfqDesk'

const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).toISOString()
const october = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31, 23, 59, 59, 999) }
const PE = 48
const EE = 49

function rfq(o = {}) {
  return {
    id: 1,
    lead_id: 100,
    kind: 'fresh',
    revision: 0,
    status: 'with_technical',
    raised_at: at(2026, 10, 5, 10),
    raised_by_employee_id: 1,
    raised_by: { name: 'Asha Rani' },
    leads: { office_territory: 'ludhiana', parties: { name: 'Client' } },
    ...o,
  }
}

// One of everything, across two execs and two offices.
const ROWS = [
  rfq({ id: 1, status: 'with_technical' }),
  rfq({ id: 2, status: 'with_estimation', approved_at: at(2026, 10, 5, 12), approved_by: PE }),
  rfq({
    id: 3,
    raised_by_employee_id: 2,
    raised_by: { name: 'Bala Singh' },
    leads: { office_territory: 'jalandhar', parties: { name: 'B' } },
    status: 'quoted',
    approved_at: at(2026, 10, 5, 11),
    approved_by: PE,
    lixil_raised_at: at(2026, 10, 5, 15),
    lixil_raised_by: EE,
    quote_received_at: at(2026, 10, 7, 15),
    quote_received_by: EE,
    quote_value: 400000,
    quote_ref: 'R26-1',
  }),
  rfq({ id: 4, status: 'sent_back', sent_back_from: 'technical', sent_back_at: at(2026, 10, 6, 9), sent_back_by: PE, send_back_note: 'W3 too tall' }),
  rfq({
    id: 5,
    kind: 'revised',
    revision: 1,
    raised_by_employee_id: 2,
    raised_by: { name: 'Bala Singh' },
    status: 'sent_back',
    sent_back_from: 'estimation',
    approved_at: at(2026, 10, 6, 10),
    approved_by: PE,
    approver: { name: 'Harjot Singh' },
    sent_back_at: at(2026, 10, 6, 15),
    sent_back_by: EE,
  }),
  rfq({ id: 6, kind: 'price_revision', status: 'with_lixil', lixil_raised_at: at(2026, 10, 8), lixil_raised_by: EE }),
  rfq({ id: 7, raised_at: at(2026, 9, 20), status: 'with_estimation', approved_at: at(2026, 10, 1, 9), approved_by: PE }),
]

const ctx = { range: october, rangeLabel: 'this month', employeeId: PE, approvedCount: 4 }

function view(focus, chosen = {}, sort = 'latest', c = ctx) {
  const panel = buildRfqPanel({ focus, rows: ROWS, ctx: c, eyebrow: 'October 2026' })
  return { panel, view: panel.viewFor({ ...panel.initial, ...chosen }, sort) }
}

describe('every popup counts exactly what its figure on the page counts', () => {
  it('matches the strip and the cards', () => {
    const volume = rfqVolume(ROWS, october)
    expect(view('raised').view.total).toBe(volume.raised)
    expect(view('quotes').view.total).toBe(volume.quotes)
    expect(view('priceRevisions').view.total).toBe(priceRevisionSummary(ROWS, october).started)
    expect(view('bounced').view.total).toBe(bouncedAfterApproval(ROWS, october).list.length)
    // "Sent back" opens on Step = Sent back; its headline is the tile's figure
    const sent = buildRfqPanel({ focus: 'sentBack', rows: ROWS, ctx, initial: { step: 'sent_back' }, eyebrow: 'x' })
    expect(sent.value).toBe('2')
    expect(sent.viewFor(sent.initial, 'latest').total).toBe(2)
    for (const step of turnaroundByStep(ROWS, october)) {
      expect(view(`turnaround:${step.key}`).view.total).toBe(step.count)
    }
  })

  it("matches the desk's own Today strips", () => {
    const tech = technicalMonthStats(ROWS, PE, october.start)
    expect(view('myApproved').view.total).toBe(tech.approved)
    expect(view('mySentBack').view.total).toBe(tech.sentBack)
    expect(view('myBounced').view.total).toBe(tech.bounced)
    const est = estimationMonthStats(ROWS, EE, october.start)
    const eeCtx = { ...ctx, employeeId: EE }
    expect(view('myLixilRaised', {}, 'latest', eeCtx).view.total).toBe(est.raised)
    expect(view('myQuotes', {}, 'latest', eeCtx).view.total).toBe(est.quoted)
    expect(view('myEstSentBack', {}, 'latest', eeCtx).view.total).toBe(est.sentBack)
  })

  it('builds every focus without throwing, empty or not', () => {
    for (const focus of RFQ_FOCUS_KEYS) {
      const panel = buildRfqPanel({ focus, rows: [], ctx, eyebrow: 'x' })
      expect(panel.viewFor(panel.initial, panel.sorts[0].key).rows).toEqual([])
      expect(buildRfqPanel({ focus, rows: ROWS, ctx, eyebrow: 'x' }).kind).toBe('rfqBreakdown')
    }
  })
})

describe('filters', () => {
  it('narrow the list by exec, office, kind and step', () => {
    expect(view('raised', { exec: '2' }).view.rows.map((r) => r.id)).toEqual([5, 3])
    expect(view('raised', { office: 'jalandhar' }).view.rows.map((r) => r.id)).toEqual([3])
    expect(view('raised', { kind: 'revised' }).view.rows.map((r) => r.id)).toEqual([5])
    expect(view('raised', { step: 'sent_back' }).view.rows.map((r) => r.id)).toEqual([5, 4])
  })

  it('leave the figures alone on Step, so a share stays a share of every RFQ raised', () => {
    const { view: v } = view('raised', { step: 'sent_back' })
    const sent = v.stats.find((s) => s.label === 'Sent back')
    expect(v.total).toBe(2)
    expect(v.stats[0].value).toBe('5')
    expect(sent.value).toBe('2')
    expect(sent.sub).toBe('40% of these')
  })

  it('offer only facets that exist in the figure, hiding none themselves', () => {
    const { panel } = view('raised')
    expect(panel.filters.execs.map((e) => e.name)).toEqual(['Asha Rani', 'Bala Singh'])
    expect(panel.filters.steps.map((s) => s.key)).toEqual(['with_technical', 'with_estimation', 'quoted', 'sent_back'])
  })
})

describe('breakdowns', () => {
  it('never filter by their own dimension', () => {
    const { view: v } = view('raised', { exec: '2' })
    const byExec = v.sections.find((s) => s.title === 'By exec')
    expect(byExec.rows.map((r) => [r.label, r.value, r.active])).toEqual([
      ['Asha Rani', '3', false],
      ['Bala Singh', '2', true],
    ])
    const where = v.sections.find((s) => s.title === 'Where they are now')
    expect(where.rows.map((r) => r.key)).toEqual(['quoted', 'sent_back'])
  })

  it('are left out when there is only one group', () => {
    const { view: v } = view('bounced')
    expect(v.sections).toEqual([])
  })

  it('give a turnaround breakdown its typical time', () => {
    const { view: v } = view('turnaround:technical')
    expect(v.sections.find((s) => s.title === 'By exec').rows[0].sub).toMatch(/^typical /)
  })
})

describe('the list', () => {
  it('sorts a turnaround slowest first, and the rest newest or oldest first', () => {
    // #7 was raised 20 Sep and approved 1 Oct — the slowest check by far
    expect(view('turnaround:technical', {}, 'slowest').view.rows[0].id).toBe(7)
    expect(view('raised', {}, 'latest').view.rows[0].id).toBe(5)
    expect(view('raised', {}, 'oldest').view.rows[0].id).toBe(1)
  })

  it('links a lead only when the viewer can read it, and shows a send-back note', () => {
    const rows = [rfq({ id: 9, leads: null, status: 'sent_back', sent_back_from: 'technical', sent_back_at: at(2026, 10, 6), sent_back_by: PE, send_back_note: ' too tall ' })]
    const panel = buildRfqPanel({ focus: 'mySentBack', rows, ctx, eyebrow: 'x' })
    const [row] = panel.viewFor(panel.initial, 'latest').rows
    expect(row).toMatchObject({ linkable: false, name: 'Lead #100', note: 'too tall' })
  })

  it('names who approved on the bounced list', () => {
    expect(view('bounced').view.rows[0].approver).toBe('Harjot')
  })
})

describe('statusWords', () => {
  it('says which step sent an RFQ back', () => {
    expect(statusWords({ status: 'sent_back', sent_back_from: 'estimation' })).toBe('Sent back by estimation')
    expect(statusWords({ status: 'with_lixil' })).toBe('With Lixil')
  })
})
