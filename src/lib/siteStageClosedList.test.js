import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SITE_STAGE_OPTIONS } from './siteStageOptions'

// sites.site_stage is a CLOSED list as of 2026-09-09 (the owner's ruling: "i
// do not want any other site stage other than the standard 5 that we are
// providing"), enforced by Schema/migration_site_stage_check.sql's
// sites_site_stage_check.
//
// This file is the regression guard for that, and it exists because the
// failure mode is SILENT and SLOW: a re-added "Other…" box does not break
// anything on the day it lands. It writes one off-list value, which then
// fragments Dashboard's "Leads by site stage" card (Plaster really being 88
// leads while the card reported 20 is the measured precedent — see
// migration_normalize_site_stage.sql) and puts a value in the column that All
// Leads' Site stage facet cannot offer as a filter. Since the constraint went
// on, such a write now fails outright with an opaque Postgres 23514 on a form
// the rep cannot argue with — so the UI and the database MUST agree.
//
// Static source scanning, not behaviour: two of the four screens below live
// on sales_executive/sales_coordinator-only routes that an owner session
// cannot reach, so they could not be driven in a browser when this shipped.
// Same lightweight-scan approach queryPaging.test.js already uses for the
// PostgREST row cap, and for the same reason — it covers every call site at
// once, including the ones a single session cannot visit.

const FILES = {
  'New Lead (Scanning)': 'src/pages/LeadQuickCapture.jsx',
  'Lead Detail — Site details': 'src/components/SiteDetailsSection.jsx',
  'Log Activity — Site Visit': 'src/pages/ActivityLog.jsx',
  // Unmounted today, closed anyway so a future mount cannot reopen the hole.
  'SiteSearchOrCreate (unmounted)': 'src/components/SiteSearchOrCreate.jsx',
}

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('sites.site_stage is a closed list in every write path', () => {
  for (const [label, rel] of Object.entries(FILES)) {
    describe(label, () => {
      const src = read(rel)

      it('builds its dropdown from the shared SITE_STAGE_OPTIONS', () => {
        expect(src).toContain('SITE_STAGE_OPTIONS')
      })

      it('offers no "Other…" option', () => {
        // Matches <option value="other">, regardless of surrounding whitespace.
        expect(src).not.toMatch(/value=(["'])other\1/)
      })

      it('has no free-text "Describe stage" input', () => {
        expect(src).not.toMatch(/Describe stage\s*\n?\s*<input/i)
      })

      it('keeps no custom-stage state to write from', () => {
        // The state is what actually produced the value; the <option> only
        // offered it. Removing one without the other is the real hazard.
        expect(src).not.toMatch(/\bcustom(Site)?Stage\b/)
      })

      it("resolves its stage with no === 'other' branch", () => {
        expect(src).not.toMatch(/siteStage\s*===\s*(["'])other\1/)
      })
    })
  }
})

describe('the app list and the database CHECK cannot drift apart', () => {
  const migration = read('Schema/migration_site_stage_check.sql')

  it('is the five standard stages, in construction order', () => {
    expect(SITE_STAGE_OPTIONS).toEqual(['DPC', 'FF Slab', 'SF Slab', 'Plaster', 'Flooring'])
  })

  it('names every SITE_STAGE_OPTIONS value in the CHECK constraint', () => {
    // The two-sided-change guard. Adding a sixth stage to siteStageOptions.js
    // without widening sites_site_stage_check makes every save of that stage
    // fail live with a 23514; this fails in CI instead.
    const check = migration.match(/ADD CONSTRAINT\s+sites_site_stage_check[\s\S]*?;/)?.[0]
    expect(check, 'ADD CONSTRAINT block not found in the migration').toBeTruthy()
    for (const stage of SITE_STAGE_OPTIONS) {
      expect(check, `"${stage}" missing from the CHECK`).toContain(`'${stage}'`)
    }
  })

  it('allows no stage the app cannot offer', () => {
    const check = migration.match(/ADD CONSTRAINT\s+sites_site_stage_check[\s\S]*?;/)?.[0] ?? ''
    const inList = check.match(/IN\s*\(([^)]*)\)/)?.[1] ?? ''
    const allowed = [...inList.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(allowed.sort()).toEqual([...SITE_STAGE_OPTIONS].sort())
  })

  it('keeps NULL legal — 46% of sites have no stage recorded yet', () => {
    expect(migration).toMatch(/site_stage\s+IS\s+NULL/i)
  })
})
