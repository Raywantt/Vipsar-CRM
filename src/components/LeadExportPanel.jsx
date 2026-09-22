import { useEffect, useRef, useState } from 'react'
import {
  buildLeadExport,
  DEFAULT_EXPORT_COLUMN_IDS,
  EXPORT_COLUMN_GROUPS,
  EXPORT_COLUMNS,
  exportFileName,
  extrasNeededFor,
  normaliseColumnIds,
} from '../lib/leadExport'
import { fetchExportExtras, fetchLeadsForExport } from '../lib/leadExportQueries'
import { buildLeadExportBlob, saveBlob } from '../lib/leadExportFile'
import { errorMessage } from '../lib/errorMessage'

// All Leads' "Download Excel" column picker (owner only, desktop only — see
// roles.js's canExportLeads). A slide-over reusing the drill-down panel's
// chrome, the same way Lead Detail puts its edit forms in one. Every column is
// a checkbox; the file holds the ticked ones in the order listed here.

// The last set used is remembered on this computer — a per-viewer
// convenience, so browser storage is right for it (and it fails soft: a
// private window or blocked storage just means starting from the defaults).
const COLUMNS_STORAGE_KEY = 'vip-export-columns:leads'

function readRememberedColumns() {
  try {
    const ids = normaliseColumnIds(JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) ?? 'null'))
    return ids.length ? ids : DEFAULT_EXPORT_COLUMN_IDS
  } catch {
    return DEFAULT_EXPORT_COLUMN_IDS
  }
}

function rememberColumns(ids) {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Storage blocked — the choice simply isn't remembered.
  }
}

// `listParams` is exactly what the list's own page was fetched with, so the
// file holds the same leads as the screen. `onDone(count)` fires once the
// download has been handed to the browser.
function LeadExportPanel({ totalCount, listParams, filterSummary, exportedBy, onClose, onDone }) {
  const [selected, setSelected] = useState(readRememberedColumns)
  const [working, setWorking] = useState(null)
  const [error, setError] = useState(null)
  // Closing the panel mid-export abandons it: the fetch finishes quietly and
  // nothing is downloaded.
  // Reset on (re)mount — StrictMode's dev double-mount runs the cleanup once
  // before the real mount, which would otherwise abandon every download.
  const abandoned = useRef(false)
  useEffect(() => {
    abandoned.current = false
    return () => {
      abandoned.current = true
    }
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selectedSet = new Set(selected)
  const toggle = (id) => setSelected((ids) => normaliseColumnIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  async function handleDownload() {
    const columnIds = normaliseColumnIds(selected)
    setError(null)
    setWorking(`Fetching ${totalCount.toLocaleString('en-IN')} lead${totalCount === 1 ? '' : 's'}…`)
    try {
      const { data, error: fetchError } = await fetchLeadsForExport(listParams)
      if (abandoned.current) return
      if (fetchError) throw fetchError

      const { failed, ...extras } = await fetchExportExtras(data.leads, extrasNeededFor(columnIds), (label) => {
        if (!abandoned.current) setWorking(`Fetching ${label}…`)
      })
      if (abandoned.current) return

      setWorking('Building the spreadsheet…')
      const now = new Date()
      const sheets = buildLeadExport({
        leads: data.leads,
        columnIds,
        extras,
        origin: window.location.origin,
        filterSummary,
        exportedBy,
        exportedAt: now,
        searchCapped: data.searchCapped,
        failed,
      })
      const blob = await buildLeadExportBlob(sheets)
      if (abandoned.current) return

      saveBlob(blob, exportFileName(filterSummary, now))
      rememberColumns(columnIds)
      onDone(data.leads.length)
    } catch (e) {
      if (abandoned.current) return
      setError(errorMessage(e))
      setWorking(null)
    }
  }

  const activeFilters = filterSummary.filter((f) => f.active)
  const busy = working != null

  return (
    <>
      <div className="vip-dd-backdrop" onClick={onClose} />
      <div className="vip-dd-panel vip-export-panel" role="dialog" aria-modal="true" aria-labelledby="vip-export-title">
        <div className="vip-dd-head">
          <div className="vip-dd-head-text">
            <span className="vip-dd-eyebrow">Download Excel</span>
            <h2 className="vip-dd-title" id="vip-export-title">
              Choose columns for {totalCount.toLocaleString('en-IN')} lead{totalCount === 1 ? '' : 's'}
            </h2>
            <p className="vip-dd-note">
              {activeFilters.length
                ? activeFilters.map((f) => `${f.label}: ${f.value}`).join(' · ')
                : 'All leads — no filters set.'}
            </p>
          </div>
          <button type="button" className="vip-dd-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="vip-export-tools">
          <span className="vip-card-note">
            {selected.length} of {EXPORT_COLUMNS.length} columns
          </span>
          <span className="vip-export-tools-links">
            <button type="button" className="vip-btn-link" disabled={busy} onClick={() => setSelected(EXPORT_COLUMNS.map((c) => c.id))}>
              Select all
            </button>
            <button type="button" className="vip-btn-link" disabled={busy} onClick={() => setSelected([])}>
              Clear
            </button>
            <button type="button" className="vip-btn-link" disabled={busy} onClick={() => setSelected(DEFAULT_EXPORT_COLUMN_IDS)}>
              Reset to default
            </button>
          </span>
        </div>

        <fieldset className="vip-lock vip-export-groups" disabled={busy}>
          {EXPORT_COLUMN_GROUPS.map((group) => (
            <div key={group.id} className="vip-export-group">
              <span className="vip-fact-label">{group.label}</span>
              <div className="vip-export-grid">
                {EXPORT_COLUMNS.filter((c) => c.group === group.id).map((c) => (
                  <label key={c.id} className="vip-check">
                    <input type="checkbox" checked={selectedSet.has(c.id)} onChange={() => toggle(c.id)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>

        <div className="vip-export-foot">
          {error && (
            <p className="vip-error" role="alert">
              {error}
            </p>
          )}
          {working && (
            <p className="vip-form-note" role="status">
              {working}
            </p>
          )}
          <div className="vip-btn-row">
            <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="vip-btn vip-btn-sm" disabled={busy || selected.length === 0} onClick={handleDownload}>
              {busy ? 'Preparing…' : selected.length === 0 ? 'Pick at least one column' : `Download ${selected.length} column${selected.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default LeadExportPanel
