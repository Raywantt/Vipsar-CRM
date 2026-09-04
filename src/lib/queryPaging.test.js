// A static guardrail for the row-cap bug fixed 2026-09-04 (see fetchAllRows.js
// and CLAUDE.md's Conventions entry). PostgREST caps every response at the
// project's max-rows setting (1,000) whether or not the query asked for a
// limit, and says nothing when it truncates. A query that means "every row"
// must page through fetchAllRows() — this test scans the actual source tree
// and fails the moment a new `.from(<table>)....select(...)` chain is added
// with no limit, range, single-row marker, count-only request, or explicit
// fetchAllRows() wrapper, so the mistake is caught the moment it's written
// instead of months later when a table quietly crosses the cap.
//
// This is deliberately a lightweight text scan, not a real parser — it leans
// on this codebase's own consistent style (one query built per short function
// or effect, blank lines separating logical blocks) rather than a full JS
// AST. A genuine one-off that the scan can't see through (rare; none exist as
// of this writing) should be marked inline with `// paging-audit: <reason>` on
// the line before the `.from(...)` call — not by loosening the scan itself.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function listSourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.js')) {
      out.push(full)
    }
  }
  return out
}

// Markers that prove a `.from()` call is already safe: it returns a single
// row, is count-only (no rows transferred, so PostgREST's row cap does not
// apply — see supabaseFetch.js's guardrail comment), is explicitly bounded by
// the caller, or already goes through the paging helper. `head: true` and
// `head:true` both appear in this codebase depending on formatting.
const SAFE_MARKERS = [
  '.single(',
  '.maybeSingle(',
  '.limit(',
  '.range(',
  'fetchAllRows',
  'head: true',
  'head:true',
]

// A write returns at most the rows it touched, which the caller controls by
// construction (an .update().eq(id) or an .insert() of a known payload) — not
// the "how many rows exist" question this guardrail is about.
const WRITE_MARKERS = ['.insert(', '.update(', '.upsert(', '.delete(']

const ESCAPE_HATCH = /paging-audit:/

// The real unit of scope here is a FUNCTION, not a paragraph — a query built
// across several reassignments of one `let query = ...` variable (this
// codebase's own pattern for conditional filters, see fetchLeadsList) can
// legitimately span many blank-line-separated paragraphs before its
// `.limit()`/`.range()` appears at the very end. So: for a top-level `export
// function`/`export async function`, the window is the WHOLE function body
// (captured the same way this bug's own investigation captured one — from the
// declaration to the next line that is exactly `}` at column 0, which holds
// throughout this codebase's consistent 2-space-indent style). For a
// `.from(...)` that isn't inside any top-level export (an effect or inline
// handler in a page/component), fall back to a generous line window — wide
// enough to catch the real patterns in this codebase, not a substitute for
// the eyes-on review this test's own output still deserves.
const COMPONENT_FALLBACK_LINES = 40

function topLevelFunctionSpans(lines) {
  const spans = []
  for (let i = 0; i < lines.length; i++) {
    if (/^export (async )?function\s/.test(lines[i])) {
      let end = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j] === '}') {
          end = j + 1
          break
        }
      }
      spans.push([i, end])
    }
  }
  return spans
}

function findViolations(file, text) {
  const violations = []
  const lines = text.split('\n')
  const spans = topLevelFunctionSpans(lines)
  const fromRe = /\.from\(\s*['"][a-zA-Z_]+['"]\s*\)/g

  lines.forEach((line, i) => {
    fromRe.lastIndex = 0
    let m
    while ((m = fromRe.exec(line))) {
      const table = /['"]([a-zA-Z_]+)['"]/.exec(m[0])[1]
      const span = spans.find(([s, e]) => i >= s && i < e)
      const [winStart, winEnd] = span ?? [Math.max(0, i - 3), Math.min(lines.length, i + COMPONENT_FALLBACK_LINES)]
      const window = lines.slice(winStart, winEnd).join('\n')
      const precedingLine = lines[i - 1] ?? ''

      if (WRITE_MARKERS.some((k) => window.includes(k))) continue
      if (SAFE_MARKERS.some((k) => window.includes(k))) continue
      if (ESCAPE_HATCH.test(precedingLine) || ESCAPE_HATCH.test(window)) continue

      violations.push(`${file}:${i + 1} — unbounded .from('${table}') with no .limit()/.range()/.single()/fetchAllRows()`)
    }
  })
  return violations
}

describe('every query that can return more than one row must be bounded', () => {
  it('has no naked .from(...).select(...) chain outside fetchAllRows.js', () => {
    const files = listSourceFiles(SRC_ROOT).filter((f) => !f.endsWith(`${path.sep}fetchAllRows.js`))
    const violations = files.flatMap((f) => findViolations(f, fs.readFileSync(f, 'utf-8')))

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} unpaged Supabase query chain(s). Each one can silently ` +
          `truncate at PostgREST's max-rows cap with no error (see fetchAllRows.js). Wrap it in ` +
          `fetchAllRows(), add .limit()/.range() if it's deliberately bounded, or mark the line ` +
          `above it with "// paging-audit: <why this is safe>" if it's a genuine one-off:\n\n` +
          violations.join('\n')
      )
    }
    expect(violations).toEqual([])
  })
})
