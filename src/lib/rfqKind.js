import { stageRank } from './stageProgress'

// Which bucket a newly-logged "RFQ Raised" activity falls into for a given
// lead, decided from the lead's stage AT THE MOMENT it's logged, then frozen
// onto the activity row (activities.rfq_kind) — never re-derived live, same
// "decided once, at logging time" reasoning as meetingBucket.js.
//
// Settled with the owner 2026-09-09: a sales exec re-requests a quotation
// whenever the client asks for changes, so a lead often accumulates several
// RFQs before a quote is finalized. The first one on a lead is FRESH; every
// one logged once the lead is already at RFQ Raised stage or later is
// REVISED. No retroactive classification — activities logged before this
// shipped keep rfq_kind = null (see Schema/migration_rfq_kind.sql).
export const FRESH_RFQ = 'fresh'
export const REVISED_RFQ = 'revised'

export const RFQ_KIND_LABELS = {
  [FRESH_RFQ]: 'Fresh',
  [REVISED_RFQ]: 'Revised',
}

// The funnel position at which an RFQ stops being "fresh". Named rather than
// inlined so the rule reads the way the owner stated it. Mirrors
// meetingBucket.js's OLD_FROM_STAGE = 'rfq' — the two rules share a
// threshold today by coincidence, not because one is derived from the
// other; they answer different questions and could diverge later, so this
// is its own constant, not a shared import.
const REVISED_FROM_STAGE = 'rfq'

// `stage` is the value to classify against. For a lead currently on_hold,
// the caller resolves the stage it actually PAUSED at first (same
// derivation LeadDetail's Deal progress stepper and the
// enforce_owner_only_stage_change() trigger already use — most recent
// non-on_hold stage_history row, falling back to 'calling') and passes that
// in instead of the literal 'on_hold' value, which has no funnel rank.
export function rfqKindForStage(stage) {
  // A decided deal (won/lost) is treated as past RFQ in every real case —
  // reaching either implies a quotation was already put in front of the
  // client. Listed explicitly since won/lost have no funnel rank of their
  // own (see stageRank).
  if (stage === 'won' || stage === 'lost') return REVISED_RFQ

  const rank = stageRank(stage)
  // An unranked legacy free-text stage (current_stage is still free text at
  // the DB layer) falls back to FRESH rather than being guessed at as
  // revised — the same "blank means blank, don't invent a confident value"
  // rule dealValueOrNull/meetingTypeForStage already follow. This is also
  // what makes a paused legacy-imported lead with no stage_history at all
  // default to fresh once it resumes and reaches RFQ Raised stage: the
  // caller passes the fallback 'calling', which ranks below the threshold.
  if (rank == null) return FRESH_RFQ

  return rank >= stageRank(REVISED_FROM_STAGE) ? REVISED_RFQ : FRESH_RFQ
}

// Whether logging a FRESH RFQ should also auto-advance the lead's stage to
// 'rfq' (the owner's request — the CRM records this instead of asking the
// exec to also flip the stage chip by hand). Deliberately narrower than
// "rfqKindForStage returned fresh": a lead that's currently on_hold must
// never have its stage moved as a side effect of logging an activity —
// resuming a paused lead stays its own deliberate action — and a won/lost
// lead is never fresh in the first place (see above), so this only ever
// fires for a lead genuinely sitting before RFQ Raised in the funnel right
// now. Takes the lead's REAL current stage, never a resolved pausedAt.
export function shouldAdvanceToRfq(currentStage) {
  if (currentStage === 'on_hold' || currentStage === 'won' || currentStage === 'lost') return false
  const rank = stageRank(currentStage)
  return rank != null && rank < stageRank(REVISED_FROM_STAGE)
}
