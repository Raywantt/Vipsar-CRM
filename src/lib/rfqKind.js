import { stageRank } from './stageProgress'

// Which bucket a newly-logged "RFQ Raised" activity falls into for a given
// lead, decided AT THE MOMENT it's logged, then frozen onto the activity row
// (activities.rfq_kind) — never re-derived live, same "decided once, at
// logging time" reasoning as meetingBucket.js.
//
// Settled with the owner 2026-09-09: a sales exec re-requests a quotation
// whenever the client asks for changes, so a lead often accumulates several
// RFQs before a quote is finalized. The first one on a lead is FRESH; every
// one logged once the lead already has a prior RFQ on file is REVISED. No
// retroactive classification — activities logged before this shipped keep
// rfq_kind = null (see Schema/migration_rfq_kind.sql).
//
// Originally implemented by checking the lead's funnel stage (a lead already
// at "RFQ Raised" or later must have had one before) instead of its actual
// RFQ activity history — changed 2026-09-10 after that proxy produced a
// wrong answer live: a lead's stage can reach "RFQ Raised" via a manual
// stage-chip pick, with no RFQ ever actually logged, and the rank-based rule
// then called the genuinely-first RFQ on it a revision. See rfqKindForLead's
// own comment below for the fix.
export const FRESH_RFQ = 'fresh'
export const REVISED_RFQ = 'revised'

export const RFQ_KIND_LABELS = {
  [FRESH_RFQ]: 'Fresh',
  [REVISED_RFQ]: 'Revised',
}

// The funnel position at which an RFQ stops being "fresh". Named rather than
// inlined so the rule reads the way the owner stated it. Mirrors
// meetingBucket.js's OLD_FROM_STAGE = 'rfq' — the two rules share a
// threshold today by coincidence, not because one is derived from the
// other; they answer different questions and could diverge later, so this
// is its own constant, not a shared import.
const REVISED_FROM_STAGE = 'rfq'

// `stage` is only consulted for the won/lost override below — it used to be
// the WHOLE rule (classify by funnel rank), which was found live 2026-09-10
// to be wrong: a lead's stage can reach 'rfq' or later by a manual
// stage-chip pick (an exec, coordinator or owner moving it by hand, with no
// RFQ activity ever logged), and the old rank-based rule then tagged the
// genuinely-first RFQ on that lead as a revision. Real case: Vishal moved a
// lead's chip to "RFQ Raised" one day, then logged his actual first RFQ on
// it the next day — the CRM told him it was a revision of an RFQ that had
// never happened.
//
// The rule now asks the more direct question — has an rfq_raised activity
// actually been logged for this lead before? — via `hasPriorRfqActivity`,
// which the caller resolves with a real query (this file stays pure, no
// network calls of its own). Untagged/legacy activities count as "prior"
// same as tagged ones; only their EXISTENCE matters here.
export function rfqKindForLead(stage, hasPriorRfqActivity) {
  // A decided deal (won/lost) is treated as past RFQ in every real case —
  // reaching either implies a quotation was already put in front of the
  // client, even on the rare lead where that was never logged as its own
  // activity. This stays stage-based on purpose: it's not asking "was an
  // RFQ logged", it's asking "does a new RFQ make sense as fresh sourcing
  // progress on an already-decided deal" — no.
  if (stage === 'won' || stage === 'lost') return REVISED_RFQ

  return hasPriorRfqActivity ? REVISED_RFQ : FRESH_RFQ
}

// Whether logging a FRESH RFQ should also auto-advance the lead's stage to
// 'rfq' (the owner's request — the CRM records this instead of asking the
// exec to also flip the stage chip by hand). Deliberately narrower than
// "rfqKindForLead returned fresh": a lead that's currently on_hold must
// never have its stage moved as a side effect of logging an activity —
// resuming a paused lead stays its own deliberate action — and a won/lost
// lead is never fresh in the first place (see above), so this only ever
// fires for a lead genuinely sitting before RFQ Raised in the funnel right
// now. Takes the lead's REAL current stage, never a resolved pausedAt. Note
// this stays funnel-rank-based on purpose — it answers "is there still a
// stage worth moving to", which is a different question from whether this
// is the lead's first RFQ (rfqKindForLead's job).
export function shouldAdvanceToRfq(currentStage) {
  if (currentStage === 'on_hold' || currentStage === 'won' || currentStage === 'lost') return false
  const rank = stageRank(currentStage)
  return rank != null && rank < stageRank(REVISED_FROM_STAGE)
}

// ---------------------------------------------------------------------------
// What Lead Detail's Sales progress card shows for RFQs.
//
// Replaces the old hand-maintained "RFQ raised" checkbox + date input
// (removed 2026-09-09, the owner's call): now that logging an RFQ Raised
// activity auto-advances the stage, the rep already tells the CRM when an
// RFQ went out, so asking them again on this form was a second place to
// record one fact — and the two could disagree.
//
// The rules, settled with the owner:
//   * The FRESH date is the EARLIEST RFQ Raised activity NOT tagged
//     'revised'. Excluding revisions from that calculation, rather than
//     just taking the first row of any kind, is what makes the owner's
//     stated invariant hold in every case: the fresh RFQ date cannot
//     change however many revisions are logged afterwards. It also
//     handles the lead whose very first LOGGED RFQ is itself a revision
//     (real for a legacy lead already sitting past RFQ stage when the
//     CRM first saw it) — that lead has no fresh RFQ on record and says
//     so, rather than relabelling a revision as the fresh one.
//   * The REVISED date is the LATEST activity explicitly tagged
//     rfq_kind = 'revised', and moves forward with each new one.
//     Untagged pre-2026-09-09 rows never produce one — no retroactive
//     classification, the same rule migration_rfq_kind.sql
//     applies to the data itself. A lead with three old untagged RFQs
//     therefore shows one date, not a guessed revision.
//   * With no RFQ activity at all, fall back to the lead's own stored
//     rfq_raised_at / rfq_raised. The legacy imports wrote those columns
//     directly on hundreds of leads whose RFQ was never logged as an
//     activity, and those leads would otherwise go blank where they show a
//     date today. `source` says which of the two answered, so the caller
//     can word it honestly.
//
// Pure — takes rows already fetched for the activity timeline, makes no
// query of its own. Dates are returned as the raw column values; the caller
// formats them (an activity's created_at is a naive TIMESTAMP needing
// parseTimestamp, the lead's rfq_raised_at is a plain DATE that must not go
// near a Date at all — see dbTime.js).
export function summariseRfqHistory(activities, lead) {
  const rfqs = (activities ?? [])
    .filter((a) => a.activity_type === 'rfq_raised')
    .slice()
    // The caller's own order isn't guaranteed (LeadDetail fetches activities
    // newest-first), so sort here rather than trusting it. Ties keep their
    // incoming order, which is fine: two RFQs sharing a timestamp are the
    // same day's work either way.
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))

  if (rfqs.length === 0) {
    if (lead?.rfq_raised_at) {
      return { raised: true, source: 'lead', freshAt: lead.rfq_raised_at, revisedAt: null, revisedCount: 0 }
    }
    // rfq_raised true with no date is a real state in the Vipul import: the
    // RFQ is a fact, the date isn't recorded anywhere. Say so rather than
    // dropping the fact or inventing a day for it.
    if (lead?.rfq_raised) {
      return { raised: true, source: 'lead', freshAt: null, revisedAt: null, revisedCount: 0 }
    }
    return { raised: false, source: null, freshAt: null, revisedAt: null, revisedCount: 0 }
  }

  const revisions = rfqs.filter((a) => a.rfq_kind === REVISED_RFQ)
  // Not rfqs[0] — see the FRESH rule above. Anything not tagged 'revised'
  // counts, which is what keeps untagged legacy rows working, and what
  // makes the fresh date immovable however many revisions arrive later.
  const fresh = rfqs.find((a) => a.rfq_kind !== REVISED_RFQ)

  return {
    raised: true,
    source: 'activity',
    freshAt: fresh ? fresh.created_at ?? null : null,
    revisedAt: revisions.length > 0 ? revisions[revisions.length - 1].created_at ?? null : null,
    revisedCount: revisions.length,
  }
}
