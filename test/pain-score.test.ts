import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PainSignal } from '../src/pain/signal.ts'
import { scoreTerms, snapshotSlug } from '../src/pain/commands/score.ts'
import type { ScoredTerm } from '../src/pain/commands/score.ts'

type MinedSignal = PainSignal & { multi_source_pain_match: boolean }

function sig(
  overrides: Partial<PainSignal> & { url: string; weight: number; term: string } & { multi_source_pain_match?: boolean },
): MinedSignal {
  return {
    source: 'hn',
    story_title: 'Test Story',
    excerpt: 'some excerpt',
    matched_phrase: 'would pay',
    workaround_detected: false,
    created_at: '2026-01-01T00:00:00Z',
    multi_source_pain_match: false,
    ...overrides,
  }
}

// ── Test 1: ranked order, case-insensitive keyword join, sorted sources ────────

test('scoreTerms: ranks by score desc, case-insensitive keyword join, distinct sorted contributing_sources', () => {
  const signals: MinedSignal[] = [
    sig({ term: 'crm alternative', url: 'https://hn.com/1', weight: 0.9, source: 'hn' }),
    sig({ term: 'crm alternative', url: 'https://dev.to/1', weight: 0.65, source: 'devto' }),
    sig({ term: 'invoicing', url: 'https://hn.com/2', weight: 0.55, source: 'hn' }),
  ]

  const keywords = [
    // suggestion 'CRM Alternative' must match term 'crm alternative' case-insensitively
    { seed: 'crm', pattern: 'alternative to {seed}', suggestion: 'CRM Alternative' },
  ]

  // parseRisingValue(150) = 150/300 = 0.5 — only the seed-matching entry counts;
  // the unrelated breakout junk (value 13000) must be filtered out, not drive a global max
  const rising = [
    { query: 'best crm software', value: 150 },
    { query: 'lidl near me', value: 13000 },
  ]

  const ranked = scoreTerms(signals, keywords, rising)

  assert.equal(ranked.length, 2)

  // crm alternative should rank first
  assert.equal(ranked[0].term, 'crm alternative')
  assert.equal(ranked[1].term, 'invoicing')

  // Verify crm alternative breakdown
  // keywordSignal = patternWeight('alternative to {seed}') = 0.9
  // keyword_signal component = 0.9 * 0.35 = 0.315
  // trendVelocity = max(parseRisingValue(150)) = 0.5
  // trend_velocity component = 0.5 * 0.25 = 0.125
  // painDepth = (0.9 + 0.65) / 2 = 0.775
  // pain_depth component = 0.775 * 0.40 = 0.31
  const crm = ranked[0]
  assert.ok(Math.abs(crm.breakdown.keyword_signal - 0.315) < 1e-9)
  assert.ok(Math.abs((crm.breakdown.trend_velocity as number) - 0.125) < 1e-9)
  assert.ok(Math.abs(crm.breakdown.pain_depth - 0.31) < 1e-9)
  assert.equal(crm.breakdown.workaround_bonus_applied, false)
  assert.equal(crm.signal_count, 2)

  // contributing_sources must be sorted and distinct
  assert.deepEqual(crm.contributing_sources, ['devto', 'hn'])

  // invoicing has no keyword match → default 0.3 → keyword_signal component = 0.3 * 0.35 = 0.105
  const inv = ranked[1]
  assert.ok(Math.abs(inv.breakdown.keyword_signal - 0.105) < 1e-9)
  assert.deepEqual(inv.contributing_sources, ['hn'])
})

// ── Test 1b: seed-level join — a term equal to a seed inherits its best pattern ─

test('scoreTerms: term matching a keyword seed gets that seed\'s best pattern weight', () => {
  const signals: MinedSignal[] = [
    sig({ term: 'invoicing', url: 'https://hn.com/3', weight: 0.6 }),
  ]
  const keywords = [
    { seed: 'invoicing', pattern: '{seed} pricing', suggestion: 'invoicing pricing 2026' },
    { seed: 'invoicing', pattern: 'alternative to {seed}', suggestion: 'alternative to xero' },
  ]

  const ranked = scoreTerms(signals, keywords, null)
  // best pattern for the seed is 'alternative to {seed}' → 0.9 → component 0.9 × 0.35
  assert.ok(Math.abs(ranked[0].breakdown.keyword_signal - 0.9 * 0.35) < 1e-9)
})

// ── Test 2: no trend file → 'absent' marker, 0 contribution ──────────────────

test('scoreTerms: risingValues=null marks breakdown trend_velocity as "absent" and contributes 0', () => {
  const signals: MinedSignal[] = [
    sig({ term: 'saas tool', url: 'https://hn.com/x', weight: 0.7 }),
  ]

  const ranked = scoreTerms(signals, [], null)

  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].breakdown.trend_velocity, 'absent')

  // score = 0.3*0.35 + 0 + 0.7*0.40 = 0.105 + 0.28 = 0.385
  const expectedScore = 0.3 * 0.35 + 0.7 * 0.40
  assert.ok(Math.abs(ranked[0].score - expectedScore) < 1e-9)
})

// ── Test 3: workaround bonus applies 1.2× to pain_depth; score stays ≤ 1 ─────

test('scoreTerms: workaround signal gets 1.2× pain bonus, scores higher than twin without it, score ≤ 1', () => {
  const allSignals: MinedSignal[] = [
    sig({ term: 'workaround-term', url: 'https://hn.com/w', weight: 0.7, workaround_detected: true }),
    sig({ term: 'plain-term', url: 'https://hn.com/p', weight: 0.7, workaround_detected: false }),
  ]

  const ranked = scoreTerms(allSignals, [], null)

  const wTerm = ranked.find((t) => t.term === 'workaround-term')
  const pTerm = ranked.find((t) => t.term === 'plain-term')
  assert.ok(wTerm != null)
  assert.ok(pTerm != null)

  // workaround term must score strictly higher
  assert.ok(wTerm.score > pTerm.score)
  assert.equal(wTerm.breakdown.workaround_bonus_applied, true)
  assert.equal(pTerm.breakdown.workaround_bonus_applied, false)

  // Both must stay ≤ 1
  assert.ok(wTerm.score <= 1)
  assert.ok(pTerm.score <= 1)

  // Max values: all-1 inputs with workaround still clamps to 1.0
  const maxSignals: MinedSignal[] = [
    sig({ term: 'max-term', url: 'https://hn.com/m', weight: 1.0, workaround_detected: true }),
  ]
  const maxKeywords = [{ seed: 'max', pattern: 'alternative to {seed}', suggestion: 'max-term' }]
  const maxRanked = scoreTerms(maxSignals, maxKeywords, [{ query: 'max tools', value: 5000 }])
  assert.equal(maxRanked[0].score, 1)
})

// ── Test 4: snapshotSlug determinism + tmpdir write ───────────────────────────

test('snapshotSlug: deterministic, hyphenated, ≤60 chars, order-independent; snapshot file contains ranked JSON', () => {
  const slug1 = snapshotSlug(['crm alternative', 'invoicing'])
  const slug2 = snapshotSlug(['invoicing', 'crm alternative'])
  assert.equal(slug1, slug2)
  assert.equal(slug1, 'crm-alternative-invoicing')
  assert.ok(slug1.length <= 60)
  assert.ok(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug1))

  // Write ranked JSON to tmpdir and verify contents
  const tmpDir = mkdtempSync(join(tmpdir(), 'pain-score-'))
  const outPath = join(tmpDir, 'test-snapshot.json')

  const signals: MinedSignal[] = [
    sig({ term: 'crm alternative', url: 'https://hn.com/1', weight: 0.9 }),
    sig({ term: 'invoicing', url: 'https://hn.com/2', weight: 0.55 }),
  ]

  // risingValues=[] (file present but empty): trendVelocity=0, breakdown is 0 (not 'absent')
  const ranked = scoreTerms(signals, [], [])
  writeFileSync(outPath, JSON.stringify(ranked, null, 2))

  const written = JSON.parse(readFileSync(outPath, 'utf8')) as ScoredTerm[]
  assert.ok(Array.isArray(written))
  assert.equal(written.length, 2)
  // crm alternative has higher painDepth → ranks first
  assert.equal(written[0].term, 'crm alternative')
  // trend_velocity is a number (0), not 'absent', because file was present
  assert.equal(written[0].breakdown.trend_velocity, 0)
})
