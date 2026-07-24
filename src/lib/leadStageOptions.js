// current_stage is deliberately free text on the leads table (not a CHECK
// enum) — this is just the app-layer suggested list, with an "other" escape
// hatch for anything not covered here (same pattern as SITE_STAGE_OPTIONS).
// Shared by LeadStageSection (the editor) and the dashboard's Stage
// breakdown, so they can't drift apart.
export const LEAD_STAGE_OPTIONS = ['new', 'hot', 'rfq', 'quote', 'negotiation', 'won', 'lost']
