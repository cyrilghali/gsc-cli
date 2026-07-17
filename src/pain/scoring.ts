// `pattern` is a case-insensitive regex source. Live comments phrase pain with
// interleaved words and inflections ("would happily pay", "frustrating") that
// exact n-grams never hit — the probe measured a 0/14 exact-match rate on
// comments that Algolia's AND-query had already pre-selected for those words.
export type PhraseEntry = { readonly pattern: string; readonly weight: number; readonly workaround: boolean }

export const SHARED_PHRASES = [
  { pattern: "(?:would|'d) (?:\\w+ ){0,2}pay", weight: 1.0, workaround: false },
  { pattern: '(?:happy|willing) to pay', weight: 1.0, workaround: false },
  { pattern: 'is there (?:a|an|any) (?:\\w+ )?(?:tool|app|service|saas)', weight: 0.85, workaround: false },
  { pattern: 'does anyone know of', weight: 0.85, workaround: false },
  { pattern: 'spreadsheets?', weight: 0.8, workaround: true },
  { pattern: 'manual(?:ly| process)', weight: 0.9, workaround: true },
  { pattern: 'wish there (?:was|were)', weight: 0.65, workaround: false },
  { pattern: 'someone should (?:build|make)', weight: 0.65, workaround: false },
  { pattern: 'frustrat(?:ed|ing)', weight: 0.55, workaround: false },
  { pattern: 'hate (?:that|how)', weight: 0.55, workaround: false },
] as const satisfies readonly PhraseEntry[]

export const DEV_TO_PHRASES = [
  { pattern: 'struggl(?:e|ed|ing)', weight: 0.55, workaround: false },
  { pattern: 'had to manually', weight: 0.9, workaround: true },
  { pattern: 'before i built', weight: 0.65, workaround: false },
  { pattern: 'painful', weight: 0.55, workaround: false },
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
    const re = new RegExp(entry.pattern, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(lower)) !== null) {
      const pidx = m.index
      const minDist = Math.min(...termPositions.map((t) => Math.abs(pidx - t)))
      if (minDist <= 150 && (best === null || entry.weight > best.weight)) {
        best = { matched_phrase: m[0], weight: entry.weight, workaround_detected: entry.workaround }
      }
      if (m.index === re.lastIndex) re.lastIndex++
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
