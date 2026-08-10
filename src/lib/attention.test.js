import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeAttentionBuckets, countDistinctLeads, buildAgeingPanel, STALE_DAYS, ATTENTION_DAYS, SILENT_QUOTE_DAYS, PENDING_RFQ_DAYS } from './attention'

const NOW = new Date(2026, 7, 13, 12, 0, 0) // Thursday 2026-08-13, noon
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

function baseLead(overrides = {}) {
  return {
    id: 'lead-1',
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
