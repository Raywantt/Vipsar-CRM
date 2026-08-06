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

export async function subscribeToPush(employeeId) {
  if (!isPushSupported()) {
    return { data: null, error: { message: 'Push notifications are not supported on this device/browser.' } }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { data: null, error: { message: 'Notification permission was not granted.' } }
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
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

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return { error: null }

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('employee_id', employeeId)
  return { error }
}
