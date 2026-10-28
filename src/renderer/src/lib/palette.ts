// Categorical palette for light surfaces, fixed order — never cycled beyond 8
// slots. Muted, evenly weighted hues so no single category shouts; each step
// keeps at least 3:1 contrast against the white card background.
export const CATEGORICAL = [
  '#2f6b9a', // steel blue
  '#2e7d5b', // green
  '#b5683a', // copper
  '#6f56a0', // violet
  '#a87b1e', // ochre
  '#2a8584', // teal
  '#a34e6e', // berry
  '#4f6d7a' // slate
]

export const CATEGORICAL_FALLBACK = '#8a948f'

export function colorForIndex(i: number): string {
  return i < CATEGORICAL.length ? CATEGORICAL[i] : CATEGORICAL_FALLBACK
}
