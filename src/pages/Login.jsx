import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { errorMessage } from '../lib/errorMessage'

function Login() {
  const { session, employee, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session && employee) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) {
      setError(errorMessage(error))
    }
  }

  return (
    <div className="vip-login">
      <div className="vip-login-brand">
        <div className="vip-login-mark">V</div>
        <div className="vip-login-word">VIPSAR</div>
      </div>

      <div className="vip-login-pitch">
        <div className="vip-login-h">Every plot, every quote, one record.</div>
        <div className="vip-login-sub">Sign in to log visits and leads from site.</div>
      </div>

      <form className="vip-login-form" onSubmit={handleSubmit}>
        <input
          className="vip-input"
          type="email"
          placeholder="you@vipsar.in"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
        />
        <input
          className="vip-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <p className="vip-error">{error}</p>}
        <button className="vip-btn" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Log in'}
        </button>
        <div className="vip-login-note">Accounts are created by the owner. No self signup.</div>
      </form>
    </div>
  )
}

export default Login
