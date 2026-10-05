import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  rangeForPreset,
  startOfWeek,
  previousRangeFor,
  rangeLabelFor,
  periodSpanLabel,
  offsetForDate,
  isSteppablePreset,
} from './dateRanges'
import { targetPeriodFor, periodForPreset } from './targetPeriods'

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

// ---- The ‹ › stepper: whole periods back from now ----
describe('stepping back through past periods', () => {
  const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()]
  const DAY = 24 * 60 * 60 * 1000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 13, 12, 0, 0)) // Thursday 2026-08-13, noon
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offset 0 is exactly the to-date range every preset already returned', () => {
    ;['week', '15d', 'month', 'quarter'].forEach((preset) => {
      expect(rangeForPreset(preset, null, null, 0)).toEqual(rangeForPreset(preset))
    })
  })

  it('a past week is the complete Monday–Sunday, not a week-to-date', () => {
    const { start, end } = rangeForPreset('week', null, null, 1)
    expect(ymd(start)).toEqual([2026, 8, 3]) // the Monday before this one
    expect(ymd(end)).toEqual([2026, 8, 9]) // its Sunday — not "today minus a week"
    expect(end.getHours()).toBe(23)
    expect(ymd(rangeForPreset('week', null, null, 2).start)).toEqual([2026, 7, 27])
  })

  it('a past month is the whole calendar month, across a year boundary', () => {
    const jul = rangeForPreset('month', null, null, 1)
    expect(ymd(jul.start)).toEqual([2026, 7, 1])
    expect(ymd(jul.end)).toEqual([2026, 7, 31])
    const dec = rangeForPreset('month', null, null, 8)
    expect(ymd(dec.start)).toEqual([2025, 12, 1])
    expect(ymd(dec.end)).toEqual([2025, 12, 31])
  })

  it('a past quarter is the whole calendar quarter, across a year boundary', () => {
    const q2 = rangeForPreset('quarter', null, null, 1)
    expect(ymd(q2.start)).toEqual([2026, 4, 1])
    expect(ymd(q2.end)).toEqual([2026, 6, 30])
    const q4 = rangeForPreset('quarter', null, null, 3)
    expect(ymd(q4.start)).toEqual([2025, 10, 1])
    expect(ymd(q4.end)).toEqual([2025, 12, 31])
  })

  it('15D steps in non-overlapping blocks of 15 days', () => {
    const cur = rangeForPreset('15d', null, null, 0)
    const prev = rangeForPreset('15d', null, null, 1)
    expect(ymd(prev.start)).toEqual([2026, 7, 15])
    expect(ymd(prev.end)).toEqual([2026, 7, 29])
    expect(ymd(cur.start)).toEqual([2026, 7, 30])
    // Each block is 15 whole days, and the one before ends the day before the
    // current one starts — nothing shared, nothing skipped.
    expect(Math.round((cur.start - prev.start) / DAY)).toBe(15)
    expect(cur.start.getTime() - prev.end.getTime()).toBe(1)
  })

  it('ignores the offset for presets that cannot step, and for nonsense', () => {
    expect(ymd(rangeForPreset('today', null, null, 3).start)).toEqual([2026, 8, 13])
    expect(ymd(rangeForPreset('custom', '2026-08-01', '2026-08-05', 3).start)).toEqual([2026, 8, 1])
    expect(rangeForPreset('week', null, null, -2)).toEqual(rangeForPreset('week'))
    expect(rangeForPreset('week', null, null, 'x')).toEqual(rangeForPreset('week'))
    expect(isSteppablePreset('week')).toBe(true)
    expect(isSteppablePreset('today')).toBe(false)
    expect(isSteppablePreset('custom')).toBe(false)
  })

  it('names the target period the stepper is showing, and the current one is unchanged', () => {
    expect(targetPeriodFor('month', 0)).toEqual(periodForPreset('month'))
    expect(targetPeriodFor('month', 1)).toEqual({ periodType: 'month', periodValue: '2026-07' })
    expect(targetPeriodFor('quarter', 1)).toEqual({ periodType: 'quarter', periodValue: '2026-Q2' })
    expect(targetPeriodFor('week', 1)).toEqual({ periodType: 'week', periodValue: '2026-W32' })
    // Targets are keyed week/month/quarter only.
    expect(targetPeriodFor('15d', 1)).toBeNull()
    expect(targetPeriodFor('custom', 1)).toBeNull()
  })

  describe("offsetForDate (the stepper's own date picker)", () => {
    const at = (preset, y, m, d) => offsetForDate(preset, new Date(y, m - 1, d))

    it('maps a day to the week that contains it', () => {
      expect(at('week', 2026, 8, 10)).toBe(0) // this Monday
      expect(at('week', 2026, 8, 9)).toBe(1) // last Sunday
      expect(at('week', 2026, 8, 3)).toBe(1) // last Monday
      expect(at('week', 2026, 7, 27)).toBe(2)
    })

    it('maps a day to the month and quarter that contain it', () => {
      expect(at('month', 2026, 8, 1)).toBe(0)
      expect(at('month', 2026, 7, 15)).toBe(1)
      expect(at('month', 2025, 12, 20)).toBe(8)
      expect(at('quarter', 2026, 7, 1)).toBe(0)
      expect(at('quarter', 2026, 6, 30)).toBe(1)
      expect(at('quarter', 2025, 11, 1)).toBe(3)
    })

    it('maps a day to its 15-day block, counted back from today', () => {
      expect(at('15d', 2026, 7, 30)).toBe(0) // 14 days back is still the current block
      expect(at('15d', 2026, 7, 29)).toBe(1)
      expect(at('15d', 2026, 7, 15)).toBe(1)
      expect(at('15d', 2026, 7, 14)).toBe(2)
    })

    it('treats today and the future as the current period', () => {
      expect(at('week', 2026, 8, 13)).toBe(0)
      expect(at('month', 2026, 12, 25)).toBe(0)
    })

    it('round-trips: the range at the offset it returns contains the day', () => {
      ;['week', '15d', 'month', 'quarter'].forEach((preset) => {
        ;[new Date(2026, 7, 5), new Date(2026, 5, 17), new Date(2025, 11, 31), new Date(2026, 0, 1)].forEach((day) => {
          const { start, end } = rangeForPreset(preset, null, null, offsetForDate(preset, day))
          expect(day >= start && day <= end).toBe(true)
        })
      })
    })
  })

  describe('labels', () => {
    it('keeps the shared wording for the current period', () => {
      expect(rangeLabelFor('week', 0, rangeForPreset('week'))).toBe('this week')
      expect(rangeLabelFor('15d', 0, rangeForPreset('15d'))).toBe('last 15 days')
    })

    it('says "last …" for the period right before, and names the dates after that', () => {
      expect(rangeLabelFor('week', 1, rangeForPreset('week', null, null, 1))).toBe('last week')
      expect(rangeLabelFor('month', 1, rangeForPreset('month', null, null, 1))).toBe('last month')
      expect(rangeLabelFor('quarter', 1, rangeForPreset('quarter', null, null, 1))).toBe('last quarter')
      expect(rangeLabelFor('week', 2, rangeForPreset('week', null, null, 2))).toBe('27 Jul – 2 Aug')
      expect(rangeLabelFor('month', 3, rangeForPreset('month', null, null, 3))).toBe('May 2026')
      expect(rangeLabelFor('quarter', 2, rangeForPreset('quarter', null, null, 2))).toBe('Q1 2026')
    })

    it('names a stepped-back 15D window by its dates, never "last 15 days"', () => {
      expect(rangeLabelFor('15d', 1, rangeForPreset('15d', null, null, 1))).toBe('15 – 29 Jul')
    })

    it('adds the year only when the span is not in the current one', () => {
      expect(periodSpanLabel('week', { start: new Date(2025, 11, 29), end: new Date(2026, 0, 4) })).toBe('29 Dec 2025 – 4 Jan 2026')
      expect(periodSpanLabel('week', { start: new Date(2025, 5, 2), end: new Date(2025, 5, 8) })).toBe('2 – 8 Jun 2025')
    })

    it('labels a to-date week by the whole week it sits in', () => {
      expect(periodSpanLabel('week', rangeForPreset('week'))).toBe('10 – 16 Aug')
    })
  })

  describe('previousRangeFor once stepped back', () => {
    it('names the dates instead of "last week", which would name the period on screen', () => {
      const range = rangeForPreset('week', null, null, 2)
      const prev = previousRangeFor('week', range, 2)
      expect(ymd(prev.range.start)).toEqual([2026, 7, 20])
      expect(ymd(prev.range.end)).toEqual([2026, 7, 26])
      expect(prev.label).toBe('20 – 26 Jul')
      // Unstepped, it still says what it always said.
      expect(previousRangeFor('week', rangeForPreset('week')).label).toBe('last week')
    })

    it('sets a whole past month against the WHOLE month before it', () => {
      // September has 30 days, August 31: a like-for-like cut would drop Aug 31.
      vi.setSystemTime(new Date(2026, 9, 5, 12)) // now October, so September is offset 1
      const range = rangeForPreset('month', null, null, 1)
      expect(ymd(range.start)).toEqual([2026, 9, 1])
      expect(ymd(range.end)).toEqual([2026, 9, 30])
      const prev = previousRangeFor('month', range, 1)
      expect(ymd(prev.range.start)).toEqual([2026, 8, 1])
      expect(ymd(prev.range.end)).toEqual([2026, 8, 31])
      expect(prev.label).toBe('August 2026')
    })

    it('sets a past 15D window against the 15 days right before it', () => {
      const range = rangeForPreset('15d', null, null, 1)
      const prev = previousRangeFor('15d', range, 1)
      expect(ymd(prev.range.start)).toEqual([2026, 6, 30])
      expect(ymd(prev.range.end)).toEqual([2026, 7, 14])
      expect(prev.label).toBe('30 Jun – 14 Jul')
    })
  })
})