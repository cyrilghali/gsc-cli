import assert from 'node:assert/strict'
import test from 'node:test'
import { CliError } from '../src/config.ts'
import { autocomplete } from '../src/trends/api.ts'
import { DEFAULT_PATTERNS, dedupeSuggestions, expandSeeds } from '../src/trends/commands/suggest.ts'

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

// ── suggest helpers ───────────────────────────────────────────────────────────

test('expandSeeds: one seed × DEFAULT_PATTERNS → 4 queries, first is "alternative to crm", all carry seed + pattern template', () => {
  const expanded = expandSeeds(['crm'], DEFAULT_PATTERNS)
  assert.equal(expanded.length, DEFAULT_PATTERNS.length)
  assert.equal(expanded[0].query, 'alternative to crm')
  assert.equal(expanded[0].seed, 'crm')
  assert.equal(expanded[0].pattern, DEFAULT_PATTERNS[0])
  for (let i = 0; i < expanded.length; i++) {
    assert.equal(expanded[i].seed, 'crm')
    assert.equal(expanded[i].pattern, DEFAULT_PATTERNS[i])
  }
})

test('dedupeSuggestions: duplicate suggestion strings across two expanded queries are deduplicated (first wins)', () => {
  const records = [
    { seed: 'crm', pattern: 'alternative to {seed}', suggestion: 'salesforce' },
    { seed: 'crm', pattern: '{seed} for', suggestion: 'hubspot' },
    { seed: 'crm', pattern: '{seed} pricing', suggestion: 'hubspot' }, // duplicate — should be dropped
    { seed: 'crm', pattern: 'how to {seed} without', suggestion: 'zoho' },
  ]
  const deduped = dedupeSuggestions(records)
  assert.equal(deduped.length, 3)
  assert.deepEqual(
    deduped.map((r) => r.suggestion),
    ['salesforce', 'hubspot', 'zoho'],
  )
  // First occurrence of 'hubspot' wins — carries its original pattern
  assert.equal(deduped[1].pattern, '{seed} for')
})

test('expandSeeds records carry {seed, pattern} verbatim into SuggestRecord shape', () => {
  const patterns = ['alternative to {seed}', '{seed} pricing']
  const expanded = expandSeeds(['crm'], patterns)
  // Simulate what the action does: pair each expansion with a suggestion
  const records = expanded.map(({ seed, pattern }) => ({ seed, pattern, suggestion: 'fake' }))
  assert.equal(records[0].seed, 'crm')
  assert.equal(records[0].pattern, 'alternative to {seed}')
  assert.equal(records[1].seed, 'crm')
  assert.equal(records[1].pattern, '{seed} pricing')
  assert.equal(records[0].suggestion, 'fake')
})
