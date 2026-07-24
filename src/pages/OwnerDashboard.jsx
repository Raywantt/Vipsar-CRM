import { useAuth } from '../contexts/AuthContext'

function OwnerDashboard() {
  const { employee } = useAuth()

  return (
    <main style={{ padding: 24 }}>
      <h1>Owner Dashboard</h1>
      <p>Welcome, {employee?.name}. You're logged in as owner.</p>
    </main>
  )
}

export default OwnerDashboard
