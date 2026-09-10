import { describe, it, expect } from 'vitest'
import {
  monthPeriodValue,
  weekPeriodValue,
  quarterPeriodValue,
  periodForPreset,
  periodValueForDate,
  rangeForPeriodValue,
  periodRangeLabel,
  shiftPeriodValue,
} from './targetPeriods'

describe('monthPeriodValue', () => {
  it('formats as YYYY-MM with zero-padded month', () => {
    expect(monthPeriodValue(new Date(2026, 0, 15))).toBe('2026-01')
    expect(monthPeriodValue(new Date(2026, 10, 3))).toBe('2026-11')
  })
})

describe('quarterPeriodValue', () => {
  it('maps each month to the correct calendar quarter', () => {
    expect(quarterPeriodValue(new Date(2026, 0, 1))).toBe('2026-Q1')
    expect(quarterPeriodValue(new Date(2026, 2, 31))).toBe('2026-Q1')
    expect(quarterPeriodValue(new Date(2026, 3, 1))).toBe('2026-Q2')
    expect(quarterPeriodValue(new Date(2026, 6, 15))).toBe('2026-Q3')
    expect(quarterPeriodValue(new Date(2026, 11, 31))).toBe('2026-Q4')
  })
})

describe('weekPeriodValue', () => {
  it('matches dateRanges.js Monday-start week boundary for a known date', () => {
    // Thursday 2026-08-13 is in the ISO week starting Monday 2026-08-10.
    // 2026-01-01 is a Thursday, so week 1 contains it; Aug 13 is ISO week 33.
    expect(weekPeriodValue(new Date(2026, 7, 13))).toBe('2026-W33')
  })

  it('assigns the first days of January to week 1 when the year starts midweek', () => {
    // 2026-01-01 is a Thursday -> ISO week 1 contains it.
    expect(weekPeriodValue(new Date(2026, 0, 1))).toBe('2026-W01')
  })

  it('rolls late-December dates into next year\'s week 1 when applicable', () => {
    // 2026-12-31 is a Thursday -> stays in the same year's last ISO week.
    expect(weekPeriodValue(new Date(2026, 11, 31))).toBe('2026-W53')
  })
})

describe('periodForPreset', () => {
  const date = new Date(2026, 7, 13)

  it('week/month/quarter return a matching periodType/periodValue pair', () => {
    expect(periodForPreset('week', date)).toEqual({ periodType: 'week', periodValue: weekPeriodValue(date) })
    expect(periodForPreset('month', date)).toEqual({ periodType: 'month', periodValue: monthPeriodValue(date) })
    expect(periodForPreset('quarter', date)).toEqual({ periodType: 'quarter', periodValue: quarterPeriodValue(date) })
  })

  it('returns null for presets with no fixed period identity (15d, custom, unknown)', () => {
    expect(periodForPreset('15d', date)).toBeNull()
    expect(periodForPreset('custom', date)).toBeNull()
    expect(periodForPreset('year', date)).toBeNull()
    expect(periodForPreset('bogus', date)).toBeNull()
  })
})

describe('periodValueForDate', () => {
  it('delegates to the matching *PeriodValue function per type, null for anything else', () => {
    const date = new Date(2026, 7, 13)
    expect(periodValueForDate('week', date)).toBe(weekPeriodValue(date))
    expect(periodValueForDate('month', date)).toBe(monthPeriodValue(date))
    expect(periodValueForDate('quarter', date)).toBe(quarterPeriodValue(date))
    expect(periodValueForDate('year', date)).toBeNull()
  })
})

// The Set-a-target UI (SetTargetForm.jsx) replaced a raw "type an ISO week/
// quarter code" text field with this stepper + readable-label pair, exactly
// to stop a rep/owner silently saving a target under the wrong period — the
// reported bug this was built to rule out. These pin the underlying math.
describe('rangeForPeriodValue', () => {
  it('returns the Monday–Sunday span for a week period_value', () => {
    const range = rangeForPeriodValue('week', '2026-W37')
    expect(range.start.toISOString()).toBe('2026-09-07T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-09-13T00:00:00.000Z')
  })

  it('returns the 1st–last-day span for a month period_value', () => {
    const range = rangeForPeriodValue('month', '2026-02')
    expect(range.start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-02-28T00:00:00.000Z') // 2026 is not a leap year
  })

  it('returns the 3-month span for a quarter period_value', () => {
    const range = rangeForPeriodValue('quarter', '2026-Q3')
    expect(range.start.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-09-30T00:00:00.000Z')
  })

  it('round-trips with weekPeriodValue for every week across a full year (incl. week 53)', () => {
    for (let i = -10; i <= 400; i += 1) {
      const d = new Date(2026, 0, 1)
      d.setDate(d.getDate() + i)
      const pv = weekPeriodValue(d)
      const range = rangeForPeriodValue('week', pv)
      const localStart = new Date(range.start.getUTCFullYear(), range.start.getUTCMonth(), range.start.getUTCDate())
      expect(weekPeriodValue(localStart)).toBe(pv)
    }
  })

  it('returns null for a malformed value', () => {
    expect(rangeForPeriodValue('week', 'not-a-week')).toBeNull()
    expect(rangeForPeriodValue('month', '2026')).toBeNull()
    expect(rangeForPeriodValue('quarter', '2026-Q5')).toBeNull()
  })
})

describe('periodRangeLabel', () => {
  it('formats a week within one month as "D – D Mon YYYY"', () => {
    expect(periodRangeLabel('week', '2026-W37')).toBe('7 – 13 Sep 2026')
  })

  it('formats a week spanning two months as "D Mon – D Mon YYYY"', () => {
    expect(periodRangeLabel('week', '2026-W36')).toBe('31 Aug – 6 Sep 2026')
  })

  it('formats a month as its full name and year', () => {
    expect(periodRangeLabel('month', '2026-09')).toBe('September 2026')
  })

  it('formats a quarter with its Q label appended', () => {
    expect(periodRangeLabel('quarter', '2026-Q3')).toBe('1 Jul – 30 Sep 2026 (Q3)')
  })
})

describe('shiftPeriodValue', () => {
  it('steps a week forward and backward by exactly one calendar week', () => {
    expect(shiftPeriodValue('week', '2026-W37', 1)).toBe('2026-W38')
    expect(shiftPeriodValue('week', '2026-W37', -1)).toBe('2026-W36')
  })

  it('steps a month forward across a year boundary', () => {
    expect(shiftPeriodValue('month', '2026-12', 1)).toBe('2027-01')
  })

  it('steps a quarter forward across a year boundary', () => {
    expect(shiftPeriodValue('quarter', '2026-Q4', 1)).toBe('2027-Q1')
  })

  it('is the inverse of itself (n steps forward then back returns the original)', () => {
    expect(shiftPeriodValue('week', shiftPeriodValue('week', '2026-W37', 5), -5)).toBe('2026-W37')
  })
})
