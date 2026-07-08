/**
 * Offline tests for querySearchAnalytics pagination (src/api.ts).
 *
 * Strategy to stay fully offline:
 *  - Point XDG_CONFIG_HOME at a temp dir that holds a tokens.json with a
 *    far-future expiry, so getAccessToken() returns the mock access_token
 *    without any network call (the expiry check short-circuits the refresh
 *    branch entirely).
 *  - Ensure GOOGLE_APPLICATION_CREDENTIALS is unset so the service-account
 *    path is not taken (which would try to sign a JWT and hit the token URL).
 *  - Mock globalThis.fetch (via node:test context mock) to return canned
 *    Search Analytics JSON for the API POST calls.
 *
 * The mock is automatically restored by node:test when each test context exits.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_ROWS_PER_REQUEST, querySearchAnalytics, type SearchAnalyticsRow } from '../src/api.ts'

// ── helpers ───────────────────────────────────────────────────────────────────

const BASE_REQUEST = {
  startDate: '2026-01-01',
  endDate: '2026-01-31',
}

function mockRow(i: number): SearchAnalyticsRow {
  return { keys: [`page${i}`], clicks: i, impressions: i * 10, ctr: 0.1, position: 1.0 }
}

/** Build a serialised API response body for an array of rows. */
function rowsBody(rows: SearchAnalyticsRow[]): string {
  return JSON.stringify({ rows })
}

/** Build a serialised body for a large batch without creating SearchAnalyticsRow objects. */
function bigBatchBody(count: number): string {
  const pieces: string[] = []
  for (let i = 0; i < count; i++) {
    pieces.push(`{"clicks":${i},"impressions":0,"ctr":0,"position":0}`)
  }
  return `{"rows":[${pieces.join(',')}]}`
}

/**
 * Write a tokens.json with a far-future expiry into a temp XDG config dir and
 * return the dir path and cleanup function.
 */
function setupTempConfig(): { xdgBase: string; cleanup: () => void } {
  const xdgBase = mkdtempSync(join(tmpdir(), 'gsc-api-test-'))
  const configDir = join(xdgBase, 'gsc-cli')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'tokens.json'),
    JSON.stringify({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expiry: 9_999_999_999_999, // far future → expiry check passes without a refresh fetch
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      client_id: 'mock-client-id',
      client_secret: 'mock-client-secret',
    }),
  )
  return { xdgBase, cleanup: () => rmSync(xdgBase, { recursive: true, force: true }) }
}

/**
 * Set the env vars needed to route getAccessToken() through the OAuth tokens
 * path and return a restore function.
 */
function patchEnv(xdgBase: string): () => void {
  const savedXdg = process.env.XDG_CONFIG_HOME
  const savedGac = process.env.GOOGLE_APPLICATION_CREDENTIALS
  process.env.XDG_CONFIG_HOME = xdgBase
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS
  return () => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
    if (savedGac === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = savedGac
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('single short batch: loop stops after one fetch', async (t) => {
  const { xdgBase, cleanup } = setupTempConfig()
  const restoreEnv = patchEnv(xdgBase)
  let fetchCount = 0

  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++
    return new Response(rowsBody([mockRow(1), mockRow(2), mockRow(3)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  try {
    const rows = await querySearchAnalytics('https://example.com/', BASE_REQUEST, 100)
    assert.equal(fetchCount, 1, 'expected exactly one API call')
    assert.equal(rows.length, 3)
    assert.equal(rows[0].clicks, 1)
  } finally {
    restoreEnv()
    cleanup()
  }
})

test('full batch triggers a second fetch; second batch terminates the loop', async (t) => {
  // To get a second fetch, the first batch must fill MAX_ROWS_PER_REQUEST so
  // the loop believes there may be more data.  We use limit = MAX + 1 so the
  // while condition still holds after the first batch.
  const { xdgBase, cleanup } = setupTempConfig()
  const restoreEnv = patchEnv(xdgBase)
  let fetchCount = 0

  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++
    if (fetchCount === 1) {
      // Exactly MAX_ROWS_PER_REQUEST rows → batch.length === batchSize → no early break
      return new Response(bigBatchBody(MAX_ROWS_PER_REQUEST), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    // Second call: return 1 row (< batchSize of 1) → break
    return new Response(rowsBody([mockRow(0)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  try {
    const rows = await querySearchAnalytics('https://example.com/', BASE_REQUEST, MAX_ROWS_PER_REQUEST + 1)
    assert.equal(fetchCount, 2, 'expected two API calls for a full first batch')
    assert.equal(rows.length, MAX_ROWS_PER_REQUEST + 1)
  } finally {
    restoreEnv()
    cleanup()
  }
})

test('limit caps rows: loop exits once rows.length reaches limit without an extra fetch', async (t) => {
  // limit = 5, API returns exactly 5 rows.
  // After adding them: rows.length (5) === limit → while exits; no second fetch.
  const { xdgBase, cleanup } = setupTempConfig()
  const restoreEnv = patchEnv(xdgBase)
  let fetchCount = 0

  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++
    if (fetchCount > 1) throw new Error('unexpected second fetch')
    return new Response(rowsBody([mockRow(1), mockRow(2), mockRow(3), mockRow(4), mockRow(5)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  try {
    const rows = await querySearchAnalytics('https://example.com/', BASE_REQUEST, 5)
    assert.equal(fetchCount, 1, 'expected exactly one API call')
    assert.equal(rows.length, 5)
  } finally {
    restoreEnv()
    cleanup()
  }
})
