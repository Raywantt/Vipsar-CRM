// A small tag for a card or section that shows the pipeline as it is TODAY while
// the page is stepped back to a past period. Those cards (Needs attention,
// Closure forecast, Pipeline by stage, Leads by area / site stage / product,
// Why we lose) read the current state of every lead; the CRM keeps no history of
// it, so last month's pipeline can't be redrawn. Without a tag, a card that
// doesn't change when you step back looks broken — or, worse, gets read as last
// month's figure.
//
// One definition, so the wording can't drift between the screens that use it.
function SnapshotTag() {
  return <span className="vip-snapshot-tag">Snapshot · as of today</span>
}

export default SnapshotTag
