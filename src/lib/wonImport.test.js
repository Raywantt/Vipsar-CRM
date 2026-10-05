import { describe, expect, it } from 'vitest'
import { isWonImportLead } from './wonImport'
import { isImportedLead } from './attention'

describe('isWonImportLead', () => {
  it('recognises the won-import marker', () => {
    expect(isWonImportLead({ external_reference_id: 'won-import-58' })).toBe(true)
  })
  it('ignores other leads', () => {
    expect(isWonImportLead({ external_reference_id: 'legacy-12' })).toBe(false)
    expect(isWonImportLead({ external_reference_id: null })).toBe(false)
    expect(isWonImportLead(null)).toBe(false)
  })
  it('is not treated as a legacy import by the stale clock', () => {
    expect(isImportedLead({ external_reference_id: 'won-import-58' })).toBe(false)
  })
})
