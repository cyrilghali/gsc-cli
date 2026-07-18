import assert from 'node:assert/strict'
import test from 'node:test'
import { INTENT_MARKERS, intentCompletions, parseTraffic, productCore, shockScore } from '../src/trends/commands/shocks.ts'

test('parseTraffic handles "200+", "20 000+" and empty strings', () => {
  assert.equal(parseTraffic('200+'), 200)
  assert.equal(parseTraffic('20 000+'), 20000)
  assert.equal(parseTraffic(''), null)
})

test('intentCompletions keeps root-anchored completions with a marker, drops news noise', () => {
  const completions = [
    'portasplit en stock',
    'portasplit avis',
    'portasplit prix',
    'ukraine news today',
    'stock market portas',
  ]
  assert.deepEqual(intentCompletions(completions, 'portasplit', INTENT_MARKERS.fr), [
    'portasplit en stock',
    'portasplit prix',
  ])
})

test('productCore: null for short queries, first 3 non-stopword tokens for long ones', () => {
  assert.equal(productCore('shark chillpill'), null)
  assert.equal(productCore('shark chillpill ventilateur brumisateur'), 'shark chillpill')
  assert.equal(productCore('rowenta ventilateur sur pied turbo'), 'rowenta ventilateur')
  assert.equal(productCore('ventilateur de plafond'), null)
})

test('shockScore: intent dominates, magnitude breaks ties, clamps to 1', () => {
  // News spike: huge traffic, no intent → capped at 0.4
  assert.ok(shockScore({ intentCount: 0, traffic: 500_000, risingValue: null }) <= 0.4)
  // Product hunt: 3 intents + breakout → 1.0
  assert.equal(shockScore({ intentCount: 3, traffic: null, risingValue: 5000 }), 1)
  // Intent without magnitude still leads over pure magnitude
  const intentOnly = shockScore({ intentCount: 3, traffic: 0, risingValue: null })
  const trafficOnly = shockScore({ intentCount: 0, traffic: 50_000, risingValue: null })
  assert.ok(intentOnly > trafficOnly)
})
