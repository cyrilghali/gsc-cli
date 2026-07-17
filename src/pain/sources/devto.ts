import { CliError } from '../../config.ts'
import { scorePhrase, DEV_TO_PHRASES } from '../scoring.ts'
import type { PainSignal } from '../signal.ts'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface DevtoArticle {
  url: string
  title: string
  description: string | null
  published_at: string | null
  created_at: string | null
}

async function fetchDevto(url: string): Promise<Response> {
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
        throw new CliError('devto: HTTP 429')
      }
      if (!res.ok) throw new CliError(`devto: HTTP ${res.status}`)
      return res
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliError('devto: request timed out (30 s).', 'Check your connection.')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
  throw new CliError('devto: unexpected state after retry')
}

export async function mineDevto(term: string): Promise<PainSignal[]> {
  const slug = term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const url = `https://dev.to/api/articles?per_page=100&tag=${encodeURIComponent(slug)}`

  const res = await fetchDevto(url)

  let data: unknown
  try {
    data = JSON.parse(await res.text())
  } catch {
    throw new CliError('devto: could not parse response JSON.')
  }

  if (!Array.isArray(data)) {
    throw new CliError('devto: response is not an array.')
  }

  const articles = data as DevtoArticle[]
  const signals: PainSignal[] = []

  for (const article of articles) {
    const text = article.title + ' ' + (article.description ?? '')
    const scored = scorePhrase(text, term, DEV_TO_PHRASES)
    if (scored === null) continue
    const desc = article.description ?? ''
    signals.push({
      source: 'devto',
      term,
      url: article.url,
      story_title: article.title,
      excerpt: desc.slice(0, 300),
      matched_phrase: scored.matched_phrase,
      weight: scored.weight,
      workaround_detected: scored.workaround_detected,
      created_at: article.published_at ?? article.created_at ?? '',
    })
  }

  return signals
}
