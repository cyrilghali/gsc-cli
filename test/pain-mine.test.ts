import assert from 'node:assert/strict'
import test from 'node:test'
import type { PainSignal } from '../src/pain/signal.ts'
import { mergeTermSignals } from '../src/pain/commands/mine.ts'

// ── fixture helpers ───────────────────────────────────────────────────────────

function sig(overrides: Partial<PainSignal> & { url: string; weight: number }): PainSignal {
  return {
    source: 'hn',
    term: 'saas',
    story_title: 'Test Story',
    excerpt: 'some excerpt',
    matched_phrase: 'pain phrase',
    workaround_detected: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── Test 1: dedup by URL (first wins), sorted by weight desc ─────────────────

test('mergeTermSignals: deduplicates shared URL (first wins) and sorts by weight desc', () => {
  const sharedUrl = 'https://example.com/shared'
  const hnSignals: PainSignal[] = [
    sig({ url: sharedUrl, weight: 5, source: 'hn' }),    // shared — should win (first)
    sig({ url: 'https://example.com/a', weight: 3, source: 'hn' }),
  ]
  const devtoSignals: PainSignal[] = [
    sig({ url: sharedUrl, weight: 10, source: 'devto' }), // shared — should be dropped (second)
    sig({ url: 'https://example.com/b', weight: 7, source: 'devto' }),
  ]

  const results: PromiseSettledResult<PainSignal[]>[] = [
    { status: 'fulfilled', value: hnSignals },
    { status: 'fulfilled', value: devtoSignals },
  ]

  const merged = mergeTermSignals('saas', results, 50)

  // 3 distinct URLs (shared appears once)
  assert.equal(merged.length, 3)

  // Shared URL uses the first-seen version (hn, weight=5, not devto weight=10)
  const shared = merged.find((s) => s.url === sharedUrl)
  assert.ok(shared, 'shared URL should appear exactly once')
  assert.equal(shared.source, 'hn')
  assert.equal(shared.weight, 5)

  // Sorted by weight desc: 7, 5, 3
  assert.equal(merged[0].weight, 7)
  assert.equal(merged[1].weight, 5)
  assert.equal(merged[2].weight, 3)
})

// ── Test 2: rejected source is skipped, fulfilled source survives ─────────────

test('mergeTermSignals: rejected source is ignored, fulfilled signals survive', () => {
  const goodSignals: PainSignal[] = [
    sig({ url: 'https://example.com/x', weight: 4, source: 'hn' }),
    sig({ url: 'https://example.com/y', weight: 2, source: 'hn' }),
  ]

  const results: PromiseSettledResult<PainSignal[]>[] = [
    { status: 'fulfilled', value: goodSignals },
    { status: 'rejected', reason: new Error('devto: HTTP 429') },
  ]

  const merged = mergeTermSignals('saas', results, 50)

  assert.equal(merged.length, 2)
  assert.equal(merged[0].weight, 4)
  assert.equal(merged[1].weight, 2)
})

// ── Test 3: multi_url_pain_match flag ──────────────────────────────────────

test('mergeTermSignals: multi_url_pain_match true when ≥3 distinct URLs, false when <3', () => {
  // Case A: 3 distinct URLs → all flagged true
  const threeSignals: PainSignal[] = [
    sig({ url: 'https://example.com/1', weight: 3, source: 'hn' }),
    sig({ url: 'https://example.com/2', weight: 2, source: 'hn' }),
    sig({ url: 'https://example.com/3', weight: 1, source: 'hn' }),
  ]
  const resultsWith3: PromiseSettledResult<PainSignal[]>[] = [
    { status: 'fulfilled', value: threeSignals },
  ]
  const mergedWith3 = mergeTermSignals('saas', resultsWith3, 50)
  assert.equal(mergedWith3.length, 3)
  for (const s of mergedWith3) {
    assert.equal(s.multi_url_pain_match, true, `expected true for url=${s.url}`)
  }

  // Case B: 2 distinct URLs → all flagged false
  const twoSignals: PainSignal[] = [
    sig({ url: 'https://example.com/a', weight: 3, source: 'hn' }),
    sig({ url: 'https://example.com/b', weight: 1, source: 'hn' }),
  ]
  const resultsWith2: PromiseSettledResult<PainSignal[]>[] = [
    { status: 'fulfilled', value: twoSignals },
  ]
  const mergedWith2 = mergeTermSignals('saas', resultsWith2, 50)
  assert.equal(mergedWith2.length, 2)
  for (const s of mergedWith2) {
    assert.equal(s.multi_url_pain_match, false, `expected false for url=${s.url}`)
  }
})

// ── Test 4: every record carries its term ─────────────────────────────────────

test('mergeTermSignals: every output record carries the term passed as argument', () => {
  const signals: PainSignal[] = [
    sig({ url: 'https://example.com/p', weight: 5, source: 'hn', term: 'saas' }),
    sig({ url: 'https://example.com/q', weight: 3, source: 'devto', term: 'saas' }),
  ]
  const results: PromiseSettledResult<PainSignal[]>[] = [
    { status: 'fulfilled', value: signals },
  ]

  const merged = mergeTermSignals('zapier alternative', results, 50)
  // The term in the output should be the one passed as the first argument
  for (const s of merged) {
    assert.equal(s.term, 'zapier alternative')
  }
})

// ── Test 5: --limit caps output per term ──────────────────────────────────────

test('mergeTermSignals: limit caps the number of returned signals', () => {
  const signals: PainSignal[] = Array.from({ length: 10 }, (_, i) =>
    sig({ url: `https://example.com/${i}`, weight: 10 - i, source: 'hn' }),
  )
  const results: PromiseSettledResult<PainSignal[]>[] = [
    { status: 'fulfilled', value: signals },
  ]

  const merged = mergeTermSignals('saas', results, 3)
  assert.equal(merged.length, 3)
  // Should be the top 3 by weight
  assert.equal(merged[0].weight, 10)
  assert.equal(merged[1].weight, 9)
  assert.equal(merged[2].weight, 8)
})
