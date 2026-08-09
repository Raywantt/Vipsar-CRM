import { describe, it, expect } from 'vitest'
import { monthPeriodValue, weekPeriodValue, quarterPeriodValue, periodForPreset } from './targetPeriods'

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
