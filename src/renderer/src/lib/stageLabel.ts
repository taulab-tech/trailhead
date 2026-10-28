export function stageLabel(stage: number | null): string {
  if (stage === null) return 'Not part of funnel'
  if (stage === 1) return 'Entry'
  if (stage === 2) return 'Middle'
  if (stage === 3) return 'End'
  return `Stage ${stage}`
}
