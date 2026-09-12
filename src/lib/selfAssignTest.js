// ⚠️ TEMPORARY — added 2026-09-12 at the owner's request, to test the
// lead-assignment push notification end to end on a real phone.
//
// THE PROBLEM IT SOLVES: "Reassign owner" offers fetchActiveSalesExecs(),
// which is every active employee whose role is in CARRIES_OWN_LEADS —
// sales_executive and sales_manager. An `owner` is deliberately not in that
// list, because an owner does not carry a pipeline. That is correct, and it
// also means the owner had no way to send themselves a lead and watch the
// notification arrive, without borrowing a rep's phone or a rep's login.
//
// TO REMOVE THIS, set the flag below to false. That is the whole removal —
// the option disappears, nothing else in the app changes, and no data needs
// undoing (a lead that ended up owned by the owner is reassigned back to a
// rep from the same control). Deleting this file outright also works; its
// only consumer is LeadDetail.jsx.
//
// WHAT IT DOES NOT DO: it does not make the owner a rep. The self-assign
// entry is added to this one dropdown and nowhere else, so the owner still
// does not appear in the heatmap, the Day Review table, Set-a-target, the
// attainment ranking or All Leads' owner filter. A lead parked on the owner
// is therefore invisible to every per-rep report until it is handed back —
// which is exactly why this is a test affordance and not a product change.
//
// TURNED OFF 2026-09-12, once the owner had confirmed a real push arriving on
// a real phone. Left in place rather than deleted because the next time this
// needs proving — a new handset, a rep who cannot get notifications to work,
// a change to the push payload — flipping this back to true is the whole of
// re-enabling it, and re-deriving why fetchActiveSalesExecs() excludes an
// owner is the expensive part, not the six lines below.
export const SELF_ASSIGN_TEST_ENABLED = false

// Appended, not merged into the roster, so the option is visibly a test one
// and sorts last rather than hiding alphabetically among real reps. The
// database has no objection: leads.owner_employee_id is a plain FK to
// employees with no role constraint, and an owner passes every leads UPDATE
// policy already.
export function withSelfAssignTestOption(activeSalesExecs, employee) {
  if (!SELF_ASSIGN_TEST_ENABLED) return activeSalesExecs
  if (employee?.role !== 'owner' || !employee?.id) return activeSalesExecs
  if (activeSalesExecs.some((e) => e.id === employee.id)) return activeSalesExecs

  return [
    ...activeSalesExecs,
    { id: employee.id, name: `${employee.name} (me — TEST)`, role: employee.role, isSelfAssignTest: true },
  ]
}
