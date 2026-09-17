import { useEffect, useState } from 'react'
import { fetchActiveBdms } from '../lib/bdmQueries'

// The small, rarely-changing roster of active BDMs — what every BdmChip
// (src/components/BdmChip.jsx) needs to turn a lead's bare bdm_employee_id
// into a name. fetchActiveBdms is wrapped in cachedQuery, so many components
// calling this on the same page collapse into one request, not one each.
export function useBdmRoster() {
  const [bdms, setBdms] = useState([])
  useEffect(() => {
    let active = true
    fetchActiveBdms().then(({ data }) => {
      if (active) setBdms(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])
  return bdms
}
