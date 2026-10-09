import { supabase } from './supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// Web Push wants the VAPID key as a Uint8Array, not the base64url string
// it's shipped as via .env.
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// 'unsupported' | 'default' | 'granted' | 'denied' — 'default' means never asked yet.
export function getPushPermissionState() {
  return isPushSupported() ? Notification.permission : 'unsupported'
}

// Whether *this device* already has an active push subscription — read
// straight from the browser's own PushManager (the source of truth for "is
// this device subscribed"), not from push_subscriptions.
export async function hasActiveSubscription() {
  if (!isPushSupported()) return false
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return Boolean(subscription)
}

// How long a tap on the toggle waits for the app's service worker. `ready`
// never settles when no worker is active, so without a limit the Profile tick
// box sat greyed out for ever with nothing on screen to say why.
const SERVICE_WORKER_WAIT_MS = 8000

function serviceWorkerReady() {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('Service worker not ready'), { name: 'ServiceWorkerTimeout' }))
    }, SERVICE_WORKER_WAIT_MS)
  })
  return Promise.race([navigator.serviceWorker.ready, timeout]).finally(() => clearTimeout(timer))
}

// Turns whatever the browser's push machinery threw into a sentence a person
// can act on. Before this, subscribe() rejecting (Brave, a phone that can't
// reach Google's push service, a stuck worker) escaped as an unhandled
// rejection: the toggle's busy flag never cleared and no message appeared.
// The error's name is kept in brackets so a screenshot of it is enough to
// diagnose from.
function pushFailureMessage(err) {
  let text = "Couldn't turn on notifications on this phone."
  if (err?.name === 'ServiceWorkerTimeout') {
    text = "The app's background service isn't running yet. Close and reopen the CRM, then try again."
  } else if (err?.name === 'NotAllowedError') {
    text = "Notifications are blocked for this app. Allow them in the phone's settings for this app, then try again."
  } else if (err?.name === 'AbortError') {
    text =
      "The phone couldn't reach its push service. Check its internet connection and that the date and time are set to automatic, then try again."
  }
  return `${text} (${err?.name || 'error'})`
}

export async function subscribeToPush(employeeId) {
  if (!isPushSupported()) {
    return { data: null, error: { message: 'Push notifications are not supported on this device/browser.' } }
  }

  let subscription
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { data: null, error: { message: 'Notification permission was not granted.' } }
    }

    const registration = await serviceWorkerReady()
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  } catch (err) {
    console.error(err)
    return { data: null, error: { message: pushFailureMessage(err) } }
  }
  const raw = subscription.toJSON()

  return supabase
    .from('push_subscriptions')
    .upsert(
      {
        employee_id: employeeId,
        endpoint: raw.endpoint,
        p256dh: raw.keys.p256dh,
        auth: raw.keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: 'endpoint' }
    )
    .select()
    .single()
}

export async function unsubscribeFromPush(employeeId) {
  if (!isPushSupported()) return { error: null }

  let endpoint
  try {
    const registration = await serviceWorkerReady()
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return { error: null }

    endpoint = subscription.endpoint
    await subscription.unsubscribe()
  } catch (err) {
    console.error(err)
    return { error: { message: pushFailureMessage(err) } }
  }
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('employee_id', employeeId)
  return { error }
}
