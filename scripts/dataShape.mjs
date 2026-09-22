// The "data shape" stamp for remembered screen data (instant open).
//
// The app saves each screen's last answer on the device and paints it on the
// next open, even after an update — UNLESS the update changed how that data is
// fetched or shaped, in which case the saved copy is thrown away (TanStack's
// `buster`, src/lib/queryClient.js). Until 2026-09-21 the stamp was the build
// time, so EVERY deploy wiped everyone's saved numbers and made their next
// open the slow one.
//
// Now the stamp is a hash of the files that decide what a remembered query
// returns. A deploy that only touches screens, styles or wording keeps the
// saved data; a deploy that touches a query file discards it. Which files
// those are is decided HERE, once: vite.config.js stamps the build with
// dataShapeId(), and src/lib/cachedQueryShape.test.js checks that every
// useCachedQuery call fetches through one of them.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Not import.meta.dirname: that needs Node 20.11+, and Vercel's build image
// is whatever the project settings say.
const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Everything in src/lib named *Queries.js, plus the shared helpers they build
// on and the two hooks that fetch. Paths are repo-relative with forward
// slashes, so the list reads the same on Windows and on Vercel.
const EXTRA = [
  'src/lib/fetchAllRows.js',
  'src/lib/leadOwnerHistory.js',
  'src/lib/poolLeads.js',
  'src/lib/queryClient.js',
  'src/hooks/useCachedQuery.js',
  'src/hooks/useAttentionBuckets.js',
  'src/hooks/useBdmPeriodRows.js',
]

export function dataShapeFiles() {
  const queryModules = readdirSync(join(ROOT, 'src/lib'))
    .filter((f) => /Queries\.js$/.test(f) && !/\.test\.js$/.test(f))
    .map((f) => `src/lib/${f}`)
  return [...new Set([...queryModules, ...EXTRA])].sort()
}

export function dataShapeId() {
  const hash = createHash('sha256')
  for (const file of dataShapeFiles()) {
    hash.update(file)
    // Line endings normalised, so a Windows checkout and Vercel's agree.
    hash.update(readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'))
  }
  return hash.digest('hex').slice(0, 16)
}
