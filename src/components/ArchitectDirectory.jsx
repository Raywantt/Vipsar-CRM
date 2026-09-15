import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ShowMoreRows from './ShowMoreRows'
import {
  DEFAULT_DIRECTORY_SORT,
  DIRECTORY_SORTS,
  PORTFOLIO_ALL,
  PORTFOLIO_NONE,
  filterDirectoryRows,
  sortDirectoryRows,
} from '../lib/architectNetwork'
import { lastMetLabel } from '../lib/architectStats'
import { formatCurrencyCompact } from '../lib/format'

const PAGE = 50

// Header cells, in column order. `sort` names the DIRECTORY_SORTS key a click
// applies; every column is sortable. Each sort has one fixed direction (numbers
// high→low, names A→Z) — a second click doesn't reverse it, which keeps the
// header and the phone's sort dropdown one and the same control.
const COLUMNS = [
  { key: 'name', label: 'Architect', sort: 'name' },
  { key: 'firm', label: 'Firm', sort: 'firm' },
  { key: 'portfolio', label: 'Portfolio', sort: null },
  { key: 'met', label: 'Last meeting', sort: 'met' },
  { key: 'referred', label: 'Leads', sort: 'referred', num: true },
  { key: 'open', label: 'Open', sort: 'open', num: true },
  { key: 'won', label: 'Won', sort: 'won', num: true },
]

// The company-wide architect directory on Architect Network's Architects tab
// (BDM.md Step 6). Owner's ruling: a table with search and a portfolio filter,
// firm as a column, sortable, all-time figures. 214 architects at build time,
// which is why this is a table rather than My Architects' firm cards.
//
// One DOM for both widths, the Top 5 card's pattern: a grid table with a
// header row from 1024px; below that each row wraps to a name line and a
// figures line, each figure carrying its own unit word, and the sort moves
// into a dropdown (the header is hidden). Both read the same `sort` state.
//
// `rows` are buildDirectoryRows(...) (src/lib/architectNetwork.js); a row's
// figures match that architect's profile page.
function ArchitectDirectory({ rows, bdms, loading, error }) {
  const [term, setTerm] = useState('')
  const [portfolio, setPortfolio] = useState(PORTFOLIO_ALL)
  const [sort, setSort] = useState(DEFAULT_DIRECTORY_SORT)
  const [shown, setShown] = useState(PAGE)

  const visible = useMemo(
    () => sortDirectoryRows(filterDirectoryRows(rows ?? [], { term, portfolio }), sort),
    [rows, term, portfolio, sort]
  )
  const withBdm = (rows ?? []).filter((r) => r.bdmId != null).length

  // Any change to what's listed starts the list from the top again.
  function update(setter) {
    return (value) => {
      setter(value)
      setShown(PAGE)
    }
  }

  return (
    <div className="vip-card">
      <div className="vip-net-dir-toolbar">
        <label className="vip-field vip-net-dir-search">
          <span className="vip-sr-only">Search architects by name, firm or mobile</span>
          <input
            className="vip-input"
            type="search"
            value={term}
            onChange={(e) => update(setTerm)(e.target.value)}
            placeholder="Search name, firm or mobile"
          />
        </label>
        <label className="vip-field vip-net-dir-filter">
          <span className="vip-sr-only">Portfolio</span>
          <select className="vip-select" value={portfolio} onChange={(e) => update(setPortfolio)(e.target.value)}>
            <option value={PORTFOLIO_ALL}>All architects</option>
            {bdms.map((b) => (
              <option key={b.id} value={String(b.id)}>
                With {b.name}
              </option>
            ))}
            <option value={PORTFOLIO_NONE}>Not with a BDM</option>
          </select>
        </label>
        <label className="vip-field vip-net-dir-filter vip-only-mobile">
          <span className="vip-sr-only">Sort by</span>
          <select className="vip-select" value={sort} onChange={(e) => update(setSort)(e.target.value)}>
            {DIRECTORY_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows && (
        <p className="vip-net-dir-count">
          {visible.length === rows.length
            ? `${rows.length} architects · ${withBdm} with a BDM`
            : `${visible.length} of ${rows.length} architects`}
        </p>
      )}

      {error ? (
        <p className="vip-error" role="alert">
          {error}
        </p>
      ) : loading || !rows ? (
        <p className="vip-empty">Loading architects…</p>
      ) : visible.length === 0 ? (
        <p className="vip-empty">No architects match.</p>
      ) : (
        <div className="vip-net-dir" role="table" aria-label="Architects">
          <div className="vip-net-dir-row vip-net-dir-headrow" role="row">
            {COLUMNS.map((c) => (
              <span
                key={c.key}
                role="columnheader"
                className={c.num ? 'vip-net-dir-num' : undefined}
                aria-sort={c.sort && c.sort === sort ? (c.num || c.sort === 'met' ? 'descending' : 'ascending') : undefined}
              >
                {c.sort ? (
                  <button
                    type="button"
                    className={c.sort === sort ? 'vip-net-dir-sort vip-active' : 'vip-net-dir-sort'}
                    onClick={() => update(setSort)(c.sort)}
                  >
                    {c.label}
                  </button>
                ) : (
                  c.label
                )}
              </span>
            ))}
          </div>

          {visible.slice(0, shown).map((r) => (
            <Link key={r.id} to={`/architects/${r.id}`} className="vip-net-dir-row" role="row">
              <span role="cell" className="vip-net-dir-name">
                {r.name}
              </span>
              <span role="cell" className={r.firm ? 'vip-net-dir-firm' : 'vip-net-dir-firm vip-net-dir-blank'}>
                {r.firm ?? '—'}
              </span>
              <span role="cell">
                {r.bdmName ? (
                  <span className="vip-portfolio-tag vip-net-dir-tag">With {r.bdmName}</span>
                ) : (
                  <span className="vip-net-dir-none">Not with a BDM</span>
                )}
              </span>
              <span role="cell" className="vip-net-dir-met">
                {lastMetLabel(r.lastMetDays)}
              </span>
              <span role="cell" className="vip-net-dir-num">
                <b>{r.referred}</b>
                <span className="vip-net-dir-unit"> {r.referred === 1 ? 'lead' : 'leads'}</span>
              </span>
              <span role="cell" className={r.openValue ? 'vip-net-dir-num' : 'vip-net-dir-num vip-net-dir-blank'}>
                <b>{r.openValue ? formatCurrencyCompact(r.openValue) : '—'}</b>
                <span className="vip-net-dir-unit"> open</span>
              </span>
              <span role="cell" className={r.wonValue ? 'vip-net-dir-num' : 'vip-net-dir-num vip-net-dir-blank'}>
                <b>{r.wonValue ? formatCurrencyCompact(r.wonValue) : '—'}</b>
                <span className="vip-net-dir-unit"> won</span>
              </span>
            </Link>
          ))}
          <ShowMoreRows
            shown={Math.min(shown, visible.length)}
            total={visible.length}
            noun="architects"
            onShowMore={() => setShown((n) => n + PAGE)}
          />
        </div>
      )}
    </div>
  )
}

export default ArchitectDirectory
