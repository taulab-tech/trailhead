/**
 * Splits a job headline into title and organisation where it says so:
 * "Electrical Engineer at NORTHWIND", "Co-Founder and CTO @ KeenSite".
 * Anything else ("CTO of KeenSite", "Mechanical Engineer-in-Training") is
 * left whole, since "of"/"in" don't reliably separate a title from a place.
 */
export function splitHeadline(headline: string): { title: string; org: string | null } {
  const match = headline.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i) ?? headline.match(/^(.+?)\s*@\s*(.+)$/)
  return match ? { title: match[1].trim(), org: match[2].trim() } : { title: headline.trim(), org: null }
}

/** The title and organisation to suggest for a profile: split from its headline, else its latest experience. */
export function suggestedPosition(c: { headline: string | null; experience: string | null }): {
  title: string
  org: string
} {
  const split = c.headline ? splitHeadline(c.headline) : null
  return { title: split?.title ?? '', org: split?.org ?? c.experience ?? '' }
}

/**
 * A result safe to pre-select for one-click approval: exactly one profile
 * mentions the institution, it has a job title, and its name carries the
 * student's last name. Anything less certain is left for the user to choose.
 */
export function strongMatch<
  C extends { name: string; headline: string | null; institutionMatch: string | null }
>(candidates: C[], lastName: string): C | null {
  const withInstitution = candidates.filter((c) => c.institutionMatch)
  if (withInstitution.length !== 1) return null
  const [match] = withInstitution
  if (!match.headline) return null
  const last = lastName.trim().toLowerCase()
  return last && match.name.toLowerCase().includes(last) ? match : null
}
