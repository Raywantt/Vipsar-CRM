import { Link } from 'react-router-dom'
import { IconActivity, IconPlus } from './NavIcons'

// The FAB's two-choice bottom sheet (New Lead / Log Activity) — mobile-only,
// opened from BottomNav.jsx's centre FAB. /activity is sales_executive-only
// (see App.jsx), so an owner only ever sees New Lead here.
function FabSheet({ isOwner, onClose }) {
  return (
    <>
      <div className="vip-sheet-backdrop" onClick={onClose} />
      <div className="vip-sheet">
        <div className="vip-sheet-handle" />

        <Link to="/leads/new" className="vip-sheet-row vip-sheet-row-primary" onClick={onClose}>
          <span className="vip-sheet-icon">
            <IconPlus style={{ width: 22, height: 22 }} />
          </span>
          <span className="vip-sheet-text">
            <span className="vip-sheet-title">New lead</span>
            <span className="vip-sheet-sub">Source + any one field. Details later.</span>
          </span>
        </Link>

        {!isOwner && (
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

        <div className="vip-sheet-foot">Works offline — saved on this phone, synced when you're back on signal.</div>
      </div>
    </>
  )
}

export default FabSheet
