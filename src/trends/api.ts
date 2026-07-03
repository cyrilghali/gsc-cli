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
    const res = await fetch(`${BASE}/trends/?geo=${encodeURIComponent(geo || 'US')}`, {
      headers: { 'User-Agent': UA },
    })
    const raw = res.headers.get('set-cookie') ?? ''
    // Keep just the `name=value` pairs, drop Path/Domain/Expires attributes.
    cachedCookie = raw
      .split(/,(?=\s*\w+=)/)
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ')
  } catch {
    cachedCookie = ''
  }
  return cachedCookie
}

/** Strip the `)]}',` prefix Google prepends, then parse. */
function parseGuardedJson<T>(text: string): T {
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function getTrends(path: string, params: Record<string, string>, geo: string): Promise<string> {
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`
  const backoff = [800, 2500, 5000]
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Cookie: await cookie(geo), 'Accept-Language': 'en-US' },
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
    if (!res.ok) throw new CliError(`Google Trends request failed (HTTP ${res.status}).`)
    return res.text()
  }
}

export interface ComparisonItem {
  keyword: string
  geo: string
  time: string
}

interface Widget {
  id: string
  token: string
  request: unknown
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
  value: number[]
}

/** Interest over time for one or more compared keywords (each value[] index = one keyword). */
export async function interestOverTime(
  keywords: string[],
  geo: string,
  time: string,
  category: number,
): Promise<{ keywords: string[]; points: TimelinePoint[] }> {
  const items = keywords.map((keyword) => ({ keyword, geo, time }))
  const widgets = await explore(items, category)
  const ts = widgets.find((w) => w.id === 'TIMESERIES')
  if (!ts) throw new CliError('Google Trends did not return a time-series widget for that query.')
  const data = await widgetData<{ default: { timelineData: TimelinePoint[] } }>('multiline', ts, geo)
  return { keywords, points: data.default?.timelineData ?? [] }
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

const decodeXml = (s: string): string =>
  s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .trim()

const tag = (block: string, name: string): string | undefined => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decodeXml(m[1]) : undefined
}

/**
 * Today's trending searches for a geo. Google retired the old `dailytrends` JSON
 * endpoint (now 404); this reads the current `/trending/rss` feed instead.
 */
export async function dailyTrends(geo: string): Promise<TrendingSearch[]> {
  const url = `${BASE}/trending/rss?geo=${encodeURIComponent(geo)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' } })
  if (res.status === 429) {
    throw new CliError('Google Trends rate-limited the request (429).', 'Wait a minute and retry.')
  }
  if (!res.ok) throw new CliError(`Google Trends request failed (HTTP ${res.status}).`)
  const xml = await res.text()

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
