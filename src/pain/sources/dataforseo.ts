import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, configDir } from '../../config.ts'

/**
 * DataForSEO v3 client for keyword enrichment — the paid stage of the
 * opportunity pipeline. Two live endpoints per batch (≤1000 keywords each):
 * Google Ads search volume (volume, CPC, competition) and Labs bulk keyword
 * difficulty. Auth is HTTP Basic with the API login/password from
 * app.dataforseo.com; every response carries the actual `cost` billed, which
 * callers surface instead of estimating.
 */

const BASE = 'https://api.dataforseo.com/v3'

export interface DataForSeoAuth {
  login: string
  password: string
}

const authPath = () => join(configDir(), 'dataforseo.json')

/**
 * Resolve credentials: DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD env vars first,
 * then ~/.config/gsc-cli/dataforseo.json.
 */
export function resolveAuth(): DataForSeoAuth {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (login && password) return { login, password }

  let text: string
  try {
    text = readFileSync(authPath(), 'utf8')
  } catch {
    throw new CliError(
      'No DataForSEO credentials found.',
      `Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD, or run: gpain enrich --save-auth '<login>:<password>' (API credentials from app.dataforseo.com).`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CliError(`Could not parse ${authPath()}.`, 'The file is corrupted; delete it and save auth again.')
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.login !== 'string' || typeof obj.password !== 'string') {
    throw new CliError(`${authPath()} must contain { "login": "...", "password": "..." }.`)
  }
  return { login: obj.login, password: obj.password }
}

export function saveAuth(auth: DataForSeoAuth): string {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const path = authPath()
  writeFileSync(path, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

export interface EnrichedTerm {
  term: string
  search_volume: number | null
  cpc: number | null
  competition_index: number | null
  keyword_difficulty: number | null
}

interface DfsTaskResponse {
  status_code: number
  status_message: string
  cost: number
  tasks?: {
    status_code: number
    status_message: string
    result?: Record<string, unknown>[] | null
  }[]
}

async function postLive(
  path: string,
  payload: Record<string, unknown>,
  auth: DataForSeoAuth,
): Promise<{ result: Record<string, unknown>[]; cost: number }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 60_000)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${auth.login}:${auth.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([payload]),
      signal: ac.signal,
    })
    if (res.status === 401) {
      throw new CliError('DataForSEO rejected the credentials (401).', 'Check the API login/password on app.dataforseo.com.')
    }

    let data: DfsTaskResponse
    const text = await res.text()
    try {
      data = JSON.parse(text) as DfsTaskResponse
    } catch {
      throw new CliError(`DataForSEO returned unparseable JSON (HTTP ${res.status}).`)
    }
    // Error bodies (e.g. 40104 unverified account) carry the reason in
    // status_message even when the HTTP status is 4xx
    if (!res.ok || data.status_code >= 40000) {
      throw new CliError(`DataForSEO: ${data.status_message} (${data.status_code}).`)
    }
    const task = data.tasks?.[0]
    if (task == null || task.status_code >= 40000) {
      throw new CliError(
        `DataForSEO task failed: ${task?.status_message ?? data.status_message}.`,
        task?.status_code === 40201 ? 'Insufficient funds — top up the account balance.' : undefined,
      )
    }
    return { result: task.result ?? [], cost: data.cost }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CliError('DataForSEO request timed out (60 s).', 'Try again, or check your connection.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)

/**
 * Enrich terms with volume/CPC/competition (Google Ads) and keyword
 * difficulty (Labs). `location` is a DataForSEO location_code (2840 = US).
 * Returns one record per input term (null metrics when an endpoint had no
 * data for it) plus the total billed cost.
 */
export async function enrichTerms(
  terms: string[],
  location: number,
  language: string,
  auth: DataForSeoAuth,
): Promise<{ enriched: EnrichedTerm[]; cost: number }> {
  const volume = await postLive(
    '/keywords_data/google_ads/search_volume/live',
    { keywords: terms, location_code: location, language_code: language },
    auth,
  )
  const difficulty = await postLive(
    '/dataforseo_labs/google/bulk_keyword_difficulty/live',
    { keywords: terms, location_code: location, language_code: language },
    auth,
  )

  const volByKw = new Map<string, Record<string, unknown>>()
  for (const r of volume.result) {
    if (typeof r.keyword === 'string') volByKw.set(r.keyword.toLowerCase(), r)
  }
  // Labs wraps per-keyword records in result[0].items
  const kdByKw = new Map<string, Record<string, unknown>>()
  const items = difficulty.result[0]?.items
  if (Array.isArray(items)) {
    for (const r of items as Record<string, unknown>[]) {
      if (typeof r.keyword === 'string') kdByKw.set(r.keyword.toLowerCase(), r)
    }
  }

  const enriched = terms.map((term): EnrichedTerm => {
    const v = volByKw.get(term.toLowerCase())
    const k = kdByKw.get(term.toLowerCase())
    return {
      term,
      search_volume: num(v?.search_volume),
      cpc: num(v?.cpc),
      competition_index: num(v?.competition_index),
      keyword_difficulty: num(k?.keyword_difficulty),
    }
  })

  return { enriched, cost: volume.cost + difficulty.cost }
}
