import { CliError } from '../../config.ts'
import { scorePhrase } from '../scoring.ts'
import type { PainSignal } from '../signal.ts'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface HnHit {
  objectID: string
  comment_text: string | null
  story_title: string | null
  created_at: string
}

interface HnResponse {
  hits: HnHit[]
}

async function fetchHn(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const res = await fetch(url, { signal: ac.signal })
      if (res.status === 429) {
        if (attempt === 0) {
          await sleep(1000)
          continue
        }
        throw new CliError('hn: HTTP 429')
      }
      if (!res.ok) throw new CliError(`hn: HTTP ${res.status}`)
      return res
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliError('hn: request timed out (30 s).', 'Check your connection.')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
  throw new CliError('hn: unexpected state after retry')
}

/**
 * Query probes paired with the term. Topical comments carry pain phrases at a
 * ~1% base rate, so a bare-term query yields nothing; each probe is an
 * unquoted AND-query (term + probe words) that pre-selects candidate comments,
 * which scorePhrase then validates with anchored matching.
 */
const QUERY_PROBES = [
  'would pay',
  'is there a tool',
  'wish there was',
  'spreadsheet',
  'manually',
  'frustrated',
] as const

export async function mineHn(term: string, days: number): Promise<PainSignal[]> {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400
  const seen = new Map<string, HnHit>()

  for (let i = 0; i < QUERY_PROBES.length; i++) {
    if (i > 0) await sleep(150)
    const url =
      `https://hn.algolia.com/api/v1/search` +
      `?tags=comment` +
      `&query=${encodeURIComponent(`${term} ${QUERY_PROBES[i]}`)}` +
      `&hitsPerPage=20` +
      `&numericFilters=created_at_i>${cutoff}`

    const res = await fetchHn(url)

    let data: unknown
    try {
      data = JSON.parse(await res.text())
    } catch {
      throw new CliError('hn: could not parse response JSON.')
    }

    if (
      data === null ||
      typeof data !== 'object' ||
      !Array.isArray((data as Record<string, unknown>).hits)
    ) {
      throw new CliError('hn: response missing hits array.')
    }

    for (const hit of (data as HnResponse).hits) {
      if (!seen.has(hit.objectID)) seen.set(hit.objectID, hit)
    }
  }

  const hits = [...seen.values()]
  const signals: PainSignal[] = []

  for (const hit of hits) {
    const text = hit.comment_text ?? ''
    const scored = scorePhrase(text, term)
    if (scored === null) continue
    const stripped = text.replace(/<[^>]*>/g, '')
    signals.push({
      source: 'hn',
      term,
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      story_title: hit.story_title ?? '',
      excerpt: stripped.slice(0, 300),
      matched_phrase: scored.matched_phrase,
      weight: scored.weight,
      workaround_detected: scored.workaround_detected,
      created_at: hit.created_at,
    })
  }

  return signals
}
