import { canOverrideDeskQuote, canSetQuoteValue } from './roles'

// Typing a lead's quote value by hand (owner's ruling, 2026-10-09: owners and
// sales managers). Pure rules, no network — Sales progress and the manager's
// quote card on a team lead both read them, so the two can't drift.
//
// The RFQ desk is still the normal source (RFQ-DESK.md, 2026-10-06): its quote
// lands on the lead as leads.quote_value, with the per-product split in
// leads.quote_lines. A typed value is for leads the desk never quoted — the
// legacy imports, a lead that never raised an RFQ — and, for the OWNER only, a
// correction on top of a desk quote.

// The largest value leads.quote_value (DECIMAL(14,2)) can hold, exclusive.
export const MAX_QUOTE_VALUE = 1e12

// What this viewer may do to this lead's quote value.
//   none   — cannot type one (every other role): the read-only row stands.
//   edit   — can type; `overrides` is true when a Lixil quote is on file and
//            this save would replace its figure (owner only).
//   locked — would be able to type, but a Lixil quote is on file and only an
//            owner may change it (a manager).
// enforce_manager_lock() refuses the locked case in the database too, so this
// is a UI mirror, not the boundary.
export function quoteControl(role, deskQuote) {
  if (!canSetQuoteValue(role)) return { mode: 'none', overrides: false }
  if (!deskQuote) return { mode: 'edit', overrides: false }
  if (canOverrideDeskQuote(role)) return { mode: 'edit', overrides: true }
  return { mode: 'locked', overrides: false }
}

// The figure on screen: the lead's own column, else the desk's quote (the
// column is trigger-filled from it, so they only differ for an old lead).
export function shownQuoteValue(lead, deskQuote) {
  return lead?.quote_value ?? deskQuote?.quote_value ?? null
}

// Where the figure on screen came from, for the line beside it.
//   desk     — it is the Lixil quote's figure.
//   override — a Lixil quote is on file but the lead carries a different total.
//   typed    — a value with no desk quote behind it.
//   none     — nothing yet.
export function quoteOrigin(lead, deskQuote) {
  const shown = shownQuoteValue(lead, deskQuote)
  if (shown == null) return 'none'
  if (!deskQuote) return 'typed'
  return Number(shown) === Number(deskQuote.quote_value) ? 'desk' : 'override'
}

export function hasQuoteSplit(lead) {
  return Array.isArray(lead?.quote_lines) && lead.quote_lines.length > 0
}

// Text from the input -> { value } (a number, or null for blank) or { error }.
export function parseQuoteInput(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return { value: null }
  const n = Number(text)
  if (!Number.isFinite(n) || n <= 0 || n >= MAX_QUOTE_VALUE) {
    return { error: 'Enter a quote value above zero, or leave it blank.' }
  }
  return { value: Math.round(n * 100) / 100 }
}

// What to write for the typed text — { patch } (null when nothing changes) or
// { error }. Rules:
//  - the input only matters if it differs from the figure on screen, so saving
//    a card without touching the quote never writes it (and never clears a split);
//  - a lead with a desk quote can't be blanked: clearing would just show the
//    desk's figure again, so blank there means "leave it";
//  - a changed value no longer matches the per-product split of the quote it
//    replaces, so the split is cleared with it (the by-product figures then
//    show it as "Not split yet" rather than guess).
export function quoteValuePatch(raw, { lead, deskQuote = null }) {
  const parsed = parseQuoteInput(raw)
  if (parsed.error) return { error: parsed.error }

  const current = shownQuoteValue(lead, deskQuote)
  const next = parsed.value

  if (next == null) {
    if (deskQuote || lead?.quote_value == null) return { patch: null }
  } else if (current != null && Number(current) === next) {
    return { patch: null }
  }

  return { patch: { quote_value: next, ...(hasQuoteSplit(lead) ? { quote_lines: null } : {}) } }
}
