import { useMemo } from 'react'
import { useCachedQuery } from './useCachedQuery'
import { fetchLeadOffices } from '../lib/dashboardQueries'
import { buildOfficeDirectory } from '../lib/officeScope'

// The lead id → office lookup behind every popup's Office filter. Fetched only
// while `enabled` (a popup that can be filtered is open), remembered like every
// other screen read so the second popup of the day finds it already there, and
// shared by key so ten popups cost one request. `directory` is null until it
// is known; `failed` lets the popup say nothing rather than offer a filter it
// can't honour.
export function useOfficeDirectory(enabled) {
  const { result, isLoading } = useCachedQuery(['office', 'directory'], fetchLeadOffices,{ enabled })
  const rows = result?.data
  const directory = useMemo(() => (rows ? buildOfficeDirectory(rows) : null), [rows])
  return { directory, loading: isLoading, failed: Boolean(result?.error) && !directory }
}
