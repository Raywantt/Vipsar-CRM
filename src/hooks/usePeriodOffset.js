import { useCallback } from 'react'
import { usePersistedFilterState } from './usePersistedFilterState'
import { isSteppablePreset } from '../lib/dateRanges'

// How many whole periods back the ‹ › stepper under the range buttons has been
// walked (0 = the current, still-running period). Shared by the Dashboard, the
// BDM Dashboard and Architect Network, which already share one persisted
// preset, so the three read the period the same way.
//
// Kept beside the preset under the same storage key, so a "drill into an exec,
// then Back" round trip returns to the week you were reading rather than to
// this one — and a fresh nav-link visit starts at the current period, like the
// preset does.
//
// `onPresetChange` is the one handler the range buttons call: it sets the preset
// AND returns to the current period. Choosing a different preset must never
// carry a stale offset across (3 weeks back is not 3 months back), and tapping
// the preset that is already active is the quick way home.
export function usePeriodOffset(preset, setPreset) {
  const [stored, setStored] = usePersistedFilterState('vip-filters:dashboard', 'offset', 0)

  // Only Week / 15D / Month / Quarter step. Anything else reads 0 whatever is
  // stored, and a stored value that isn't a whole non-negative number is ignored
  // rather than trusted.
  const offset = isSteppablePreset(preset) && Number.isInteger(stored) && stored > 0 ? stored : 0

  const setOffset = useCallback(
    (next) => setStored(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0),
    [setStored]
  )

  const onPresetChange = useCallback(
    (next) => {
      setPreset(next)
      setStored(0)
    },
    [setPreset, setStored]
  )

  return { offset, setOffset, onPresetChange }
}
