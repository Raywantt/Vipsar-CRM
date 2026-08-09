import { describe, it, expect } from 'vitest'
import { isOpenLead, dealValueFor, sumOpenPipelineValue } from './pipelineValue'

describe('isOpenLead', () => {
  it('treats won and lost as closed', () => {
    expect(isOpenLead({ current_stage: 'won' })).toBe(false)
    expect(isOpenLead({ current_stage: 'lost' })).toBe(false)
  })

  it('treats every other stage, including on_hold, as open', () => {
    expect(isOpenLead({ current_stage: 'negotiation' })).toBe(true)
    expect(isOpenLead({ current_stage: 'on_hold' })).toBe(true)
  })

  it('defaults a missing stage to calling (open)', () => {
    expect(isOpenLead({ current_stage: null })).toBe(true)
    expect(isOpenLead({})).toBe(true)
  })
})

describe('dealValueFor', () => {
  it('an open lead is valued at its quote_value alone, ignoring order_value', () => {
    // order_value should only ever be set once a deal is booked/won — a
    // still-open lead carrying one anyway (the flagged process gap in
    // CLAUDE.md) must not leak into the figure.
    expect(dealValueFor({ current_stage: 'negotiation', quote_value: 50000, order_value: 999999 })).toBe(50000)
  })

  it('an open lead with no quote at all is valued at 0, not fabricated', () => {
    expect(dealValueFor({ current_stage: 'calling', quote_value: null, order_value: null })).toBe(0)
  })

  it('a won lead prefers order_value over quote_value', () => {
    expect(dealValueFor({ current_stage: 'won', quote_value: 50000, order_value: 60000 })).toBe(60000)
  })

  it('a won lead falls back to quote_value when order_value was never entered', () => {
    expect(dealValueFor({ current_stage: 'won', quote_value: 50000, order_value: null })).toBe(50000)
  })

  it('a lost lead uses the same order_value-first fallback as won', () => {
    expect(dealValueFor({ current_stage: 'lost', quote_value: 50000, order_value: null })).toBe(50000)
  })

  it('order_value of 0 is a real value (not "missing"), so it is not overridden by quote_value', () => {
    // `??` only falls through on null/undefined, so an explicit 0 order_value
    // (a deal genuinely booked for nothing) stays 0, unlike a never-entered one.
    expect(dealValueFor({ current_stage: 'won', quote_value: 50000, order_value: 0 })).toBe(0)
  })
})

describe('sumOpenPipelineValue', () => {
  it('sums only open leads, using each one\'s dealValueFor', () => {
    const leads = [
      { current_stage: 'negotiation', quote_value: 100000, order_value: null },
      { current_stage: 'won', quote_value: 50000, order_value: 80000 },
      { current_stage: 'rfq', quote_value: null, order_value: null },
      { current_stage: 'lost', quote_value: 20000, order_value: null },
    ]
    // Only the two open leads count: 100000 + 0
    expect(sumOpenPipelineValue(leads)).toBe(100000)
  })

  it('returns 0 for an empty list', () => {
    expect(sumOpenPipelineValue([])).toBe(0)
  })
})
