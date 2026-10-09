import { describe, expect, it } from 'vitest'
import {
  hasQuoteSplit,
  parseQuoteInput,
  quoteControl,
  quoteOrigin,
  quoteValuePatch,
  shownQuoteValue,
} from './quoteValue'
import { ROLES, canOverrideDeskQuote, canSetQuoteValue, rolesWith } from './roles'

const DESK = { id: 7, status: 'quoted', quote_value: 1000000, quote_ref: 'LX-501' }

describe('who may type a quote value', () => {
  it('is the owner and the sales manager, nobody else', () => {
    expect(rolesWith(canSetQuoteValue).sort()).toEqual([ROLES.OWNER, ROLES.SALES_MANAGER].sort())
    expect(canSetQuoteValue(ROLES.SALES_EXECUTIVE)).toBe(false)
    expect(canSetQuoteValue(ROLES.SALES_COORDINATOR)).toBe(false)
    expect(canSetQuoteValue(ROLES.BDM)).toBe(false)
    expect(canSetQuoteValue(ROLES.PRODUCTION_EXECUTIVE)).toBe(false)
    expect(canSetQuoteValue(ROLES.ESTIMATION_EXECUTIVE)).toBe(false)
    expect(canSetQuoteValue(undefined)).toBe(false)
  })

  it('lets only the owner replace a figure the RFQ desk recorded', () => {
    expect(rolesWith(canOverrideDeskQuote)).toEqual([ROLES.OWNER])
  })
})

describe('quoteControl', () => {
  it('lets the owner and a manager type when the desk has not quoted', () => {
    expect(quoteControl(ROLES.OWNER, null)).toEqual({ mode: 'edit', overrides: false })
    expect(quoteControl(ROLES.SALES_MANAGER, null)).toEqual({ mode: 'edit', overrides: false })
  })

  it('lets the owner override a desk quote and says it is an override', () => {
    expect(quoteControl(ROLES.OWNER, DESK)).toEqual({ mode: 'edit', overrides: true })
  })

  it('locks a manager out once a desk quote is on file', () => {
    expect(quoteControl(ROLES.SALES_MANAGER, DESK).mode).toBe('locked')
  })

  it('gives every other role the read-only row, with or without a desk quote', () => {
    for (const role of [ROLES.SALES_EXECUTIVE, ROLES.SALES_COORDINATOR, ROLES.BDM, undefined]) {
      expect(quoteControl(role, null).mode).toBe('none')
      expect(quoteControl(role, DESK).mode).toBe('none')
    }
  })
})

describe('what is on screen', () => {
  it('prefers the lead column and falls back to the desk quote', () => {
    expect(shownQuoteValue({ quote_value: 500 }, DESK)).toBe(500)
    expect(shownQuoteValue({ quote_value: null }, DESK)).toBe(1000000)
    expect(shownQuoteValue({ quote_value: null }, null)).toBeNull()
  })

  it('names where it came from', () => {
    expect(quoteOrigin({ quote_value: null }, null)).toBe('none')
    expect(quoteOrigin({ quote_value: 250000 }, null)).toBe('typed')
    expect(quoteOrigin({ quote_value: 1000000 }, DESK)).toBe('desk')
    expect(quoteOrigin({ quote_value: '1000000.00' }, DESK)).toBe('desk')
    expect(quoteOrigin({ quote_value: 900000 }, DESK)).toBe('override')
  })

  it('knows a lead carries a per-product split', () => {
    expect(hasQuoteSplit({ quote_lines: [{ product_id: 1, value: 5 }] })).toBe(true)
    expect(hasQuoteSplit({ quote_lines: [] })).toBe(false)
    expect(hasQuoteSplit({ quote_lines: null })).toBe(false)
    expect(hasQuoteSplit({})).toBe(false)
  })
})

describe('parseQuoteInput', () => {
  it('reads a number, rounding to paise', () => {
    expect(parseQuoteInput('250000')).toEqual({ value: 250000 })
    expect(parseQuoteInput(' 1234.567 ')).toEqual({ value: 1234.57 })
  })

  it('treats blank as "no value"', () => {
    expect(parseQuoteInput('')).toEqual({ value: null })
    expect(parseQuoteInput('   ')).toEqual({ value: null })
    expect(parseQuoteInput(null)).toEqual({ value: null })
  })

  it('refuses zero, negatives, junk and anything the column cannot hold', () => {
    for (const bad of ['0', '-5', 'abc', '1e12', '999999999999999']) {
      expect(parseQuoteInput(bad).error).toBeTruthy()
    }
  })
})

describe('quoteValuePatch', () => {
  it('writes a typed value on a lead with no quote', () => {
    expect(quoteValuePatch('300000', { lead: { quote_value: null } })).toEqual({ patch: { quote_value: 300000 } })
  })

  it('writes nothing when the figure is unchanged, so saving the card never touches it', () => {
    expect(quoteValuePatch('300000', { lead: { quote_value: 300000 } })).toEqual({ patch: null })
    expect(quoteValuePatch('1000000', { lead: { quote_value: 1000000, quote_lines: [{ product_id: 1, value: 1000000 }] }, deskQuote: DESK })).toEqual({ patch: null })
    expect(quoteValuePatch('', { lead: { quote_value: null } })).toEqual({ patch: null })
  })

  it('clears a typed value when the box is emptied', () => {
    expect(quoteValuePatch('', { lead: { quote_value: 300000 } })).toEqual({ patch: { quote_value: null } })
  })

  it('does not let an emptied box clear a desk quote — it would only show the desk figure again', () => {
    expect(quoteValuePatch('', { lead: { quote_value: 1000000 }, deskQuote: DESK })).toEqual({ patch: null })
  })

  it('clears the per-product split when the total it described changes', () => {
    const lead = { quote_value: 1000000, quote_lines: [{ product_id: 1, value: 600000 }, { product_id: 2, value: 400000 }] }
    expect(quoteValuePatch('900000', { lead, deskQuote: DESK })).toEqual({
      patch: { quote_value: 900000, quote_lines: null },
    })
  })

  it('leaves quote_lines alone when there is no split to clear', () => {
    expect(quoteValuePatch('400000', { lead: { quote_value: 300000, quote_lines: null } }).patch).toEqual({ quote_value: 400000 })
  })

  it('reports a bad entry instead of writing it', () => {
    expect(quoteValuePatch('-1', { lead: { quote_value: 1 } }).error).toBeTruthy()
    expect(quoteValuePatch('nope', { lead: { quote_value: 1 } }).error).toBeTruthy()
  })
})
