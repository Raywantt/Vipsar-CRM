import { useAuth } from '../contexts/AuthContext'

function OwnerDashboard() {
  const { employee, signOut } = useAuth()

  return (
    <main style={{ padding: 24 }}>
      <h1>Owner Dashboard</h1>
      <p>Welcome, {employee?.name}. You're logged in as owner.</p>
      <button type="button" onClick={signOut}>
        Log out
      </button>
    </main>
  )
}

export default OwnerDashboard
