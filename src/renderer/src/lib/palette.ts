// Validated categorical palette (dark-surface steps), fixed order — never cycled
// beyond 8 slots. See the dataviz skill's palette.md for the light-mode values
// and validation methodology; this app is dark-theme only.
export const CATEGORICAL_DARK = [
  '#3987e5', // blue
  '#008300', // green
  '#d55181', // magenta
  '#c98500', // yellow
  '#199e70', // aqua
  '#d95926', // orange
  '#9085e9', // violet
  '#e66767' // red
]

export const CATEGORICAL_FALLBACK = '#5a5f6d'

export function colorForIndex(i: number): string {
  return i < CATEGORICAL_DARK.length ? CATEGORICAL_DARK[i] : CATEGORICAL_FALLBACK
}
