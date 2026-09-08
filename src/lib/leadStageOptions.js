// current_stage is deliberately free text on the leads table (not a CHECK
// enum) — this is just the app-layer suggested list, with an "other" escape
// hatch for anything not covered here (same pattern as SITE_STAGE_OPTIONS).
// Shared by LeadStageSection (the editor) and the dashboard's Stage
// breakdown, so they can't drift apart.
//
// Grouped New (calling → joinery follow up) / Warm (RFQ raised → quote
// submission) / Hot (negotiation) funnel, plus the independent `on_hold`
// stage (reachable from any of the above — see LeadStageSection.jsx) and
// the two terminal stages. Order here is the canonical stage order used by
// the chip picker, the Kanban board, and the stage-breakdown table/funnel.
//
// `measurements` and `design_discussion` were retired 2026-09-08 (the
// owner's ruling) — every lead sitting at `measurements` moved to
// `joinery_follow_up`, and every lead at `design_discussion` moved to `rfq`
// (see Schema/migration_retire_measurements_design_discussion.sql for the
// one-time data migration; a lead's stage is still free text at the DB
// layer, so nothing here needed a constraint change). `rfq`'s label became
// "RFQ Raised" in the same pass.
export const LEAD_STAGE_OPTIONS = [
  'calling',
  'presentation',
  'joinery_follow_up',
  'rfq',
  'quote_submission',
  'negotiation',
  'on_hold',
  'won',
  'lost',
]

// Value -> human display label. Values are the literal current_stage
// strings stored on `leads` (and used for CSS chip class names, so they
// stay single-token slugs); labels are what's actually shown on screen.
export const LEAD_STAGE_LABELS = {
  calling: 'Calling',
  presentation: 'Presentation',
  joinery_follow_up: 'Joinery follow up',
  rfq: 'RFQ Raised',
  quote_submission: 'Quote submission',
  negotiation: 'Negotiation',
  on_hold: 'On hold',
  won: 'Won',
  lost: 'Lost',
}

// A lead saved via the "Other…" free-text escape hatch has a current_stage
// outside LEAD_STAGE_OPTIONS entirely — falls back to the raw value itself,
// same fallback spirit as stageChipClass/stageFg in statusColors.js.
export function stageLabel(stage) {
  return LEAD_STAGE_LABELS[stage] ?? stage
}
