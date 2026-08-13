import { describe, it, expect } from 'vitest'
import { FUNNEL_SEQUENCE, stageRank, isBackwardStageMove } from './stageProgress'

// The rule these pin (owner's ruling, 2026-08-13): a sales executive may move
// a lead FORWARD only. The same rule is enforced for real by the
// owner_only_stage_change trigger in Schema/migration_lead_edit_rights.sql —
// if this file is changed, that trigger has to change with it.

describe('FUNNEL_SEQUENCE', () => {
  it('is the 8 sequential stages, excluding the off-funnel three', () => {
    expect(FUNNEL_SEQUENCE).toEqual([
      'calling',
      'presentation',
      'joinery_follow_up',
      'measurements',
      'design_discussion',
      'rfq',
      'quote_submission',
      'negotiation',
    ])
  })

  it('gives on_hold / won / lost no rank', () => {
    expect(stageRank('on_hold')).toBeNull()
    expect(stageRank('won')).toBeNull()
    expect(stageRank('lost')).toBeNull()
  })

  it('gives an unrecognised legacy stage no rank', () => {
    expect(stageRank('some_imported_value')).toBeNull()
  })
})

describe('isBackwardStageMove', () => {
  it('allows moving forward, one step or several', () => {
    expect(isBackwardStageMove('calling', 'presentation')).toBe(false)
    expect(isBackwardStageMove('calling', 'negotiation')).toBe(false)
    expect(isBackwardStageMove('rfq', 'quote_submission')).toBe(false)
  })

  it('blocks moving back, one step or several', () => {
    expect(isBackwardStageMove('presentation', 'calling')).toBe(true)
    expect(isBackwardStageMove('negotiation', 'calling')).toBe(true)
    // the exact case the owner described: 3 -> 2
    expect(isBackwardStageMove('joinery_follow_up', 'presentation')).toBe(true)
  })

  it('treats a no-op as not backward', () => {
    expect(isBackwardStageMove('rfq', 'rfq')).toBe(false)
  })

  it('always allows pausing or closing, from anywhere in the funnel', () => {
    expect(isBackwardStageMove('negotiation', 'on_hold')).toBe(false)
    expect(isBackwardStageMove('calling', 'won')).toBe(false)
    expect(isBackwardStageMove('calling', 'lost')).toBe(false)
    expect(isBackwardStageMove('negotiation', 'lost')).toBe(false)
  })

  it('blocks reopening a decided deal, in any direction', () => {
    expect(isBackwardStageMove('won', 'negotiation')).toBe(true)
    expect(isBackwardStageMove('lost', 'negotiation')).toBe(true)
    expect(isBackwardStageMove('lost', 'calling')).toBe(true)
    // even "forward" out of a close is still a reopen
    expect(isBackwardStageMove('lost', 'won')).toBe(true)
  })

  it('ranks an on-hold lead at the stage it paused at, not at on_hold', () => {
    // paused after negotiation, trying to go back to calling
    expect(isBackwardStageMove('on_hold', 'calling', 'negotiation')).toBe(true)
    // resuming exactly where it paused
    expect(isBackwardStageMove('on_hold', 'negotiation', 'negotiation')).toBe(false)
    // resuming further forward than it paused
    expect(isBackwardStageMove('on_hold', 'negotiation', 'rfq')).toBe(false)
  })

  it('closes the On hold laundering route', () => {
    // The whole reason pausedAt is threaded through: without it, on_hold has
    // no rank, so negotiation -> on_hold -> calling would read as two legal
    // moves and walk the lead back to the start.
    expect(isBackwardStageMove('negotiation', 'on_hold')).toBe(false)
    expect(isBackwardStageMove('on_hold', 'calling', 'negotiation')).toBe(true)
  })

  it('falls back to permissive when the paused stage is unknown', () => {
    // A lead never explicitly moved has no stage_history row for its default
    // 'calling', so pausedAt can come back null. Nothing is guessed at.
    expect(isBackwardStageMove('on_hold', 'calling', null)).toBe(false)
  })

  it('leaves an unrecognised legacy stage alone rather than guessing', () => {
    expect(isBackwardStageMove('some_imported_value', 'calling')).toBe(false)
    expect(isBackwardStageMove('negotiation', 'some_imported_value')).toBe(false)
  })

  it('is inert on missing input', () => {
    expect(isBackwardStageMove(null, 'calling')).toBe(false)
    expect(isBackwardStageMove('calling', null)).toBe(false)
  })
})
