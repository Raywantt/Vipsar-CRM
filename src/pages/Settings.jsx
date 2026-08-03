import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import AddEmployeeForm from '../components/AddEmployeeForm'
import ManageEmployeesSection from '../components/ManageEmployeesSection'
import DeleteLeadSection from '../components/DeleteLeadSection'
import { fetchAllEmployees } from '../lib/employeeQueries'

function Settings() {
  const { employee } = useAuth()

  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetchAllEmployees().then(({ data, error }) => {
      if (!active) return
      setLoading(false)
      if (!error) setEmployees(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  function upsertEmployee(row) {
    setEmployees((prev) => {
      const exists = prev.some((e) => e.id === row.id)
      return exists ? prev.map((e) => (e.id === row.id ? row : e)) : [...prev, row].sort((a, b) => a.name.localeCompare(b.name))
    })
  }

  return (
    <>
      <p className="vip-lede">Owner-only tools for managing the team and cleaning up data.</p>

      <AddEmployeeForm onCreated={upsertEmployee} />

      {loading ? (
        <p className="vip-empty">Loading employees…</p>
      ) : (
        <ManageEmployeesSection employees={employees} currentEmployeeId={employee?.id} onUpdated={upsertEmployee} />
      )}

      <DeleteLeadSection />
    </>
  )
}

export default Settings
