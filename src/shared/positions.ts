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
