// PostgREST's .or() filter string uses "," to separate conditions and "()"
// to group them, and ILIKE treats "%"/"_" as wildcards — strip all of them
// so a search term can never be misread as filter syntax.
export function sanitizeForIlike(term) {
  return term.replace(/[%_,()]/g, '')
}
