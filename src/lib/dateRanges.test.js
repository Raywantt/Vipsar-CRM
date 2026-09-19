import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rangeForPreset, startOfWeek, previousRangeFor } from './dateRanges'

describe('startOfWeek', () => {
  it('returns the same Monday for any day within that week', () => {
    // Thursday 2026-08-13
    const thursday = new Date(2026, 7, 13)
    const monday = startOfWeek(thursday)
    expect(monday.getFullYear()).toBe(2026)
    expect(monday.getMonth()).toBe(7)
    expect(monday.getDate()).toBe(10)
    expect(monday.getDay()).toBe(1)
  })

  it('treats Sunday as the end of the prior week, not the start of a new one', () => {
    // Sunday 2026-08-16 belongs to the week starting Monday 2026-08-10
    const sunday = new Date(2026, 7, 16)
    const monday = startOfWeek(sunday)
    expect(monday.getDate()).toBe(10)
  })

  it('zeroes out the time component', () => {
    const d = new Date(2026, 7, 13, 15, 30, 45)
    const monday = startOfWeek(d)
    expect(monday.getHours()).toBe(0)
    expect(monday.getMinutes()).toBe(0)
    expect(monday.getSeconds()).toBe(0)
  })
})

describe('rangeForPreset', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 13, 12, 0, 0)) // Thursday 2026-08-13, noon
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('15d spans 15 days ending today, not calendar-aligned', () => {
    const { start, end } = rangeForPreset('15d')
    expect(start.getDate()).toBe(30) // 13 - 14 = -1 -> rolls into July 30
    expect(start.getMonth()).toBe(6)
    expect(end.getDate()).toBe(13)
    expect(end.getHours()).toBe(23)
  })

  it('week starts on Monday', () => {
    const { start } = rangeForPreset('week')
    expect(start.getDate()).toBe(10)
    expect(start.getDay()).toBe(1)
  })

  it('month starts on the 1st of the current month', () => {
    const { start } = rangeForPreset('month')
    expect(start.getDate()).toBe(1)
    expect(start.getMonth()).toBe(7)
  })

  it('quarter starts on the first month of the current calendar quarter', () => {
    const { start } = rangeForPreset('quarter')
    // August is in Q3 (Jul-Sep) -> quarter starts July 1
    expect(start.getMonth()).toBe(6)
    expect(start.getDate()).toBe(1)
  })

  it('year starts on Jan 1', () => {
    const { start } = rangeForPreset('year')
    expect(start.getMonth()).toBe(0)
    expect(start.getDate()).toBe(1)
  })

  it('custom returns null when either bound is missing', () => {
    expect(rangeForPreset('custom', '2026-08-01', null)).toBeNull()
    expect(rangeForPreset('custom', null, '2026-08-01')).toBeNull()
    expect(rangeForPreset('custom', null, null)).toBeNull()
  })

  it('custom swaps the bounds when start is after end', () => {
    const { start, end } = rangeForPreset('custom', '2026-08-10', '2026-08-01')
    expect(start.getDate()).toBe(1)
    expect(end.getDate()).toBe(10)
  })

  it('custom returns start-of-day/end-of-day for well-ordered bounds', () => {
    const { start, end } = rangeForPreset('custom', '2026-08-01', '2026-08-05')
    expect(start.getDate()).toBe(1)
    expect(start.getHours()).toBe(0)
    expect(end.getDate()).toBe(5)
    expect(end.getHours()).toBe(23)
  })

  it('returns null for an unrecognized preset', () => {
    expect(rangeForPreset('bogus')).toBeNull()
  })
})

describe('previousRangeFor', () => {
  const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()]

  it('compares a part-week against the SAME part of last week, not the days just before it', () => {
    const range = { start: new Date(2026, 8, 14), end: new Date(2026, 8, 16, 23, 59, 59, 999) } // Mon–Wed
    const prev = previousRangeFor('week', range)
    expect(prev.label).toBe('last week')
    expect(ymd(prev.range.start)).toEqual([2026, 9, 7]) // last Monday
    expect(ymd(prev.range.end)).toEqual([2026, 9, 9]) // last Wednesday — not Sunday the 13th
  })

  it('compares a month-to-date against the same days of last month', () => {
    const range = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 16, 23, 59, 59, 999) }
    const prev = previousRangeFor('month', range)
    expect(prev.label).toBe('last month')
    expect(ymd(prev.range.start)).toEqual([2026, 8, 1])
    expect(ymd(prev.range.end)).toEqual([2026, 8, 16])
  })

  it('caps at the previous month\'s own last day when this month has run longer than it had', () => {
    // 31 days elapsed of a 31-day month, against a 30-day September.
    const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31, 23, 59, 59, 999) }
    const prev = previousRangeFor('month', range)
    expect(ymd(prev.range.end)).toEqual([2026, 9, 30]) // not Oct 1
  })

  it('reaches back a whole quarter, across a year boundary', () => {
    const range = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 20, 23, 59, 59, 999) } // Q1 to date
    const prev = previousRangeFor('quarter', range)
    expect(prev.label).toBe('last quarter')
    expect(ymd(prev.range.start)).toEqual([2025, 10, 1])
    expect(ymd(prev.range.end)).toEqual([2025, 10, 20])
  })

  it('compares a range with no calendar identity against the equal window immediately before it', () => {
    const range = { start: new Date(2026, 8, 2), end: new Date(2026, 8, 16, 23, 59, 59, 999) } // 15 days
    const prev = previousRangeFor('15d', range)
    expect(prev.label).toBe('the 15 days before')
    expect(ymd(prev.range.start)).toEqual([2026, 8, 18])
    expect(ymd(prev.range.end)).toEqual([2026, 9, 1])
    // It ends the instant before the range starts, so the two never overlap.
    expect(prev.range.end.getTime()).toBe(range.start.getTime() - 1)
  })

  it('has nothing to compare against when there is no range', () => {
    expect(previousRangeFor('custom', null)).toBeNull()
  })
})