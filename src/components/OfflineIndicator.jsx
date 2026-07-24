import { useEffect, useState } from 'react'
import './OfflineIndicator.css'

function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    function handleOnline() {
      setIsOffline(false)
    }
    function handleOffline() {
      setIsOffline(true)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div className="offline-indicator" role="status">
      You're offline. The app is still open, but nothing you submit will save
      until your connection comes back.
    </div>
  )
}

export default OfflineIndicator
