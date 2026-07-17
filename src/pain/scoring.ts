export type PhraseEntry = { readonly phrase: string; readonly weight: number; readonly workaround: boolean }

export const SHARED_PHRASES = [
  { phrase: 'would pay', weight: 1.0, workaround: false },
  { phrase: "i'd pay", weight: 1.0, workaround: false },
  { phrase: 'is there a tool', weight: 0.85, workaround: false },
  { phrase: 'does anyone know of', weight: 0.85, workaround: false },
  { phrase: 'use a spreadsheet', weight: 0.90, workaround: true },
  { phrase: 'manually', weight: 0.90, workaround: true },
  { phrase: 'i wish there was', weight: 0.65, workaround: false },
  { phrase: 'someone should build', weight: 0.65, workaround: false },
  { phrase: 'frustrated with', weight: 0.55, workaround: false },
  { phrase: 'hate that', weight: 0.55, workaround: false },
] as const satisfies readonly PhraseEntry[]

export const DEV_TO_PHRASES = [
  { phrase: 'struggle with', weight: 0.55, workaround: false },
  { phrase: 'we had to manually', weight: 0.90, workaround: true },
  { phrase: 'before i built', weight: 0.65, workaround: false },
  { phrase: 'painful', weight: 0.55, workaround: false },
] as const satisfies readonly PhraseEntry[]

export function patternWeight(pattern: string): number {
  const p = pattern.toLowerCase()
  if (p.includes('alternative to')) return 0.9
  if (p.includes('without')) return 0.8
  if (p.includes('for')) return 0.75
  return 0.3
}

/**
 * Anchor roots for a term: one lowercase root per token, with common suffixes
 * stripped so "invoicing" also anchors on "invoice"/"invoices" in the text.
 * A root shorter than 4 chars falls back to the full token ("api", "crm").
 */
export function anchorRoots(term: string): string[] {
  return term
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((token) => {
      for (const suffix of ['ing', 'es', 's']) {
        if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
          return token.slice(0, token.length - suffix.length)
        }
      }
      return token
    })
}

export function scorePhrase(
  text: string,
  term: string,
  extraPhrases?: readonly PhraseEntry[],
): { matched_phrase: string; weight: number; workaround_detected: boolean } | null {
  const lower = text.toLowerCase()
  const roots = anchorRoots(term)

  const termPositions: number[] = []
  for (const root of roots) {
    let seek = 0
    while (seek < lower.length) {
      const idx = lower.indexOf(root, seek)
      if (idx === -1) break
      termPositions.push(idx)
      seek = idx + 1
    }
  }
  if (termPositions.length === 0) return null

  const phrases: readonly PhraseEntry[] = extraPhrases != null ? [...SHARED_PHRASES, ...extraPhrases] : SHARED_PHRASES

  let best: { matched_phrase: string; weight: number; workaround_detected: boolean } | null = null

  for (const entry of phrases) {
    const lphrase = entry.phrase.toLowerCase()
    let ppos = 0
    while (ppos < lower.length) {
      const pidx = lower.indexOf(lphrase, ppos)
      if (pidx === -1) break
      const minDist = Math.min(...termPositions.map((t) => Math.abs(pidx - t)))
      if (minDist <= 150 && (best === null || entry.weight > best.weight)) {
        best = { matched_phrase: entry.phrase, weight: entry.weight, workaround_detected: entry.workaround }
      }
      ppos = pidx + 1
    }
  }

  return best
}

export function parseRisingValue(v: number): number {
  if (!isFinite(v) || v < 0) return 0
  if (v >= 5000) return 1.0
  return Math.min(v / 300, 1.0)
}

export function opportunityScore(input: {
  keywordSignal: number
  trendVelocity: number
  painDepth: number
  workaroundDetected: boolean
}): {
  score: number
  breakdown: {
    keyword_signal: number
    trend_velocity: number
    pain_depth: number
    workaround_bonus_applied: boolean
  }
} {
  const effectivePainDepth = input.workaroundDetected ? input.painDepth * 1.2 : input.painDepth
  const keyword_signal = input.keywordSignal * 0.35
  const trend_velocity = input.trendVelocity * 0.25
  const pain_depth = effectivePainDepth * 0.40
  const score = Math.min(Math.max(keyword_signal + trend_velocity + pain_depth, 0), 1)
  return {
    score,
    breakdown: { keyword_signal, trend_velocity, pain_depth, workaround_bonus_applied: input.workaroundDetected },
  }
}
