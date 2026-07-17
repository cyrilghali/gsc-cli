import { slugify } from '../../cli-util.ts'
import { CliError } from '../../config.ts'
import { fetchSource } from '../http.ts'
import { scorePhrase, DEV_TO_PHRASES } from '../scoring.ts'
import type { PainSignal } from '../signal.ts'

interface DevtoArticle {
  url: string
  title: string
  description: string | null
  published_at: string | null
  created_at: string | null
}

export async function mineDevto(term: string): Promise<PainSignal[]> {
  const url = `https://dev.to/api/articles?per_page=100&tag=${encodeURIComponent(slugify(term))}`

  const res = await fetchSource(url, 'devto')

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
    const desc = article.description ?? ''
    const scored = scorePhrase(article.title + ' ' + desc, term, DEV_TO_PHRASES)
    if (scored === null) continue
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
