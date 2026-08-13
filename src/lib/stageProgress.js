import { LEAD_STAGE_OPTIONS } from './leadStageOptions'

// Who may move a lead's stage, and in which direction.
//
// Settled with the owner 2026-08-13: a lead is edited by exactly three
// people — its own sales executive, that exec's sales coordinator, and the
// owner. All three may change the stage. But **a sales executive may only
// move a lead FORWARD**; walking it back to an earlier stage is a
// coordinator/owner action.
//
// This module is the app-layer copy of that rule. The enforcement copy is
// the `enforce_owner_only_stage_change()` trigger in
// Schema/migration_lead_edit_rights.sql — keep the two in step. The trigger
// is the real boundary; this exists so the UI can grey a chip out with a
// reason instead of letting the rep click it and collect a database error.

// The 8 sequential funnel stages, in order. on_hold/won/lost are excluded
// on purpose: a pause and two outcomes, none of which has a position in the
// sequence. Same filter LeadDetail's Deal progress stepper uses for its own
// backbone.
export const FUNNEL_SEQUENCE = LEAD_STAGE_OPTIONS.filter(
  (s) => s !== 'on_hold' && s !== 'won' && s !== 'lost',
)

// Position in the funnel, or null for anything off it — on_hold, won, lost,
// and any legacy free-text current_stage that predates the taxonomy rename
// (current_stage is still free text at the DB layer, see DECISIONS.md).
export function stageRank(stage) {
  const i = FUNNEL_SEQUENCE.indexOf(stage)
  return i === -1 ? null : i
}

// Would moving `fromStage` → `toStage` walk the lead BACKWARDS?
//
// `pausedAt` is where an on-hold lead actually paused (LeadDetail already
// derives this for the stepper: the most recent non-on-hold stage_history
// row, falling back to 'calling'). Without it, On hold would launder a
// reversal — negotiation → on_hold → calling would read as two forward-ish
// moves because on_hold itself has no rank.
//
// Deliberately NOT backwards, in either direction:
//   * → on_hold / won / lost   pausing or closing is always allowed
//   * on_hold → its own paused stage   resuming where you left off
//   * anything involving an unranked legacy stage   left alone rather than
//     guessed at, matching how the rest of the app falls back for one
export function isBackwardStageMove(fromStage, toStage, pausedAt = null) {
  if (!fromStage || !toStage || fromStage === toStage) return false

  // Reopening a decided deal is the largest reversal there is — it moves
  // money back out of a reported figure, so it stays a coordinator/owner
  // action regardless of which stage it reopens into.
  if (fromStage === 'won' || fromStage === 'lost') return true

  const fromRank = stageRank(fromStage === 'on_hold' ? pausedAt : fromStage)
  const toRank = stageRank(toStage)
  if (fromRank == null || toRank == null) return false

  return toRank < fromRank
}
