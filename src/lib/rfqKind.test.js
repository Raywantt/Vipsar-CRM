import { describe, it, expect } from 'vitest'
import {
  hasStandingPriorRfq,
  isSetAsideRfq,
  rfqKindForLead,
  shouldAdvanceToRfq,
  summariseRfqHistory,
  FRESH_RFQ,
  REVISED_RFQ,
} from './rfqKind'

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

// Owner's ruling, 2026-10-09: an RFQ the Production Executive sent back from
// the technical check never passed, so the exec's corrected version is the
// lead's FRESH RFQ — not a revision of it.
describe('hasStandingPriorRfq', () => {
  const desk = (activity_id, status, sent_back_from = null) => ({ activity_id, status, sent_back_from })

  it('is false for a lead with no RFQ Raised activity at all', () => {
    expect(hasStandingPriorRfq([], [])).toBe(false)
    expect(hasStandingPriorRfq(null, null)).toBe(false)
  })

  it('is true for an earlier RFQ with no desk row (logged before the desk, or while it was off)', () => {
    expect(hasStandingPriorRfq([11], [])).toBe(true)
    expect(hasStandingPriorRfq([11], [desk(99, 'sent_back', 'technical')])).toBe(true)
  })

  it('is false when the only earlier RFQ was sent back from the technical check', () => {
    expect(hasStandingPriorRfq([11], [desk(11, 'sent_back', 'technical')])).toBe(false)
    // …so the corrected one is classed fresh.
    expect(rfqKindForLead('calling', hasStandingPriorRfq([11], [desk(11, 'sent_back', 'technical')]))).toBe(FRESH_RFQ)
  })

  it('stays false through a second and third send-back — fresh until one passes', () => {
    const rows = [desk(11, 'sent_back', 'technical'), desk(12, 'sent_back', 'technical')]
    expect(hasStandingPriorRfq([11, 12], rows)).toBe(false)
  })

  it('is true once the corrected RFQ is waiting, approved, quoted or withdrawn', () => {
    const first = desk(11, 'sent_back', 'technical')
    for (const status of ['with_technical', 'with_estimation', 'with_lixil', 'quoted', 'withdrawn']) {
      expect(hasStandingPriorRfq([11, 12], [first, desk(12, status)])).toBe(true)
    }
  })

  it('is true for an RFQ Estimation sent back — it had passed, so its correction is a revision', () => {
    expect(hasStandingPriorRfq([11], [desk(11, 'sent_back', 'estimation')])).toBe(true)
  })

  it('is true for an RFQ the exec withdrew (only a Production send-back resets it)', () => {
    expect(hasStandingPriorRfq([11], [desk(11, 'withdrawn')])).toBe(true)
  })

  it('is true when an old, desk-less RFQ sits beside a sent-back one', () => {
    expect(hasStandingPriorRfq([10, 11], [desk(11, 'sent_back', 'technical')])).toBe(true)
  })

  it('does not let a price revision (no activity) set anything aside', () => {
    expect(hasStandingPriorRfq([11], [desk(null, 'sent_back', 'technical')])).toBe(true)
  })
})

describe('isSetAsideRfq', () => {
  it('is only a technical send-back', () => {
    expect(isSetAsideRfq({ status: 'sent_back', sent_back_from: 'technical' })).toBe(true)
    expect(isSetAsideRfq({ status: 'sent_back', sent_back_from: 'estimation' })).toBe(false)
    expect(isSetAsideRfq({ status: 'with_technical', sent_back_from: null })).toBe(false)
    expect(isSetAsideRfq(null)).toBe(false)
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

  describe('a fresh RFQ the technical check sent back', () => {
    const sentBack = { activity_id: 1, status: 'sent_back', sent_back_from: 'technical' }
    const withTechnical = { activity_id: 2, status: 'with_technical', sent_back_from: null }
    const fresh1 = { ...rfq('2026-10-07T09:00:00', 'fresh'), id: 1 }
    const fresh2 = { ...rfq('2026-10-08T09:00:00', 'fresh'), id: 2 }

    it('hands the Fresh date to the corrected one, whatever order the activities arrive in', () => {
      for (const history of [[fresh1, fresh2], [fresh2, fresh1]]) {
        const s = summariseRfqHistory(history, {}, [sentBack, withTechnical])
        expect(s.freshAt).toBe('2026-10-08T09:00:00')
        expect(s.revisedAt).toBeNull()
        expect(s.revisedCount).toBe(0)
      }
    })

    it('shows the latest attempt when every fresh one was sent back', () => {
      const secondBack = { activity_id: 2, status: 'sent_back', sent_back_from: 'technical' }
      const s = summariseRfqHistory([fresh1, fresh2], {}, [sentBack, secondBack])
      expect(s.freshAt).toBe('2026-10-08T09:00:00')
    })

    it('shows the one lone attempt when it was sent back and nothing was re-raised', () => {
      expect(summariseRfqHistory([fresh1], {}, [sentBack]).freshAt).toBe('2026-10-07T09:00:00')
    })

    it('does not move once the corrected one is approved and revisions follow', () => {
      const approved = { activity_id: 2, status: 'with_estimation', sent_back_from: null }
      const rev = { ...rfq('2026-10-09T09:00:00', 'revised'), id: 3 }
      const s = summariseRfqHistory([rev, fresh2, fresh1], {}, [sentBack, approved])
      expect(s.freshAt).toBe('2026-10-08T09:00:00')
      expect(s.revisedAt).toBe('2026-10-09T09:00:00')
    })

    it('leaves a lead with no desk rows exactly as before — the earliest untagged one wins', () => {
      const old = [{ ...rfq('2026-05-06T09:00:00'), id: 7 }, { ...rfq('2026-06-10T09:00:00'), id: 8 }]
      expect(summariseRfqHistory(old, {}).freshAt).toBe('2026-05-06T09:00:00')
      expect(summariseRfqHistory(old, {}, []).freshAt).toBe('2026-05-06T09:00:00')
    })
  })
})
