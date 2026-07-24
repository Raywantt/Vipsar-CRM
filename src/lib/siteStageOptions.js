// site_stage is deliberately free text on the sites table (not a CHECK
// enum) — this is just the app-layer preset list shown in dropdowns, with
// an "other" escape hatch for anything not covered here.
export const SITE_STAGE_OPTIONS = ['foundation', 'structure', 'finishing', 'completed']
