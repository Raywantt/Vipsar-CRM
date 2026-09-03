import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getPushPermissionState, hasActiveSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/pushSubscription'
import { fetchAllEmployees, fetchCoordinators, fetchManagers } from '../lib/employeeQueries'
import { roleLabel } from '../lib/roles'
import AddEmployeeForm from '../components/AddEmployeeForm'
import ManageEmployeesSection from '../components/ManageEmployeesSection'
import DeletePartySection from '../components/DeletePartySection'
import ChangePasswordForm from '../components/ChangePasswordForm'
import { errorMessage } from '../lib/errorMessage'
import { getStoredTheme, setTheme, fetchAccountTheme, saveAccountTheme } from '../lib/theme'

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
  const [coordinators, setCoordinators] = useState([])
  const [managers, setManagers] = useState([])
  const [employeesLoading, setEmployeesLoading] = useState(isOwner)
  const [addingEmployee, setAddingEmployee] = useState(false)

  const [changingPassword, setChangingPassword] = useState(false)

  const [theme, setThemeChoice] = useState(getStoredTheme)
  const [themeSaveWarning, setThemeSaveWarning] = useState(null)

  function handleThemeChange(value) {
    setTheme(value)
    setThemeChoice(value)
    setThemeSaveWarning(null)
    if (!employee) return
    saveAccountTheme(employee.id, value).then(({ error }) => {
      if (error) setThemeSaveWarning("Saved on this device, but couldn't sync to your account.")
    })
  }

  useEffect(() => {
    setPermission(getPushPermissionState())
    hasActiveSubscription().then(setSubscribed)
  }, [])

  // Converges to whatever's actually saved on the account, in case this
  // page rendered before AuthContext's own post-login sync (see
  // AuthContext.jsx) had a chance to resolve — e.g. the very first visit to
  // Profile right after logging in on a new device. A no-op re-application
  // if the two already agree.
  useEffect(() => {
    if (!employee) return
    let active = true
    fetchAccountTheme(employee.id).then((accountTheme) => {
      if (!active || !accountTheme) return
      setTheme(accountTheme)
      setThemeChoice(accountTheme)
    })
    return () => {
      active = false
    }
  }, [employee])

  useEffect(() => {
    if (!isOwner) return
    let active = true
    Promise.all([fetchAllEmployees(), fetchCoordinators(), fetchManagers()]).then(
      ([all, coords, mgrs]) => {
        if (!active) return
        setEmployeesLoading(false)
        if (!all.error) setEmployees(all.data ?? [])
        if (!coords.error) setCoordinators(coords.data ?? [])
        if (!mgrs.error) setManagers(mgrs.data ?? [])
      }
    )
    return () => {
      active = false
    }
  }, [isOwner])

  function upsertEmployee(row) {
    setEmployees((prev) => {
      const exists = prev.some((e) => e.id === row.id)
      return exists ? prev.map((e) => (e.id === row.id ? row : e)) : [...prev, row].sort((a, b) => a.name.localeCompare(b.name))
    })
    // Keep the "Reports to" options in step with the role just saved, without
    // a refetch: promoting someone to coordinator has to make them selectable
    // immediately, and demoting them has to stop other execs being assignable
    // to a person who is no longer a coordinator.
    setCoordinators((prev) => {
      const eligible = row.role === 'sales_coordinator' && row.is_active
      const listed = prev.some((c) => c.id === row.id)
      if (eligible && !listed) {
        return [...prev, { id: row.id, name: row.name }].sort((a, b) => a.name.localeCompare(b.name))
      }
      if (!eligible && listed) return prev.filter((c) => c.id !== row.id)
      return listed ? prev.map((c) => (c.id === row.id ? { id: row.id, name: row.name } : c)) : prev
    })
    // Same treatment for the manager list, for the same reason: promoting
    // someone to Sales Manager has to make them selectable in the "Reports to
    // (Manager)" dropdown immediately, without a refetch.
    setManagers((prev) => {
      const eligible = row.role === 'sales_manager' && row.is_active
      const listed = prev.some((m) => m.id === row.id)
      if (eligible && !listed) {
        return [...prev, { id: row.id, name: row.name }].sort((a, b) => a.name.localeCompare(b.name))
      }
      if (!eligible && listed) return prev.filter((m) => m.id !== row.id)
      return listed ? prev.map((m) => (m.id === row.id ? { id: row.id, name: row.name } : m)) : prev
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
            <div className="vip-fact-value">{roleLabel(employee?.role)}</div>
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
        {themeSaveWarning && <p className="vip-error" role="alert">{themeSaveWarning}</p>}
      </div>

      {/* Owner-only admin tooling. Add employee and Delete a party stay
          desktop-only (design_handoff_vipsar_mobile: "not shown on mobile") —
          both are sit-down tasks needing a UUID pasted from the Supabase
          dashboard, or a deliberate destructive confirm.

          Manage employees is deliberately NOT in that wrapper as of Phase 8:
          it now owns coordinator assignment, which is a normal
          "reshuffle who reports to whom" action an owner may well do from a
          phone. Keeping it desktop-only would have meant the only route to it
          was a laptop. */}
      {isOwner && (
        <>
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
            </div>
          </div>

          {employeesLoading ? (
            <p className="vip-empty">Loading employees…</p>
          ) : (
            <ManageEmployeesSection
              employees={employees}
              coordinators={coordinators}
              managers={managers}
              currentEmployeeId={employee?.id}
              onUpdated={upsertEmployee}
            />
          )}

          <div className="vip-only-desktop">
            <DeletePartySection />
          </div>
        </>
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
