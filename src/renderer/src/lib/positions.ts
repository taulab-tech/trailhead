/** "2024-03" → "Mar 2024". */
export function formatSince(since: string): string {
  const [year, month] = since.split('-').map(Number)
  if (!year || !month) return since
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}
