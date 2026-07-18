import assert from 'node:assert/strict'
import test from 'node:test'
import { enrichTerms } from '../src/pain/sources/dataforseo.ts'
import { applyEnrichment, sweetSpot } from '../src/pain/commands/score.ts'
import type { ScoredTerm } from '../src/pain/commands/score.ts'

test('enrichTerms merges volume and difficulty endpoints per term, sums billed cost', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url
    assert.ok((init?.headers as Record<string, string>).Authorization.startsWith('Basic '))
    if (href.includes('/keywords_data/google_ads/search_volume/live')) {
      return new Response(
        JSON.stringify({
          status_code: 20000, status_message: 'Ok.', cost: 0.05,
          tasks: [{ status_code: 20000, status_message: 'Ok.', result: [
            { keyword: 'crm for dentists', search_volume: 320, cpc: 6.4, competition_index: 33 },
          ] }],
        }),
        { status: 200 },
      )
    }
    return new Response(
      JSON.stringify({
        status_code: 20000, status_message: 'Ok.', cost: 0.01,
        tasks: [{ status_code: 20000, status_message: 'Ok.', result: [
          { items: [{ keyword: 'crm for dentists', keyword_difficulty: 12 }] },
        ] }],
      }),
      { status: 200 },
    )
  })

  const { enriched, cost } = await enrichTerms(['crm for dentists', 'no data term'], 2840, 'en', {
    login: 'l', password: 'p',
  })

  assert.ok(Math.abs(cost - 0.06) < 1e-9)
  assert.deepEqual(enriched[0], {
    term: 'crm for dentists',
    search_volume: 320,
    cpc: 6.4,
    competition_index: 33,
    keyword_difficulty: 12,
  })
  assert.deepEqual(enriched[1], {
    term: 'no data term',
    search_volume: null,
    cpc: null,
    competition_index: null,
    keyword_difficulty: null,
  })
})

test('sweetSpot verdict requires micro volume AND cpc ≥ 2 AND kd < 30; applyEnrichment attaches per term', () => {
  assert.equal(
    sweetSpot({ search_volume: 320, cpc: 6.4, competition_index: 33, keyword_difficulty: 12 }).verdict,
    true,
  )
  // Head-term profile: huge volume, high difficulty
  const head = sweetSpot({ search_volume: 90500, cpc: 12, competition_index: 90, keyword_difficulty: 85 })
  assert.equal(head.verdict, false)
  assert.equal(head.micro_volume, false)
  assert.equal(head.low_difficulty, false)
  // Null metrics never pass
  assert.equal(
    sweetSpot({ search_volume: null, cpc: null, competition_index: null, keyword_difficulty: null }).verdict,
    false,
  )

  const base = { score: 0.9, breakdown: { keyword_signal: 0, trend_velocity: 0 as const, pain_depth: 0, workaround_bonus_applied: false }, contributing_sources: [], multi_url_pain_match: false, signal_count: 1, top_signals: [] }
  const ranked: ScoredTerm[] = [
    { term: 'crm for dentists', ...base },
    { term: 'unenriched', ...base },
  ]
  const out = applyEnrichment(ranked, [
    { term: 'CRM for Dentists', search_volume: 320, cpc: 6.4, competition_index: 33, keyword_difficulty: 12 },
  ])
  assert.equal(out[0].sweet_spot?.verdict, true)
  assert.equal(out[1].enrichment, null)
  assert.equal(out[1].sweet_spot, null)
})
