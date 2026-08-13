import { Link } from 'react-router-dom'
import { IconActivity, IconPlus } from './NavIcons'

// The FAB's bottom sheet (New Lead / Log Activity) — mobile-only, opened from
// BottomNav.jsx's centre FAB.
//
// Takes explicit capability props rather than the `isOwner` flag it used to.
// That flag encoded "not an owner means a rep", which stopped being true when
// Phase 8 added sales_coordinator. BottomNav decides who can do what and this
// component just renders it — and doesn't open at all unless at least one row
// applies, so there's no empty-sheet state to design for. A coordinator gets
// both rows: neither /leads/new nor /activity route to a screen that assumes
// "you own what you're about to create" anymore — both now ask "who is this
// for?" and credit the picked exec, not whoever is filling in the form.
function FabSheet({ canCreateLead, canLogActivity, onClose }) {
  return (
    <>
      <div className="vip-sheet-backdrop" onClick={onClose} />
      <div className="vip-sheet">
        <div className="vip-sheet-handle" />

        {canCreateLead && (
          <Link to="/leads/new" className="vip-sheet-row vip-sheet-row-primary" onClick={onClose}>
            <span className="vip-sheet-icon">
              <IconPlus style={{ width: 22, height: 22 }} />
            </span>
            <span className="vip-sheet-text">
              <span className="vip-sheet-title">New lead</span>
              <span className="vip-sheet-sub">Source + any one field. Details later.</span>
            </span>
          </Link>
        )}

        {canLogActivity && (
          <Link to="/activity" className="vip-sheet-row" onClick={onClose}>
            <span className="vip-sheet-icon">
              <IconActivity style={{ width: 22, height: 22 }} />
            </span>
            <span className="vip-sheet-text">
              <span className="vip-sheet-title">Log activity</span>
              <span className="vip-sheet-sub">Visit, call, RFQ, office day, booking</span>
            </span>
          </Link>
        )}
      </div>
    </>
  )
}

export default FabSheet
