const YEAR_SUFFIX = /\s+(19|20)\d{2}$/

/**
 * Groups recurring offerings of the same course/event together — importer.ts
 * deliberately names each year's offering distinctly ("GE431 2023",
 * "GE431 2024", "Agtech Hackathon 2025", …) so they don't merge into a single
 * event record. Stripping that trailing year back off recovers the shared
 * series identity ("GE431", "Agtech Hackathon") for display grouping.
 */
export function seriesKeyFor(eventName: string): string {
  const stripped = eventName.replace(YEAR_SUFFIX, '').trim()
  return stripped || eventName
}
