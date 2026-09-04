import { describe, it, expect } from 'vitest'
import { fetchAllRows } from './fetchAllRows'

// A stand-in for a PostgREST builder: .order()/.range() are chainable and the
// object is awaited at the end. `cap` is the server's max-rows setting — the
// thing that makes an uncapped query silently short.
function fakeTable(rows, { cap = 1000, withCount = true } = {}) {
  const calls = []
  const build = () => {
    let from = 0
    let to = Infinity
    const q = {
      order: (col, opts) => {
        q._orders.push([col, opts?.ascending])
        return q
      },
      range: (a, b) => {
        from = a
        to = b
        return q
      },
      _orders: [],
      then: (resolve) => {
        const want = Math.min(to - from + 1, cap)
        const slice = rows.slice(from, from + want)
        calls.push({ from, to, returned: slice.length, orders: q._orders })
        resolve({ data: slice, error: null, count: withCount ? rows.length : null })
      },
    }
    return q
  }
  return { build, calls }
}

const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }))

describe('fetchAllRows', () => {
  it('returns every row when the table is larger than the server cap', async () => {
    const t = fakeTable(mkRows(1204), { cap: 1000 })
    const { data, error } = await fetchAllRows(t.build)
    expect(error).toBe(null)
    expect(data).toHaveLength(1204)
    expect(data.at(-1).id).toBe(1204)
  })

  // The regression that shipped: one unpaged request stops at the cap and
  // reports 1,000 of 1,204 rows as if it were everything.
  it('a single capped request would have missed 204 rows', async () => {
    const t = fakeTable(mkRows(1204), { cap: 1000 })
    const { data } = await t.build().range(0, 1_000_000)
    expect(data).toHaveLength(1000)
  })

  it('costs exactly ceil(total / cap) requests when a count is available', async () => {
    const t = fakeTable(mkRows(1204), { cap: 1000 })
    await fetchAllRows(t.build)
    expect(t.calls).toHaveLength(2)
    expect(t.calls.map((c) => c.from)).toEqual([0, 1000])
  })

  it('still returns every row when the caller forgot the count', async () => {
    const t = fakeTable(mkRows(1204), { cap: 1000, withCount: false })
    const { data } = await fetchAllRows(t.build, { pageSize: 1000 })
    expect(data).toHaveLength(1204)
    // No count means it can only stop on an empty page: one extra round trip.
    expect(t.calls).toHaveLength(3)
  })

  // A short page must not be read as "the rows ran out" — it can just be the
  // server's own cap coming in under what we asked for.
  it('does not truncate when the server cap is smaller than the page size', async () => {
    const t = fakeTable(mkRows(1204), { cap: 500, withCount: false })
    const { data } = await fetchAllRows(t.build, { pageSize: 1000 })
    expect(data).toHaveLength(1204)
  })

  it('applies a deterministic order so paging cannot repeat or skip rows', async () => {
    const t = fakeTable(mkRows(10))
    await fetchAllRows(t.build)
    expect(t.calls[0].orders).toContainEqual(['id', true])
  })

  it("appends its order last, leaving the caller's own sort primary", async () => {
    const t = fakeTable(mkRows(10))
    await fetchAllRows(() => t.build().order('changed_at', { ascending: false }))
    expect(t.calls[0].orders).toEqual([
      ['changed_at', false],
      ['id', true],
    ])
  })

  // Consumers like mostRecentLeadByParty and computeOrderValueActuals read a
  // most-recent-first list and keep the FIRST row per key. An ascending
  // tiebreaker would hand them the oldest of a set of rows sharing a
  // timestamp — and the legacy imports wrote whole sheets in one transaction,
  // so shared timestamps are the norm, not an edge case.
  it('can tie-break descending, to match a most-recent-first sort', async () => {
    const t = fakeTable(mkRows(10))
    await fetchAllRows(() => t.build().order('changed_at', { ascending: false }), { ascending: false })
    expect(t.calls[0].orders).toEqual([
      ['changed_at', false],
      ['id', false],
    ])
  })

  it('surfaces an error instead of returning a partial list', async () => {
    const failing = () => ({
      order: function () { return this },
      range: function () { return this },
      then: (resolve) => resolve({ data: null, error: { message: 'boom' }, count: null }),
    })
    const { data, error } = await fetchAllRows(failing)
    expect(data).toBe(null)
    expect(error.message).toBe('boom')
  })

  it('handles an empty table without an extra page', async () => {
    const t = fakeTable([])
    const { data } = await fetchAllRows(t.build)
    expect(data).toEqual([])
    expect(t.calls).toHaveLength(1)
  })

  // speculativePages: fire page 2 alongside page 1 rather than waiting for
  // page 1's count to prove it's needed. Opt-in, for the tables known to sit
  // just over the cap (leads/stage_history/parties).
  describe('speculativePages', () => {
    it('returns the same rows as the serial path, in the same order', async () => {
      const serial = fakeTable(mkRows(1204), { cap: 1000 })
      const spec = fakeTable(mkRows(1204), { cap: 1000 })
      const a = await fetchAllRows(serial.build)
      const b = await fetchAllRows(spec.build, { speculativePages: 1 })
      expect(b.data).toEqual(a.data)
      expect(b.data).toHaveLength(1204)
    })

    it('fetches both pages at once instead of waiting for the count', async () => {
      const t = fakeTable(mkRows(1204), { cap: 1000 })
      await fetchAllRows(t.build, { speculativePages: 1 })
      // Still exactly 2 requests — the win is that they overlap, not that
      // there are fewer of them.
      expect(t.calls).toHaveLength(2)
      expect(t.calls.map((c) => c.from).sort((x, y) => x - y)).toEqual([0, 1000])
    })

    // The cost of guessing wrong: one extra request that comes back empty.
    // It must not corrupt the result or trigger further paging.
    it('is harmless when the table turns out to fit in one page', async () => {
      const t = fakeTable(mkRows(10), { cap: 1000 })
      const { data } = await fetchAllRows(t.build, { speculativePages: 1 })
      expect(data).toHaveLength(10)
      expect(t.calls).toHaveLength(2)
    })

    it('is harmless on an empty table', async () => {
      const t = fakeTable([], { cap: 1000 })
      const { data } = await fetchAllRows(t.build, { speculativePages: 1 })
      expect(data).toEqual([])
    })

    it('still fetches pages beyond the speculative ones', async () => {
      const t = fakeTable(mkRows(3500), { cap: 1000 })
      const { data } = await fetchAllRows(t.build, { speculativePages: 1 })
      expect(data).toHaveLength(3500)
      expect(t.calls.map((c) => c.from).sort((x, y) => x - y)).toEqual([0, 1000, 2000, 3000])
    })

    // With no count there is no plan to follow, so the serial walk still has
    // to run — but it must resume AFTER what the speculative page already
    // brought back, not re-fetch it.
    it('does not duplicate rows when no count is available', async () => {
      const t = fakeTable(mkRows(1204), { cap: 1000, withCount: false })
      const { data } = await fetchAllRows(t.build, { speculativePages: 1 })
      expect(data).toHaveLength(1204)
      expect(data.at(-1).id).toBe(1204)
    })

    it('surfaces an error from a speculative page rather than silently dropping it', async () => {
      let call = 0
      const build = () => ({
        order: function () { return this },
        range: function () { return this },
        then: (resolve) => {
          call += 1
          if (call === 2) return resolve({ data: null, error: { message: 'page 2 failed' }, count: null })
          resolve({ data: mkRows(1000), error: null, count: 1204 })
        },
      })
      const { data, error } = await fetchAllRows(build, { speculativePages: 1 })
      expect(data).toBe(null)
      expect(error.message).toBe('page 2 failed')
    })
  })

  it('stops cleanly when the total is an exact multiple of the cap', async () => {
    const t = fakeTable(mkRows(2000), { cap: 1000 })
    const { data } = await fetchAllRows(t.build)
    expect(data).toHaveLength(2000)
    expect(t.calls).toHaveLength(2)
  })
})
