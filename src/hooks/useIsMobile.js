import { useEffect, useState } from 'react'

// Mirrors the ≥1024px breakpoint vipsar-theme.css uses everywhere
// (max-width: 1023.98px) — one source for the number so it can't drift
// between CSS and JS. NumPadInput is the current consumer: it needs to
// know the breakpoint in JS, not just CSS, since desktop and mobile render
// genuinely different <input> behavior (native keyboard vs. the on-screen
// numpad), not just different layout a stylesheet alone could switch.
const QUERY = '(max-width: 1023.98px)'

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    function handleChange(e) {
      setIsMobile(e.matches)
    }
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  return isMobile
}
