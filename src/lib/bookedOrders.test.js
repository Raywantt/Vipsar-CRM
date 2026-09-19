import { describe, it, expect } from 'vitest'
import { computeOrderValueActuals } from '../components/TargetsVsActualsCard'
import {
  dealSizeBand,
  closedDeals,
  dealsIn,
  bookedFacets,
  computeBookedView,
} from './bookedOrders'

// Naive timestamps, the way PostgREST serialises stage_history.changed_at.
const range = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59) }
const previousRange = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59) }

// A stage_history 'won' row, newest first is the caller's job (as in production).
const won = (leadId, changedAt, ownerId, orderValue, bdm = null) => ({
  lead_id: leadId,
  changed_at: changedAt,
  leads: { owner_employee_id: ownerId, bdm_employee_id: bdm, order_value: orderValue },
})

const lead = (id, extra = {}) => ({
  id,
  external_reference_id: null,
  created_at: '2026-08-01T05:00:00',
  source_type: 'referral_other',
  office_territory: 'ludhiana',
  bdm_employee_id: null,
  parties: { name: `Client ${id}` },
  sites: null,
  employees: { name: `Owner ${extra.owner ?? 1}` },
  products: { name: 'TOSTEM' },
  ...extra,
})

const leads = [
  lead(1, { owner: 1, source_type: 'scanning', office_territory: 'ludhiana' }),
  lead(2, { owner: 1, source_type: 'referral_other', office_territory: 'amritsar' }),
  lead(3, { owner: 2, source_type: 'referral_other', office_territory: 'amritsar' }),
  lead(4, { owner: 2, source_type: 'lixil', office_territory: null, bdm_employee_id: 9 }),
]

// newest first
const history = [
  won(4, '2026-09-20T05:00:00', 2, 3000000, 9),
  won(3, '2026-09-15T05:00:00', 2, 800000),
  won(2, '2026-09-10T05:00:00', 1, 1200000),
  won(1, '2026-09-05T05:00:00', 1, 400000),
]

const roster = [
  { id: 1, name: 'Owner 1' },
  { id: 2, name: 'Owner 2' },
  { id: 3, name: 'Owner 3' }, // closed nothing
]

const all = closedDeals({ wonStageHistory: history, breakdownLeads: leads, employees: roster })
const deals = dealsIn(all, range)
const view = (filters = {}, extra = {}) =>
  computeBookedView({ deals, previousDeals: null, roster, filters, previousLabel: 'last month', ...extra })

describe('dealSizeBand', () => {
  it('cuts at ₹5L / ₹10L / ₹20L, edge going to the higher band', () => {
    expect(dealSizeBand(499999)).toBe('lt5')
    expect(dealSizeBand(500000)).toBe('5to10')
    expect(dealSizeBand(1000000)).toBe('10to20')
    expect(dealSizeBand(2000000)).toBe('20plus')
  })

  it('gives a deal with no value no band at all rather than the lowest one', () => {
    expect(dealSizeBand(0)).toBeNull()
    expect(dealSizeBand(null)).toBeNull()
  })
})

describe('closedDeals', () => {
  it('keeps one deal per lead — the most recent won row — and skips rows RLS hid', () => {
    const rows = [
      won(1, '2026-09-20T05:00:00', 1, 500000),
      won(1, '2026-07-01T05:00:00', 1, 100000), // an older win of the same lead
      { lead_id: 2, changed_at: '2026-09-18T05:00:00', leads: null },
    ]
    const result = closedDeals({ wonStageHistory: rows, breakdownLeads: leads })
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(500000)
  })

  it('credits the lead’s current owner, and names the lead through the shared rule', () => {
    const d = all.find((x) => x.leadId === 3)
    expect(d.ownerId).toBe(2)
    expect(d.ownerName).toBe('Owner 2')
    expect(d.name).toBe('Client 3')
  })

  it('falls back to a placeholder name and no facts for a lead the leads fetch does not hold', () => {
    const [d] = closedDeals({ wonStageHistory: [won(99, '2026-09-01T05:00:00', 1, 1)], breakdownLeads: [], employees: roster })
    expect(d.name).toBe('Lead #99')
    expect(d.source).toBeNull()
    expect(d.ownerName).toBe('Owner 1')
  })

  it('totals to exactly what the KPI tile and heatmap compute for the same range', () => {
    const fromDeals = dealsIn(all, range).reduce((s, d) => s + d.value, 0)
    expect(fromDeals).toBe(computeOrderValueActuals(history, range, false))
    const perExec = computeOrderValueActuals(history, range, true)
    const byOwner = new Map()
    dealsIn(all, range).forEach((d) => byOwner.set(d.ownerId, (byOwner.get(d.ownerId) ?? 0) + d.value))
    expect([...byOwner.entries()].sort()).toEqual([...perExec.entries()].sort())
  })

  describe('import dates', () => {
    const legacy = (id) => lead(id, { external_reference_id: `legacy-${id}` })

    it('tags only an imported lead stamped exactly 12:00:00 between 1 and 6 Sep', () => {
      const result = closedDeals({
        wonStageHistory: [
          won(10, '2026-09-03T12:00:00', 1, 1), // the import stamp
          won(11, '2026-09-03T10:39:59.162808', 1, 1), // legacy, but a real moment
          won(12, '2026-09-07T12:00:00', 1, 1), // right time, after the import window
        ],
        breakdownLeads: [legacy(10), legacy(11), legacy(12)],
      })
      expect(result.map((d) => d.importDate)).toEqual([true, false, false])
    })

    it('never tags an app-created lead, whatever time it was won at', () => {
      const [d] = closedDeals({ wonStageHistory: [won(20, '2026-09-03T12:00:00', 1, 1)], breakdownLeads: [lead(20)] })
      expect(d.importDate).toBe(false)
    })
  })

  // Time to close (created_at → won) is deliberately NOT reported. Measured on the
  // live data it says nothing true: an imported lead's created_at is the day of
  // the import, and most app leads were entered at the moment they were won
  // (0, 1, 1, 2 days) — so it would show when someone typed a deal in, not how
  // fast it closed. Revisit once leads carry a real creation date.
  it('carries no time-to-close figure', () => {
    const [d] = closedDeals({
      wonStageHistory: [won(30, '2026-09-11T05:00:00', 1, 1)],
      breakdownLeads: [lead(30, { created_at: '2026-09-01T05:00:00' })],
    })
    expect(d).not.toHaveProperty('tookDays')
  })
})

describe('dealsIn', () => {
  it('keeps only deals won inside the range', () => {
    expect(dealsIn(all, previousRange)).toHaveLength(0)
    expect(dealsIn(all, range)).toHaveLength(4)
  })
})

describe('bookedFacets', () => {
  it('offers the owners that have deals AND the roster, so an exec with none can still be picked', () => {
    const f = bookedFacets(deals, roster)
    expect(f.owners.map((o) => [o.name, o.count])).toEqual([['Owner 1', 2], ['Owner 2', 2], ['Owner 3', 0]])
    expect(f.total).toBe(4)
  })

  it('offers only the sources and size bands the period actually has', () => {
    const f = bookedFacets(deals, roster)
    expect(f.sources.map((s) => s.key)).toEqual(['scanning', 'lixil', 'referral_other'])
    expect(f.sizes.map((s) => s.key)).toEqual(['lt5', '5to10', '10to20', '20plus'])
  })

  it('hides a facet that has a single choice', () => {
    const one = dealsIn(closedDeals({ wonStageHistory: [history[3]], breakdownLeads: leads }), range)
    const f = bookedFacets(one, [])
    expect(f.owners).toEqual([])
    expect(f.sources).toEqual([])
    expect(f.sizes).toEqual([])
    // Every product is TOSTEM here, so the Product facet has nothing to choose.
    expect(f.products).toEqual([])
  })
})

describe('computeBookedView', () => {
  it('reads the strip: booked, deals, average over priced deals, biggest', () => {
    const v = view()
    expect(v.total).toBe(4)
    expect(v.stats.map((s) => s.value)).toEqual(['₹54.0L', '4', '₹13.5L', '₹30.0L'])
    expect(v.stats[3].sub).toBe('Client 4')
  })

  it('leaves a won lead with no order value out of the average but still counts the deal', () => {
    const withUnpriced = dealsIn(
      closedDeals({ wonStageHistory: [won(1, '2026-09-05T05:00:00', 1, 600000), won(2, '2026-09-06T05:00:00', 1, null)], breakdownLeads: leads }),
      range
    )
    const v = computeBookedView({ deals: withUnpriced, previousDeals: null, roster, filters: {}, previousLabel: 'x' })
    expect(v.stats[1].value).toBe('2')
    expect(v.stats[2].value).toBe('₹6.0L')
    expect(v.unpriced).toBe(1)
    expect(v.rows.find((r) => r.leadId === 2).value).toBe('—')
  })

  it('sets each figure against the previous period, like for like under a filter', () => {
    const previousDeals = dealsIn(
      closedDeals({ wonStageHistory: [won(1, '2026-08-05T05:00:00', 1, 200000), won(3, '2026-08-06T05:00:00', 2, 5000000)], breakdownLeads: leads }),
      previousRange
    )
    const all4 = computeBookedView({ deals, previousDeals, roster, filters: {}, previousLabel: 'last month' })
    expect(all4.stats[0].sub).toBe('▲ 4% vs last month')
    // Owner 1 alone: ₹16L this month against ₹2L last month — Owner 2's ₹50L stays out of it.
    const owner1 = computeBookedView({ deals, previousDeals, roster, filters: { owner: '1' }, previousLabel: 'last month' })
    expect(owner1.stats[0].sub).toBe('▲ 700% vs last month')
  })

  it('says nothing about a comparison that is not there, instead of inventing a zero', () => {
    expect(view().stats[0].sub).toBe('this period')
  })

  describe('filters', () => {
    it('narrows the strip, the deals and the breakdowns to the chosen owner', () => {
      const v = view({ owner: '1' })
      expect(v.total).toBe(2)
      expect(v.rows.map((r) => r.leadId)).toEqual([2, 1])
      expect(v.stats[0].value).toBe('₹16.0L')
    })

    it('matches a source, a deal-size band and a product', () => {
      expect(view({ source: 'scanning' }).rows.map((r) => r.leadId)).toEqual([1])
      expect(view({ size: '20plus' }).rows.map((r) => r.leadId)).toEqual([4])
      expect(view({ product: 'TOSTEM' }).total).toBe(4)
      expect(view({ product: 'VOX' }).total).toBe(0)
    })

    it('never matches a deal with no value against a size band', () => {
      const unpriced = dealsIn(closedDeals({ wonStageHistory: [won(1, '2026-09-05T05:00:00', 1, null)], breakdownLeads: leads }), range)
      const v = computeBookedView({ deals: unpriced, previousDeals: null, roster, filters: { size: 'lt5' }, previousLabel: 'x' })
      expect(v.total).toBe(0)
    })

    it('does not let "Closed by" filter by its own dimension — an exec pick keeps every exec listed', () => {
      const v = view({ owner: '1' })
      expect(v.byExec.map((e) => e.name)).toEqual(['Owner 2', 'Owner 1', 'Owner 3'])
      expect(v.byExec.find((e) => e.key === '1').selected).toBe(true)
    })

    it('lets "Closed by" follow the other filters', () => {
      const v = view({ source: 'scanning' })
      expect(v.byExec.map((e) => [e.name, e.value])).toEqual([['Owner 1', '₹4.0L'], ['Owner 2', '₹0'], ['Owner 3', '₹0']])
    })

    it('does not let "By source" filter by its own dimension', () => {
      const v = view({ source: 'scanning' })
      expect(v.bySource.map((r) => r.label).sort()).toEqual(['Lixil', 'Referral', 'Scanning'])
      expect(v.bySource.find((r) => r.label === 'Scanning').active).toBe(true)
      // …but it does follow the owner filter.
      expect(view({ owner: '2' }).bySource.find((r) => r.label === 'Scanning').count).toBe(0)
    })
  })

  describe('closed by', () => {
    it('ranks execs by value and keeps one who closed nothing at the bottom, saying so', () => {
      const v = view()
      expect(v.byExec.map((e) => e.name)).toEqual(['Owner 2', 'Owner 1', 'Owner 3'])
      expect(v.byExec[0].sub).toBe('2 deals · avg ₹19.0L · 70% of booked')
      expect(v.byExec[2].sub).toBe('no orders booked')
    })

    it('scales each bar against the biggest exec', () => {
      const v = view()
      expect(v.byExec[0].pct).toBe('100%')
      expect(v.byExec[2].pct).toBe('0%')
    })
  })

  describe('where the orders came from', () => {
    it('shows every source of the period, biggest first, with share of booked', () => {
      const v = view()
      expect(v.bySource.map((r) => r.label)).toEqual(['Lixil', 'Referral', 'Scanning'])
      expect(v.bySource[0].sub).toBe('1 deal · 56% of booked')
    })

    it('names a lead with no territory "Not set", last-ish by value, never dropped', () => {
      const v = view()
      expect(v.byTerritory.map((r) => r.label)).toContain('Not set')
      expect(v.byTerritory.reduce((s, r) => s + r.count, 0)).toBe(4)
    })

    it('reports the BDM-sourced deals as a single line, or nothing when there are none', () => {
      expect(view().viaBdm).toEqual({ count: 1, value: '₹30.0L' })
      expect(view({ source: 'scanning' }).viaBdm).toBeNull()
    })

    it('leaves the product breakdown out when the period has only one product', () => {
      expect(view().byProduct).toEqual([])
    })
  })

  describe('closed deals', () => {
    it('lists latest first, and biggest first on request', () => {
      expect(view().rows.map((r) => r.leadId)).toEqual([4, 3, 2, 1])
      expect(view({}, { sort: 'biggest' }).rows.map((r) => r.leadId)).toEqual([4, 2, 3, 1])
    })

    it('carries the quiet line: where it came from and which office', () => {
      const row = view().rows.find((r) => r.leadId === 1)
      expect(row.meta).toBe('Scanning · Ludhiana')
    })

    it('rounds a figure under ₹1L to whole rupees, so an average never prints its decimals', () => {
      const small = dealsIn(
        closedDeals({
          wonStageHistory: [won(1, '2026-09-05T05:00:00', 1, 83239), won(2, '2026-09-06T05:00:00', 1, 47941), won(3, '2026-09-07T05:00:00', 1, 78624)],
          breakdownLeads: leads,
        }),
        range
      )
      const v = computeBookedView({ deals: small, previousDeals: null, roster, filters: {}, previousLabel: 'x' })
      // (83239 + 47941 + 78624) / 3 = 69934.667
      expect(v.byExec.find((e) => e.key === '1').sub).toContain('avg ₹69,935')
      expect(v.stats[2].value).toBe('₹69,935')
    })
  })

  it('counts deals that carry an import date so the popup can say so', () => {
    const imported = dealsIn(
      closedDeals({
        wonStageHistory: [won(1, '2026-09-03T12:00:00', 1, 100000), won(2, '2026-09-10T05:00:00', 1, 200000)],
        breakdownLeads: [lead(1, { external_reference_id: 'legacy-1' }), lead(2)],
      }),
      range
    )
    const v = computeBookedView({ deals: imported, previousDeals: null, roster, filters: {}, previousLabel: 'x' })
    expect(v.imported).toBe(1)
    // …and still counts them, so this total stays equal to the KPI tile's.
    expect(v.stats[0].value).toBe('₹3.0L')
  })
})
