import { useAuth } from '../contexts/AuthContext'
import './Account.css'

const ROLE_LABELS = {
  owner: 'Owner',
  sales_executive: 'Sales Executive',
}

function Account() {
  const { employee, user, signOut } = useAuth()

  return (
    <main className="account">
      <div className="account-header">
        <h1>Account</h1>
      </div>

      <section className="account-card">
        <div className="account-row">
          <span className="account-label">Name</span>
          <span>{employee?.name}</span>
        </div>
        <div className="account-row">
          <span className="account-label">Role</span>
          <span>{ROLE_LABELS[employee?.role] ?? employee?.role}</span>
        </div>
        <div className="account-row">
          <span className="account-label">Mobile</span>
          <span>{employee?.mobile || 'Not set'}</span>
        </div>
        <div className="account-row">
          <span className="account-label">Email</span>
          <span>{user?.email}</span>
        </div>
      </section>

      <button type="button" className="account-logout" onClick={signOut}>
        Log out
      </button>
    </main>
  )
}

export default Account
