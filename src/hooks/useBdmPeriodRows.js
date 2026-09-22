import { useMemo } from 'react'
import { useCachedQuery } from './useCachedQuery'
import { fetchClosedRows } from '../lib/bdmQueries'
import { buildClosedRows } from '../lib/bdmLeadUpdates'
import { errorMessage } from '../lib/errorMessage'

// Fetch-and-shape for the business development manager's period lists
// (BdmLeadUpdateCards.jsx). Returns { rows, error }; rows is null while
// loading. Does nothing until both a range and a BDM id exist, which is also
// how a caller keeps it idle (pass range = null).
//
// Remembered on the device (instant open). `name` identifies WHICH list —
// part of the key, spelled out rather than read off `fetcher.name`, since a
// minified build renames functions and a key must never let one list's saved
// answer stand in for another's. What's stored is the fetcher's raw answer
// (its shape lives in bdmQueries.js); `build` shapes it on the way out.
export function useBdmPeriodRows(name, fetcher, build, range, bdmId) {
  const rangeKey = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : null
  const query = useCachedQuery(['bdm-period', name, rangeKey, bdmId], () => fetcher(range), {
    enabled: Boolean(rangeKey && bdmId),
  })
  const result = query.result
  return useMemo(() => {
    if (!result) return { rows: null, error: null }
    if (result.error) return { rows: [], error: errorMessage(result.error) }
    return { rows: build(result.data, bdmId), error: null }
    // `build` is a fresh arrow on every caller render; what it does never changes.
  }, [result, bdmId]) // eslint-disable-line react-hooks/exhaustive-deps
}

// The won/lost rows for the period — fetched once by BdmDashboard and handed to
// both the Closed card and Pipeline closed, so the list and the figure can't
// disagree about which leads closed.
export function useClosedRows(range, bdmId) {
  return useBdmPeriodRows(
    'closed',
    fetchClosedRows,
    (data, id) => buildClosedRows(data.stageRows, data.lossRows, id),
    range,
    bdmId
  )
}
