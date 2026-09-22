// Guards the "data shape" stamp (scripts/dataShape.mjs) that decides whether
// data a phone remembered survives an app update.
//
// The stamp only notices changes to the query files. So every useCachedQuery
// call must fetch THROUGH one of them — a plain function reference, or an
// arrow that does nothing but call one with arguments. Anything that reshapes
// the answer inline (merging two fetches, `.then(...)`, an async block) would
// change what gets saved without changing the stamp, and the next update would
// paint the old shape into code expecting the new one. Move that code into a
// query module (src/lib/screenQueries.js holds the combined ones).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, posix } from 'node:path'
import { dataShapeFiles } from '../../scripts/dataShape.mjs'

const SRC = 'src'

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(js|jsx)$/.test(name) && !/\.test\./.test(name) ? [full.replace(/\\/g, '/')] : []
  })
}

// Splits the argument list of the call whose "(" is at `open` into top-level
// arguments, skipping over strings, template literals and nested brackets.
function callArguments(text, open) {
  const args = []
  let depth = 0
  let start = open + 1
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) {
        args.push(text.slice(start, i))
        return args.map((a) => a.trim()).filter(Boolean)
      }
    } else if (ch === ',' && depth === 1) {
      args.push(text.slice(start, i))
      start = i + 1
    }
  }
  throw new Error('unterminated call')
}

// Strips // comments so a comment above the fetch argument can't hide it.
function withoutLineComments(s) {
  return s.replace(/^\s*\/\/.*$/gm, '').trim()
}

// The function a fetch argument calls, or null if it does more than call one.
function fetchedFunction(arg) {
  const a = withoutLineComments(arg)
  if (/^[A-Za-z_$][\w$]*$/.test(a)) return a
  const m = a.match(/^\(\)\s*=>\s*([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/)
  if (!m) return null
  const inner = m[2]
  if (/=>|\.then\(|\bawait\b|\{|Promise\./.test(inner)) return null
  return m[1]
}

function importsOf(text) {
  const map = new Map()
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const part of m[1].split(',')) {
      const [imported, local] = part.trim().split(/\s+as\s+/)
      if (imported) map.set((local ?? imported).trim(), m[2])
    }
  }
  return map
}

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = posix.normalize(posix.join(dirname(fromFile).replace(/\\/g, '/'), spec))
  for (const candidate of [base, `${base}.js`, `${base}.jsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function findCalls() {
  const calls = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/useCachedQuery\(/g)) {
      const before = text.slice(Math.max(0, m.index - 20), m.index)
      if (/function\s+$/.test(before)) continue // the hook's own definition
      const args = callArguments(text, m.index + 'useCachedQuery'.length)
      calls.push({ file, text, fetchArg: args[1] ?? '' })
    }
  }
  return calls
}

describe('remembered screen data is shaped only by stamped query files', () => {
  const stamped = new Set(dataShapeFiles())
  const calls = findCalls()

  it('finds the useCachedQuery calls (a parser that found none would pass vacuously)', () => {
    expect(calls.length).toBeGreaterThan(25)
  })

  it('every fetch is a plain call to a function — no inline reshaping', () => {
    const offenders = calls
      .filter((c) => fetchedFunction(c.fetchArg) === null)
      .map((c) => `${c.file}: ${withoutLineComments(c.fetchArg).slice(0, 80)}`)
    expect(offenders).toEqual([])
  })

  it('every fetched function comes from a stamped query file', () => {
    const offenders = []
    for (const c of calls) {
      const fn = fetchedFunction(c.fetchArg)
      if (!fn) continue
      if (stamped.has(c.file)) continue // e.g. useAttentionBuckets' own fallback
      const spec = importsOf(c.text).get(fn)
      const resolved = spec ? resolveModule(c.file, spec) : null
      if (!resolved || !stamped.has(resolved)) offenders.push(`${c.file}: ${fn} (${spec ?? 'defined locally'})`)
    }
    expect(offenders).toEqual([])
  })

  it('the stamped list includes every query module the app fetches through', () => {
    for (const f of ['src/lib/screenQueries.js', 'src/lib/dashboardQueries.js', 'src/lib/queryClient.js']) {
      expect(stamped.has(f)).toBe(true)
    }
  })
})
