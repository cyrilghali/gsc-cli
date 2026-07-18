import { getAccessToken } from './auth.ts'
import { CliError } from './config.ts'

const BASE_URL = 'https://searchconsole.googleapis.com'

/** Maximum rows the Search Analytics API returns per request. */
export const MAX_ROWS_PER_REQUEST = 25_000

export class ApiError extends CliError {
  status: number

  constructor(status: number, message: string, hint?: string) {
    super(message, hint)
    this.name = 'ApiError'
    this.status = status
  }
}

function hintForStatus(status: number): string | undefined {
  switch (status) {
    case 401:
      return 'Your credentials are invalid or expired. Run `gsc auth login` again.'
    case 403:
      return 'You do not have access to this property, or the Search Console API is not enabled for your Google Cloud project. For service accounts, add the service account email as a user of the property in Search Console (Settings → Users and permissions). If you signed in with --readonly and this is a write operation, run `gsc auth login` again without --readonly.'
    case 404:
      return 'Property not found. Use the exact property URL shown by `gsc sites list`: `https://example.com/` for URL-prefix properties or `sc-domain:example.com` for domain properties.'
    case 429:
      return 'Search Console API quota exceeded. Wait a moment and retry.'
    default:
      return undefined
  }
}

async function request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
  const token = await getAccessToken()
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : BASE_URL + pathOrUrl
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new CliError(`Could not reach the Google API: ${err instanceof Error ? err.message : String(err)}`, 'Check your network connection.')
  }
  const text = await res.text()
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } }
      if (parsed.error?.message) message = parsed.error.message
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, message, hintForStatus(res.status))
  }
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new CliError(
      'Search Console API returned a non-JSON response.',
      `Body (first 200 chars): ${text.slice(0, 200)}`,
    )
  }
}

export interface SiteEntry {
  siteUrl: string
  permissionLevel: string
}

export interface DimensionFilter {
  dimension: string
  operator: string
  expression: string
}

export interface SearchAnalyticsRequest {
  startDate: string
  endDate: string
  dimensions?: string[]
  type?: string
  dimensionFilterGroups?: { groupType?: string; filters: DimensionFilter[] }[]
  rowLimit?: number
  startRow?: number
  dataState?: string
  aggregationType?: string
}

export interface SearchAnalyticsRow {
  keys?: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface SitemapContents {
  type?: string
  submitted?: string
  indexed?: string
}

export interface SitemapEntry {
  path: string
  lastSubmitted?: string
  isPending?: boolean
  isSitemapsIndex?: boolean
  lastDownloaded?: string
  warnings?: string
  errors?: string
  contents?: SitemapContents[]
}

export interface IndexStatusResult {
  verdict?: string
  coverageState?: string
  robotsTxtState?: string
  indexingState?: string
  lastCrawlTime?: string
  pageFetchState?: string
  googleCanonical?: string
  userCanonical?: string
  crawledAs?: string
  sitemap?: string[]
  referringUrls?: string[]
}

export interface InspectionResponse {
  inspectionResult?: {
    inspectionResultLink?: string
    indexStatusResult?: IndexStatusResult
    ampResult?: { verdict?: string }
    mobileUsabilityResult?: { verdict?: string }
    richResultsResult?: {
      verdict?: string
      detectedItems?: { richResultType?: string }[]
    }
  }
}

const encodeSite = encodeURIComponent

export async function listSites(): Promise<SiteEntry[]> {
  const res = await request<{ siteEntry?: SiteEntry[] }>('GET', '/webmasters/v3/sites')
  return res.siteEntry ?? []
}

export const addSite = (site: string): Promise<void> =>
  request<void>('PUT', `/webmasters/v3/sites/${encodeSite(site)}`)

export const removeSite = (site: string): Promise<void> =>
  request<void>('DELETE', `/webmasters/v3/sites/${encodeSite(site)}`)

export async function querySearchAnalytics(
  site: string,
  base: SearchAnalyticsRequest,
  limit: number,
): Promise<SearchAnalyticsRow[]> {
  const rows: SearchAnalyticsRow[] = []
  let startRow = 0
  while (rows.length < limit) {
    const batchSize = Math.min(MAX_ROWS_PER_REQUEST, limit - rows.length)
    const res = await request<{ rows?: SearchAnalyticsRow[] }>(
      'POST',
      `/webmasters/v3/sites/${encodeSite(site)}/searchAnalytics/query`,
      { ...base, rowLimit: batchSize, startRow },
    )
    const batch = res.rows ?? []
    rows.push(...batch)
    if (batch.length < batchSize) break
    startRow += batch.length
  }
  return rows
}

export async function listSitemaps(site: string): Promise<SitemapEntry[]> {
  const res = await request<{ sitemap?: SitemapEntry[] }>('GET', `/webmasters/v3/sites/${encodeSite(site)}/sitemaps`)
  return res.sitemap ?? []
}

export const submitSitemap = (site: string, feedUrl: string): Promise<void> =>
  request<void>('PUT', `/webmasters/v3/sites/${encodeSite(site)}/sitemaps/${encodeURIComponent(feedUrl)}`)

export const deleteSitemap = (site: string, feedUrl: string): Promise<void> =>
  request<void>('DELETE', `/webmasters/v3/sites/${encodeSite(site)}/sitemaps/${encodeURIComponent(feedUrl)}`)

export const inspectUrl = (site: string, url: string): Promise<InspectionResponse> =>
  request<InspectionResponse>('POST', '/v1/urlInspection/index:inspect', {
    inspectionUrl: url,
    siteUrl: site,
  })

// ── Indexing API ──────────────────────────────────────────────────────────────

const INDEXING_BASE = 'https://indexing.googleapis.com/v3'

const INDEXING_403_HINT =
  'Enable the "Web Search Indexing API" in your Google Cloud project ' +
  '(console.cloud.google.com/apis/library/indexing.googleapis.com) ' +
  'and re-run `gsc auth login` — the indexing scope was added to the default login.'

function wrapIndexing403(err: unknown): never {
  if (err instanceof ApiError && err.status === 403) {
    throw new ApiError(403, err.message, INDEXING_403_HINT)
  }
  throw err
}

export interface UrlNotificationEntry {
  url?: string
  type?: 'URL_UPDATED' | 'URL_DELETED'
  notifyTime?: string
}

export interface UrlNotificationMetadata {
  url?: string
  latestUpdate?: UrlNotificationEntry
  latestRemove?: UrlNotificationEntry
}

export interface UrlNotificationPublishResponse {
  urlNotificationMetadata?: UrlNotificationMetadata
}

export async function publishUrlNotification(
  url: string,
  type: 'URL_UPDATED' | 'URL_DELETED',
): Promise<UrlNotificationPublishResponse> {
  try {
    return await request<UrlNotificationPublishResponse>(
      'POST',
      `${INDEXING_BASE}/urlNotifications:publish`,
      { url, type },
    )
  } catch (err) {
    wrapIndexing403(err)
  }
}

export async function getUrlNotificationMetadata(url: string): Promise<UrlNotificationMetadata> {
  try {
    return await request<UrlNotificationMetadata>(
      'GET',
      `${INDEXING_BASE}/urlNotifications/metadata?url=${encodeURIComponent(url)}`,
    )
  } catch (err) {
    wrapIndexing403(err)
  }
}
