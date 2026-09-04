// Caps an already-fully-loaded list to `shown` of `total` rows and reveals
// more IN PLACE on click, chunk by chunk — for a list that is already the
// deepest view (a drill-down body, or a card with nowhere further to send
// "View all"). Unlike ClosureForecastCard's own "+N more · View all" (which
// navigates to a deeper panel), there's no deeper place to send this one, so
// it grows the same list instead.
function ShowMoreRows({ shown, total, noun, onShowMore }) {
  if (total <= shown) return null
  return (
    <button type="button" className="vip-dd-more-row" onClick={onShowMore}>
      +{total - shown} more {noun}
    </button>
  )
}

export default ShowMoreRows
