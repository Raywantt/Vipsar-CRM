import { useEffect, useState } from 'react'

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
      // localStorage, not sessionStorage — this should show once ever on a
      // device, not once per browser session (a PWA gets closed and reopened
      // constantly, which is a new "session" every time).
      if (localStorage.getItem(IOS_DISMISS_KEY) !== '1') {
        localStorage.setItem(IOS_DISMISS_KEY, '1')
        setShowIosHint(true)
      }
      return
    }

    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      if (localStorage.getItem(ANDROID_DISMISS_KEY) === '1') return
      localStorage.setItem(ANDROID_DISMISS_KEY, '1')
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
    // The localStorage flag is already set from the moment this was shown
    // (see the effect above) — dismiss just hides it for the rest of this
    // visit.
    setShowAndroidBanner(false)
  }

  function dismissIos() {
    setShowIosHint(false)
  }

  // Mounted globally (outside .vip-app, so it also covers /login — see
  // CLAUDE.md) rather than as Home's last child, so it needs its own
  // app-column width constraint instead of inheriting one from a parent.
  function installColumn(content) {
    return <div style={{ maxWidth: 'var(--vip-app-max)', margin: '0 auto', padding: '10px 16px 0' }}>{content}</div>
  }

  if (showAndroidBanner) {
    return installColumn(
      <div className="vip-install">
        <div>
          <div className="vip-install-title">Add to home screen</div>
          <div className="vip-install-sub">Works with no signal.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
          <button type="button" className="vip-btn-link" onClick={dismissAndroid}>
            Later
          </button>
          <button type="button" className="vip-btn" onClick={handleInstallClick}>
            Install
          </button>
        </div>
      </div>
    )
  }

  if (showIosHint) {
    return installColumn(
      <div className="vip-install">
        <div>
          <div className="vip-install-title">Add to home screen</div>
          <div className="vip-install-sub">Tap Share, then "Add to Home Screen".</div>
        </div>
        <button type="button" className="vip-btn-link" onClick={dismissIos}>
          Later
        </button>
      </div>
    )
  }

  return null
}

export default InstallPrompt
