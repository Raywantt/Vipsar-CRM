// current_stage is deliberately free text on the leads table (not a CHECK
// enum) — this is just the app-layer suggested list, with an "other" escape
// hatch for anything not covered here (same pattern as SITE_STAGE_OPTIONS).
// Shared by LeadStageSection (the editor) and the dashboard's Stage
// breakdown, so they can't drift apart.
//
// Grouped New (calling → measurements) / Warm (design discussion → quote
// submission) / Hot (negotiation) funnel, plus the independent `on_hold`
// stage (reachable from any of the above — see LeadStageSection.jsx) and
// the two terminal stages. Order here is the canonical stage order used by
// the chip picker, the Kanban board, and the stage-breakdown table/funnel.
export const LEAD_STAGE_OPTIONS = [
  'calling',
  'presentation',
  'joinery_follow_up',
  'measurements',
  'design_discussion',
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
  measurements: 'Measurements to be taken',
  design_discussion: 'Design discussion',
  rfq: 'RFQ',
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
