import assert from 'node:assert/strict'
import test from 'node:test'
import { CliError } from '../src/config.ts'
import { dailyTrends, decodeXml, interestOverTime, parseGuardedJson, tag, validateGeo } from '../src/trends/api.ts'

// ── parseGuardedJson ───────────────────────────────────────────────────────────

test("parseGuardedJson strips the )]}' prefix before an object", () => {
  const result = parseGuardedJson<{ a: number }>(`)]}'` + ',\n{"a":1}')
  assert.deepEqual(result, { a: 1 })
})

test("parseGuardedJson strips the )]}' prefix before an array", () => {
  const result = parseGuardedJson<number[]>(")]}',\n[1,2,3]")
  assert.deepEqual(result, [1, 2, 3])
})

test('parseGuardedJson picks the earliest JSON start when both { and [ appear in the prefix', () => {
  // { appears before [ in real Google output; make sure we take the minimum
  const result = parseGuardedJson<{ v: number[] }>(")]}',\n{\"v\":[4,5]}")
  assert.deepEqual(result, { v: [4, 5] })
})

test('parseGuardedJson throws CliError when no JSON start character is found', () => {
  assert.throws(
    () => parseGuardedJson('no json here at all'),
    (e: unknown) => e instanceof CliError,
  )
})

test('parseGuardedJson round-trips a valid JSON object without any prefix', () => {
  const result = parseGuardedJson<{ key: string }>('{"key":"value"}')
  assert.deepEqual(result, { key: 'value' })
})

test('parseGuardedJson throws CliError when the JSON after the prefix is malformed', () => {
  assert.throws(
    () => parseGuardedJson(")]}',\n{not valid json}"),
    (e: unknown) => e instanceof CliError,
  )
})

// ── decodeXml ──────────────────────────────────────────────────────────────────

test('decodeXml unwraps CDATA sections', () => {
  assert.equal(decodeXml('<![CDATA[hello & world]]>'), 'hello & world')
})

test('decodeXml decodes all five standard XML entities', () => {
  assert.equal(decodeXml('&lt;'), '<')
  assert.equal(decodeXml('&gt;'), '>')
  assert.equal(decodeXml('&quot;'), '"')
  assert.equal(decodeXml('&#39;'), "'")
  assert.equal(decodeXml('&apos;'), "'")
  assert.equal(decodeXml('&amp;'), '&')
})

test('decodeXml trims surrounding whitespace', () => {
  assert.equal(decodeXml('  hello  '), 'hello')
})

test('decodeXml returns plain text unchanged (modulo trim)', () => {
  assert.equal(decodeXml('plain text'), 'plain text')
})

// ── tag ────────────────────────────────────────────────────────────────────────

test('tag extracts inner text from a simple element', () => {
  assert.equal(tag('<title>My Topic</title>', 'title'), 'My Topic')
})

test('tag decodes XML entities within the extracted content', () => {
  assert.equal(tag('<title>&lt;Breaking&gt;</title>', 'title'), '<Breaking>')
})

test('tag returns undefined when the named element is absent', () => {
  assert.equal(tag('<title>foo</title>', 'traffic'), undefined)
})

test('tag handles CDATA inside the matched element', () => {
  assert.equal(tag('<title><![CDATA[Raw & Ready]]></title>', 'title'), 'Raw & Ready')
})

// ── dailyTrends (offline via fetch mock) ──────────────────────────────────────
//
// fetchWithRetry calls cookie() first (which fetches the trends homepage) then
// fetches the RSS URL.  We mock globalThis.fetch so that:
//  - the cookie URL (anything that is NOT the RSS endpoint) throws → cachedCookie is set to ''
//  - the RSS URL returns our fixture XML
// The mock is automatically restored by node:test when the test context exits.

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss">
  <channel>
    <item>
      <title><![CDATA[Climate Change]]></title>
      <ht:approx_traffic>500,000+</ht:approx_traffic>
      <ht:news_item>
        <ht:news_item_title><![CDATA[New Report]]></ht:news_item_title>
        <ht:news_item_url>https://example.com/article</ht:news_item_url>
      </ht:news_item>
      <ht:news_item>
        <ht:news_item_title>Second Story</ht:news_item_title>
        <ht:news_item_url>https://example.com/article2</ht:news_item_url>
      </ht:news_item>
    </item>
    <item>
      <title>Another Topic</title>
      <ht:approx_traffic>1,000+</ht:approx_traffic>
    </item>
  </channel>
</rss>`

test('dailyTrends parses RSS fixture: array shape, query, traffic and news items', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (urlStr.includes('/trending/rss')) {
      return new Response(FIXTURE_XML, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      })
    }
    // Cookie prefetch — throw so the cookie module falls back to ''
    throw new Error('offline (cookie fetch suppressed in test)')
  })

  const results = await dailyTrends('US')

  assert.equal(results.length, 2)

  const first = results[0]
  assert.equal(first.query, 'Climate Change')
  assert.equal(first.traffic, '500,000+')
  assert.equal(first.relatedQueries.length, 2)
  assert.equal(first.relatedQueries[0], 'New Report')
  assert.equal(first.relatedQueries[1], 'Second Story')
  assert.equal(first.articleTitle, 'New Report')
  assert.equal(first.articleUrl, 'https://example.com/article')

  const second = results[1]
  assert.equal(second.query, 'Another Topic')
  assert.equal(second.traffic, '1,000+')
  assert.equal(second.relatedQueries.length, 0)
  assert.equal(second.articleTitle, undefined)
  assert.equal(second.articleUrl, undefined)
})

// ── dailyTrends HTTP error branches ───────────────────────────────────────────

test('dailyTrends throws CliError on HTTP 400 from RSS endpoint', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (urlStr.includes('/trending/rss')) {
      return new Response('', { status: 400 })
    }
    throw new Error('offline (cookie fetch suppressed in test)')
  })

  await assert.rejects(
    () => dailyTrends('US'),
    (e: unknown) => e instanceof CliError && /400/.test(e.message),
  )
})

test('dailyTrends retries on 429 and resolves on second RSS attempt', async (t) => {
  let rssCallCount = 0
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (urlStr.includes('/trending/rss')) {
      rssCallCount++
      if (rssCallCount === 1) return new Response('', { status: 429 })
      return new Response(FIXTURE_XML, { status: 200, headers: { 'content-type': 'application/rss+xml' } })
    }
    // Cookie prefetch — throw so cookie() falls back to ''
    throw new Error('offline (cookie fetch suppressed in test)')
  })

  const results = await dailyTrends('US')
  assert.equal(results.length, 2)
})

// ── interestOverTime widget null guard ────────────────────────────────────────

test('interestOverTime throws CliError on malformed widget with null request', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (urlStr.includes('/trends/api/explore')) {
      return new Response(
        JSON.stringify({ widgets: [{ id: 'TIMESERIES', request: null, token: 't' }] }),
        { status: 200 },
      )
    }
    throw new Error('offline (cookie fetch suppressed in test)')
  })

  await assert.rejects(
    () => interestOverTime([{ keyword: 'test', geo: 'US' }], 'today 12-m', 0),
    (e: unknown) => e instanceof CliError && /malformed widget/.test(e.message),
  )
})

// ── validateGeo ────────────────────────────────────────────────────────────────

test('validateGeo accepts two-letter country codes and the empty worldwide geo', () => {
  assert.doesNotThrow(() => validateGeo('US'))
  assert.doesNotThrow(() => validateGeo('FR'))
  assert.doesNotThrow(() => validateGeo(''))
})

test('validateGeo accepts a subdivision suffix', () => {
  assert.doesNotThrow(() => validateGeo('US-NY'))
  assert.doesNotThrow(() => validateGeo('GB-ENG'))
})

test('validateGeo rejects malformed codes with an actionable CliError', () => {
  for (const bad of ['fr', 'USA', 'BADGEO', 'U', 'US-']) {
    assert.throws(
      () => validateGeo(bad),
      (e: unknown) => e instanceof CliError && e.message.includes(bad),
      `expected CliError for ${JSON.stringify(bad)}`,
    )
  }
})
