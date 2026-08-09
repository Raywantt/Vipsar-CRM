import { Link } from 'react-router-dom'

// path="*" used to silently redirect straight to Home — a typo'd or stale
// link landed a user on Today with no explanation at all. This shows what
// happened instead, same plain-message convention ProtectedRoute already
// uses for "Account not linked"/"Account deactivated".
function NotFound() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Page not found</h1>
      <p>There's nothing here — the link may be out of date.</p>
      <Link to="/" className="vip-btn vip-btn-secondary" style={{ marginTop: 16, width: 'auto', display: 'inline-flex' }}>
        Back to Today
      </Link>
    </main>
  )
}

export default NotFound
