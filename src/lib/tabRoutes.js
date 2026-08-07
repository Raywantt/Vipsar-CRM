// BottomNav's own destinations — the only routes that (a) get no AppNav back
// button and (b) keep the mobile tab bar visible. Every other route was
// "drilled into" from one of these, so on mobile it hides the tab bar
// entirely (replaced by a sticky action bar or nothing, see each page) and
// gets a back button instead. Shared by AppNav.jsx (back button) and
// ProtectedRoute.jsx (tab bar visibility) so the two definitions can't drift
// apart — matched against pathname only, so '/dashboard' covers both the
// Reports view and '?tab=leads' (query strings aren't part of pathname).
export const TAB_ROUTES = new Set(['/', '/search', '/dashboard'])
