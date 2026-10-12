// The Team Report as an .xlsx (owner's choice, 2026-10-12): a Summary sheet
// (everyone, every measure, totals over the ticked periods), one sheet per
// person (measures down, periods across, each target under its measure), and
// "About this report" — the periods, who exported it, and the notes that say
// what each figure means. The workbook is built as plain data here
// (buildTeamReportWorkbook, tested); write-excel-file is imported dynamically
// in teamReportBlob only, so it stays its own chunk, fetched on the first
// Download — the same arrangement as All Leads' export (leadExportFile.js).
import { INR_FORMAT } from './leadExport'
import { roleLabel } from './roles'
import { formatDateShort } from './format'
import { toISODate } from './followupDates'
import { attainment, periodCountLabel } from './teamReport'

const bold = (value) => ({ value, type: String, fontWeight: 'bold' })
const text = (value) => ({ value, type: String })
const muted = (value) => ({ value, type: String, fontStyle: 'italic', textColor: '#5F6B6D' })

function figure(value, money, extra = {}) {
  if (value == null) return null
  return money ? { value: Number(value), type: Number, format: INR_FORMAT, ...extra } : { value: Number(value), type: Number, ...extra }
}

function percentCell(value) {
  return value == null ? null : { value, type: Number, format: '0"%"', fontStyle: 'italic', textColor: '#5F6B6D' }
}

// A period's column heading — the current, still-running one says so.
export function periodHeading(period) {
  return period.isCurrent ? `${period.label} (so far)` : period.label
}

// ---------- sheet names ----------

// Excel's rules: at most 31 characters, none of : \ / ? * [ ], not blank, not
// starting or ending with an apostrophe, and unique ignoring case. Two people
// with the same name get "(2)".
export function sheetNamesFor(names, reserved = []) {
  const taken = new Set(reserved.map((n) => n.toLowerCase()))
  return names.map((raw) => {
    const base =
      String(raw ?? '')
        .replace(/[:\\/?*[\]]/g, ' ')
        .replace(/^'+|'+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 31) || 'Person'
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`
      name = `${base.slice(0, 31 - suffix.length).trimEnd()}${suffix}`
    }
    taken.add(name.toLowerCase())
    return name
  })
}

// ---------- the workbook ----------

const SUMMARY = 'Summary'
const ABOUT = 'About this report'

function summarySheet(report) {
  const { measures, sections } = report
  const header = [bold('Person'), bold('Role'), ...measures.map((m) => bold(m.label))]
  const rows = [header]
  // Every row the full width — a short row is padded rather than left ragged.
  const line = (...cells) => [...cells, ...Array(Math.max(0, header.length - cells.length)).fill(null)]
  sections.forEach((section, i) => {
    if (sections.length > 1) {
      if (i > 0) rows.push(line())
      rows.push(line(bold(section.label)))
    }
    section.rows.forEach((r) => {
      rows.push([text(r.name), text(roleLabel(r.role)), ...measures.map((m) => figure(r.cells[m.key].total, m.money))])
    })
    rows.push([
      bold(section.totalLabel),
      null,
      ...measures.map((m) => figure(section.total[m.key].total, m.money, { fontWeight: 'bold' })),
    ])
  })
  return {
    sheet: SUMMARY,
    data: rows,
    columns: [{ width: 24 }, { width: 24 }, ...measures.map((m) => ({ width: m.money ? 16 : Math.max(11, m.label.length + 2) }))],
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
  }
}

function personSheet(report, row, sheetName) {
  const { periods, measures } = report
  const header = [bold('Measure'), ...periods.map((p) => bold(periodHeading(p))), bold('Total')]
  const rows = [header]
  measures.forEach((m) => {
    const cell = row.cells[m.key]
    rows.push([text(m.label), ...cell.values.map((v) => figure(v, m.money)), figure(cell.total, m.money, { fontWeight: 'bold' })])
    // A target line only where this person has a target for this measure in at
    // least one of the periods — no rows of blanks for measures nobody targets.
    if (cell.targets && cell.targets.some((t) => t != null)) {
      rows.push([
        muted('   Target'),
        ...cell.targets.map((t) => figure(t, m.money, { fontStyle: 'italic', textColor: '#5F6B6D' })),
        figure(cell.targetTotal, m.money, { fontStyle: 'italic', textColor: '#5F6B6D' }),
      ])
      rows.push([
        muted('   % of target'),
        ...cell.values.map((v, i) => percentCell(attainment(v, cell.targets[i]))),
        percentCell(attainment(cell.total, cell.targetTotal)),
      ])
    }
  })
  return {
    sheet: sheetName,
    data: rows,
    columns: [{ width: 22 }, ...periods.map(() => ({ width: 15 })), { width: 15 }],
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
  }
}

function aboutSheet(report, { periodType, exportedBy, exportedAt }) {
  const people = report.sections.flatMap((s) => s.rows)
  const rows = [
    [bold('VIPSAR CRM — Team report'), null],
    [null, null],
    [bold('Exported on'), text(formatExportedAt(exportedAt))],
    [bold('Exported by'), text(exportedBy || '—')],
    [bold('Periods'), text(periodCountLabel(periodType, report.periods.length))],
    ...report.periods.map((p) => [null, text(p.isCurrent ? `${p.fullLabel} (so far)` : p.fullLabel)]),
    [bold('People'), { value: people.length, type: Number }],
    [bold('Measures'), text(report.measures.map((m) => m.label).join(', '))],
    [null, null],
    [bold('Notes'), null],
    ...report.notes.map((n) => [text(n.text), null]),
    [text('Each person’s sheet shows their target under a measure wherever one was set.'), null],
  ]
  return { sheet: ABOUT, data: rows, columns: [{ width: 18 }, { width: 80 }] }
}

// Everything the file holds, as write-excel-file sheet options, in order.
export function buildTeamReportWorkbook(report, { periodType, exportedBy, exportedAt }) {
  const people = report.sections.flatMap((s) => s.rows)
  const names = sheetNamesFor(people.map((r) => r.name), [SUMMARY, ABOUT])
  return [
    summarySheet(report),
    ...people.map((r, i) => personSheet(report, r, names[i])),
    aboutSheet(report, { periodType, exportedBy, exportedAt }),
  ]
}

// The .xlsx as a Blob. Split from the download so it can be built (and fail)
// before anything is clicked.
export async function teamReportBlob(sheets) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  return writeXlsxFile(sheets, { fontFamily: 'Calibri', fontSize: 11 }).toBlob()
}

// "VIPSAR Team report – 4 weeks – 12 Oct 2026.xlsx", with the person's name when
// the report is about one person. Characters Windows refuses are replaced.
export function teamReportFileName({ periodType, periodCount, people, date }) {
  const parts = ['VIPSAR Team report']
  if (people.length === 1) parts.push(people[0].name)
  parts.push(periodCountLabel(periodType, periodCount), formatDateShort(toISODate(date)))
  return `${parts.join(' – ').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 150).trim()}.xlsx`
}

// "12 Oct 2026, 3:45 pm" in the viewer's own clock.
function formatExportedAt(date) {
  const h = date.getHours()
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(date.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  return `${formatDateShort(toISODate(date))}, ${time}`
}
