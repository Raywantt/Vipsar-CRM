import { LEAD_STAGE_OPTIONS } from './leadStageOptions'

// Stage -> foreground colour, keyed to LEAD_STAGE_OPTIONS so
// LeadStageBoard/LeadStageSection/LeadsByCategoryCard/LeadDetail/
// SalesFunnelCard can't drift into showing different colors for the same
// stage. Canonical table from the design handoff's COMPONENT_MAP.md.
export const STAGE_FG = {
  new: '#485456',
  hot: '#0f6b6b',
  rfq: '#7a6413',
  quote: '#2f5878',
  negotiation: '#5a4287',
  won: '#1f6f4a',
  lost: '#b4232a',
}

// vipsar-theme.css ships a ready-made .vip-chip-<stage> pill (bg+fg) per
// stage. current_stage is free text (not a DB enum — see
// leadStageOptions.js), so a stage saved via the "Other…" escape hatch
// falls back to the neutral "new" pill rather than an undefined class.
export function stageChipClass(stage) {
  return STAGE_FG[stage] ? `vip-chip vip-chip-${stage}` : 'vip-chip vip-chip-new'
}

// For places that only tint text/borders, not a filled chip (the stage
// board's column border-top, LeadStageSection's selectable vip-chip-select
// buttons, the sales-funnel bar fill).
export function stageFg(stage) {
  return STAGE_FG[stage] ?? STAGE_FG.new
}

// Sanity check in dev: every suggested stage should have an explicit color.
if (import.meta.env.DEV) {
  const missing = LEAD_STAGE_OPTIONS.filter((s) => !STAGE_FG[s])
  if (missing.length > 0) {
    console.warn('statusColors.js is missing colors for stages:', missing)
  }
}
