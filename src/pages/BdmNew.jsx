import { useEffect, useState } from 'react'
import { useHeaderOverride } from '../contexts/HeaderContext'
import LeadQuickCapture from './LeadQuickCapture'
import NewArchitectForm from '../components/NewArchitectForm'

const KINDS = [
  { value: 'lead', label: 'Lead' },
  { value: 'architect', label: 'Architect' },
]

// A business development manager's "+ New" (BDM.md §3 Screens) — one screen,
// a Lead / Architect toggle on top. BDM only: every other role's /leads/new is
// the plain New Lead form, unchanged (NewRoute.jsx picks).
//
// Both forms stay MOUNTED and the toggle only hides one ([hidden]). Switching
// to Architect to add the architect a lead came through, then back, must not
// wipe the half-filled lead — both forms keep their state in component state,
// so unmounting would. Each form's own sticky Save footer sits inside its
// hidden wrapper, so only the visible one shows.
function BdmNew() {
  const [kind, setKind] = useState('lead')
  const { setOverride } = useHeaderOverride()

  useEffect(() => {
    setOverride({ title: 'New', sub: 'Required fields are marked *' })
    return () => setOverride(null)
  }, [setOverride])

  return (
    <div className="vip-narrow vip-stack">
      <div className="vip-seg" role="tablist" aria-label="What are you adding?">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            role="tab"
            id={`vip-new-tab-${k.value}`}
            aria-selected={kind === k.value}
            aria-controls={`vip-new-panel-${k.value}`}
            className={kind === k.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => setKind(k.value)}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div id="vip-new-panel-lead" role="tabpanel" aria-labelledby="vip-new-tab-lead" hidden={kind !== 'lead'}>
        <LeadQuickCapture />
      </div>
      <div
        id="vip-new-panel-architect"
        role="tabpanel"
        aria-labelledby="vip-new-tab-architect"
        hidden={kind !== 'architect'}
      >
        <NewArchitectForm />
      </div>
    </div>
  )
}

export default BdmNew
