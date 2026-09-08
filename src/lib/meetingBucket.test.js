import { describe, it, expect } from 'vitest'
import { meetingTypeForStage, OLD_MEETING, NEW_MEETING, PICKABLE_MEETING } from './meetingBucket'
import { LEAD_STAGE_OPTIONS } from './leadStageOptions'
import { ACTIVITY_TYPES, LOGGABLE_ACTIVITY_TYPES, ACTIVITY_LABELS } from './activityTypes'

describe('meetingTypeForStage', () => {
  it('buckets everything below RFQ as a new meeting', () => {
    for (const stage of ['calling', 'presentation', 'joinery_follow_up']) {
      expect(meetingTypeForStage(stage)).toBe(NEW_MEETING)
    }
  })

  it('buckets RFQ and everything after it as an old meeting', () => {
    for (const stage of ['rfq', 'quote_submission', 'negotiation']) {
      expect(meetingTypeForStage(stage)).toBe(OLD_MEETING)
    }
  })

  // The three stages with no funnel rank of their own. on_hold was named by
  // the owner directly; won/lost follow from "RFQ and above".
  it('buckets on hold, won and lost as old meetings', () => {
    expect(meetingTypeForStage('on_hold')).toBe(OLD_MEETING)
    expect(meetingTypeForStage('won')).toBe(OLD_MEETING)
    expect(meetingTypeForStage('lost')).toBe(OLD_MEETING)
  })

  it('falls back to new for an unset or unrecognised legacy stage', () => {
    expect(meetingTypeForStage(null)).toBe(NEW_MEETING)
    expect(meetingTypeForStage(undefined)).toBe(NEW_MEETING)
    expect(meetingTypeForStage('hot')).toBe(NEW_MEETING)
  })

  // The rule has to keep covering the taxonomy, not a snapshot of it: a stage
  // added to LEAD_STAGE_OPTIONS later must still land in exactly one bucket.
  it('assigns every canonical stage to exactly one bucket', () => {
    for (const stage of LEAD_STAGE_OPTIONS) {
      expect([OLD_MEETING, NEW_MEETING]).toContain(meetingTypeForStage(stage))
    }
  })
})

describe('activity type lists', () => {
  it('never offers the unbucketed meeting as a storable activity type', () => {
    expect(ACTIVITY_TYPES.map((t) => t.value)).not.toContain(PICKABLE_MEETING)
    expect(ACTIVITY_TYPES.map((t) => t.value)).toEqual(expect.arrayContaining([OLD_MEETING, NEW_MEETING]))
  })

  it('offers one Client Meeting button rather than making the rep classify it', () => {
    const pickable = LOGGABLE_ACTIVITY_TYPES.map((t) => t.value)
    expect(pickable).toContain(PICKABLE_MEETING)
    expect(pickable).not.toContain(OLD_MEETING)
    expect(pickable).not.toContain(NEW_MEETING)
  })

  it('labels every value either list can produce', () => {
    for (const v of [...ACTIVITY_TYPES, ...LOGGABLE_ACTIVITY_TYPES].map((t) => t.value)) {
      expect(ACTIVITY_LABELS[v]).toBeTruthy()
    }
  })
})
