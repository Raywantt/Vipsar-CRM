import { useMemo, useState } from 'react'
import ShowMoreRows from './ShowMoreRows'
import { DEFAULT_FIRM_SORT, FIRM_SORTS, filterFirmRows, sortFirmRows } from '../lib/architectNetwork'
import { lastMetLabel } from '../lib/architectStats'
import { formatCurrencyCompact } from '../lib/format'

const PAGE = 50

// Header cells, in column order — same shape as ArchitectDirectory's COLUMNS
// (every column sortable, one fixed direction per sort).
const COLUMNS = [
  { key: 'name', label: 'Firm', sort: 'name' },
  { key: 'architects', label: 'Architects', sort: 'architects', num: true },
  { key: 'referred', label: 'Leads', sort: 'referred', num: true },
  { key: 'open', label: 'Open', sort: 'open', num: true },
  { key: 'won', label: 'Won', sort: 'won', num: true },
  { key: 'winRate', label: 'Win rate', sort: 'winRate', num: true },
  { key: 'met', label: 'Last meeting', sort: 'met' },
]

// Architect Network's Firms tab — one row per firm, rolling up every
// architect at it (src/lib/architectNetwork.js's buildFirmRows). No portfolio
// filter here: a BDM's portfolio tags architects, not firms.
//
// Rows aren't links — there's no /firms/:id page anywhere in this app (the
// same "read-only, no detail route" shape Search's Site results already
// follow), so a firm here is a rollup to read, not a page to open.
//
// The sort dropdown shows at every width, same as ArchitectDirectory's —
// below 1024px it's the only way to sort (the header row is hidden); at
// 1024px+ it sits beside the clickable column headers, both reading the one
// `sort` state below.
function FirmDirectory({ rows, loading, error }) {
  const [term, setTerm] = useState('')
  const [sort, setSort] = useState(DEFAULT_FIRM_SORT)
  const [shown, setShown] = useState(PAGE)

  const visible = useMemo(() => sortFirmRows(filterFirmRows(rows ?? [], term), sort), [rows, term, sort])

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
          <span className="vip-sr-only">Search firms by name</span>
          <input
            className="vip-input"
            type="search"
            value={term}
            onChange={(e) => update(setTerm)(e.target.value)}
            placeholder="Search firm name"
          />
        </label>
        <label className="vip-field vip-net-dir-filter">
          <span className="vip-sr-only">Sort by</span>
          <select className="vip-select" value={sort} onChange={(e) => update(setSort)(e.target.value)}>
            {FIRM_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows && <p className="vip-net-dir-count">{visible.length === rows.length ? `${rows.length} firms` : `${visible.length} of ${rows.length} firms`}</p>}

      {error ? (
        <p className="vip-error" role="alert">
          {error}
        </p>
      ) : loading || !rows ? (
        <p className="vip-empty">Loading firms…</p>
      ) : visible.length === 0 ? (
        <p className="vip-empty">{rows.length === 0 ? 'No architect is linked to a firm yet.' : 'No firms match.'}</p>
      ) : (
        <div className="vip-net-dir" role="table" aria-label="Firms">
          <div className="vip-net-dir-row vip-net-firm-row vip-net-dir-headrow" role="row">
            {COLUMNS.map((c) => (
              <span
                key={c.key}
                role="columnheader"
                className={c.num ? 'vip-net-dir-num' : undefined}
                aria-sort={c.sort && c.sort === sort ? (c.num || c.sort === 'met' ? 'descending' : 'ascending') : undefined}
              >
                <button
                  type="button"
                  className={c.sort === sort ? 'vip-net-dir-sort vip-active' : 'vip-net-dir-sort'}
                  onClick={() => update(setSort)(c.sort)}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>

          {visible.slice(0, shown).map((r) => (
            <div key={r.key} className="vip-net-dir-row vip-net-firm-row" role="row">
              <span role="cell" className="vip-net-dir-name">
                {r.name}
              </span>
              <span role="cell" className="vip-net-dir-num">
                <b>{r.architectCount}</b>
                <span className="vip-net-dir-unit"> {r.architectCount === 1 ? 'architect' : 'architects'}</span>
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
              <span role="cell" className={r.winRate == null ? 'vip-net-dir-num vip-net-dir-blank' : 'vip-net-dir-num'}>
                <b>{r.winRate == null ? '—' : `${r.winRate}%`}</b>
                {r.winRate != null && <span className="vip-net-dir-unit"> ({r.wonCount}W · {r.lostCount}L)</span>}
              </span>
              <span role="cell" className="vip-net-dir-met">
                {lastMetLabel(r.lastMetDays)}
              </span>
            </div>
          ))}
          <ShowMoreRows shown={Math.min(shown, visible.length)} total={visible.length} noun="firms" onShowMore={() => setShown((n) => n + PAGE)} />
        </div>
      )}
    </div>
  )
}

export default FirmDirectory
