export function stageLabel(stage: number | null): string {
  if (stage === null) return 'Not part of funnel'
  if (stage === 1) return 'Entry'
  if (stage === 2) return 'Middle'
  if (stage === 3) return 'End'
  return `Stage ${stage}`
}

/** Label for the stop at `index` (0-based) along a trail of `total` stops: first is Entry, last is End. */
export function trailStopLabel(index: number, total: number): string {
  if (index === 0) return 'Entry'
  if (index === total - 1) return 'End'
  if (total === 3) return 'Middle'
  return `Stage ${index + 1}`
}
