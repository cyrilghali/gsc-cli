import { sleep } from '../cli-util.ts'
import { CliError } from '../config.ts'

/**
 * Client for Google Trends' undocumented internal endpoints (the same ones the
 * trends.google.com UI calls). There is no official API, no auth: we mimic a
 * browser, grab an anonymous cookie, and strip the anti-JSON-hijacking prefix
 * (`)]}',`) that every response ships with. Expect the occasional 429 — Google
 * rate-limits these hard.
 */

const BASE = 'https://trends.google.com'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Google expects the timezone as an offset in minutes (UTC minus local). */
const tz = (): number => new Date().getTimezoneOffset()

let cachedCookie: string | undefined

/** Fetch an anonymous consent/NID cookie so the API endpoints stop 429-ing us. */
async function cookie(geo: string): Promise<string> {
  if (cachedCookie !== undefined) return cachedCookie
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 10_000)
    try {
      const res = await fetch(`${BASE}/trends/?geo=${encodeURIComponent(geo || 'US')}`, {
        headers: { 'User-Agent': UA },
        signal: ac.signal,
      })
      const raw = res.headers.get('set-cookie') ?? ''
      // Keep just the `name=value` pairs, drop Path/Domain/Expires attributes.
      cachedCookie = raw
        .split(/,(?=\s*\w+=)/)
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean)
        .join('; ')
    } finally {
      clearTimeout(timer)
    }
  } catch {
    cachedCookie = ''
  }
  return cachedCookie
}

/** Strip the `)]}',` prefix Google prepends, then parse. */
export function parseGuardedJson<T>(text: string): T {
  const start = text.indexOf('{')
  const arr = text.indexOf('[')
  const at = start === -1 ? arr : arr === -1 ? start : Math.min(start, arr)
  if (at === -1) throw new CliError('Google Trends returned an unrecognized response.')
  try {
    return JSON.parse(text.slice(at)) as T
  } catch {
    throw new CliError('Could not parse the Google Trends response.', 'Google may have changed their internal format.')
  }
}


const GEO_RE = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/

/**
 * Validate a geo code token (must already be uppercased). Empty string = worldwide, always allowed.
 * Throws CliError on invalid codes.
 */
export function validateGeo(geo: string): void {
  if (geo === '') return
  if (!GEO_RE.test(geo)) {
    throw new CliError(
      `Invalid geo code "${geo}".`,
      'Use a two-letter ISO 3166-1 country code (US, FR, GB…), optionally with a subdivision suffix (US-NY).',
    )
  }
}

async function fetchWithRetry(url: string, geo: string): Promise<string> {
  const backoff = [800, 2500, 5000]
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Cookie: await cookie(geo), 'Accept-Language': 'en-US' },
        signal: ac.signal,
      })
      if (res.status === 429) {
        if (attempt < backoff.length) {
          cachedCookie = undefined // a stale cookie is a common cause; fetch a fresh one on retry
          await sleep(backoff[attempt])
          continue
        }
        throw new CliError(
          'Google Trends rate-limited the request (429).',
          'These endpoints are unofficial and throttled. Wait a minute and retry, or narrow the query.',
        )
      }
      if (res.status === 400) throw new CliError('Google Trends rejected the request (HTTP 400).', 'The geo, keyword, or timeframe combination was rejected. Check your inputs.')
      if (!res.ok) throw new CliError(`Google Trends request failed (HTTP ${res.status}).`)
      return res.text()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliError('Google Trends request timed out (30 s).', 'Try again, or check your connection.')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}

async function getTrends(path: string, params: Record<string, string>, geo: string): Promise<string> {
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`
  return fetchWithRetry(url, geo)
}

export interface ComparisonItem {
  keyword: string
  geo: string
  time: string
}

interface Widget {
  id: string
  token: string
  request: Record<string, unknown> | null | undefined
}

/** Step 1 of the two-hop dance: exchange keywords for per-widget tokens. */
async function explore(items: ComparisonItem[], category: number): Promise<Widget[]> {
  const req = JSON.stringify({ comparisonItem: items, category, property: '' })
  const text = await getTrends('/trends/api/explore', { hl: 'en-US', tz: String(tz()), req }, items[0]?.geo ?? '')
  const data = parseGuardedJson<{ widgets: Widget[] }>(text)
  if (!data.widgets?.length) {
    throw new CliError('Google Trends returned no data for that query.', 'Try a broader keyword, timeframe, or geo.')
  }
  return data.widgets
}

async function widgetData<T>(kind: string, widget: Widget, geo: string): Promise<T> {
  if (widget.request == null) throw new CliError('Google Trends returned a malformed widget (no request payload).')
  const text = await getTrends(
    `/trends/api/widgetdata/${kind}`,
    { hl: 'en-US', tz: String(tz()), req: JSON.stringify(widget.request), token: widget.token },
    geo,
  )
  return parseGuardedJson<T>(text)
}

export interface TimelinePoint {
  time: string
  formattedTime: string
  value?: number[]
}

/**
 * Interest over time for prepared comparison items (each `value[]` index = one item,
 * in the same order). Labels are the caller's concern — this stays display-agnostic.
 *
 * Cross-geo comparison relies on Google jointly normalizing all items to one shared
 * 0–100 scale, which holds ONLY because every item rides in a single `explore` request.
 * Confirmed empirically 2026-07-03: `thanksgiving` across US,FR in one request returns
 * peaks US=100 / FR=4 (jointly scaled), whereas each geo alone returns 100 (independent).
 * Do not split this into per-geo requests or cross-geo comparison silently breaks.
 */
export async function interestOverTime(
  items: { keyword: string; geo: string }[],
  time: string,
  category: number,
): Promise<{ points: TimelinePoint[] }> {
  const comparisonItems: ComparisonItem[] = items.map((it) => ({ ...it, time }))
  const widgets = await explore(comparisonItems, category)
  const ts = widgets.find((w) => w.id === 'TIMESERIES')
  if (!ts) throw new CliError('Google Trends did not return a time-series widget for that query.')
  // The geo passed here only feeds the already-cached cookie, so any item's geo is equivalent.
  const data = await widgetData<{ default: { timelineData: TimelinePoint[] } }>('multiline', ts, items[0]?.geo ?? '')
  return { points: data.default?.timelineData ?? [] }
}

export interface RankedQuery {
  query: string
  value: number
  formattedValue: string
  link?: string
}

/** Related queries for a single keyword: `top` (all-time) and `rising` (breakout) lists. */
export async function relatedQueries(
  keyword: string,
  geo: string,
  time: string,
  category: number,
): Promise<{ top: RankedQuery[]; rising: RankedQuery[] }> {
  const widgets = await explore([{ keyword, geo, time }], category)
  const rq = widgets.find((w) => w.id === 'RELATED_QUERIES')
  if (!rq) throw new CliError('Google Trends did not return related queries for that keyword.')
  const data = await widgetData<{
    default: { rankedList: { rankedKeyword: RankedQuery[] }[] }
  }>('relatedsearches', rq, geo)
  const lists = data.default?.rankedList ?? []
  return { top: lists[0]?.rankedKeyword ?? [], rising: lists[1]?.rankedKeyword ?? [] }
}

export interface TrendingSearch {
  query: string
  traffic: string
  relatedQueries: string[]
  articleTitle?: string
  articleUrl?: string
}

export const decodeXml = (s: string): string =>
  s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim()

export const tag = (block: string, name: string): string | undefined => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decodeXml(m[1]) : undefined
}

/**
 * Closure-local retry for the Autocomplete endpoint. Deliberately isolated from
 * fetchWithRetry and cachedCookie: the suggest API needs no session cookie and
 * must never read or write module-level cookie state.
 */
async function fetchAutocomplete(url: string): Promise<string> {
  const backoff = [800, 2500, 5000]
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const res = await fetch(url, { signal: ac.signal })
      if (res.status === 429) {
        if (attempt < backoff.length) {
          await sleep(backoff[attempt])
          continue
        }
        throw new CliError(
          'Google Autocomplete rate-limited the request (429).',
          'Wait a minute and retry, or narrow the query.',
        )
      }
      if (!res.ok) throw new CliError(`Google Autocomplete request failed (HTTP ${res.status}).`)
      return res.text()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CliError('Google Autocomplete request timed out (30 s).', 'Try again, or check your connection.')
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Google Autocomplete suggestions for `query` in the given `geo` (ISO 3166-1,
 * e.g. "US"). Empty `geo` sends an empty `gl` value, which returns worldwide
 * suggestions. The function uses its own fetch path with no Cookie header and
 * plain JSON parsing — the suggest API has a different format and rate-limit
 * profile from the Trends endpoints.
 *
 * Throws CliError if the response shape no longer matches `[query, string[]]`.
 */
export async function autocomplete(query: string, geo: string, lang = 'en'): Promise<string[]> {
  const params = new URLSearchParams({ client: 'chrome', q: query, hl: lang, gl: geo })
  const url = `https://suggestqueries.google.com/complete/search?${params.toString()}`
  const text = await fetchAutocomplete(url)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CliError(
      'The autocomplete response shape changed: could not parse JSON.',
      'Google may have updated the suggest endpoint format.',
    )
  }
  if (
    !Array.isArray(parsed) ||
    !Array.isArray(parsed[1]) ||
    !(parsed[1] as unknown[]).every((s) => typeof s === 'string')
  ) {
    throw new CliError(
      'The autocomplete response shape changed.',
      'Expected an array where index [1] is an array of strings.',
    )
  }
  return parsed[1] as string[]
}

/**
 * Today's trending searches for a geo. Google retired the old `dailytrends` JSON
 * endpoint (now 404); this reads the current `/trending/rss` feed instead.
 */
export async function dailyTrends(geo: string): Promise<TrendingSearch[]> {
  const url = `${BASE}/trending/rss?geo=${encodeURIComponent(geo)}`
  const xml = await fetchWithRetry(url, geo)

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  return items.map((block) => {
    const news = [...block.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map((m) => m[1])
    const first = news[0]
    return {
      query: tag(block, 'title') ?? '',
      traffic: tag(block, 'ht:approx_traffic') ?? '',
      relatedQueries: news.map((n) => tag(n, 'ht:news_item_title') ?? '').filter(Boolean),
      articleTitle: first ? tag(first, 'ht:news_item_title') : undefined,
      articleUrl: first ? tag(first, 'ht:news_item_url') : undefined,
    }
  })
}
