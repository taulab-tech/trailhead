/**
 * Jaro-Winkler string similarity, implemented locally so the matching engine
 * has zero external/network dependencies. Returns a score from 0 (no match)
 * to 1 (identical).
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1
  const aMatches = new Array(a.length).fill(false)
  const bMatches = new Array(b.length).fill(false)

  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0

  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  transpositions = Math.floor(transpositions / 2)

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3

  let prefix = 0
  const maxPrefix = Math.min(4, a.length, b.length)
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++

  return jaro + prefix * 0.1 * (1 - jaro)
}

/**
 * Compares two "First Last" style names token-by-token (order independent)
 * so "John Smith" vs "Smith John" or minor typos still score highly.
 */
export function nameSimilarity(nameA: string, nameB: string): number {
  if (!nameA || !nameB) return 0
  if (nameA === nameB) return 1

  const tokensA = nameA.split(' ').filter(Boolean)
  const tokensB = nameB.split(' ').filter(Boolean)
  if (tokensA.length === 0 || tokensB.length === 0) return 0

  // Whole-string similarity, plus best-effort token alignment average.
  const wholeScore = jaroWinkler(nameA, nameB)

  let tokenTotal = 0
  const used = new Set<number>()
  for (const tokenA of tokensA) {
    let best = 0
    let bestIdx = -1
    tokensB.forEach((tokenB, idx) => {
      if (used.has(idx)) return
      const score = jaroWinkler(tokenA, tokenB)
      if (score > best) {
        best = score
        bestIdx = idx
      }
    })
    if (bestIdx >= 0) used.add(bestIdx)
    tokenTotal += best
  }
  const tokenScore = tokenTotal / Math.max(tokensA.length, tokensB.length)

  return Math.max(wholeScore, tokenScore)
}
