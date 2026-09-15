import { useEffect, useState } from 'react'
import { fetchClosedRows } from '../lib/bdmQueries'
import { buildClosedRows } from '../lib/bdmLeadUpdates'
import { errorMessage } from '../lib/errorMessage'

// Fetch-and-shape for the business development manager's period lists
// (BdmLeadUpdateCards.jsx). Returns { rows, error }; rows is null while
// loading. Does nothing until both a range and a BDM id exist, which is also
// how a caller keeps it idle (pass range = null).
export function useBdmPeriodRows(fetcher, build, range, bdmId) {
  const [state, setState] = useState({ rows: null, error: null })
  const rangeKey = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : null

  useEffect(() => {
    if (!rangeKey || !bdmId) return
    let active = true
    setState({ rows: null, error: null })
    fetcher(range).then((res) => {
      if (!active) return
      if (res.error) setState({ rows: [], error: errorMessage(res.error) })
      else setState({ rows: build(res.data, bdmId), error: null })
    })
    return () => {
      active = false
    }
    // range is represented by rangeKey; the object identity changes every render.
  }, [rangeKey, bdmId]) // eslint-disable-line react-hooks/exhaustive-deps

  return state
}

// The won/lost rows for the period — fetched once by BdmDashboard and handed to
// both the Closed card and Pipeline closed, so the list and the figure can't
// disagree about which leads closed.
export function useClosedRows(range, bdmId) {
  return useBdmPeriodRows(fetchClosedRows, (data, id) => buildClosedRows(data.stageRows, data.lossRows, id), range, bdmId)
}
