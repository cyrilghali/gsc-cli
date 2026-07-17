import assert from 'node:assert/strict'
import test from 'node:test'
import { CliError } from '../src/config.ts'
import { autocomplete } from '../src/trends/api.ts'

// ── autocomplete ──────────────────────────────────────────────────────────────

test('autocomplete: happy path returns suggestions array and sends no Cookie header', async (t) => {
  let capturedInit: RequestInit | undefined

  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (urlStr.includes('suggestqueries.google.com')) {
      return new Response(JSON.stringify(['seed', ['s1', 's2']]), { status: 200 })
    }
    throw new Error('unexpected fetch URL in test')
  })

  const result = await autocomplete('seed', 'US')
  assert.deepEqual(result, ['s1', 's2'])

  // No Cookie header — the fetch call must not carry one.
  const h = capturedInit?.headers
  if (h instanceof Headers) {
    assert.equal(h.has('cookie'), false)
    assert.equal(h.has('Cookie'), false)
  } else if (Array.isArray(h)) {
    assert.ok(!(h as [string, string][]).some(([k]) => k.toLowerCase() === 'cookie'))
  } else {
    const rec = h as Record<string, string> | undefined
    assert.equal(rec?.['Cookie'], undefined)
    assert.equal(rec?.['cookie'], undefined)
  }
})

test('autocomplete: retries on 429 then resolves on 200 (real 800 ms first backoff)', async (t) => {
  let calls = 0

  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (urlStr.includes('suggestqueries.google.com')) {
      calls++
      if (calls === 1) return new Response('', { status: 429 })
      return new Response(JSON.stringify(['seed', ['s1', 's2']]), { status: 200 })
    }
    throw new Error('unexpected fetch URL in test')
  })

  const result = await autocomplete('seed', 'US')
  assert.deepEqual(result, ['s1', 's2'])
})

test('autocomplete: throws CliError after exhausting all 429 retries', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (urlStr.includes('suggestqueries.google.com')) {
      return new Response('', { status: 429 })
    }
    throw new Error('unexpected fetch URL in test')
  })

  await assert.rejects(
    () => autocomplete('seed', 'US'),
    (e: unknown) => e instanceof CliError,
  )
})
