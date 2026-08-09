import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getPushPermissionState, hasActiveSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/pushSubscription'
import { fetchAllEmployees } from '../lib/employeeQueries'
import AddEmployeeForm from '../components/AddEmployeeForm'
import ManageEmployeesSection from '../components/ManageEmployeesSection'
import DeletePartySection from '../components/DeletePartySection'
import ChangePasswordForm from '../components/ChangePasswordForm'
import { errorMessage } from '../lib/errorMessage'
import { getStoredTheme, setTheme } from '../lib/theme'

const ROLE_LABELS = {
  owner: 'Owner',
  sales_executive: 'Sales Executive',
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

function Profile() {
  const { employee, user, signOut } = useAuth()
  const isOwner = employee?.role === 'owner'

  const [permission, setPermission] = useState('default')
  const [subscribed, setSubscribed] = useState(false)
  const [notifBusy, setNotifBusy] = useState(false)
  const [notifError, setNotifError] = useState(null)

  const [employees, setEmployees] = useState([])
  const [employeesLoading, setEmployeesLoading] = useState(isOwner)
  const [addingEmployee, setAddingEmployee] = useState(false)

  const [changingPassword, setChangingPassword] = useState(false)

  const [theme, setThemeChoice] = useState(getStoredTheme)

  function handleThemeChange(value) {
    setTheme(value)
    setThemeChoice(value)
  }

  useEffect(() => {
    setPermission(getPushPermissionState())
    hasActiveSubscription().then(setSubscribed)
  }, [])

  useEffect(() => {
    if (!isOwner) return
    let active = true
    fetchAllEmployees().then(({ data, error }) => {
      if (!active) return
      setEmployeesLoading(false)
      if (!error) setEmployees(data ?? [])
    })
    return () => {
      active = false
    }
  }, [isOwner])

  function upsertEmployee(row) {
    setEmployees((prev) => {
      const exists = prev.some((e) => e.id === row.id)
      return exists ? prev.map((e) => (e.id === row.id ? row : e)) : [...prev, row].sort((a, b) => a.name.localeCompare(b.name))
    })
  }

  async function handleToggleNotifications() {
    setNotifBusy(true)
    setNotifError(null)

    if (subscribed) {
      const { error } = await unsubscribeFromPush(employee.id)
      setNotifBusy(false)
      if (error) {
        setNotifError(errorMessage(error))
        return
      }
      setSubscribed(false)
      return
    }

    const { error } = await subscribeToPush(employee.id)
    setNotifBusy(false)
    if (error) {
      setNotifError(errorMessage(error))
      return
    }
    setSubscribed(true)
    setPermission(getPushPermissionState())
  }

  return (
    <div className="vip-narrow">
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

      <div className="vip-card">
        <div className="vip-card-title">Notifications</div>
        {permission === 'unsupported' ? (
          <p className="vip-form-note">Push notifications aren't supported on this browser or device.</p>
        ) : permission === 'denied' ? (
          <p className="vip-form-note">
            Notifications are blocked for this site. Enable them in your browser's site settings to get follow-up reminders.
          </p>
        ) : (
          <label className="vip-check">
            <input type="checkbox" checked={subscribed} disabled={notifBusy} onChange={handleToggleNotifications} />
            {subscribed ? 'Reminders enabled on this device' : 'Get follow-up reminders on this device'}
          </label>
        )}
        {notifError && <p className="vip-error" role="alert">{notifError}</p>}
      </div>

      <div className="vip-card">
        <div className="vip-card-title">Appearance</div>
        <div className="vip-seg vip-seg-outline">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={theme === opt.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
              onClick={() => handleThemeChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="vip-form-note">System matches your phone or browser's own light/dark setting.</p>
      </div>

      {/* Owner-only admin tooling — desktop only (design_handoff_vipsar_mobile:
          "not shown on mobile"). A phone-width Profile stays a lean personal
          screen; team/data management stays a desktop task. */}
      {isOwner && (
        <div className="vip-only-desktop">
          <div className="vip-stack">
            <p className="vip-lede">Owner-only tools for managing the team and cleaning up data.</p>

            <div className="vip-card">
              <div className="vip-card-head">
                <div className="vip-card-title">Add employee</div>
                {!addingEmployee && (
                  <button type="button" className="vip-btn-link" onClick={() => setAddingEmployee(true)}>
                    + Add
                  </button>
                )}
              </div>
              {addingEmployee && (
                <AddEmployeeForm
                  onCreated={(row) => {
                    upsertEmployee(row)
                    setAddingEmployee(false)
                  }}
                  onCancel={() => setAddingEmployee(false)}
                />
              )}
            </div>

            {employeesLoading ? (
              <p className="vip-empty">Loading employees…</p>
            ) : (
              <ManageEmployeesSection employees={employees} currentEmployeeId={employee?.id} onUpdated={upsertEmployee} />
            )}

            <DeletePartySection />
          </div>
        </div>
      )}

      <div className="vip-card">
        <div className="vip-card-head">
          <div className="vip-card-title">Change password</div>
          {!changingPassword && (
            <button type="button" className="vip-btn-link" onClick={() => setChangingPassword(true)}>
              Change
            </button>
          )}
        </div>
        {changingPassword && <ChangePasswordForm email={user?.email} onCancel={() => setChangingPassword(false)} />}
      </div>

      <button type="button" className="vip-btn vip-btn-secondary" onClick={signOut}>
        Log out
      </button>
    </div>
  )
}

export default Profile
