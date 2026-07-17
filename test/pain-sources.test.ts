import assert from 'node:assert/strict'
import test from 'node:test'
import { mineHn } from '../src/pain/sources/hn.ts'
import { mineDevto } from '../src/pain/sources/devto.ts'

// ── HN fixtures ───────────────────────────────────────────────────────────────

const HN_FIXTURE = {
  hits: [
    {
      objectID: 'hn001',
      comment_text: 'I would pay for a better invoicing tool honestly',
      story_title: 'Ask HN: Best invoicing tools?',
      created_at: '2026-07-01T10:00:00.000Z',
    },
    {
      objectID: 'hn002',
      comment_text: 'Great weather today, totally off topic',
      story_title: 'unrelated',
      created_at: '2026-07-01T11:00:00.000Z',
    },
  ],
}

// ── Test 1: HN — one matching comment, one unrelated → exactly one signal ─────

test('mineHn returns exactly one signal for the matching comment and none for unrelated', async (t) => {
  let capturedUrl = ''
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    capturedUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url
    return new Response(JSON.stringify(HN_FIXTURE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  const signals = await mineHn('invoicing', 30)

  // URL shape
  assert.ok(capturedUrl.includes('tags=comment'), 'URL must contain tags=comment')
  assert.ok(/created_at_i>\d{10}(?!\d)/.test(capturedUrl), 'cutoff must be 10-digit epoch seconds, not milliseconds')

  // Signal count and content
  assert.equal(signals.length, 1)
  assert.equal(signals[0].term, 'invoicing')
  assert.equal(signals[0].url, 'https://news.ycombinator.com/item?id=hn001')
  assert.equal(signals[0].matched_phrase, 'would pay')
  assert.equal(signals[0].source, 'hn')
})

// ── Test 2: Excerpt truncation ────────────────────────────────────────────────

test('mineHn truncates excerpt to 300 chars from a 500-char comment', async (t) => {
  const longComment = 'I would pay for better invoicing ' + 'x'.repeat(467)
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      JSON.stringify({ hits: [{ objectID: 'h1', comment_text: longComment, story_title: '', created_at: '' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )

  const signals = await mineHn('invoicing', 30)
  assert.equal(signals.length, 1)
  assert.equal(signals[0].excerpt.length, 300)
})

// ── Test 3: devto — slugification and article-adapted phrase match ─────────────

test('mineDevto slugifies term and returns signal when article-adapted phrase matches', async (t) => {
  let capturedUrl = ''
  const FIXTURE_ARTICLE = {
    url: 'https://dev.to/user/article',
    title: 'How I struggle with meeting notes every day',
    description: 'A deep dive on painful async standup workflows',
    published_at: '2026-07-10T09:00:00Z',
    created_at: '2026-07-10T09:00:00Z',
  }

  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    capturedUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url
    return new Response(JSON.stringify([FIXTURE_ARTICLE]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  const signals = await mineDevto('meeting notes')

  assert.ok(capturedUrl.includes('tag=meeting-notes'), 'URL must contain tag=meeting-notes')
  assert.equal(signals.length, 1)
  assert.equal(signals[0].source, 'devto')
  assert.equal(signals[0].story_title, FIXTURE_ARTICLE.title)
})

// ── Test 4: HN 429 retry — resolves after single retry ───────────────────────

test('mineHn retries once on 429 and resolves with results from second attempt', async (t) => {
  let callCount = 0
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++
    if (callCount === 1) return new Response('', { status: 429 })
    return new Response(JSON.stringify({ hits: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  const signals = await mineHn('invoicing', 30)
  assert.equal(callCount, 2)
  assert.deepEqual(signals, [])
})
