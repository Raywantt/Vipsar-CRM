import { useEffect, useRef, useState } from 'react'
import { useNavigationType } from 'react-router-dom'

// Keeps one filter field alive across a "drill into a row, then Back" round
// trip — a POP navigation (the browser/PWA back gesture, or AppNav's own
// back button, which calls navigate(-1)) — but starts fresh every time the
// screen is reached by clicking a nav link instead (PUSH/REPLACE), even if
// that link points at the same screen. sessionStorage is the carrier
// because every filtered screen in this app is a route, and crossing routes
// unmounts the page and drops its plain useState.
//
// A screen with several filter fields calls this once per field, all under
// the same storageKey — see LeadsListCard.jsx/Search.jsx/MyTeam.jsx/
// Dashboard.jsx for the pattern. Restoring only ever happens once, at the
// component's first render after a POP; later re-renders don't re-check
// navigationType, so mid-session state changes can't fight this.
export function usePersistedFilterState(storageKey, fieldKey, initialValue) {
  const navigationType = useNavigationType()
  const fullKey = `${storageKey}:${fieldKey}`
  const initRef = useRef(undefined)

  if (initRef.current === undefined) {
    let restored
    if (navigationType === 'POP') {
      try {
        const raw = sessionStorage.getItem(fullKey)
        if (raw != null) restored = JSON.parse(raw)
      } catch {
        restored = undefined
      }
    }
    initRef.current = { value: restored !== undefined ? restored : initialValue }
  }

  const [value, setValue] = useState(initRef.current.value)

  useEffect(() => {
    try {
      sessionStorage.setItem(fullKey, JSON.stringify(value))
    } catch {
      // Private-mode/quota failures just mean this field won't survive a
      // round trip — the rest of the app is unaffected either way.
    }
  }, [fullKey, value])

  return [value, setValue]
}
