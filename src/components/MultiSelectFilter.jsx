import { useEffect, useId, useRef, useState } from 'react'

// A filter that takes any number of values: a button that reads like a
// <select>, opening a checklist. Nothing ticked means "no filter" (the
// `allLabel`). It's one shape for every All Leads facet, so the toolbar keeps
// reading as one kind of control.
//
// Selection is reported in `options` order, whatever order the boxes were
// ticked in, so the same choice always makes the same filter (and cache key).
//
// Below 1024px the checklist opens in the flow of the filter panel — a phone
// has no room to float it over the page. At >=1024px it floats under the
// button (theme: .vip-multi-panel).
function MultiSelectFilter({ label, options, selected, onChange, allLabel }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const picked = new Set(selected)
  const chosen = options.filter((o) => picked.has(o.value))
  const summary = chosen.length === 0 ? allLabel : chosen.length === 1 ? chosen[0].label : `${chosen.length} selected`

  function toggle(value) {
    const next = new Set(picked)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value))
  }

  return (
    <div className="vip-multi" ref={rootRef}>
      <button
        type="button"
        className={chosen.length ? 'vip-multi-btn vip-multi-on' : 'vip-multi-btn'}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="vip-multi-text">{summary}</span>
        <svg className="vip-multi-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="vip-multi-panel" id={panelId} role="group" aria-label={label}>
          {options.map((o) => (
            <label key={o.value} className="vip-check vip-multi-opt">
              <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
          {chosen.length > 0 && (
            <button type="button" className="vip-action-close vip-multi-clear" onClick={() => onChange([])}>
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default MultiSelectFilter
