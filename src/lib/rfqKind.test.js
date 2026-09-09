import { describe, it, expect } from 'vitest'
import { rfqKindForStage, shouldAdvanceToRfq, FRESH_RFQ, REVISED_RFQ } from './rfqKind'

describe('rfqKindForStage', () => {
  it('is fresh below the RFQ threshold', () => {
    for (const stage of ['calling', 'presentation', 'joinery_follow_up']) {
      expect(rfqKindForStage(stage)).toBe(FRESH_RFQ)
    }
  })

  it('is revised at RFQ Raised stage or later', () => {
    for (const stage of ['rfq', 'quote_submission', 'negotiation']) {
      expect(rfqKindForStage(stage)).toBe(REVISED_RFQ)
    }
  })

  it('treats won and lost as revised', () => {
    expect(rfqKindForStage('won')).toBe(REVISED_RFQ)
    expect(rfqKindForStage('lost')).toBe(REVISED_RFQ)
  })

  it('falls back to fresh for an unranked/legacy stage', () => {
    expect(rfqKindForStage('some_imported_value')).toBe(FRESH_RFQ)
    expect(rfqKindForStage(null)).toBe(FRESH_RFQ)
  })

  it('classifies a paused legacy lead (resolved fallback stage) as fresh', () => {
    // The caller resolves on_hold to whatever it paused at, falling back to
    // 'calling' when there's no stage_history at all — exactly the legacy-
    // import case with no data to say what stage it paused on.
    expect(rfqKindForStage('calling')).toBe(FRESH_RFQ)
  })
})

describe('shouldAdvanceToRfq', () => {
  it('advances from any pre-RFQ stage', () => {
    expect(shouldAdvanceToRfq('calling')).toBe(true)
    expect(shouldAdvanceToRfq('presentation')).toBe(true)
    expect(shouldAdvanceToRfq('joinery_follow_up')).toBe(true)
  })

  it('never advances once already at or past RFQ', () => {
    expect(shouldAdvanceToRfq('rfq')).toBe(false)
    expect(shouldAdvanceToRfq('quote_submission')).toBe(false)
    expect(shouldAdvanceToRfq('negotiation')).toBe(false)
  })

  it('never advances an on_hold lead — resuming stays a deliberate action', () => {
    expect(shouldAdvanceToRfq('on_hold')).toBe(false)
  })

  it('never reopens a decided deal', () => {
    expect(shouldAdvanceToRfq('won')).toBe(false)
    expect(shouldAdvanceToRfq('lost')).toBe(false)
  })

  it('does not touch an unrecognised legacy stage', () => {
    expect(shouldAdvanceToRfq('some_imported_value')).toBe(false)
  })
})
