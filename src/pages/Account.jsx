import { useAuth } from '../contexts/AuthContext'

const ROLE_LABELS = {
  owner: 'Owner',
  sales_executive: 'Sales Executive',
}

function Account() {
  const { employee, user, signOut } = useAuth()

  return (
    <>
      <div className="vip-card">
        <div className="vip-facts" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div>
            <div className="vip-fact-label">Name</div>
            <div className="vip-fact-value">{employee?.name}</div>
          </div>
          <div>
            <div className="vip-fact-label">Role</div>
            <div className="vip-fact-value">{ROLE_LABELS[employee?.role] ?? employee?.role}</div>
          </div>
          <div>
            <div className="vip-fact-label">Mobile</div>
            <div className="vip-fact-value">{employee?.mobile || 'Not set'}</div>
          </div>
          <div>
            <div className="vip-fact-label">Email</div>
            <div className="vip-fact-value">{user?.email}</div>
          </div>
        </div>
      </div>

      <button type="button" className="vip-btn vip-btn-secondary" onClick={signOut}>
        Log out
      </button>
    </>
  )
}

export default Account
