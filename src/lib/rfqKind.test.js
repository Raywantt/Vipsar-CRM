import { describe, it, expect } from 'vitest'
import { rfqKindForLead, shouldAdvanceToRfq, summariseRfqHistory, FRESH_RFQ, REVISED_RFQ } from './rfqKind'

describe('rfqKindForLead', () => {
  it('is fresh with no prior RFQ activity, whatever the stage', () => {
    for (const stage of ['calling', 'presentation', 'joinery_follow_up', 'rfq', 'quote_submission', 'negotiation']) {
      expect(rfqKindForLead(stage, false)).toBe(FRESH_RFQ)
    }
  })

  it('is revised once a prior RFQ activity already exists, whatever the stage', () => {
    for (const stage of ['calling', 'presentation', 'rfq', 'quote_submission', 'negotiation']) {
      expect(rfqKindForLead(stage, true)).toBe(REVISED_RFQ)
    }
  })

  it('treats won and lost as revised regardless of activity history', () => {
    expect(rfqKindForLead('won', false)).toBe(REVISED_RFQ)
    expect(rfqKindForLead('lost', false)).toBe(REVISED_RFQ)
    expect(rfqKindForLead('won', true)).toBe(REVISED_RFQ)
  })

  it('classifies a paused legacy lead (resolved fallback stage) as fresh when nothing was logged yet', () => {
    // The caller resolves on_hold to whatever it paused at, falling back to
    // 'calling' when there's no stage_history at all.
    expect(rfqKindForLead('calling', false)).toBe(FRESH_RFQ)
  })

  it('regression: a stage moved to RFQ Raised by hand, with no RFQ ever logged, must not make the real first RFQ a revision', () => {
    // Found live 2026-09-10: a lead's stage got bumped to 'rfq' via the
    // stage-chip picker with no rfq_raised activity behind it. The old
    // rank-based rule saw stage='rfq' and called the genuinely-first RFQ
    // logged the next day a revision. hasPriorRfqActivity is the correct
    // signal precisely because it doesn't care how the stage got there.
    expect(rfqKindForLead('rfq', false)).toBe(FRESH_RFQ)
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

describe('summariseRfqHistory', () => {
  const rfq = (created_at, rfq_kind = null) => ({ activity_type: 'rfq_raised', created_at, rfq_kind })
  const other = (created_at) => ({ activity_type: 'call', created_at, rfq_kind: null })

  it('reports nothing for a lead with no RFQ at all', () => {
    expect(summariseRfqHistory([other('2026-09-01T10:00:00')], { rfq_raised: false, rfq_raised_at: null }))
      .toEqual({ raised: false, source: null, freshAt: null, revisedAt: null, revisedCount: 0 })
  })

  it('takes the earliest non-revised RFQ as the fresh date, whatever order they arrive in', () => {
    // LeadDetail fetches activities newest-first, so this must not trust order.
    const s = summariseRfqHistory(
      [rfq('2026-09-09T09:00:00', 'revised'), rfq('2026-09-05T09:00:00', 'fresh')],
      { rfq_raised: true, rfq_raised_at: '2026-09-09' }
    )
    expect(s.source).toBe('activity')
    expect(s.freshAt).toBe('2026-09-05T09:00:00')
  })

  it('never moves the fresh date, however many revisions are logged after it', () => {
    // The owner's stated invariant, pinned: adding revisions can only ever
    // change the revised row.
    const fresh = rfq('2026-09-05T09:00:00', 'fresh')
    let history = [fresh]
    let firstSeen = null
    for (const day of ['07', '09', '11', '14']) {
      history = [rfq(`2026-09-${day}T09:00:00`, 'revised'), ...history]
      const s = summariseRfqHistory(history, {})
      firstSeen ??= s.freshAt
      expect(s.freshAt).toBe('2026-09-05T09:00:00')
      expect(s.freshAt).toBe(firstSeen)
      expect(s.revisedAt).toBe(`2026-09-${day}T09:00:00`)
    }
    expect(summariseRfqHistory(history, {}).revisedCount).toBe(4)
  })

  it('reports no fresh RFQ when every logged one is a revision', () => {
    // Real for a legacy lead already past RFQ stage when the CRM first saw
    // it: relabelling that revision as the fresh RFQ would be a fabrication.
    const s = summariseRfqHistory([rfq('2026-09-07T09:00:00', 'revised')], {})
    expect(s.raised).toBe(true)
    expect(s.freshAt).toBeNull()
    expect(s.revisedAt).toBe('2026-09-07T09:00:00')
  })

  it('shows the LATEST revision and how many there are', () => {
    const s = summariseRfqHistory(
      [
        rfq('2026-09-05T09:00:00', 'fresh'),
        rfq('2026-09-07T09:00:00', 'revised'),
        rfq('2026-09-09T09:00:00', 'revised'),
      ],
      {}
    )
    expect(s.revisedAt).toBe('2026-09-09T09:00:00')
    expect(s.revisedCount).toBe(2)
  })

  it('never invents a revision from untagged pre-2026-09-09 activities', () => {
    // No retroactive classification: three old untagged RFQs are one date,
    // not a guessed fresh-then-revised pair.
    const s = summariseRfqHistory(
      [rfq('2026-05-06T09:00:00'), rfq('2026-06-10T09:00:00'), rfq('2026-06-12T09:00:00')],
      {}
    )
    expect(s.freshAt).toBe('2026-05-06T09:00:00')
    expect(s.revisedAt).toBeNull()
    expect(s.revisedCount).toBe(0)
  })

  it('falls back to the imported lead columns when no RFQ was ever logged', () => {
    // Hundreds of legacy leads carry rfq_raised_at with no matching activity;
    // they must not go blank where they show a date today.
    const s = summariseRfqHistory([other('2026-08-01T09:00:00')], { rfq_raised: true, rfq_raised_at: '2026-08-22' })
    expect(s).toEqual({ raised: true, source: 'lead', freshAt: '2026-08-22', revisedAt: null, revisedCount: 0 })
  })

  it('keeps the fact when the import recorded an RFQ but no date (the Vipul rows)', () => {
    const s = summariseRfqHistory([], { rfq_raised: true, rfq_raised_at: null })
    expect(s.raised).toBe(true)
    expect(s.freshAt).toBeNull()
  })

  it('prefers real activity history over the stored column', () => {
    const s = summariseRfqHistory([rfq('2026-09-05T09:00:00', 'fresh')], { rfq_raised: true, rfq_raised_at: '2026-08-22' })
    expect(s.source).toBe('activity')
    expect(s.freshAt).toBe('2026-09-05T09:00:00')
  })

  it('survives a null activities list', () => {
    expect(summariseRfqHistory(null, null).raised).toBe(false)
  })
})
