// Turns leadExport.js's plain sheet data into a real .xlsx and hands it to the
// browser as a download. write-excel-file is imported HERE, dynamically, and
// nowhere else — so it is its own chunk, fetched the first time the owner
// presses Download, and the app everyone else opens never carries it.
//
// The library writes the cells, widths and frozen header itself. Two things it
// has no option for are added as a "feature" (its extension point, which edits
// the sheet's XML as the file is assembled):
//   - filter arrows on the header row (<autoFilter>)
//   - "Open lead" cells as real hyperlinks (<hyperlinks> + one external
//     relationship per link) — a =HYPERLINK() formula would be simpler, but
//     Excel opens a downloaded file in Protected View, which doesn't calculate
//     formulas, so every link would show blank until "Enable Editing".

// Column number (1-based) to Excel letters: 1 -> A, 27 -> AA.
export function columnLetters(n) {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The feature for the Leads sheet (always the workbook's first sheet).
export function leadsSheetFeature({ columnCount, rowCount, links }, utility) {
  const { getOrderOfSiblings, insertElementMarkupAccordingToOrderOfSiblings } = utility
  const onLeadsSheet = (properties) => properties.sheetIndex === 0

  return {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform(xml, _options, properties) {
            if (!onLeadsSheet(properties) || columnCount === 0) return xml
            const order = getOrderOfSiblings('xl/worksheets/sheet{id}.xml', 'worksheet')
            let out = insertElementMarkupAccordingToOrderOfSiblings(
              xml,
              `<autoFilter ref="A1:${columnLetters(columnCount)}${Math.max(rowCount, 1)}"/>`,
              order,
              'worksheet'
            )
            if (links.length) {
              const items = links
                .map((l, i) => `<hyperlink ref="${columnLetters(l.column)}${l.row}" r:id="rId-lead-link-${i + 1}"/>`)
                .join('')
              out = insertElementMarkupAccordingToOrderOfSiblings(out, `<hyperlinks>${items}</hyperlinks>`, order, 'worksheet')
            }
            return out
          },
        },
        'xl/worksheets/_rels/sheet{id}.xml.rels': {
          insert(_options, properties) {
            if (!onLeadsSheet(properties) || links.length === 0) return undefined
            return links
              .map(
                (l, i) =>
                  `<Relationship Id="rId-lead-link-${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeAttribute(l.url)}" TargetMode="External"/>`
              )
              .join('')
          },
        },
      },
    },
  }
}

function sheetOptions({ sheet, data, columns }, extra = {}) {
  return { sheet, data, columns, ...extra }
}

// Builds the workbook and returns it as a Blob. Split from the download so a
// test can check the file itself.
export async function buildLeadExportBlob({ leadsSheet, aboutSheet }) {
  const [{ default: writeXlsxFile }, utility] = await Promise.all([
    import('write-excel-file/browser'),
    import('write-excel-file/utility'),
  ])
  return writeXlsxFile(
    [sheetOptions(leadsSheet, { stickyRowsCount: 1 }), sheetOptions(aboutSheet)],
    { fontFamily: 'Calibri', fontSize: 11, features: [leadsSheetFeature(leadsSheet, utility)] }
  ).toBlob()
}

// Saves the file through the browser's own download — the same temporary
// <a download> the library's toFile() uses, kept here so the Blob can be
// built (and fail) before anything is clicked.
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 1000)
}
