import { useEffect, useState } from 'react'

// Same online/offline listener OfflineIndicator.jsx already had inline —
// pulled out so Today's SYNCED pill and New Lead's offline note can share it
// instead of each re-registering the same two window listeners.
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
    }
    function handleOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}
