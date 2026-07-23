import SiteSearchOrCreate from '../components/SiteSearchOrCreate'

// Temporary, unprotected page for visually checking SiteSearchOrCreate.
// Remove once confirmed working — not part of the real app flow.
function DevSiteSearchTest() {
  return (
    <main style={{ padding: 24 }}>
      <h1>SiteSearchOrCreate — dev check</h1>
      <SiteSearchOrCreate onSelect={(s) => console.log('onSelect', s)} />
    </main>
  )
}

export default DevSiteSearchTest
