// Shared by LeadStageSection (the "why was this lost" prompt) and the
// dashboard's loss-reasons breakdown, so they can't drift apart — same
// extraction pattern as LEAD_STAGE_OPTIONS/SITE_STAGE_OPTIONS.
export const LOSS_REASON_OPTIONS = ['price', 'competitor', 'timeline', 'budget_cut', 'site_delay', 'other']

// Value -> human display label, same pattern as leadStageOptions.js's
// LEAD_STAGE_LABELS/stageLabel() — LossReasonsCard used to print these raw
// enum values directly (`budget_cut`, `site_delay`), the one enum in this
// app that never got a label map.
export const LOSS_REASON_LABELS = {
  price: 'Price',
  competitor: 'Lost to a competitor',
  timeline: 'Timeline',
  budget_cut: 'Budget cut',
  site_delay: 'Site delayed',
  other: 'Other',
}

export function lossReasonLabel(reason) {
  return LOSS_REASON_LABELS[reason] ?? reason
}
