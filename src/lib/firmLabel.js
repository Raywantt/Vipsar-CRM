// One place decides how a party's firm reads, so a linked firm and a legacy
// text one can't render differently in different lists.
//
// The fallback is load-bearing but also a trap worth knowing: it masked a real
// bug while the firm embed was silently returning nothing, because the legacy
// firm_name happened to match. Any future change to how .firm is resolved must
// be re-verified against an architect whose firm_name and linked firm DIFFER —
// equal values cannot tell the two sources apart.
//
// Lives in lib (it used to be exported from PartySearchOrCreate.jsx) so pure
// modules like architectStats.js can use it without importing a component.
export function firmLabel(party) {
  return party?.firm?.name ?? party?.firm_name ?? null
}
