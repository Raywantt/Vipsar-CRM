import { describe, it, expect } from 'vitest'
import { leadStatus, hasImportDate, leadRecords, leadsIn, leadFacets, computeSourceView, sourceColor, SOURCE_COLORS } from './leadSources'
import { buildSourcePanel } from './drilldownBuilders'
import { SOURCE_TYPE_OPTIONS } from './sourceTypeOptions'

// September 2026 is in the past for every future run, so the daily buckets
// (which stop at "now") are all 30 of them.
const range = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59) }
const august = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59) }
const previous = { range: august, label: 'last month' }

let nextId = 1
function lead(over = {}) {
  return {
    id: nextId++,
    created_at: '2026-09-10T06:00:00',
    source_type: 'scanning',
    current_stage: 'calling',
    owner_employee_id: 1,
    office_territory: 'ludhiana',
    quote_sent: false,
    quote_value: null,
    order_value: null,
    external_reference_id: null,
    product_ids: [],
    employees: { name: 'Asha Rao' },
    parties: { name: 'A Client' },
    ...over,
  }
}

const view = (leads, filters = {}, extra = {}) => {
  const all = leadRecords({ breakdownLeads: leads, sourceOptions: SOURCE_TYPE_OPTIONS })
  return computeSourceView({
    leads: leadsIn(all, range),
    previousLeads: leadsIn(all, august),
    allTime: all,
    sourceOptions: SOURCE_TYPE_OPTIONS,
    filters: { owner: '', source: '', office: '', status: '', product: '', noImports: false, ...filters },
    range,
    previousLabel: 'last month',
    ...extra,
  })
}

describe('leadStatus', () => {
  it('partitions every lead into one of five buckets', () => {
    expect(leadStatus({ current_stage: 'won' })).toBe('won')
    expect(leadStatus({ current_stage: 'lost', quote_sent: true })).toBe('lost')
    expect(leadStatus({ current_stage: 'on_hold', quote_sent: true })).toBe('hold')
    expect(leadStatus({ current_stage: 'quote_submission' })).toBe('quoted')
    expect(leadStatus({ current_stage: 'negotiation' })).toBe('quoted')
    expect(leadStatus({ current_stage: 'presentation', quote_sent: true })).toBe('quoted')
    expect(leadStatus({ current_stage: 'presentation' })).toBe('open')
  })

  it('treats a missing stage as the funnel start, like the rest of the app', () => {
    expect(leadStatus({ current_stage: null })).toBe('open')
  })
})

describe('hasImportDate', () => {
  it('tags an imported lead stamped with the moment the sheet was loaded', () => {
    expect(hasImportDate({ external_reference_id: 'legacy-12', created_at: '2026-09-18T07:07:38.809873' })).toBe(true)
  })

  it("does not tag an imported lead carrying the sheet's own date (midnight)", () => {
    expect(hasImportDate({ external_reference_id: 'legacy-12', created_at: '2025-08-11T00:00:00' })).toBe(false)
  })

  it('never tags an app-created lead, whatever its time', () => {
    expect(hasImportDate({ external_reference_id: null, created_at: '2026-09-03T10:57:43.888182' })).toBe(false)
  })
})

describe('membership — the popup counts exactly what the card counts', () => {
  const leads = [
    lead({ created_at: '2026-09-02T06:00:00' }),
    lead({ created_at: '2026-09-30T06:00:00' }),
    lead({ created_at: '2026-08-15T06:00:00' }), // last month
    lead({ created_at: '2026-10-02T06:00:00' }), // next month
    lead({ source_type: 'lixil' }),
  ]

  it('keeps leads created inside the range and drops the rest', () => {
    expect(view(leads).total).toBe(3)
  })

  it('shows only the sources the viewer is offered (an exec sees Scanning and Walk-in)', () => {
    const execSources = SOURCE_TYPE_OPTIONS.filter((o) => ['scanning', 'showroom_walkin'].includes(o.value))
    const records = leadRecords({ breakdownLeads: leads, sourceOptions: execSources })
    expect(leadsIn(records, range)).toHaveLength(2) // the Lixil lead is not theirs to count
  })

  it('builds a panel whose header total is that same count', () => {
    const panel = buildSourcePanel({ breakdownLeads: leads, sourceOptions: SOURCE_TYPE_OPTIONS, employees: [], range, rangeLabel: 'September 2026', previous })
    expect(panel.kind).toBe('sources')
    expect(panel.value).toBe('3')
    expect(panel.viewFor({ owner: '', source: '', office: '', status: '', product: '', noImports: false }, 'latest').total).toBe(3)
  })

  it('is not ready until the leads have landed', () => {
    const panel = buildSourcePanel({ breakdownLeads: [], sourceOptions: SOURCE_TYPE_OPTIONS, employees: [], range, rangeLabel: 'x', leadsReady: false })
    expect(panel.ready).toBe(false)
  })
})

describe('the strip and the comparison', () => {
  const leads = [
    lead({ created_at: '2026-09-03T06:00:00' }),
    lead({ created_at: '2026-09-03T07:00:00', source_type: 'lixil' }),
    lead({ created_at: '2026-09-04T06:00:00' }),
    lead({ created_at: '2026-08-10T06:00:00' }),
    lead({ created_at: '2026-08-11T06:00:00' }),
  ]

  it('sets the period against the previous one', () => {
    const v = view(leads)
    expect(v.stats[0]).toMatchObject({ label: 'New leads', value: '3' })
    expect(v.stats[0].sub).toBe('▲ 50% vs last month')
  })

  it('names the top source and the busiest day', () => {
    const v = view(leads)
    expect(v.stats[1]).toMatchObject({ label: 'Top source', value: '67%', sub: 'Scanning · 2' })
    expect(v.stats[2]).toMatchObject({ label: 'Busiest day', value: '2' })
  })

  it('carries no comparison for "Won so far" — an older cohort has simply had longer to convert', () => {
    const v = view([lead({ current_stage: 'won', order_value: 500000 })])
    expect(v.stats[3]).toMatchObject({ label: 'Won so far', value: '1' })
    expect(v.stats[3].sub).not.toMatch(/vs /)
  })
})

describe('the chart', () => {
  it('draws a bar per day, and the bars add up to the total', () => {
    const v = view([lead({ created_at: '2026-09-03T06:00:00' }), lead({ created_at: '2026-09-03T08:00:00' }), lead({ created_at: '2026-09-20T06:00:00', source_type: 'lixil' })])
    expect(v.chart.unit).toBe('day')
    expect(v.chart.bars).toHaveLength(30)
    expect(v.chart.bars.reduce((s, b) => s + b.total, 0)).toBe(v.total)
    expect(v.chart.peak).toBe(2)
  })

  it('sizes a bar against the peak, and a stack part against its own count', () => {
    const v = view([lead({ created_at: '2026-09-03T06:00:00' }), lead({ created_at: '2026-09-03T08:00:00', source_type: 'lixil' }), lead({ created_at: '2026-09-04T06:00:00' })])
    const busy = v.chart.bars.find((b) => b.total === 2)
    const quiet = v.chart.bars.find((b) => b.total === 1)
    expect(busy.height).toBe('100%')
    expect(quiet.height).toBe('50%')
    expect(busy.parts.map((p) => p.count)).toEqual([1, 1])
  })

  it('moves to weeks past a month, so a quarter is a dozen bars rather than ninety slivers', () => {
    const all = leadRecords({ breakdownLeads: [lead()], sourceOptions: SOURCE_TYPE_OPTIONS })
    const quarter = { start: new Date(2026, 6, 1), end: new Date(2026, 8, 30, 23, 59, 59) }
    const v = computeSourceView({
      leads: leadsIn(all, quarter),
      previousLeads: null,
      allTime: all,
      sourceOptions: SOURCE_TYPE_OPTIONS,
      filters: {},
      range: quarter,
    })
    expect(v.chart.unit).toBe('week')
    expect(v.chart.bars.length).toBeGreaterThan(12)
    expect(v.chart.bars.length).toBeLessThan(16)
  })
})

describe('filters', () => {
  const leads = [
    lead({ owner_employee_id: 1, employees: { name: 'Asha Rao' }, source_type: 'scanning' }),
    lead({ owner_employee_id: 1, employees: { name: 'Asha Rao' }, source_type: 'lixil', current_stage: 'won', order_value: 800000 }),
    lead({ owner_employee_id: 2, employees: { name: 'Bhavna Das' }, source_type: 'scanning', office_territory: 'amritsar', current_stage: 'lost' }),
  ]

  it('matches an owner by its string key — a <select> only ever returns strings', () => {
    expect(view(leads, { owner: '1' }).total).toBe(2)
    expect(view(leads, { owner: '2' }).total).toBe(1)
  })

  it('filters by source, office and status', () => {
    expect(view(leads, { source: 'scanning' }).total).toBe(2)
    expect(view(leads, { office: 'amritsar' }).total).toBe(1)
    expect(view(leads, { status: 'won' }).total).toBe(1)
  })

  it("never filters a breakdown by its own dimension — picking Scanning leaves every source on By source", () => {
    const v = view(leads, { source: 'scanning' })
    expect(v.total).toBe(2)
    expect(v.bySource.find((r) => r.key === 'lixil').count).toBe(1)
    expect(v.bySource.find((r) => r.key === 'scanning').active).toBe(true)
  })

  it('keeps every exec on By exec when one is picked', () => {
    const v = view(leads, { owner: '1' }, { roster: [{ id: 1, name: 'Asha Rao' }, { id: 2, name: 'Bhavna Das' }, { id: 3, name: 'Chetan Lal' }] })
    expect(v.byExec.map((e) => e.name)).toEqual(['Asha Rao', 'Bhavna Das', 'Chetan Lal'])
    expect(v.byExec[0].selected).toBe(true)
    // An exec with no new leads stays — a finding, not noise.
    expect(v.byExec[2].sub).toBe('no new leads')
  })

  it("ignores the status filter in 'what became of them' — status is what it draws", () => {
    const v = view(leads, { status: 'won' })
    expect(v.total).toBe(1)
    expect(v.outcomeTotals.find((s) => s.key === 'lost').count).toBe(1)
  })

  it('hides a facet with a single choice', () => {
    const only = leadRecords({ breakdownLeads: [lead(), lead()], sourceOptions: SOURCE_TYPE_OPTIONS })
    const facets = leadFacets(leadsIn(only, range), { sourceOptions: SOURCE_TYPE_OPTIONS })
    expect(facets.owners).toEqual([])
    expect(facets.sources).toEqual([])
    expect(facets.offices).toEqual([])
    expect(facets.statuses).toEqual([])
  })

  it('offers an exec with no new leads, so the owner can still pick them', () => {
    const records = leadRecords({ breakdownLeads: leads, sourceOptions: SOURCE_TYPE_OPTIONS })
    const facets = leadFacets(leadsIn(records, range), { sourceOptions: SOURCE_TYPE_OPTIONS, roster: [{ id: 9, name: 'Zoya' }] })
    expect(facets.owners.map((o) => o.name)).toContain('Zoya')
  })
})

describe('what became of them', () => {
  it('splits a source into where each lead stands today, and totals the won order value', () => {
    const v = view([
      lead({ source_type: 'lixil', current_stage: 'won', order_value: 500000 }),
      lead({ source_type: 'lixil', current_stage: 'lost' }),
      lead({ source_type: 'lixil', current_stage: 'negotiation', quote_value: 300000 }),
      lead({ source_type: 'lixil', current_stage: 'calling' }),
    ])
    const lixil = v.outcomes.find((o) => o.key === 'lixil')
    expect(lixil.total).toBe(4)
    expect(lixil.segments.map((s) => [s.key, s.count])).toEqual([
      ['open', 1],
      ['quoted', 1],
      ['won', 1],
      ['lost', 1],
    ])
    expect(lixil.values).toBe('won ₹5.0L · open quotes ₹3.0L')
  })

  it('keeps the all-time win rate beside the cohort — won ÷ every lead of that source, any date', () => {
    const v = view([
      lead({ source_type: 'lixil', created_at: '2026-09-10T06:00:00' }),
      lead({ source_type: 'lixil', created_at: '2025-01-10T00:00:00', current_stage: 'won', order_value: 100000 }),
    ])
    const row = v.bySource.find((r) => r.key === 'lixil')
    expect(row.count).toBe(1)
    expect(row.sub).toContain('50% all-time win rate')
  })
})

describe('import-dated leads', () => {
  const imported = (over) => lead({ external_reference_id: 'legacy-7', created_at: '2026-09-18T07:07:38.809873', ...over })

  it('counts them (the card does), tags them, and says how many', () => {
    const v = view([imported(), imported(), lead()])
    expect(v.total).toBe(3)
    expect(v.imported).toBe(2)
    expect(v.rows.filter((r) => r.importDate)).toHaveLength(2)
  })

  it('drops them when asked — from the figures, the chart and the previous period alike', () => {
    const v = view([imported(), imported(), lead(), imported({ created_at: '2026-08-18T07:07:38.809873' })], { noImports: true })
    expect(v.total).toBe(1)
    expect(v.chart.peak).toBe(1)
    // Last month's one lead was an import too, so it is left out of the comparison as well.
    expect(v.stats[0].sub).toBe('new — none in last month')
    expect(v.imported).toBe(2) // what the switch is leaving out, so the line can say so
  })

  it('counts them in the comparison period too — a month set against an import reads ▼ for arithmetic alone', () => {
    const v = view([lead(), imported({ created_at: '2026-08-18T07:07:38.809873' }), imported({ created_at: '2026-08-18T07:07:38.809873' })])
    expect(v.imported).toBe(0)
    expect(v.importedPrevious).toBe(2)
  })

  it('does not tag a lead carrying the sheet\'s own (midnight) date', () => {
    const v = view([lead({ external_reference_id: 'legacy-7', created_at: '2026-09-09T00:00:00' })])
    expect(v.imported).toBe(0)
  })
})

describe('products', () => {
  it('counts a lead under each of its products and says so', () => {
    const records = leadRecords({
      breakdownLeads: [lead({ product_ids: [1, 2] }), lead({ product_ids: [1] })],
      sourceOptions: SOURCE_TYPE_OPTIONS,
      products: [{ id: 1, name: 'Tostem' }, { id: 2, name: 'VOX' }],
    })
    const v = computeSourceView({ leads: leadsIn(records, range), previousLeads: null, allTime: records, sourceOptions: SOURCE_TYPE_OPTIONS, filters: {}, range })
    expect(v.byProduct.find((r) => r.key === 'Tostem').count).toBe(2)
    expect(v.byProduct.find((r) => r.key === 'VOX').count).toBe(1)
    expect(v.multiProduct).toBe(true)
  })

  it('filters on a product the lead holds, whole', () => {
    const records = leadRecords({
      breakdownLeads: [lead({ product_ids: [1, 2] }), lead({ product_ids: [1] })],
      sourceOptions: SOURCE_TYPE_OPTIONS,
      products: [{ id: 1, name: 'Tostem' }, { id: 2, name: 'VOX' }],
    })
    const v = computeSourceView({ leads: leadsIn(records, range), previousLeads: null, allTime: records, sourceOptions: SOURCE_TYPE_OPTIONS, filters: { product: 'VOX' }, range })
    expect(v.total).toBe(1)
  })
})

describe('the list', () => {
  it('orders by latest, or by value with an unquoted lead last (never ₹0)', () => {
    const v = view([
      lead({ created_at: '2026-09-05T06:00:00', quote_value: null }),
      lead({ created_at: '2026-09-04T06:00:00', quote_value: 900000 }),
      lead({ created_at: '2026-09-06T06:00:00', quote_value: 100000 }),
    ])
    const biggest = view(
      [
        lead({ created_at: '2026-09-05T06:00:00', quote_value: null }),
        lead({ created_at: '2026-09-04T06:00:00', quote_value: 900000 }),
        lead({ created_at: '2026-09-06T06:00:00', quote_value: 100000 }),
      ],
      {},
      { sort: 'biggest' }
    )
    expect(v.rows.map((r) => r.value)).toEqual(['₹1.0L', '—', '₹9.0L'])
    expect(biggest.rows.map((r) => r.value)).toEqual(['₹9.0L', '₹1.0L', '—'])
  })
})

describe('colours', () => {
  it('gives every source in the list its own colour, by source', () => {
    const colours = SOURCE_TYPE_OPTIONS.map((o) => sourceColor(o.value))
    expect(new Set(colours).size).toBe(SOURCE_TYPE_OPTIONS.length)
    expect(Object.keys(SOURCE_COLORS).sort()).toEqual(SOURCE_TYPE_OPTIONS.map((o) => o.value).sort())
  })
})
