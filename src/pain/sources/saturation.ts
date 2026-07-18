import { sleep } from '../../cli-util.ts'
import { CliError } from '../../config.ts'
import { autocomplete } from '../../trends/api.ts'
import { anchorRoots } from '../scoring.ts'
import { fetchSource } from '../http.ts'

/**
 * Free saturation proxies for a term — how crowded is the market it names.
 *
 * - Autocomplete "{term} vs" / "{term} alternatives": Google only completes what
 *   people actually search; comparison and alternative queries exist in volume
 *   only around established incumbents. Measured 2026-07-18: "crm vs" fills all
 *   15 slots, "crm for dentists vs" fills none (Google drifts off-topic).
 * - Show HN launch density (Algolia, title-restricted): how many builders shipped
 *   into this space recently. Measured: crm 4128 / invoicing 42 / dental crm ~0
 *   over 24 months.
 *
 * Every raw completion or title passes containsAllRoots before counting —
 * Algolia's typo tolerance matches "mental" for "dental", and Autocomplete
 * pads short lists with unrelated queries.
 */

export interface ShowHnSample {
  title: string
  url: string
  created_at: string
}

export interface SaturationResult {
  term: string
  presence: number
  vs_count: number
  alternatives_count: number
  show_hn_count: number
  saturation: number
  accessibility: number
  breakdown: { vs: number; alternatives: number; show_hn: number }
  evidence: {
    vs_completions: string[]
    alternatives_completions: string[]
    show_hn_samples: ShowHnSample[]
  }
}

/**
 * True when every anchor root of `term` appears in `text` at a word start
 * (same left-boundary rule as scorePhrase, but ALL roots must match — a
 * completion about "dental office" without "crm" is not evidence for
 * "crm for dentists").
 */
export function containsAllRoots(text: string, term: string): boolean {
  const lower = text.toLowerCase()
  return anchorRoots(term).every((root) => {
    let seek = 0
    while (seek < lower.length) {
      const idx = lower.indexOf(root, seek)
      if (idx === -1) return false
      if (idx === 0 || !/[a-z0-9]/.test(lower[idx - 1])) return true
      seek = idx + 1
    }
    return false
  })
}

/**
 * Pure saturation formula. Normalization thresholds calibrated 2026-07-18 on
 * live probes (crm → 1.0, screenshot api → mid, dental crm → ~0): 10 relevant
 * completions saturate an autocomplete probe, 20 launches saturate Show HN.
 */
export function saturationScore(input: {
  vsCount: number
  alternativesCount: number
  showHnCount: number
}): { saturation: number; breakdown: { vs: number; alternatives: number; show_hn: number } } {
  const vs = Math.min(input.vsCount / 10, 1) * 0.3
  const alternatives = Math.min(input.alternativesCount / 10, 1) * 0.3
  const show_hn = Math.min(input.showHnCount / 20, 1) * 0.4
  return {
    saturation: Math.min(vs + alternatives + show_hn, 1),
    breakdown: { vs, alternatives, show_hn },
  }
}

interface HnStoryHit {
  objectID: string
  title: string | null
  created_at: string
}

async function countShowHn(term: string, days: number): Promise<{ count: number; samples: ShowHnSample[] }> {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400
  const url =
    `https://hn.algolia.com/api/v1/search` +
    `?tags=show_hn` +
    `&query=${encodeURIComponent(term)}` +
    `&restrictSearchableAttributes=title` +
    `&hitsPerPage=100` +
    `&numericFilters=created_at_i>${cutoff}`

  const res = await fetchSource(url, 'hn')

  let data: unknown
  try {
    data = JSON.parse(await res.text())
  } catch {
    throw new CliError('hn: could not parse response JSON.')
  }
  if (data === null || typeof data !== 'object' || !Array.isArray((data as Record<string, unknown>).hits)) {
    throw new CliError('hn: response missing hits array.')
  }

  const relevant = ((data as { hits: HnStoryHit[] }).hits).filter((h) =>
    containsAllRoots(h.title ?? '', term),
  )
  return {
    count: relevant.length,
    samples: relevant.slice(0, 5).map((h) => ({
      title: h.title ?? '',
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      created_at: h.created_at,
    })),
  }
}

export async function saturateTerm(term: string, days: number, geo: string): Promise<SaturationResult> {
  const own = await autocomplete(term, geo)
  await sleep(300)
  const vsRaw = await autocomplete(`${term} vs`, geo)
  await sleep(300)
  const altsRaw = await autocomplete(`${term} alternatives`, geo)
  await sleep(300)

  const presence = own.filter((c) => containsAllRoots(c, term)).length
  const vsCompletions = vsRaw.filter((c) => containsAllRoots(c, term) && /\bvs\b/.test(c.toLowerCase()))
  const altCompletions = altsRaw.filter(
    (c) => containsAllRoots(c, term) && c.toLowerCase().includes('alternative'),
  )

  const showHn = await countShowHn(term, days)

  const { saturation, breakdown } = saturationScore({
    vsCount: vsCompletions.length,
    alternativesCount: altCompletions.length,
    showHnCount: showHn.count,
  })

  return {
    term,
    presence,
    vs_count: vsCompletions.length,
    alternatives_count: altCompletions.length,
    show_hn_count: showHn.count,
    saturation,
    accessibility: Number((1 - saturation).toFixed(6)),
    breakdown,
    evidence: {
      vs_completions: vsCompletions,
      alternatives_completions: altCompletions,
      show_hn_samples: showHn.samples,
    },
  }
}
