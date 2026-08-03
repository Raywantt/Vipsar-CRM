import { createContext, useContext, useState } from 'react'

// AppNav owns a static per-route title/sub lookup, but two screens need a
// dynamic sub it has no way to compute itself (Lead Detail's party name,
// Dashboard's selected range) — this lets just those pages push an override
// up to the shared header without AppNav re-fetching their data itself.
const HeaderContext = createContext(undefined)

export function HeaderProvider({ children }) {
  const [override, setOverride] = useState(null)
  return <HeaderContext.Provider value={{ override, setOverride }}>{children}</HeaderContext.Provider>
}

export function useHeaderOverride() {
  const context = useContext(HeaderContext)
  if (context === undefined) {
    throw new Error('useHeaderOverride must be used within a HeaderProvider')
  }
  return context
}
