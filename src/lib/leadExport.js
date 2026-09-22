// All Leads' "Download Excel": which columns exist, what each one holds, and
// how a list of leads becomes the two sheets of the file. Pure — no network
// (leadExportQueries.js fetches), no library (leadExportFile.js writes the
// .xlsx). Same division of labour as drilldownBuilders.js.
//
// The owner picks the columns before each download; the file holds them in
// the order EXPORT_COLUMNS lists them, whatever order they were ticked in.
//
// "Never invent a confident value" (UI-DESIGN.md §5) holds for every column:
// a lead with no mobile, architect, quote or date on record gets a BLANK cell,
// never a placeholder, a zero or a guess.
import { leadAddress, leadDisplayName } from './leadName'
import { stageLabel } from './leadStageOptions'
import { SOURCE_TYPE_LABELS } from './sourceTypeOptions'
import { territoryLabel } from './territoryOptions'
import { ACTIVITY_LABELS } from './activityTypes'
import { parseTimestamp } from './dbTime'
import { toISODate } from './followupDates'
import { formatDateShort } from './format'
import { isPoolLead, sourcingArchitect } from './poolLeads'
import { partyTypeLabel, SITE_CONTACT_ROLE_LABELS } from './partyTypeOptions'

// ---- Who's who on a lead ----------------------------------------------------

const isArchitect = (party) => party?.party_type === 'architect'

// `leads.party_id` is NOT "the client" — New Lead resolves it to the client,
// ELSE the referrer, else the other party (CLAUDE.md, The Client card). So the
// client columns only read it when the party really is a client.
export function clientForLead(lead) {
  return lead?.parties?.party_type === 'client' ? lead.parties : null
}

// Every architect on the lead, first-credited first. An architect can be
// recorded in four places: the referrer (an architect referral), the "other
// party" from capture, party_id itself (an imported lead with no client), or a
// site contact with the Architect role. The first two are exactly
// poolLeads.js's sourcingArchitect — the one Lead Detail's "via Architect"
// line and every architect figure credit — so it leads, and the rest follow.
// A party recorded in two places is listed once.
export function architectsForLead(lead) {
  const seen = new Set()
  const out = []
  const add = (party) => {
    if (!party || seen.has(party.id)) return
    seen.add(party.id)
    out.push(party)
  }
  add(sourcingArchitect(lead.referrer, lead.other_party))
  if (isArchitect(lead.referrer)) add(lead.referrer)
  if (isArchitect(lead.other_party)) add(lead.other_party)
  if (isArchitect(lead.parties)) add(lead.parties)
  for (const c of lead.sites?.site_contacts ?? []) {
    if (c.role === 'architect' || isArchitect(c.parties)) add(c.parties)
  }
  return out
}

// A linked firm party first; the legacy typed firm_name only as a fallback
// (partyQueries.js — nothing writes firm_name any more).
function firmName(party, firms) {
  return firms.get(party.firm_party_id)?.name ?? party.firm_name?.trim() ?? null
}

function trimmed(value) {
  const s = value == null ? '' : String(value).trim()
  return s || null
}

// One value per person, joined "; ". When there are several people and only
// some have the value (a mobile, a firm), the gap is marked "—" so the list
// still lines up with the names column beside it; when nobody has it the cell
// stays blank.
function perPerson(people, pick) {
  const values = people.map((p) => trimmed(pick(p)))
  if (values.every((v) => v == null)) return null
  return values.map((v) => v ?? '—').join('; ')
}

// Contacts on the lead who aren't already in a column of their own: every site
// contact except the client and the architects, then the "other party" from
// capture and the lead's own main party (party_id) when they aren't one of
// those either — so a lead whose main contact is a builder or PMC still has
// that person's number in the file. "Owner" on a site contact means the site's
// owner, so it's spelled out — in a sheet that also has an Owner column
// holding the rep.
export function otherContactsForLead(lead) {
  const skip = new Set(architectsForLead(lead).map((p) => p.id))
  const client = clientForLead(lead)
  if (client) skip.add(client.id)

  const entries = []
  const describe = (label, party) => {
    const mobile = trimmed(party.mobile)
    return `${label}: ${party.name?.trim() || 'Unnamed'}${mobile ? ` (${mobile})` : ''}`
  }
  for (const c of lead.sites?.site_contacts ?? []) {
    if (!c.parties || skip.has(c.parties.id)) continue
    skip.add(c.parties.id)
    const role = c.role === 'owner' ? 'Site owner' : SITE_CONTACT_ROLE_LABELS[c.role] ?? c.role
    entries.push(describe(role, c.parties))
  }
  for (const party of [lead.other_party, lead.parties]) {
    if (!party || skip.has(party.id)) continue
    skip.add(party.id)
    const label = partyTypeLabel(party.party_type) ?? 'Contact'
    entries.push(describe(label.charAt(0).toUpperCase() + label.slice(1), party))
  }
  return entries.length ? entries.join('; ') : null
}

// ---- Dates ------------------------------------------------------------------

// A DATE column ('2026-09-05') passes straight through; a timestamp becomes the
// calendar day it fell on HERE (parseTimestamp — naive UTC columns would
// otherwise land 5½ hours early, see dbTime.js).
function calendarDay(value) {
  if (!value) return null
  const s = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const parsed = parseTimestamp(s)
  return parsed && !Number.isNaN(parsed.getTime()) ? toISODate(parsed) : null
}

// ---- The columns --------------------------------------------------------------

export const EXPORT_COLUMN_GROUPS = [
  { id: 'lead', label: 'Lead' },
  { id: 'client', label: 'Client' },
  { id: 'architect', label: 'Architect' },
  { id: 'referrer', label: 'Referrer' },
  { id: 'site', label: 'Site' },
  { id: 'contacts', label: 'Other contacts' },
  { id: 'status', label: 'Status' },
  { id: 'deal', label: 'Deal' },
  { id: 'dates', label: 'Dates' },
  { id: 'notes', label: 'Notes' },
]

// `kind` decides the cell's type and format (toCell below). `needs` names an
// extra read leadExportQueries.js's fetchExportExtras must make — only when a
// column that needs it is ticked. `get(lead, extras)` returns the raw value:
// text, a number, a 'YYYY-MM-DD' day, or (kind 'link') a lead id.
export const EXPORT_COLUMNS = [
  { id: 'lead_id', group: 'lead', label: 'Lead #', kind: 'number', width: 8, isDefault: true, get: (l) => l.id },
  // The Party column of All Leads, word for word. On by default because the
  // client columns are strict: a lead whose main contact is an architect,
  // builder or PMC has no client, and without this its row names nobody.
  { id: 'lead_name', group: 'lead', label: 'Lead name', kind: 'text', width: 28, isDefault: true, get: (l) => leadDisplayName(l) },
  { id: 'crm_link', group: 'lead', label: 'Link to open in CRM', header: 'Open in CRM', kind: 'link', width: 13, get: (l) => l.id },

  { id: 'client_name', group: 'client', label: 'Client name', kind: 'text', width: 26, isDefault: true, get: (l) => trimmed(clientForLead(l)?.name) },
  { id: 'client_mobile', group: 'client', label: 'Client mobile', kind: 'phone', width: 15, isDefault: true, get: (l) => trimmed(clientForLead(l)?.mobile) },

  { id: 'architect_name', group: 'architect', label: 'Architect name', kind: 'text', width: 26, isDefault: true, get: (l) => perPerson(architectsForLead(l), (p) => p.name) },
  { id: 'architect_mobile', group: 'architect', label: 'Architect mobile', kind: 'phone', width: 16, isDefault: true, get: (l) => perPerson(architectsForLead(l), (p) => p.mobile) },
  { id: 'architect_firm', group: 'architect', label: 'Architect firm', kind: 'text', width: 24, isDefault: true, needs: 'firms', get: (l, x) => perPerson(architectsForLead(l), (p) => firmName(p, x.firms)) },

  {
    id: 'referrer_name', group: 'referrer', label: 'Referred by', kind: 'text', width: 24,
    get: (l) => trimmed(l.referrer?.name) ?? (trimmed(l.referrer_employee?.name) ? `${l.referrer_employee.name.trim()} (employee)` : null),
  },
  { id: 'referrer_mobile', group: 'referrer', label: 'Referrer mobile', kind: 'phone', width: 15, get: (l) => trimmed(l.referrer?.mobile) },

  { id: 'address', group: 'site', label: 'Address', kind: 'text', width: 34, isDefault: true, get: (l) => [leadAddress(l.sites), trimmed(l.sites?.pincode)].filter(Boolean).join(', ') || null },
  { id: 'area', group: 'site', label: 'Area', kind: 'text', width: 18, isDefault: true, get: (l) => trimmed(l.sites?.areas?.area_name) },
  { id: 'site_stage', group: 'site', label: 'Site stage', kind: 'text', width: 14, isDefault: true, get: (l) => trimmed(l.sites?.site_stage) },
  { id: 'site_nickname', group: 'site', label: 'Site nickname', kind: 'text', width: 28, get: (l) => trimmed(l.sites?.nickname) },

  { id: 'other_contacts', group: 'contacts', label: 'Other site contacts', kind: 'text', width: 40, get: (l) => otherContactsForLead(l) },

  { id: 'lead_stage', group: 'status', label: 'Lead stage', kind: 'text', width: 16, isDefault: true, get: (l) => stageLabel(l.current_stage ?? 'calling') },
  { id: 'owner', group: 'status', label: 'Owner', kind: 'text', width: 20, isDefault: true, get: (l) => (isPoolLead(l) ? 'Awaiting assignment' : trimmed(l.employees?.name)) },
  { id: 'source', group: 'status', label: 'Source', kind: 'text', width: 18, isDefault: true, get: (l) => (l.source_type ? SOURCE_TYPE_LABELS[l.source_type] ?? l.source_type : null) },
  { id: 'office', group: 'status', label: 'Office', kind: 'text', width: 12, get: (l) => (l.office_territory ? territoryLabel(l.office_territory) : null) },
  { id: 'bdm', group: 'status', label: 'Brought in by (BDM)', kind: 'text', width: 20, get: (l) => trimmed(l.bdm?.name) },
  { id: 'product', group: 'status', label: 'Product', kind: 'text', width: 14, get: (l) => trimmed(l.products?.name) },

  { id: 'quote_value', group: 'deal', label: 'Quote value', kind: 'money', width: 14, get: (l) => l.quote_value },
  { id: 'order_value', group: 'deal', label: 'Order value', kind: 'money', width: 14, get: (l) => l.order_value },
  { id: 'probability', group: 'deal', label: 'Probability', kind: 'percent', width: 11, get: (l) => l.closure_probability },
  { id: 'expected_close', group: 'deal', label: 'Expected close', kind: 'date', width: 14, get: (l) => calendarDay(l.estimated_close_date) },

  { id: 'created_on', group: 'dates', label: 'Created on', kind: 'date', width: 13, get: (l) => calendarDay(l.created_at) },
  // All Leads' own "Last touch": the latest logged activity, else the day the
  // lead entered the CRM (which counts as a touch — CLAUDE.md, Needs Attention).
  { id: 'last_touch', group: 'dates', label: 'Last touch', kind: 'date', width: 13, needs: 'lastTouch', get: (l, x) => calendarDay(x.lastTouch.get(l.id) ?? l.created_at) },
  { id: 'next_followup', group: 'dates', label: 'Next follow-up', kind: 'date', width: 14, get: (l) => calendarDay(l.next_followup_date) },
  { id: 'rfq_raised_on', group: 'dates', label: 'RFQ raised on', kind: 'date', width: 14, get: (l) => calendarDay(l.rfq_raised_at) },
  { id: 'quote_sent_on', group: 'dates', label: 'Quote sent on', kind: 'date', width: 14, get: (l) => calendarDay(l.quote_sent_at) },

  {
    id: 'latest_remark', group: 'notes', label: 'Latest remark', kind: 'text', width: 50, needs: 'remarks',
    get: (l, x) => {
      const r = x.remarks.get(l.id)
      if (!trimmed(r?.body)) return null
      const who = trimmed(r.employees?.name)
      return `${formatDateShort(r.created_at)}${who ? `, ${who}` : ''}: ${r.body.trim()}`
    },
  },
  {
    id: 'last_activity_note', group: 'notes', label: 'Last activity note', kind: 'text', width: 50, needs: 'notes',
    get: (l, x) => {
      const a = x.notes.get(l.id)
      if (!trimmed(a?.notes)) return null
      const type = ACTIVITY_LABELS[a.activity_type] ?? a.activity_type
      return `${formatDateShort(a.created_at)}${type ? ` · ${type}` : ''}: ${a.notes.trim()}`
    },
  },
]

const COLUMNS_BY_ID = new Map(EXPORT_COLUMNS.map((c) => [c.id, c]))

export const DEFAULT_EXPORT_COLUMN_IDS = EXPORT_COLUMNS.filter((c) => c.isDefault).map((c) => c.id)

// A remembered or ticked set, cleaned: unknown ids (a column since removed)
// dropped, and the result put back into EXPORT_COLUMNS' order.
export function normaliseColumnIds(ids) {
  const wanted = new Set(Array.isArray(ids) ? ids : [])
  return EXPORT_COLUMNS.filter((c) => wanted.has(c.id)).map((c) => c.id)
}

// Which extra reads the chosen columns need (fetchExportExtras' `needs`).
export function extrasNeededFor(columnIds) {
  const needs = { firms: false, lastTouch: false, remarks: false, notes: false }
  for (const id of columnIds) {
    const need = COLUMNS_BY_ID.get(id)?.needs
    if (need) needs[need] = true
  }
  return needs
}

// ---- Cells --------------------------------------------------------------------

// Lakh/crore grouping, which a plain "#,##0" can't express: 12,34,567.
export const INR_FORMAT = '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"##,##0'
const DATE_FORMAT = 'd mmm yyyy'
export const LINK_TEXT = 'Open lead'

// A raw value to a write-excel-file cell. Mobiles are Text ('@') so Excel
// can't turn 9876543210 into a number or a leading zero into nothing. Dates
// are UTC midnight of the calendar day, which is exactly a whole-day serial.
export function toCell(kind, value) {
  if (value == null || value === '') return null
  switch (kind) {
    case 'phone':
      return { value: String(value), type: String, format: '@' }
    case 'number':
      return { value: Number(value), type: Number }
    case 'money':
      return { value: Number(value), type: Number, format: INR_FORMAT }
    case 'percent':
      return { value: Number(value), type: Number, format: '0"%"' }
    case 'date': {
      const [y, m, d] = String(value).split('-').map(Number)
      return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: DATE_FORMAT }
    }
    case 'link':
      return { value: LINK_TEXT, type: String, textColor: '#0563C1', textDecoration: { underline: true } }
    default:
      return { value: String(value), type: String }
  }
}

// ---- The workbook -------------------------------------------------------------

// Everything the file needs, as plain data:
//   leadsSheet  rows (header first), column widths, and `links` — the cells
//               leadExportFile.js turns into real hyperlinks
//   aboutSheet  rows for "About this export"
//
// `origin` is the CRM's own address, for the Open-in-CRM links.
// `filterSummary` is [{ label, value, active }] from LeadsListCard, so the
// file describes the filters in exactly the words the screen used.
export function buildLeadExport({ leads, columnIds, extras, origin, filterSummary, exportedBy, exportedAt, searchCapped = false, failed = [] }) {
  const columns = normaliseColumnIds(columnIds).map((id) => COLUMNS_BY_ID.get(id))
  const header = columns.map((c) => ({ value: c.header ?? c.label, type: String, fontWeight: 'bold' }))
  const links = []

  const rows = leads.map((lead, i) =>
    columns.map((c, col) => {
      const raw = c.get(lead, extras)
      if (c.kind === 'link' && raw != null) links.push({ row: i + 2, column: col + 1, url: `${origin}/leads/${raw}` })
      return toCell(c.kind, raw)
    })
  )

  const leadsSheet = {
    sheet: 'Leads',
    data: [header, ...rows],
    columns: columns.map((c) => ({ width: c.width })),
    columnCount: columns.length,
    rowCount: rows.length + 1,
    links,
  }

  const text = (value, bold = false) => ({ value, type: String, ...(bold ? { fontWeight: 'bold' } : {}) })
  const notes = [
    'Blank cells mean nothing is recorded in the CRM for that lead.',
    "Leads waiting in a BDM's pool for the owner to assign aren't on All Leads, so they aren't here either.",
  ]
  if (columnIds.includes('client_name')) {
    notes.push("Client: only a contact recorded as a client. When a lead's main contact is an architect, builder or PMC, the client columns are blank and Lead name shows who it is.")
  }
  if (columnIds.includes('architect_name')) {
    notes.push('Architect: the referring architect first, then any other architect recorded on the lead or its site.')
  }
  if (columnIds.includes('last_touch')) {
    notes.push('Last touch: the latest logged activity, or the day the lead was created if nothing has been logged.')
  }
  if (searchCapped) {
    notes.push('The search matched more than 50 parties, sites or people, so this list may be incomplete — narrow the search for a full list.')
  }
  for (const what of failed) notes.push(`Couldn't load ${what} — that column is blank. Try the download again.`)

  const aboutRows = [
    [text('VIPSAR CRM — All Leads export', true), null],
    [null, null],
    [text('Exported on', true), text(formatExportedAt(exportedAt))],
    [text('Exported by', true), text(exportedBy || '—')],
    [text('Leads', true), { value: leads.length, type: Number }],
    [null, null],
    [text('Filters', true), null],
    ...filterSummary.map((f) => [text(f.label), text(f.value)]),
    [null, null],
    [text('Notes', true), null],
    ...notes.map((n) => [text(n), null]),
  ]

  return {
    leadsSheet,
    aboutSheet: { sheet: 'About this export', data: aboutRows, columns: [{ width: 16 }, { width: 60 }] },
  }
}

// "22 Sep 2026, 3:45 pm" in the viewer's own clock.
function formatExportedAt(date) {
  const h = date.getHours()
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(date.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  return `${formatDateShort(toISODate(date))}, ${time}`
}

// "VIPSAR Leads – Vishal Kumar – Presentation – 22 Sep 2026.xlsx": the active
// filters' values in screen order, "All" when none is set. Characters Windows
// refuses in a file name are replaced, and a long search term can't make the
// name unmanageable.
export function exportFileName(filterSummary, date) {
  const parts = filterSummary.filter((f) => f.active).map((f) => f.fileLabel ?? f.value)
  const middle = (parts.length ? parts.join(' – ') : 'All').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120).trim()
  return `VIPSAR Leads – ${middle} – ${formatDateShort(toISODate(date))}.xlsx`
}
