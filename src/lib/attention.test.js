import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  computeAttentionBuckets,
  computeAttentionBucketsFromRpc,
  computeStale7Bucket,
  computeStale7BucketFromRpc,
  countDistinctLeads,
  buildAgeingPanel,
  STALE_DAYS,
  ATTENTION_DAYS,
  SILENT_QUOTE_DAYS,
  PENDING_RFQ_DAYS,
} from './attention'

// Deliberately well past attention.js's HISTORY_STARTS_AT (2026-09-02) so the
// legacy-import clamp is inert here and every threshold test below measures
// the threshold it claims to. Moved forward from 2026-08-13 when that clamp
// landed — at the old date every fixture sat before the floor, so all five
// buckets correctly reported nothing and eight tests failed. The clamp has
// its own describe block at the bottom of this file.
const NOW = new Date(2026, 10, 12, 12, 0, 0) // Thursday 2026-11-12, noon
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

function baseLead(overrides = {}) {
  return {
    id: 'lead-1',
    external_reference_id: null,   // app-created; see isImportedLead
    current_stage: 'negotiation',
    created_at: daysAgo(30),
    quote_value: 10000,
    order_value: null,
    quote_sent: false,
    quote_sent_at: null,
    next_followup_date: null,
    estimated_close_date: null,
    rfq_raised: false,
    rfq_raised_at: null,
    owner_employee_id: 'emp-1',
    employees: { name: 'Asha Rao' },
    parties: { name: 'Test Party' },
    ...overrides,
  }
}

describe('computeAttentionBuckets', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('excludes closed (won/lost) leads from every bucket', () => {
    const leads = [
      baseLead({ id: 'won', current_stage: 'won', created_at: daysAgo(60) }),
      baseLead({ id: 'lost', current_stage: 'lost', created_at: daysAgo(60) }),
    ]
    const buckets = computeAttentionBuckets(leads, new Map())
    buckets.forEach((b) => expect(b.count).toBe(0))
  })

  it('puts a lead in the queue once untouched for ATTENTION_DAYS, using last activity over created_at', () => {
    const lastActivity = new Map()
    const lead = baseLead({ id: 'stale-lead', created_at: daysAgo(100) })
    lastActivity.set('stale-lead', daysAgo(ATTENTION_DAYS))

    const [stale] = computeAttentionBuckets([lead], lastActivity)
    expect(stale.key).toBe('stale')
    expect(stale.count).toBe(1)
    expect(stale.rows[0].last).toContain('Last activity')
  })

  it('does not queue a lead touched more recently than ATTENTION_DAYS', () => {
    const lastActivity = new Map([['lead-1', daysAgo(ATTENTION_DAYS - 1)]])
    const [stale] = computeAttentionBuckets([baseLead()], lastActivity)
    expect(stale.count).toBe(0)
  })

  // The whole point of splitting these two constants (2026-08-10): a lead
  // starts reading as stale at STALE_DAYS but must not reach the queue until
  // ATTENTION_DAYS. Collapsing them back into one value — the state this app
  // shipped in for months — makes this fail.
  it('leaves a lead that is stale but not yet due for attention out of the queue', () => {
    expect(STALE_DAYS).toBeLessThan(ATTENTION_DAYS)
    const lastActivity = new Map([['lead-1', daysAgo(STALE_DAYS)]])
    const [stale] = computeAttentionBuckets([baseLead()], lastActivity)
    expect(stale.count).toBe(0)
  })

  it('falls back to created_at when a lead has no logged activity at all', () => {
    const lead = baseLead({ id: 'untouched', created_at: daysAgo(ATTENTION_DAYS + 1) })
    const [stale] = computeAttentionBuckets([lead], new Map())
    expect(stale.count).toBe(1)
    expect(stale.rows[0].last).toContain('No activity since created')
  })

  it('flags a silent quote only when nothing was logged since it was sent', () => {
    const lead = baseLead({
      id: 'quote-lead',
      quote_sent: true,
      quote_sent_at: daysAgo(SILENT_QUOTE_DAYS),
    })
    const lastActivity = new Map([['quote-lead', daysAgo(SILENT_QUOTE_DAYS)]]) // no activity newer than the quote
    const buckets = computeAttentionBuckets([lead], lastActivity)
    const silentQuotes = buckets.find((b) => b.key === 'silent_quotes')
    expect(silentQuotes.count).toBe(1)
  })

  it('does not flag a silent quote when a later activity was logged', () => {
    const lead = baseLead({
      id: 'quote-lead-2',
      quote_sent: true,
      quote_sent_at: daysAgo(SILENT_QUOTE_DAYS + 2),
    })
    const lastActivity = new Map([['quote-lead-2', daysAgo(1)]]) // touched after the quote
    const buckets = computeAttentionBuckets([lead], lastActivity)
    const silentQuotes = buckets.find((b) => b.key === 'silent_quotes')
    expect(silentQuotes.count).toBe(0)
  })

  it('flags an overdue follow-up when next_followup_date is in the past', () => {
    const lead = baseLead({ id: 'fu-lead', next_followup_date: daysAgo(2) })
    const buckets = computeAttentionBuckets([lead], new Map())
    const overdue = buckets.find((b) => b.key === 'followups_overdue')
    expect(overdue.count).toBe(1)
  })

  it('does not flag a follow-up due in the future', () => {
    const future = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()
    const lead = baseLead({ id: 'fu-lead-2', next_followup_date: future })
    const buckets = computeAttentionBuckets([lead], new Map())
    const overdue = buckets.find((b) => b.key === 'followups_overdue')
    expect(overdue.count).toBe(0)
  })

  it('flags a slipped close date when estimated_close_date is in the past', () => {
    const lead = baseLead({ id: 'slip-lead', estimated_close_date: daysAgo(5) })
    const buckets = computeAttentionBuckets([lead], new Map())
    const slipped = buckets.find((b) => b.key === 'slipped')
    expect(slipped.count).toBe(1)
  })

  it('flags a pending RFQ once it has waited PENDING_RFQ_DAYS with no quote sent', () => {
    const lead = baseLead({ id: 'rfq-lead', rfq_raised: true, rfq_raised_at: daysAgo(PENDING_RFQ_DAYS) })
    const buckets = computeAttentionBuckets([lead], new Map())
    const pending = buckets.find((b) => b.key === 'pending_rfq')
    expect(pending.count).toBe(1)
  })

  it('does not flag a pending RFQ once a quote has been sent', () => {
    const lead = baseLead({
      id: 'rfq-lead-2',
      rfq_raised: true,
      rfq_raised_at: daysAgo(PENDING_RFQ_DAYS + 5),
      quote_sent: true,
    })
    const buckets = computeAttentionBuckets([lead], new Map())
    const pending = buckets.find((b) => b.key === 'pending_rfq')
    expect(pending.count).toBe(0)
  })

  it('a single lead can land in more than one bucket at once', () => {
    const lead = baseLead({
      id: 'multi',
      created_at: daysAgo(40),
      next_followup_date: daysAgo(3),
      estimated_close_date: daysAgo(3),
    })
    const buckets = computeAttentionBuckets([lead], new Map())
    const hitKeys = buckets.filter((b) => b.count > 0).map((b) => b.key)
    expect(hitKeys).toEqual(expect.arrayContaining(['stale', 'followups_overdue', 'slipped']))
  })

  it('returns rows sorted oldest (highest age) first', () => {
    // All three must clear ATTENTION_DAYS or they never reach the bucket to be
    // sorted. 'a' was 10 days, which qualified while the queue threshold was 7.
    const leads = [
      baseLead({ id: 'a', created_at: daysAgo(16) }),
      baseLead({ id: 'b', created_at: daysAgo(50) }),
      baseLead({ id: 'c', created_at: daysAgo(20) }),
    ]
    const [stale] = computeAttentionBuckets(leads, new Map())
    expect(stale.rows.map((r) => r.leadId)).toEqual(['b', 'c', 'a'])
  })

  // A lead on hold is deliberately paused — no length of pause should read
  // as neglect, however many months it's been held.
  it('never puts an on_hold lead in the stale bucket, no matter how long it has sat untouched', () => {
    const lead = baseLead({ id: 'held', current_stage: 'on_hold', created_at: daysAgo(400) })
    const [stale] = computeAttentionBuckets([lead], new Map())
    expect(stale.count).toBe(0)
  })

  // The clock resets to the day of the resume, not to wherever it stood
  // before the pause — a stage change away from on_hold is a touch.
  it('does not flag a lead as stale immediately after it resumes from hold', () => {
    const lead = baseLead({ id: 'resumed', current_stage: 'calling', created_at: daysAgo(400) })
    const lastStageChange = new Map([['resumed', daysAgo(1)]]) // resumed yesterday
    const [stale] = computeAttentionBuckets([lead], new Map(), lastStageChange)
    expect(stale.count).toBe(0)
  })

  it('flags a resumed lead as stale again once ATTENTION_DAYS have passed since the resume', () => {
    const lead = baseLead({ id: 'resumed-stale', current_stage: 'calling', created_at: daysAgo(400) })
    const lastStageChange = new Map([['resumed-stale', daysAgo(ATTENTION_DAYS)]])
    const [stale] = computeAttentionBuckets([lead], new Map(), lastStageChange)
    expect(stale.count).toBe(1)
    expect(stale.rows[0].last).toContain('Stage changed')
  })

  it('prefers a real logged activity over the stage change when the activity is more recent', () => {
    const lead = baseLead({ id: 'active-after-resume', current_stage: 'calling', created_at: daysAgo(400) })
    const lastActivity = new Map([['active-after-resume', daysAgo(ATTENTION_DAYS - 1)]])
    const lastStageChange = new Map([['active-after-resume', daysAgo(200)]]) // resumed long ago
    const [stale] = computeAttentionBuckets([lead], lastActivity, lastStageChange)
    expect(stale.count).toBe(0)
  })
})

describe('computeAttentionBucketsFromRpc — stale display matches the client-side path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function baseRpcRow(overrides = {}) {
    return {
      lead_id: 'r-1',
      party: 'Test Party',
      owner_name: 'Asha Rao',
      owner_id: 'emp-1',
      current_stage: 'calling',
      quote_value: null,
      order_value: null,
      last_activity_at: null,
      last_stage_change_at: null,
      lead_created_at: daysAgo(400),
      quote_sent_at: null,
      next_followup_date: null,
      estimated_close_date: null,
      rfq_raised_at: null,
      is_stale: true,
      is_silent_quote: false,
      is_followup_overdue: false,
      is_slipped: false,
      is_pending_rfq: false,
      ...overrides,
    }
  }

  it('reports the age from last_stage_change_at, not the stale-before-resume last_activity_at', () => {
    const row = baseRpcRow({ last_activity_at: daysAgo(400), last_stage_change_at: daysAgo(ATTENTION_DAYS) })
    const [stale] = computeAttentionBucketsFromRpc([row])
    expect(stale.rows[0].age).toBe(ATTENTION_DAYS)
    expect(stale.rows[0].last).toContain('Stage changed')
  })

  it('reports the age from last_activity_at when it is the more recent signal', () => {
    const row = baseRpcRow({ last_activity_at: daysAgo(ATTENTION_DAYS), last_stage_change_at: daysAgo(200) })
    const [stale] = computeAttentionBucketsFromRpc([row])
    expect(stale.rows[0].age).toBe(ATTENTION_DAYS)
    expect(stale.rows[0].last).toContain('Last activity')
  })

  it('trusts is_stale for membership rather than re-deciding it client-side', () => {
    // Server said not stale — even with an old-looking date, no row appears.
    const row = baseRpcRow({ is_stale: false, last_activity_at: daysAgo(400) })
    const [stale] = computeAttentionBucketsFromRpc([row])
    expect(stale.count).toBe(0)
  })
})

// The dedicated STALE_DAYS(7) tile — deliberately a DIFFERENT, earlier
// number from computeAttentionBuckets()'s ATTENTION_DAYS(14) 'stale' entry
// above. Before 2026-09-08 RightNowStrip's "Stale Leads" tile just reused
// that 14-day bucket, so the two always read identical — these tests pin
// that they no longer do.
describe('computeStale7Bucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flags a lead untouched for STALE_DAYS, well before it would enter the ATTENTION_DAYS queue', () => {
    const lastActivity = new Map([['lead-1', daysAgo(STALE_DAYS)]])
    const bucket = computeStale7Bucket([baseLead()], lastActivity)
    expect(bucket.key).toBe('stale_7d')
    expect(bucket.count).toBe(1)
  })

  it('does not flag a lead touched more recently than STALE_DAYS', () => {
    const lastActivity = new Map([['lead-1', daysAgo(STALE_DAYS - 1)]])
    const bucket = computeStale7Bucket([baseLead()], lastActivity)
    expect(bucket.count).toBe(0)
  })

  it('is a superset of the ATTENTION_DAYS bucket — anything stale enough to queue is also stale enough for this tile', () => {
    const lastActivity = new Map([['lead-1', daysAgo(ATTENTION_DAYS)]])
    const bucket = computeStale7Bucket([baseLead()], lastActivity)
    expect(bucket.count).toBe(1)
  })

  it('never puts an on_hold lead in this bucket either, same rule as the ATTENTION_DAYS one', () => {
    const lead = baseLead({ id: 'held', current_stage: 'on_hold', created_at: daysAgo(400) })
    const bucket = computeStale7Bucket([lead], new Map())
    expect(bucket.count).toBe(0)
  })

  it('excludes closed (won/lost) leads', () => {
    const leads = [
      baseLead({ id: 'won', current_stage: 'won', created_at: daysAgo(60) }),
      baseLead({ id: 'lost', current_stage: 'lost', created_at: daysAgo(60) }),
    ]
    const bucket = computeStale7Bucket(leads, new Map())
    expect(bucket.count).toBe(0)
  })
})

describe('computeStale7BucketFromRpc', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function baseRpcRow(overrides = {}) {
    return {
      lead_id: 'r-1',
      party: 'Test Party',
      owner_name: 'Asha Rao',
      owner_id: 'emp-1',
      current_stage: 'calling',
      quote_value: null,
      order_value: null,
      last_activity_at: daysAgo(STALE_DAYS),
      last_stage_change_at: null,
      lead_created_at: daysAgo(400),
      is_stale_7d: true,
      ...overrides,
    }
  }

  it('trusts is_stale_7d for membership rather than re-deciding it client-side', () => {
    const row = baseRpcRow({ is_stale_7d: false, last_activity_at: daysAgo(400) })
    const bucket = computeStale7BucketFromRpc([row])
    expect(bucket.count).toBe(0)
  })

  it('includes a row the server flagged, even one that would not qualify for the ATTENTION_DAYS bucket', () => {
    const row = baseRpcRow({ is_stale_7d: true, last_activity_at: daysAgo(STALE_DAYS) })
    const bucket = computeStale7BucketFromRpc([row])
    expect(bucket.count).toBe(1)
  })

  // A row from a database that hasn't run migration_stale_7day_tile.sql yet
  // has no `is_stale_7d` field at all — must degrade to "not stale" rather
  // than throwing, so the tile reads an honest (if temporarily low) 0
  // instead of crashing the page.
  it('degrades to an empty bucket, not a crash, when is_stale_7d is absent (migration not yet run)', () => {
    const row = baseRpcRow()
    delete row.is_stale_7d
    const bucket = computeStale7BucketFromRpc([row])
    expect(bucket.count).toBe(0)
  })
})

describe('countDistinctLeads', () => {
  it('dedupes a lead appearing in multiple buckets', () => {
    const buckets = [
      { rows: [{ leadId: 'x' }, { leadId: 'y' }] },
      { rows: [{ leadId: 'x' }] },
    ]
    expect(countDistinctLeads(buckets)).toBe(2)
  })

  it('returns 0 for all-empty buckets', () => {
    expect(countDistinctLeads([{ rows: [] }, { rows: [] }])).toBe(0)
  })
})

describe('buildAgeingPanel', () => {
  it('gates queueActions on scopeLabel, on for personal ("You"), off for company-wide', () => {
    const bucket = { title: 'No activity in 7+ days', note: 'note', listTitle: 't', listHint: 'h', count: 0, rows: [] }
    expect(buildAgeingPanel(bucket, 'Company').queueActions).toBe(false)
    expect(buildAgeingPanel(bucket, 'You', 'emp-1').queueActions).toBe(true)
  })

  it('rolls up rows by owner, counting and summing value per owner', () => {
    const bucket = {
      title: 'Stale',
      note: 'note',
      listTitle: 't',
      listHint: 'h',
      count: 2,
      rows: [
        { leadId: '1', ownerId: 'emp-1', owner: 'Asha', value: 1000, age: 10, party: 'P1', stage: 'Calling', chipClass: 'c', last: 'x' },
        { leadId: '2', ownerId: 'emp-1', owner: 'Asha', value: 2000, age: 20, party: 'P2', stage: 'Calling', chipClass: 'c', last: 'x' },
      ],
    }
    const panel = buildAgeingPanel(bucket)
    expect(panel.ownerRows).toHaveLength(1)
    expect(panel.ownerRows[0]).toMatchObject({ name: 'Asha', count: 2 })
    expect(panel.stats.find((s) => s.label === 'Oldest').value).toBe('20d')
  })

  it('groups a null ownerId under "unassigned" rather than crashing', () => {
    const bucket = {
      title: 'Stale',
      note: 'note',
      listTitle: 't',
      listHint: 'h',
      count: 1,
      rows: [{ leadId: '1', ownerId: null, owner: 'Unassigned', value: 500, age: 5, party: 'P1', stage: 'Calling', chipClass: 'c', last: 'x' }],
    }
    const panel = buildAgeingPanel(bucket)
    expect(panel.ownerRows).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The legacy-import reset (HISTORY_STARTS_AT). Pins the behaviour the owner
// asked for on 2026-09-03: every bucket clears to a blank slate, then refills
// on its own threshold as the floor ages. If someone deletes the clamp, the
// first test here fails rather than 300+ leads quietly reappearing on the
// dashboard one morning.
// ---------------------------------------------------------------------------
describe('computeAttentionBuckets — legacy history floor', () => {
  // One day after HISTORY_STARTS_AT: nothing can have aged past any threshold.
  const JUST_AFTER_GO_LIVE = new Date(2026, 8, 3, 12, 0, 0) // 2026-09-03
  const legacyLead = (overrides = {}) =>
    baseLead({
      // A real imported lead: created years ago, never touched in this CRM.
      // external_reference_id is what marks it as imported — without it the
      // clamp correctly does not apply and every test below would fail.
      external_reference_id: 'legacy-152',
      created_at: new Date(2023, 0, 21).toISOString(),
      ...overrides,
    })

  afterEach(() => vi.useRealTimers())

  function atTime(when) {
    vi.useFakeTimers()
    vi.setSystemTime(when)
  }

  it('clears all five buckets on day one, however old the inherited data is', () => {
    atTime(JUST_AFTER_GO_LIVE)
    const leads = [
      legacyLead({ id: 'stale' }),
      legacyLead({ id: 'quote', quote_sent: true, quote_sent_at: '2023-02-01' }),
      legacyLead({ id: 'rfq', rfq_raised: true, rfq_raised_at: '2023-02-01' }),
      legacyLead({ id: 'followup', next_followup_date: '2023-03-01' }),
      legacyLead({ id: 'slipped', estimated_close_date: '2023-04-01' }),
    ]
    const buckets = computeAttentionBuckets(leads, new Map())
    buckets.forEach((b) => expect(b.count).toBe(0))
  })

  it('hands each bucket back on its own threshold, not all at once', () => {
    const leads = [
      legacyLead({ id: 'stale' }),
      legacyLead({ id: 'quote', quote_sent: true, quote_sent_at: '2023-02-01' }),
      legacyLead({ id: 'rfq', rfq_raised: true, rfq_raised_at: '2023-02-01' }),
    ]
    const countsOn = (date) => {
      atTime(date)
      const [stale, silent, , , rfq] = computeAttentionBuckets(leads, new Map())
      vi.useRealTimers()
      return { stale: stale.count, silent: silent.count, rfq: rfq.count }
    }
    // PENDING_RFQ_DAYS (3) lands first, then SILENT_QUOTE_DAYS (5),
    // then ATTENTION_DAYS (14) — floor is 2026-09-02.
    expect(countsOn(new Date(2026, 8, 6, 12))).toEqual({ stale: 0, silent: 0, rfq: 1 })
    expect(countsOn(new Date(2026, 8, 8, 12))).toEqual({ stale: 0, silent: 1, rfq: 1 })
    // stale is 3, not 1: all three fixtures are untouched legacy leads, so
    // every one of them crosses ATTENTION_DAYS together once the floor ages.
    expect(countsOn(new Date(2026, 8, 17, 12))).toEqual({ stale: 3, silent: 1, rfq: 1 })
  })

  it('reports the REAL age once a lead resurfaces, not the floored one', () => {
    atTime(new Date(2026, 8, 17, 12)) // 15 days past the floor
    const [stale] = computeAttentionBuckets([legacyLead({ id: 'old' })], new Map())
    expect(stale.count).toBe(1)
    // Created 2023-01-21; ~1335 days by 2026-09-17. The floor gates whether it
    // shows, never what it claims about itself.
    expect(stale.rows[0].age).toBeGreaterThan(1300)
  })

  it('does not shield a lead whose own recorded activity is recent enough to judge', () => {
    atTime(new Date(2026, 9, 30, 12)) // well past the floor
    const lastActivity = new Map([['worked', new Date(2026, 9, 1).toISOString()]])
    const [stale] = computeAttentionBuckets([legacyLead({ id: 'worked' })], lastActivity)
    // Real activity logged in this CRM 29 days ago — the clamp is irrelevant.
    expect(stale.count).toBe(1)
    expect(stale.rows[0].age).toBe(29)
  })

  it('still fires immediately for a date set inside this CRM, with no grace', () => {
    atTime(new Date(2026, 8, 3, 12)) // day one, when everything else is silent
    const leads = [
      baseLead({ id: 'own-followup', created_at: '2026-09-02', next_followup_date: '2026-09-02' }),
    ]
    const [, , followupsOverdue] = computeAttentionBuckets(leads, new Map())
    // Dated on/after the floor, so it is this CRM's own promise, not an
    // inherited one — a rep who set yesterday's date is genuinely overdue.
    expect(followupsOverdue.count).toBe(1)
  })
})

// Regression guard for a bug caught live on 2026-09-03, before shipping: the
// first cut of the clamp keyed on the DATE alone, so it also silenced
// app-created leads whose dates happened to predate the import. Lead #320
// (MADANLAL LAKHANI) was a genuine in-CRM follow-up, set for 22 Aug and truly
// overdue, and it vanished for a fortnight. The clamp must key on provenance.
describe('computeAttentionBuckets — the clamp must not touch app-created leads', () => {
  const DAY_AFTER_IMPORT = new Date(2026, 8, 3, 12, 0, 0) // 2026-09-03

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(DAY_AFTER_IMPORT)
  })
  afterEach(() => vi.useRealTimers())

  it('still reports an app-created follow-up that went overdue before the import', () => {
    const leads = [
      baseLead({ id: 320, external_reference_id: null, next_followup_date: '2026-08-22' }),
    ]
    const [, , followupsOverdue] = computeAttentionBuckets(leads, new Map())
    expect(followupsOverdue.count).toBe(1)
  })

  it('still reports an app-created lead that has genuinely gone quiet', () => {
    const leads = [
      baseLead({ id: 'app', external_reference_id: null, created_at: new Date(2026, 6, 1).toISOString() }),
    ]
    const [stale] = computeAttentionBuckets(leads, new Map())
    expect(stale.count).toBe(1)
  })

  it('silences the identical lead when it carries an import reference', () => {
    const leads = [
      baseLead({ id: 'imported', external_reference_id: 'legacy-9', created_at: new Date(2026, 6, 1).toISOString() }),
    ]
    const [stale] = computeAttentionBuckets(leads, new Map())
    expect(stale.count).toBe(0)
  })
})
