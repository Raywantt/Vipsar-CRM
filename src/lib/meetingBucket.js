import { stageRank } from './stageProgress'

// Which umbrella a Client Meeting falls under.
//
// Settled with the owner 2026-09-07: a meeting logged against a lead at RFQ
// or later — including a paused (on_hold) or closed (won/lost) one — is an
// OLD MEETING; anything earlier in the funnel is a NEW MEETING. The intent is
// "have we already put a number in front of this client, or are we still
// winning them over", which is exactly where RFQ sits.
//
// THE BUCKET IS DECIDED ONCE, AT LOGGING TIME, AND STORED — it is not derived
// live from the lead's stage. A meeting held while a lead was still at
// `calling` stays a New Meeting forever, even after that lead reaches
// negotiation next week. That is the whole point: these count what the rep
// actually did on the day, so a stage move must never retroactively rewrite
// last month's activity report. The stored value is the activity_type itself
// (see activityTypes.js), which is what makes the two show up as genuinely
// separate meetings everywhere without a single display site special-casing
// them.

export const OLD_MEETING = 'client_meeting_old'
export const NEW_MEETING = 'client_meeting_new'

// What the rep actually taps. Never stored on an activity row — resolved into
// one of the two above before the insert, and forbidden by the activities
// CHECK constraint (see Schema/migration_client_meeting_buckets.sql) so an
// unbucketed meeting cannot exist. It IS still a legal follow_ups
// .activity_type: a reminder is about future work, where the bucket has no
// meaning yet.
export const PICKABLE_MEETING = 'client_meeting'

// The funnel position at which a meeting stops being "new". Named rather than
// inlined so the rule reads the way the owner stated it.
const OLD_FROM_STAGE = 'rfq'

export function meetingTypeForStage(stage) {
  // on_hold / won / lost have no funnel rank of their own (see stageRank) but
  // all three sit past RFQ in reality — a paused or closed deal is not a
  // fresh prospect. Listed explicitly because ranking them would misrepresent
  // the funnel everywhere else stageRank is used.
  if (stage === 'on_hold' || stage === 'won' || stage === 'lost') return OLD_MEETING

  const rank = stageRank(stage)
  // An unranked legacy free-text stage (current_stage is still free text at
  // the DB layer, see DECISIONS.md) falls back to NEW rather than being
  // guessed at as OLD — the same "blank means blank, don't invent a confident
  // value" rule dealValueOrNull and closure_probability already follow.
  if (rank == null) return NEW_MEETING

  return rank >= stageRank(OLD_FROM_STAGE) ? OLD_MEETING : NEW_MEETING
}
