import assert from 'node:assert/strict'
import test from 'node:test'
import { containsAllRoots, saturationScore, saturateTerm } from '../src/pain/sources/saturation.ts'

// ── containsAllRoots: relevance filter against typo-tolerance and drift ───────

test('containsAllRoots requires every root at a word start', () => {
  assert.equal(containsAllRoots('best crm for dentists', 'crm for dentists'), true)
  // Autocomplete drift: no crm root at all
  assert.equal(containsAllRoots('chemical inventory list for dental office', 'crm for dentists'), false)
  // Algolia typo tolerance: "mental" must not count as "dental"
  assert.equal(containsAllRoots('Show HN: mental health companion crm', 'dental crm'), false)
  // Suffix-stripped root still anchors inflections
  assert.equal(containsAllRoots('invoice tools compared', 'invoicing'), true)
})

// ── saturationScore: calibrated normalization ─────────────────────────────────

test('saturationScore: maxed probes → 1.0, empty probes → 0, mid gradient in between', () => {
  assert.equal(saturationScore({ vsCount: 15, alternativesCount: 15, showHnCount: 100 }).saturation, 1)
  assert.equal(saturationScore({ vsCount: 0, alternativesCount: 0, showHnCount: 0 }).saturation, 0)

  const mid = saturationScore({ vsCount: 5, alternativesCount: 0, showHnCount: 10 })
  // 0.5×0.3 + 0 + 0.5×0.4 = 0.35
  assert.ok(Math.abs(mid.saturation - 0.35) < 1e-9)
  assert.ok(Math.abs(mid.breakdown.vs - 0.15) < 1e-9)
  assert.ok(Math.abs(mid.breakdown.show_hn - 0.2) < 1e-9)
})

// ── saturateTerm: probe wiring, filtering, evidence ──────────────────────────

test('saturateTerm filters completions and Show HN titles, computes counts and evidence', async (t) => {
  const autocompleteByQuery: Record<string, string[]> = {
    'crm for dentists': ['best crm for dentists', 'crm software for dentists', 'chemical inventory list for dental office'],
    'crm for dentists vs': ['crm comparatif', 'crm for dentists vs excel'],
    'crm for dentists alternatives': ['best dental crm', 'crm for dentists alternatives'],
  }
  const hnResponse = {
    hits: [
      { objectID: 's1', title: 'Show HN: CRM for dentists in a weekend', created_at: '2026-01-01T00:00:00Z' },
      { objectID: 's2', title: 'Show HN: mental health app', created_at: '2026-01-02T00:00:00Z' },
    ],
  }

  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url
    if (href.includes('hn.algolia.com')) {
      assert.ok(href.includes('tags=show_hn'))
      assert.ok(href.includes('restrictSearchableAttributes=title'))
      return new Response(JSON.stringify(hnResponse), { status: 200 })
    }
    const q = new URL(href).searchParams.get('q') ?? ''
    return new Response(JSON.stringify([q, autocompleteByQuery[q] ?? []]), { status: 200 })
  })

  const result = await saturateTerm('crm for dentists', 730, '')

  assert.equal(result.presence, 2)
  assert.equal(result.vs_count, 1)
  assert.deepEqual(result.evidence.vs_completions, ['crm for dentists vs excel'])
  assert.equal(result.alternatives_count, 1)
  assert.equal(result.show_hn_count, 1)
  assert.equal(result.evidence.show_hn_samples[0].url, 'https://news.ycombinator.com/item?id=s1')
  assert.ok(Math.abs(result.accessibility - (1 - result.saturation)) < 1e-9)
})
