// The popups behind the business development manager's figures — the three
// target rows (Architect meetings, Joineries received, Leads generated) and the
// tiles on the owner's Architect Network card (Waiting in pool, Handed over,
// Won / Win rate), plus the same three target rows on the BDM's own Dashboard.
// ("Open pipeline" is not here: it reuses the pipeline popup.)
//
// Pure, no network: every row is read out of what both screens already hold —
// the BDM's leads, their architect meetings in the period, the won/lost stage
// changes and the hand-over history. Each popup is the list the figure counts,
// so the number on the card and the rows behind it cannot disagree:
//   - targets reduce through computeBdmTargetActuals' own rule (`inRange`,
//     joinery_received, the BDM's frozen tag);
//   - Won / Win rate reduce buildClosedRows, the very rows the BDM's Closed
//     card lists, through summariseClosedRows;
//   - Handed over reduces buildHandedOverRows.
// One panel kind, `records` (RecordsBody in DrilldownPanel.jsx): a header, four
// figures and one or more dated lists.
//
// The lead-based popups carry the Office chips like every other popup built from
// leads (src/lib/officeScope.js); the architect-meetings one is not about leads
// and has none.
import { officeAware } from './officeScope'
import { parseTimestamp, formatClockTime } from './dbTime'
import { inRange, summariseClosedRows } from './bdmDashboard'
import { buildClosedRows, buildHandedOverRows } from './bdmLeadUpdates'
import { sourcingArchitect } from './poolLeads'
import { leadDisplayName } from './leadName'
import { stageLabel } from './leadStageOptions'
import { stageChipClass, TONE_BAD_INK, TONE_INK, TONE_NEUTRAL, TONE_WON } from './statusColors'
import { formatCurrencyCompact } from './format'
import { dealValueOrNull, sumOpenPipelineValue } from './pipelineValue'
import { daysSince } from './architectStats'
import { SOURCE_TYPE_LABELS } from './sourceTypeOptions'
import { territoryLabel } from './territoryOptions'
import { lossReasonLabel } from './lossReasonOptions'

const CLOSED_STAGES = ['won', 'lost']
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const money = (n) => formatCurrencyCompact(Math.round(Number(n) || 0))

// "08 Oct" — the date alone, the way every other popup list dates a row. Goes
// through parseTimestamp: these are naive UTC TIMESTAMPs.
function shortDay(value) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

const byNewest = (field) => (a, b) => (parseTimestamp(b[field])?.getTime() ?? 0) - (parseTimestamp(a[field])?.getTime() ?? 0)

// One lead as a row: when it came in (or whatever date the popup is about), its
// name, where it stands now, and a quiet line saying how it arrived.
function leadRow(lead, { at, extra = [] }) {
  const stage = lead.current_stage ?? 'calling'
  const value = dealValueOrNull(lead)
  const architect = sourcingArchitect(lead.referrer, lead.other)
  const meta = [
    ...extra,
    architect?.name ? `via ${architect.name}` : null,
    SOURCE_TYPE_LABELS[lead.source_type] ?? lead.source_type ?? null,
    lead.office_territory ? territoryLabel(lead.office_territory) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    key: `lead-${lead.id}`,
    when: shortDay(at),
    name: leadDisplayName(lead),
    to: `/leads/${lead.id}`,
    chip: { label: stageLabel(stage), chipClass: stageChipClass(stage) },
    meta,
    value: value != null && value > 0 ? formatCurrencyCompact(value) : '—',
  }
}

// Who holds a lead, in words a list line can carry.
const holder = (lead) => (lead.owner_employee_id == null ? 'Waiting in pool' : `With ${lead.employees?.name ?? 'a rep'}`)

// ---------- Architect meetings (target row) ----------
// The Architect Meeting activities this BDM logged in the period — exactly the
// rows computeBdmTargetActuals counts. A meeting logged against a firm names no
// architect, so it is listed (it counts) but isn't a link.
export function buildBdmMeetingsPanel({ bdm, meetings, range, rangeLabel, target = null }) {
  const mine = (meetings ?? [])
    .filter((m) => m.activity_type === 'architect_meeting' && m.employee_id === bdm.id && inRange(m.created_at, range))
    .sort(byNewest('created_at'))

  const perArchitect = new Map()
  let firmMeetings = 0
  mine.forEach((m) => {
    if (m.parties?.party_type === 'architect' && m.parties.id) {
      perArchitect.set(m.parties.id, (perArchitect.get(m.parties.id) ?? 0) + 1)
    } else {
      firmMeetings += 1
    }
  })
  const repeats = [...perArchitect.values()].filter((n) => n > 1).length
  const rounded = target != null ? Math.round(target) : null

  return {
    kind: 'records',
    eyebrow: `${bdm.name} · ${rangeLabel}`,
    title: 'Architect meetings logged',
    value: String(mine.length),
    delta: rounded != null ? `of ${rounded} target` : null,
    note: `Every Architect Meeting ${bdm.name.split(' ')[0]} logged ${rangeLabel}, newest first.`,
    figures: [
      { label: 'Meetings', value: String(mine.length), sub: rounded != null ? `of ${rounded} target` : rangeLabel, color: TONE_INK },
      { label: 'Architects met', value: String(perArchitect.size), sub: 'different people', color: TONE_INK },
      { label: 'Met more than once', value: String(repeats), sub: repeats === 1 ? 'architect' : 'architects', color: TONE_INK },
      { label: 'Firm meetings', value: String(firmMeetings), sub: 'with a firm, not one architect', color: TONE_NEUTRAL },
    ],
    empty: `${bdm.name.split(' ')[0]} logged no Architect Meeting ${rangeLabel}.`,
    sections: [
      {
        key: 'meetings',
        title: 'Meetings',
        hint: 'newest first',
        noun: 'meetings',
        rows: mine.map((m) => {
          const isArchitect = m.parties?.party_type === 'architect' && m.parties.id
          return {
            key: `meeting-${m.id}`,
            when: shortDay(m.created_at),
            whenSub: formatClockTime(m.created_at),
            name: m.parties?.name ?? 'Architect',
            to: isArchitect ? `/architects/${m.parties.id}` : null,
            chip: null,
            meta: isArchitect ? '' : 'Firm meeting',
            value: null,
          }
        }),
      },
    ],
  }
}

// ---------- Joineries received / Leads generated (target rows) ----------
// This BDM's leads created in the period (pool and their own alike — the
// Leads generated rule), or the subset with joinery received (Joineries).
function buildBdmLeadsTargetPanelCore({ metric, bdm, leads, range, rangeLabel, target = null }) {
  const isJoinery = metric === 'bdm_joineries_received'
  const generated = (leads ?? []).filter((l) => l.bdm_employee_id === bdm.id && inRange(l.created_at, range))
  const list = (isJoinery ? generated.filter((l) => l.joinery_received === true) : generated).sort(byNewest('created_at'))

  const withRep = list.filter((l) => l.owner_employee_id != null).length
  const inPool = list.length - withRep
  const rounded = target != null ? Math.round(target) : null
  const first = bdm.name.split(' ')[0]

  const figures = isJoinery
    ? [
        { label: 'Joineries', value: String(list.length), sub: rounded != null ? `of ${rounded} target` : rangeLabel, color: TONE_INK },
        { label: 'With a rep', value: String(withRep), sub: 'assigned', color: TONE_INK },
        { label: 'In the pool', value: String(inPool), sub: 'not yet assigned', color: inPool > 0 ? TONE_BAD_INK : TONE_NEUTRAL },
        { label: 'Open pipeline', value: money(sumOpenPipelineValue(list)), sub: 'quoted so far', color: TONE_INK },
      ]
    : [
        { label: 'Leads', value: String(list.length), sub: rounded != null ? `of ${rounded} target` : rangeLabel, color: TONE_INK },
        { label: 'With joinery', value: String(list.filter((l) => l.joinery_received === true).length), sub: 'joinery received', color: TONE_INK },
        { label: 'With a rep', value: String(withRep), sub: 'assigned', color: TONE_INK },
        { label: 'In the pool', value: String(inPool), sub: 'not yet assigned', color: inPool > 0 ? TONE_BAD_INK : TONE_NEUTRAL },
      ]

  return {
    kind: 'records',
    eyebrow: `${bdm.name} · ${rangeLabel}`,
    title: isJoinery ? 'Joineries received' : 'Leads generated',
    value: String(list.length),
    delta: rounded != null ? `of ${rounded} target` : null,
    note: isJoinery
      ? `Leads ${first} brought in ${rangeLabel} with joinery received, newest first.`
      : `Every lead ${first} brought in ${rangeLabel}, in the pool or already with a rep, newest first.`,
    figures,
    empty: isJoinery ? `${first} received no joinery ${rangeLabel}.` : `${first} brought in no lead ${rangeLabel}.`,
    sections: [
      {
        key: 'leads',
        title: isJoinery ? 'Joineries' : 'Leads',
        hint: 'newest first · where each stands now',
        noun: 'leads',
        rows: list.map((l) =>
          leadRow(l, { at: l.created_at, extra: [holder(l), !isJoinery && l.joinery_received === true ? 'Joinery received' : null] })
        ),
      },
    ],
  }
}

// A target is set across every office, so it is dropped while one is chosen
// (officeScope's `hidesTargets`) rather than compared with a slice.
export const buildBdmLeadsTargetPanel = officeAware(buildBdmLeadsTargetPanelCore, {
  hidesTargets: true,
  leadIds: (a) =>
    (a.leads ?? []).filter((l) => l.bdm_employee_id === a.bdm.id && inRange(l.created_at, a.range)).map((l) => l.id),
  narrow: (scope, a) => [{ ...a, leads: scope.leads(a.leads), target: scope.active ? null : a.target }],
})

// The three target rows, one entry point: the metric names the popup.
export function buildBdmTargetPanel(args) {
  return args.metric === 'bdm_architect_meetings' ? buildBdmMeetingsPanel(args) : buildBdmLeadsTargetPanel(args)
}

// ---------- Waiting in pool (tile) ----------
// This BDM's leads nobody owns yet, oldest first — the order the owner should
// clear them in.
function buildBdmPoolPanelCore({ bdm, leads }) {
  const waiting = (leads ?? [])
    .filter((l) => l.bdm_employee_id === bdm.id && l.owner_employee_id == null)
    .sort((a, b) => (parseTimestamp(a.created_at)?.getTime() ?? 0) - (parseTimestamp(b.created_at)?.getTime() ?? 0))
  const ages = waiting.map((l) => daysSince(l.created_at) ?? 0)
  const oldest = ages.length ? Math.max(...ages) : null
  const average = ages.length ? Math.round(ages.reduce((s, n) => s + n, 0) / ages.length) : null
  const first = bdm.name.split(' ')[0]

  return {
    kind: 'records',
    eyebrow: `${bdm.name} · right now`,
    title: 'Waiting in the pool',
    value: String(waiting.length),
    note: `Leads ${first} sent to the owner that nobody has been assigned to yet, oldest first.`,
    figures: [
      { label: 'Waiting', value: String(waiting.length), sub: 'not yet assigned', color: TONE_INK },
      { label: 'Oldest', value: oldest != null ? `${oldest}d` : '—', sub: 'longest wait', color: oldest > 2 ? TONE_BAD_INK : TONE_INK },
      { label: 'Average wait', value: average != null ? `${average}d` : '—', sub: 'so far', color: TONE_INK },
      { label: 'Joinery received', value: String(waiting.filter((l) => l.joinery_received === true).length), sub: 'of those waiting', color: TONE_INK },
    ],
    empty: `Nothing of ${first}'s is waiting for an owner.`,
    sections: [
      {
        key: 'pool',
        title: 'Waiting for an owner',
        hint: 'oldest first',
        noun: 'leads',
        rows: waiting.map((l, i) =>
          leadRow(l, { at: l.created_at, extra: [`waiting ${ages[i]}d`, l.joinery_received === true ? 'Joinery received' : null] })
        ),
      },
    ],
  }
}

export const buildBdmPoolPanel = officeAware(buildBdmPoolPanelCore, {
  leadIds: (a) => (a.leads ?? []).filter((l) => l.bdm_employee_id === a.bdm.id && l.owner_employee_id == null).map((l) => l.id),
  narrow: (scope, a) => [{ ...a, leads: scope.leads(a.leads) }],
})

// ---------- Handed over (tile) ----------
// The first assignment of each of this BDM's pool leads inside the period —
// buildHandedOverRows, the BDM Dashboard's own Handed over list.
function buildBdmHandedOverPanelCore({ bdm, handedOverData, rangeLabel }) {
  const rows = buildHandedOverRows(handedOverData, bdm.id)
  const reps = new Set(rows.map((r) => r.execName).filter(Boolean))
  const stillOpen = rows.filter((r) => !CLOSED_STAGES.includes(r.lead?.current_stage ?? 'calling')).length
  const won = rows.filter((r) => r.lead?.current_stage === 'won').length
  const first = bdm.name.split(' ')[0]

  return {
    kind: 'records',
    eyebrow: `${bdm.name} · ${rangeLabel}`,
    title: 'Handed over',
    value: String(rows.length),
    note: `Leads ${first} sent to the owner that were assigned to a rep ${rangeLabel}, newest first.`,
    figures: [
      { label: 'Handed over', value: String(rows.length), sub: rangeLabel, color: TONE_INK },
      { label: 'Reps', value: String(reps.size), sub: 'received them', color: TONE_INK },
      { label: 'Still open', value: String(stillOpen), sub: 'not won or lost', color: TONE_INK },
      { label: 'Won since', value: String(won), sub: 'of these', color: won > 0 ? TONE_WON : TONE_NEUTRAL },
    ],
    empty: `None of ${first}'s leads were assigned ${rangeLabel}.`,
    sections: [
      {
        key: 'handed',
        title: 'Assigned to a rep',
        hint: 'newest first · where each stands now',
        noun: 'leads',
        rows: rows.map((r) => {
          const stage = r.lead?.current_stage ?? 'calling'
          return {
            key: r.key,
            when: shortDay(r.at),
            name: leadDisplayName(r.lead),
            to: `/leads/${r.leadId}`,
            chip: { label: stageLabel(stage), chipClass: stageChipClass(stage) },
            meta: r.execName ? `Assigned to ${r.execName}` : 'Assigned',
            value: null,
          }
        }),
      },
    ],
  }
}

export const buildBdmHandedOverPanel = officeAware(buildBdmHandedOverPanelCore, {
  leadIds: (a) => buildHandedOverRows(a.handedOverData, a.bdm.id).map((r) => r.leadId),
  narrow: (scope, a) => [{ ...a, handedOverData: scope.rows(a.handedOverData, (h) => h.lead_id) }],
})

// ---------- Won / Win rate (tiles) ----------
// One popup for both tiles (owner's choice): the BDM's leads that closed in the
// period, won and lost, with the win rate worked out. `focus` only decides which
// figure heads the popup — the tile that opened it.
//
// `selfLabel` names the owner of a lead the BDM worked themselves (buildClosedRows
// says "You", which is right on their own Dashboard and wrong on the owner's).
function buildBdmClosedPanelCore({ bdm, closedData, rangeLabel, focus = 'won', selfLabel = null }) {
  const closed = buildClosedRows(closedData?.stageRows, closedData?.lossRows, bdm.id)
  const s = summariseClosedRows(closed)
  const first = bdm.name.split(' ')[0]
  const who = (r) => (r.ownerName === 'You' && selfLabel ? selfLabel : r.ownerName)

  const row = (r) => {
    const won = r.outcome === 'won'
    return {
      key: r.key,
      when: shortDay(r.at),
      name: leadDisplayName(r.lead),
      to: `/leads/${r.leadId}`,
      chip: { label: stageLabel(r.outcome), chipClass: stageChipClass(r.outcome) },
      meta: [
        won ? null : r.reason ? `${lossReasonLabel(r.reason)}${r.competitor ? ` (${r.competitor})` : ''}` : 'No reason on file',
        who(r),
      ]
        .filter(Boolean)
        .join(' · '),
      // A won lead with no order value on file shows no figure, never ₹0.
      value: won && r.value != null ? formatCurrencyCompact(r.value) : '—',
    }
  }
  const wonRows = closed.filter((r) => r.outcome === 'won')
  const lostRows = closed.filter((r) => r.outcome === 'lost')

  return {
    kind: 'records',
    eyebrow: `${bdm.name} · ${rangeLabel}`,
    title: focus === 'winrate' ? 'Win rate' : 'Won',
    value: focus === 'winrate' ? (s.winRate == null ? '—' : `${s.winRate}%`) : money(s.wonValue),
    delta: focus === 'winrate' ? `${s.wonCount} won · ${s.lostCount} lost` : plural(s.wonCount, 'lead', 'leads'),
    note: `${first}'s leads that closed ${rangeLabel}. Win rate is won out of won plus lost; a lead reopened since is left out.`,
    figures: [
      { label: 'Won', value: money(s.wonValue), sub: plural(s.wonCount, 'lead', 'leads'), color: s.wonCount ? TONE_WON : TONE_INK },
      { label: 'Won leads', value: String(s.wonCount), sub: rangeLabel, color: TONE_INK },
      { label: 'Lost', value: String(s.lostCount), sub: rangeLabel, color: s.lostCount ? TONE_BAD_INK : TONE_INK },
      { label: 'Win rate', value: s.winRate == null ? '—' : `${s.winRate}%`, sub: s.winRate == null ? 'nothing closed' : 'of those closed', color: TONE_INK },
    ],
    empty: `None of ${first}'s leads were won or lost ${rangeLabel}.`,
    sections: [
      { key: 'won', title: 'Won', hint: 'newest first', noun: 'won leads', empty: 'Nothing won.', rows: wonRows.map(row) },
      { key: 'lost', title: 'Lost', hint: 'newest first · why', noun: 'lost leads', empty: 'Nothing lost.', rows: lostRows.map(row) },
    ],
  }
}

export const buildBdmClosedPanel = officeAware(buildBdmClosedPanelCore, {
  leadIds: (a) => buildClosedRows(a.closedData?.stageRows, a.closedData?.lossRows, a.bdm.id).map((r) => r.leadId),
  narrow: (scope, a) => [
    {
      ...a,
      closedData: {
        stageRows: scope.rows(a.closedData?.stageRows, (r) => r.lead_id),
        lossRows: scope.rows(a.closedData?.lossRows, (r) => r.lead_id),
      },
    },
  ],
})
