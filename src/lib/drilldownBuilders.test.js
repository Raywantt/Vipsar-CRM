import { describe, it, expect } from 'vitest'
import {
  wonEventsInRange,
  buildMixPanel,
  buildCategoryMixPanel,
  buildLossPanel,
  buildWinRatePanel,
  buildPipelinePanel,
} from './drilldownBuilders'

const range = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59) }

describe('wonEventsInRange', () => {
  it('keeps only the most recent won row per lead (re-opened/re-won leads counted once)', () => {
    const wonStageHistory = [
      { lead_id: 'L1', changed_at: '2026-08-10T00:00:00Z', leads: { owner_employee_id: 'e1', order_value: 5000 } },
      { lead_id: 'L1', changed_at: '2026-08-05T00:00:00Z', leads: { owner_employee_id: 'e1', order_value: 4000 } },
    ]
    const events = wonEventsInRange(wonStageHistory, range)
    expect(events).toHaveLength(1)
    expect(events[0].value).toBe(5000)
  })

  it('drops rows RLS hid (leads: null)', () => {
    const wonStageHistory = [{ lead_id: 'L2', changed_at: '2026-08-10T00:00:00Z', leads: null }]
    expect(wonEventsInRange(wonStageHistory, range)).toHaveLength(0)
  })

  it('excludes events outside the given range', () => {
    const wonStageHistory = [
      { lead_id: 'L3', changed_at: '2026-07-15T00:00:00Z', leads: { owner_employee_id: 'e1', order_value: 1000 } },
    ]
    expect(wonEventsInRange(wonStageHistory, range)).toHaveLength(0)
  })
})

describe('buildMixPanel', () => {
  const sourceOptions = [
    { label: 'Scanning', value: 'scanning' },
    { label: 'Lixil', value: 'lixil' },
  ]

  it('computes share of total and all-time conversion per source', () => {
    const periodLeads = [{ source_type: 'scanning' }, { source_type: 'scanning' }, { source_type: 'lixil' }]
    const breakdownLeads = [
      { source_type: 'scanning', current_stage: 'won' },
      { source_type: 'scanning', current_stage: 'negotiation' },
      { source_type: 'lixil', current_stage: 'lost' },
    ]
    const panel = buildMixPanel({ periodLeads, breakdownLeads, sourceOptions, rangeLabel: 'This month' })
    expect(panel.kind).toBe('mix')
    expect(panel.value).toBe('3')
    const scanning = panel.mixRows.find((r) => r.label === 'Scanning')
    expect(scanning.count).toBe(2)
    expect(scanning.share).toBe('67%')
    expect(scanning.conv).toBe('50%') // 1 won / 2 all-time scanning leads
  })

  it('renders "—" conversion for a source with zero all-time leads', () => {
    const panel = buildMixPanel({ periodLeads: [], breakdownLeads: [], sourceOptions, rangeLabel: 'This month' })
    panel.mixRows.forEach((r) => expect(r.conv).toBe('—'))
  })
})

describe('buildCategoryMixPanel', () => {
  it('groups by the supplied category function and sorts by count desc', () => {
    const breakdownLeads = [
      { id: 1, current_stage: 'won', order_value: 1000, sites: { locality: 'Model Town' } },
      { id: 2, current_stage: 'negotiation', order_value: 0, sites: { locality: 'Model Town' } },
      { id: 3, current_stage: 'lost', order_value: 0, sites: { locality: 'DLF' } },
    ]
    const panel = buildCategoryMixPanel({
      breakdownLeads,
      getCategory: (l) => l.sites?.locality ?? 'Unknown',
      eyebrow: 'Company · area',
      title: 'Leads by area',
      unit: 'area',
    })
    expect(panel.mixRows[0]).toMatchObject({ label: 'Model Town', count: 2 })
    expect(panel.mixRows[1]).toMatchObject({ label: 'DLF', count: 1 })
  })
})

describe('buildLossPanel', () => {
  it('buckets reasons and named competitors, and falls back unrecognized reasons to "other"', () => {
    const lossReasons = [
      { reason: 'price', leads: { order_value: 10000 }, lost_at: '2026-08-01', competitor_name: 'Acme' },
      { reason: 'price', leads: { order_value: 5000 }, lost_at: '2026-08-02', competitor_name: 'Acme' },
      { reason: 'not-a-real-reason', leads: { quote_value: 2000 }, lost_at: '2026-08-03', competitor_name: null },
    ]
    const panel = buildLossPanel({ lossReasons })
    expect(panel.value).toBe('3')
    const priceRow = panel.lossRows.find((r) => r.label === 'price')
    expect(priceRow.count).toBe(2)
    const otherRow = panel.lossRows.find((r) => r.label === 'other')
    expect(otherRow.count).toBe(1)
    expect(panel.compRows).toEqual([{ name: 'Acme', count: 2, value: expect.any(String) }])
  })

  it('handles an empty loss list without dividing by zero', () => {
    const panel = buildLossPanel({ lossReasons: [] })
    expect(panel.value).toBe('0')
    expect(panel.compRows).toEqual([])
  })
})

describe('buildWinRatePanel', () => {
  const employees = [{ id: 'e1', name: 'Asha' }, { id: 'e2', name: 'Ravi' }]

  it('computes win rate from decided (won/lost) leads only, ignoring rows outside the range', () => {
    const decidedStageHistory = [
      { stage: 'won', changed_at: '2026-08-05', leads: { owner_employee_id: 'e1' } },
      { stage: 'lost', changed_at: '2026-08-06', leads: { owner_employee_id: 'e1' } },
      { stage: 'won', changed_at: '2026-07-01', leads: { owner_employee_id: 'e2' } }, // outside range
    ]
    const panel = buildWinRatePanel({ decidedStageHistory, employees, range, rangeLabel: 'This month' })
    expect(panel.value).toBe('50%')
    expect(panel.stats.find((s) => s.label === 'Decided').value).toBe('2')
  })

  it('returns "—" when nothing was decided in range', () => {
    const panel = buildWinRatePanel({ decidedStageHistory: [], employees, range, rangeLabel: 'This month' })
    expect(panel.value).toBe('—')
  })
})

describe('buildPipelinePanel', () => {
  it('excludes lost and on_hold from the stage-to-stage conversion chain (no "won -> lost" row)', () => {
    const breakdownLeads = [
      { id: 'L1', current_stage: 'calling', quote_value: 1000, order_value: null },
    ]
    const funnelStageHistory = []
    const panel = buildPipelinePanel({ mode: 'funnel', breakdownLeads, funnelStageHistory })
    const labels = panel.convRows.map((r) => r.label)
    labels.forEach((label) => {
      expect(label).not.toMatch(/Won.*Lost/i)
      expect(label).not.toMatch(/On hold/i)
    })
  })

  it('sums open pipeline value only from leads not won/lost', () => {
    const breakdownLeads = [
      { id: 'L1', current_stage: 'negotiation', quote_value: 10000, order_value: null },
      { id: 'L2', current_stage: 'won', quote_value: 5000, order_value: 8000 },
    ]
    const panel = buildPipelinePanel({ mode: 'stage', breakdownLeads, funnelStageHistory: [] })
    expect(panel.stats.find((s) => s.label === 'Open value').sub).toBe('1 leads')
  })
})
