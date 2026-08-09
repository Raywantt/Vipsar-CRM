// Manual light/dark override, layered on top of the @media
// (prefers-color-scheme: dark) default in vipsar-theme.css. 'system' means
// "no override" — just delete the attribute and let the media query decide.
// index.html has its own tiny inline copy of the storage key/read logic
// (applied before any CSS loads, to avoid a flash of the wrong theme) —
// keep the two in sync if this key ever changes.
const STORAGE_KEY = 'vip-theme'
const VALID = ['light', 'dark', 'system']

export function getStoredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  return VALID.includes(stored) ? stored : 'system'
}

export function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme)
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}
