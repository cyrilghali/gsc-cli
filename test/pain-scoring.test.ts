import assert from 'node:assert/strict'
import test from 'node:test'
import { scorePhrase, parseRisingValue, opportunityScore, DEV_TO_PHRASES } from '../src/pain/scoring.ts'

test('scorePhrase returns highest-weight match when multiple phrases appear near the term', () => {
  const text = 'frustrated with how invoicing works, i would pay for a better solution'
  const result = scorePhrase(text, 'invoicing')
  assert.ok(result !== null)
  assert.equal(result.matched_phrase, 'would pay')
  assert.equal(result.weight, 1.0)
})

test('scorePhrase returns null when phrase is more than 150 chars from the term', () => {
  const text = 'i would pay' + ' '.repeat(200) + 'invoicing'
  assert.equal(scorePhrase(text, 'invoicing'), null)
})

test('scorePhrase returns null when the term is absent', () => {
  assert.equal(scorePhrase('i would pay for this', 'missing'), null)
})

test('scorePhrase sets workaround_detected true for a workaround phrase', () => {
  const result = scorePhrase('we do this manually in our invoicing pipeline', 'invoicing')
  assert.ok(result !== null)
  assert.equal(result.workaround_detected, true)
})

test('parseRisingValue: 5000 → 1.0, 300 → 1.0, 150 → 0.5, NaN → 0', () => {
  assert.equal(parseRisingValue(5000), 1.0)
  assert.equal(parseRisingValue(300), 1.0)
  assert.equal(parseRisingValue(150), 0.5)
  assert.equal(parseRisingValue(NaN), 0)
})

test('opportunityScore clamps to 1.0 when all components are maxed with workaround bonus', () => {
  const result = opportunityScore({ keywordSignal: 1, trendVelocity: 1, painDepth: 1, workaroundDetected: true })
  assert.equal(result.score, 1.0)
})

test('opportunityScore breakdown carries weighted contributions and workaround_bonus_applied', () => {
  const r = opportunityScore({ keywordSignal: 1, trendVelocity: 0, painDepth: 0, workaroundDetected: false })
  assert.ok(Math.abs(r.breakdown.keyword_signal - 0.35) < 1e-10)
  assert.equal(r.breakdown.trend_velocity, 0)
  assert.equal(r.breakdown.pain_depth, 0)
  assert.equal(r.breakdown.workaround_bonus_applied, false)

  const r2 = opportunityScore({ keywordSignal: 0, trendVelocity: 0, painDepth: 0, workaroundDetected: true })
  assert.equal(r2.breakdown.workaround_bonus_applied, true)
})

// ── Word-boundary anchoring: roots must not match mid-word ────────────────────

test('scorePhrase: root does not anchor inside an unrelated word', () => {
  const r = scorePhrase('I struggled with capital management integrations', 'api', DEV_TO_PHRASES)
  assert.equal(r, null)
})
