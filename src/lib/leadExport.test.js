import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import {
  architectsForLead,
  buildLeadExport,
  clientForLead,
  DEFAULT_EXPORT_COLUMN_IDS,
  EXPORT_COLUMN_GROUPS,
  EXPORT_COLUMNS,
  exportFileName,
  extrasNeededFor,
  INR_FORMAT,
  normaliseColumnIds,
  otherContactsForLead,
  toCell,
} from './leadExport'
import { buildLeadExportBlob, columnLetters } from './leadExportFile'
import { applyLeadsListFilters, SITE_STAGE_UNSET } from './dashboardQueries'
import { canExportLeads, rolesWith } from './roles'

const client = { id: 1, name: 'Sukhjinder Singh', mobile: '9876543210', party_type: 'client' }
const archA = { id: 2, name: 'Ar. Mehta', mobile: '9811111111', party_type: 'architect', firm_party_id: 90, firm_name: 'Old typed firm' }
const archB = { id: 3, name: 'Ar. Kaur', mobile: null, party_type: 'architect', firm_party_id: null, firm_name: null }
const builder = { id: 4, name: 'Bricks & Stones', mobile: '9822222222', party_type: 'builder' }

const noExtras = { firms: new Map(), lastTouch: new Map(), remarks: new Map(), notes: new Map() }

function lead(overrides = {}) {
  return {
    id: 210,
    current_stage: 'presentation',
    source_type: 'scanning',
    owner_employee_id: 7,
    bdm_employee_id: null,
    created_at: '2026-09-18T06:00:00',
    parties: client,
    referrer: null,
    other_party: null,
    employees: { name: 'Vishal Kumar' },
    sites: { locality: 'MAHAVIR ENCLAVE', house_no: '12', site_stage: 'DPC', areas: { area_name: 'Dugri' }, site_contacts: [] },
    ...overrides,
  }
}

const cellValue = (c) => (c == null ? null : c.value)

describe('who is who on a lead', () => {
  it('reads the client only when party_id really is a client', () => {
    expect(clientForLead(lead())).toBe(client)
    // party_id falls back to the referrer when there is no client (New Lead's rule)
    expect(clientForLead(lead({ parties: archA }))).toBeNull()
  })

  it('lists architects referrer first, then other party, party_id and site contacts — each once', () => {
    const l = lead({
      parties: archA,
      referrer: archB,
      other_party: archA,
      sites: { site_contacts: [{ role: 'architect', parties: archB }, { role: 'architect', parties: { ...builder, id: 9 } }] },
    })
    expect(architectsForLead(l).map((p) => p.id)).toEqual([3, 2, 9])
  })

  it('finds an architect recorded only as a site contact', () => {
    const l = lead({ sites: { site_contacts: [{ role: 'architect', parties: archA }] } })
    expect(architectsForLead(l)).toEqual([archA])
  })

  it('keeps names and mobiles lined up when only some architects have a number', () => {
    const l = lead({ referrer: archA, other_party: archB })
    const name = EXPORT_COLUMNS.find((c) => c.id === 'architect_name')
    const mobile = EXPORT_COLUMNS.find((c) => c.id === 'architect_mobile')
    expect(name.get(l, noExtras)).toBe('Ar. Mehta; Ar. Kaur')
    expect(mobile.get(l, noExtras)).toBe('9811111111; —')
    // nobody has one -> blank, not a dash
    expect(mobile.get(lead({ referrer: archB }), noExtras)).toBeNull()
  })

  it('prefers the linked firm over the legacy typed firm name', () => {
    const firm = EXPORT_COLUMNS.find((c) => c.id === 'architect_firm')
    const l = lead({ referrer: archA })
    expect(firm.get(l, noExtras)).toBe('Old typed firm')
    expect(firm.get(l, { ...noExtras, firms: new Map([[90, { id: 90, name: 'Mehta Associates' }]]) })).toBe('Mehta Associates')
  })

  it('lists other contacts without repeating the client or an architect, and spells out a site owner', () => {
    const l = lead({
      other_party: builder,
      sites: {
        site_contacts: [
          { role: 'owner', parties: { id: 5, name: 'Mr. Gill', mobile: '9833333333', party_type: 'other' } },
          { role: 'owner', parties: client },
          { role: 'architect', parties: archA },
        ],
      },
    })
    expect(otherContactsForLead(l)).toBe('Site owner: Mr. Gill (9833333333); Builder: Bricks & Stones (9822222222)')
    expect(otherContactsForLead(lead())).toBeNull()
  })

  // Seen on real data: a Lixil lead whose only party is a builder had no
  // client and no architect, so with the default columns its number was
  // nowhere in the file.
  it("includes a main contact who is neither client nor architect, once", () => {
    const pmc = { id: 6, name: 'Mr. Raja Singh', mobile: '9844444444', party_type: 'pmc' }
    expect(otherContactsForLead(lead({ parties: builder, sites: { site_contacts: [] } }))).toBe('Builder: Bricks & Stones (9822222222)')
    expect(otherContactsForLead(lead({ parties: pmc, sites: { site_contacts: [{ role: 'project_manager', parties: pmc }] } }))).toBe(
      'Project manager: Mr. Raja Singh (9844444444)'
    )
    // an architect main contact belongs to the Architect columns, not here
    expect(otherContactsForLead(lead({ parties: archA, sites: { site_contacts: [] } }))).toBeNull()
  })
})

describe('cells never invent a value', () => {
  it('leaves an unknown value blank instead of 0 or a placeholder', () => {
    for (const kind of ['text', 'phone', 'number', 'money', 'percent', 'date', 'link']) {
      expect(toCell(kind, null)).toBeNull()
      expect(toCell(kind, '')).toBeNull()
    }
  })

  it('stores a mobile as Text so Excel cannot turn it into a number', () => {
    expect(toCell('phone', '9876543210')).toMatchObject({ value: '9876543210', type: String, format: '@' })
  })

  it('writes a calendar day as exactly that day, with no time-zone shift', () => {
    const cell = toCell('date', '2026-09-22')
    expect(cell.type).toBe(Date)
    expect(cell.value.toISOString()).toBe('2026-09-22T00:00:00.000Z')
    // Excel's serial for 22 Sep 2026 is 46287 — a whole number, no fraction
    expect(cell.value.getTime() / 86400000 + 25569).toBe(46287)
  })

  it('formats money in lakh/crore groups', () => {
    expect(toCell('money', 1250000)).toMatchObject({ value: 1250000, type: Number, format: INR_FORMAT })
  })
})

describe('the column list', () => {
  it('gives every column a known group and a unique id', () => {
    const groups = new Set(EXPORT_COLUMN_GROUPS.map((g) => g.id))
    const ids = EXPORT_COLUMNS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of EXPORT_COLUMNS) expect(groups.has(c.group)).toBe(true)
  })

  it('defaults to the columns the owner asked for', () => {
    expect(DEFAULT_EXPORT_COLUMN_IDS).toEqual([
      'lead_id',
      'lead_name',
      'client_name',
      'client_mobile',
      'architect_name',
      'architect_mobile',
      'architect_firm',
      'address',
      'area',
      'site_stage',
      'lead_stage',
      'owner',
      'source',
    ])
  })

  it('puts ticked columns back in list order and drops ones that no longer exist', () => {
    expect(normaliseColumnIds(['source', 'retired_column', 'lead_id'])).toEqual(['lead_id', 'source'])
    expect(normaliseColumnIds(null)).toEqual([])
  })

  it('asks for an extra read only when a column needs it', () => {
    expect(extrasNeededFor(DEFAULT_EXPORT_COLUMN_IDS)).toEqual({ firms: true, lastTouch: false, remarks: false, notes: false })
    expect(extrasNeededFor(['lead_id', 'last_touch', 'latest_remark'])).toEqual({ firms: false, lastTouch: true, remarks: true, notes: false })
  })
})

const filters = [
  { label: 'Status', value: 'All', active: false },
  { label: 'Owner', value: 'Vishal Kumar', active: true },
  { label: 'Lead stage', value: 'Presentation', active: true },
]

describe('buildLeadExport', () => {
  const at = new Date(2026, 8, 22, 15, 45)
  const leads = [lead(), lead({ id: 211, parties: null, referrer: archA, sites: { locality: 'SARABHA NAGAR', site_stage: 'Plaster', site_contacts: [] } })]

  it('writes a bold header and one row per lead, in list order whatever order was ticked', () => {
    const { leadsSheet } = buildLeadExport({
      leads,
      columnIds: ['site_stage', 'client_name', 'lead_id', 'crm_link'],
      extras: noExtras,
      origin: 'https://crm.example',
      filterSummary: filters,
      exportedBy: 'Owner',
      exportedAt: at,
    })
    expect(leadsSheet.data[0].map(cellValue)).toEqual(['Lead #', 'Open in CRM', 'Client name', 'Site stage'])
    expect(leadsSheet.data[0][0].fontWeight).toBe('bold')
    expect(leadsSheet.data.slice(1).map((r) => r.map(cellValue))).toEqual([
      [210, 'Open lead', 'Sukhjinder Singh', 'DPC'],
      [211, 'Open lead', null, 'Plaster'],
    ])
    expect(leadsSheet.links).toEqual([
      { row: 2, column: 2, url: 'https://crm.example/leads/210' },
      { row: 3, column: 2, url: 'https://crm.example/leads/211' },
    ])
    expect(leadsSheet.rowCount).toBe(3)
    expect(leadsSheet.columnCount).toBe(4)
  })

  it('records the filters, the count and anything that failed to load on the About sheet', () => {
    const { aboutSheet } = buildLeadExport({
      leads,
      columnIds: ['lead_id', 'latest_remark'],
      extras: noExtras,
      origin: '',
      filterSummary: filters,
      exportedBy: 'Raywant',
      exportedAt: at,
      searchCapped: true,
      failed: ['latest remarks'],
    })
    const text = aboutSheet.data.map((r) => r.map(cellValue).filter((v) => v != null).join(' | '))
    expect(text).toContain('Exported on | 22 Sep 2026, 3:45 pm')
    expect(text).toContain('Exported by | Raywant')
    expect(text).toContain('Leads | 2')
    expect(text).toContain('Owner | Vishal Kumar')
    expect(text).toContain("Couldn't load latest remarks — that column is blank. Try the download again.")
    expect(text.some((t) => t.startsWith('The search matched more than 50'))).toBe(true)
  })
})

describe('exportFileName', () => {
  const day = new Date(2026, 8, 22)
  it('names the file after the active filters', () => {
    expect(exportFileName(filters, day)).toBe('VIPSAR Leads – Vishal Kumar – Presentation – 22 Sep 2026.xlsx')
  })
  it('says All when nothing is filtered', () => {
    expect(exportFileName([{ label: 'Owner', value: 'All owners', active: false }], day)).toBe('VIPSAR Leads – All – 22 Sep 2026.xlsx')
  })
  it('replaces characters Windows refuses in a file name', () => {
    expect(exportFileName([{ value: 'a/b:c"d', active: true, fileLabel: 'Search a/b:c"d' }], day)).toBe(
      'VIPSAR Leads – Search a-b-c-d – 22 Sep 2026.xlsx'
    )
  })
})

describe('the .xlsx itself', () => {
  it('has frozen header, filter arrows over every row and real hyperlinks', async () => {
    const sheets = buildLeadExport({
      leads: [lead(), lead({ id: 211 })],
      columnIds: ['lead_id', 'crm_link', 'client_mobile', 'quote_value'],
      extras: noExtras,
      origin: 'https://crm.example',
      filterSummary: filters,
      exportedBy: 'Owner',
      exportedAt: new Date(2026, 8, 22),
    })
    const blob = await buildLeadExportBlob(sheets)
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    const rels = strFromU8(files['xl/worksheets/_rels/sheet1.xml.rels'])

    expect(sheet).toContain('state="frozen"')
    expect(sheet).toContain('<autoFilter ref="A1:D3"/>')
    expect(sheet).toContain('<hyperlink ref="B2" r:id="rId-lead-link-1"/>')
    expect(sheet.indexOf('<autoFilter')).toBeGreaterThan(sheet.indexOf('</sheetData>'))
    expect(sheet.indexOf('<hyperlinks>')).toBeGreaterThan(sheet.indexOf('<autoFilter'))
    expect(rels).toContain('Target="https://crm.example/leads/211" TargetMode="External"')
    // the About sheet gets neither
    expect(strFromU8(files['xl/worksheets/sheet2.xml'])).not.toContain('autoFilter')
  })

  it('names columns past Z the way Excel does', () => {
    expect([1, 26, 27, 33, 52, 53].map(columnLetters)).toEqual(['A', 'Z', 'AA', 'AG', 'AZ', 'BA'])
  })
})

// The export and the on-screen list run the SAME filter function; these pin
// what it does, so a change to one is a change to both.
describe('applyLeadsListFilters', () => {
  function recorder() {
    const calls = []
    const q = new Proxy(
      {},
      {
        get(_t, name) {
          return (...args) => {
            calls.push([name, ...args])
            return q
          }
        },
      }
    )
    return { q, calls }
  }

  it('applies every facet the screen offers', () => {
    const { q, calls } = recorder()
    applyLeadsListFilters(q, {
      employeeId: '7',
      stage: 'presentation',
      siteStage: 'DPC',
      source: 'scanning',
      status: 'active',
      minValue: 100000,
      maxValue: 500000,
      searchOr: 'party_id.in.(1)',
    })
    expect(calls).toEqual([
      ['eq', 'owner_employee_id', '7'],
      ['eq', 'current_stage', 'presentation'],
      ['eq', 'sites.site_stage', 'DPC'],
      ['eq', 'source_type', 'scanning'],
      ['not', 'current_stage', 'in', '(won,lost)'],
      ['gte', 'quote_value', 100000],
      ['lte', 'quote_value', 500000],
      ['or', 'party_id.in.(1)'],
      ['or', 'owner_employee_id.not.is.null,bdm_employee_id.is.null'],
    ])
  })

  it('treats "Not set" site stage as a null filter and keeps pool leads only when asked', () => {
    const { q, calls } = recorder()
    applyLeadsListFilters(q, { siteStage: SITE_STAGE_UNSET, includePool: true })
    expect(calls).toEqual([['is', 'sites.site_stage', null]])
  })
})

describe('who can export', () => {
  it('is the owner only', () => {
    expect(rolesWith(canExportLeads)).toEqual(['owner'])
  })
})
