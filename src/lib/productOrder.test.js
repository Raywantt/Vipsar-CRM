import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compareProducts } from './productOrder'
import { RFQ_SEGMENT_OPTIONS } from './rfqDesk'

// The owner's order (2026-10-06), as Schema/migration_products_order.sql
// numbers it.
const OWNER_ORDER = ['Tostem', 'IN16', 'GIESTA', 'Noki', 'Sky Light', 'Wrapping Bars', 'StoneLam', 'VOX', 'PremiAL', 'Others']

describe("VIPSAR's product order", () => {
  it('follows sort_order, then name for a product with no position', () => {
    const rows = [
      { name: 'Others', sort_order: 10 },
      { name: 'Zeta', sort_order: null },
      { name: 'IN16', sort_order: 2 },
      { name: 'Tostem', sort_order: 1 },
      { name: 'Alpha' },
    ]
    expect([...rows].sort(compareProducts).map((p) => p.name)).toEqual(['Tostem', 'IN16', 'Others', 'Alpha', 'Zeta'])
  })

  it("matches the RFQ form's list, name for name and in the same order", () => {
    expect(RFQ_SEGMENT_OPTIONS.map((o) => o.label)).toEqual(OWNER_ORDER)
  })

  it('is the order the migration writes (its own end-of-file check)', () => {
    const sql = readFileSync(resolve(process.cwd(), 'Schema/migration_products_order.sql'), 'utf8')
    const checked = sql.match(/IS DISTINCT FROM ARRAY\[([^\]]+)\]/)[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    expect(checked).toEqual(OWNER_ORDER)
  })
})
