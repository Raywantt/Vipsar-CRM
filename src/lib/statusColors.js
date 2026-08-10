import { LEAD_STAGE_OPTIONS } from './leadStageOptions'

// Stage -> foreground colour, keyed to LEAD_STAGE_OPTIONS so
// LeadStageBoard/LeadStageSection/LeadsByCategoryCard/LeadDetail/
// SalesFunnelCard can't drift into showing different colors for the same
// stage. New/Warm/Hot ramp light-to-dark (blue/amber/green respectively),
// Won is a deeper green than Hot's Negotiation, On hold is neutral grey
// (independent of the funnel), Lost stays red — the one color reserved for
// a genuinely lost deal.
export const STAGE_FG = {
  calling: '#2E6DA4',
  presentation: '#235A8C',
  joinery_follow_up: '#1B4870',
  measurements: '#123457',
  design_discussion: '#92650B',
  rfq: '#7A5209',
  quote_submission: '#634006',
  negotiation: '#1F7A3D',
  on_hold: '#5F6A6C',
  won: '#0F5C2A',
  lost: '#B4232A',
}

// Used when a lead's current_stage isn't a recognized value at all (the
// "Other…" free-text escape hatch) — a dedicated neutral, not aliased to
// any real stage's color, since every LEAD_STAGE_OPTIONS value is now a
// real, meaningfully-colored stage.
const FALLBACK_FG = '#5F6A6C'
const FALLBACK_CHIP_CLASS = 'vip-chip vip-chip-on_hold'

// vipsar-theme.css ships a ready-made .vip-chip-<stage> pill (bg+fg) per
// stage. current_stage is free text (not a DB enum — see
// leadStageOptions.js), so a stage saved via the "Other…" escape hatch
// falls back to the neutral on-hold-grey pill rather than an undefined class.
export function stageChipClass(stage) {
  return STAGE_FG[stage] ? `vip-chip vip-chip-${stage}` : FALLBACK_CHIP_CLASS
}

// For places that only tint text/borders, not a filled chip (the stage
// board's column border-top, LeadStageSection's selectable vip-chip-select
// buttons, the sales-funnel bar fill).
export function stageFg(stage) {
  return STAGE_FG[stage] ?? FALLBACK_FG
}

// Good/warn/bad traffic-light tones — for a lead's health/status pill, deal
// stats, and any other computed-per-row tint. These used to be three
// hardcoded hex constants (GOOD/OK/BAD) independently redeclared in
// LeadDetail.jsx, EmployeeProfile.jsx, and MyTeam.jsx (not always even the
// same shade — LeadDetail/EmployeeProfile's "OK" was #b8791f, MyTeam's was
// #7a6413). Import from here instead of re-declaring a local copy; the
// actual values live in vipsar-theme.css's --vip-status-* tokens so a
// future dark-mode override only ever needs to change the CSS, not JS.
export const TONE_GOOD = 'var(--vip-teal)'
export const TONE_WARN = 'var(--vip-status-warn)'
export const TONE_BAD = 'var(--vip-lost)'
export const TONE_MID = 'var(--vip-status-mid)'
export const TONE_NEUTRAL = 'var(--vip-status-neutral)'
export const TONE_GOOD_SOFT = 'var(--vip-status-good-soft)'
export const TONE_WARN_SOFT = 'var(--vip-status-warn-soft)'
export const TONE_BAD_SOFT = 'var(--vip-status-bad-soft)'
export const TONE_NEUTRAL_SOFT = 'var(--vip-status-neutral-soft)'

// Specifically "a deal was won" — the deeper green of the `won` stage, not
// TONE_GOOD's teal. Distinct because "healthy" and "closed won" are different
// claims and the design gives them different colours. Home.jsx's "Won this
// period" KPI already used var(--vip-won) inline; this is that same value
// promoted so the Day Review's won figures can't drift from it.
export const TONE_WON = 'var(--vip-won)'

// Sanity check in dev: every suggested stage should have an explicit color.
if (import.meta.env.DEV) {
  const missing = LEAD_STAGE_OPTIONS.filter((s) => !STAGE_FG[s])
  if (missing.length > 0) {
    console.warn('statusColors.js is missing colors for stages:', missing)
  }
}
