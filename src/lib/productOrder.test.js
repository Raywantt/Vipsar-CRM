import { describe, it, expect } from 'vitest'
import { compareProducts } from './productOrder'
import { RFQ_SEGMENT_OPTIONS } from './rfqDesk'

const PORTFOLIO = ['Tostem', 'Noki', 'IN16', 'Giesta', 'Sky Light', 'Wrapping bars', 'PremiAL', 'VOX', 'StoneLam', 'Others']

describe("VIPSAR's product portfolio order", () => {
  it('is alphabetical with Others last, whatever the case', () => {
    const sorted = PORTFOLIO.map((name) => ({ name })).sort(compareProducts).map((p) => p.name)
    expect(sorted).toEqual(['Giesta', 'IN16', 'Noki', 'PremiAL', 'Sky Light', 'StoneLam', 'Tostem', 'VOX', 'Wrapping bars', 'Others'])
  })

  it("matches the RFQ form's segment list, name for name and in the same order", () => {
    const sorted = PORTFOLIO.map((name) => ({ name })).sort(compareProducts).map((p) => p.name)
    expect(RFQ_SEGMENT_OPTIONS.map((o) => o.label)).toEqual(sorted)
  })
})
