import { useEffect, useState } from 'react'
import './InstallPrompt.css'

const ANDROID_DISMISS_KEY = 'installPromptAndroidDismissed'
const IOS_DISMISS_KEY = 'installPromptIosDismissed'

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

// iPadOS 13+ reports itself as "Macintosh" in the UA string, hence the
// touch-points fallback alongside the classic iPhone/iPad/iPod check.
function isIosSafari() {
  const ua = window.navigator.userAgent
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/.test(ua)
  return isIos && isSafari
}

function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showAndroidBanner, setShowAndroidBanner] = useState(false)
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => {
    if (isStandalone()) return

    if (isIosSafari()) {
      if (sessionStorage.getItem(IOS_DISMISS_KEY) !== '1') {
        setShowIosHint(true)
      }
      return
    }

    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      if (sessionStorage.getItem(ANDROID_DISMISS_KEY) === '1') return
      setDeferredPrompt(event)
      setShowAndroidBanner(true)
    }

    function handleAppInstalled() {
      setShowAndroidBanner(false)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function handleInstallClick() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setShowAndroidBanner(false)
  }

  function dismissAndroid() {
    sessionStorage.setItem(ANDROID_DISMISS_KEY, '1')
    setShowAndroidBanner(false)
  }

  function dismissIos() {
    sessionStorage.setItem(IOS_DISMISS_KEY, '1')
    setShowIosHint(false)
  }

  if (showAndroidBanner) {
    return (
      <div className="install-prompt">
        <span className="install-prompt-text">
          Install VIPSAR CRM for quick, one-tap access.
        </span>
        <div className="install-prompt-actions">
          <button type="button" className="install-prompt-install" onClick={handleInstallClick}>
            Install
          </button>
          <button
            type="button"
            className="install-prompt-dismiss"
            onClick={dismissAndroid}
            aria-label="Dismiss install prompt"
          >
            ×
          </button>
        </div>
      </div>
    )
  }

  if (showIosHint) {
    return (
      <div className="install-prompt">
        <span className="install-prompt-text">
          On iPhone? Tap Share, then "Add to Home Screen".
        </span>
        <button
          type="button"
          className="install-prompt-dismiss"
          onClick={dismissIos}
          aria-label="Dismiss install hint"
        >
          ×
        </button>
      </div>
    )
  }

  return null
}

export default InstallPrompt
