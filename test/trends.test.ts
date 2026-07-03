import assert from 'node:assert/strict'
import test from 'node:test'
import { CliError } from '../src/config.ts'
import { buildComparison } from '../src/trends/commands/interest.ts'
import { assessVolume, resample, sparkline } from '../src/trends/sparkline.ts'

test('sparkline maps min to the lowest block and max to the highest', () => {
  const out = sparkline([0, 50, 100])
  assert.equal(out.length, 3)
  assert.equal(out[0], '▁')
  assert.equal(out[2], '█')
})

test('sparkline handles a flat series without dividing by zero', () => {
  assert.equal(sparkline([7, 7, 7]), '▁▁▁')
})

test('sparkline returns empty string for no data', () => {
  assert.equal(sparkline([]), '')
})

test('resample leaves short series untouched', () => {
  assert.deepEqual(resample([1, 2, 3], 10), [1, 2, 3])
})

test('resample averages buckets down to the target width', () => {
  const out = resample([0, 0, 10, 10], 2)
  assert.deepEqual(out, [0, 10])
})

test('assessVolume flags a mostly-zero single-run series as noise', () => {
  // The real climradar 3-month shape: long dead stretch then one trailing spike.
  const series = [...Array(88).fill(0), 11, 59, 100, 85]
  const v = assessVolume(series)
  assert.equal(v.low, true)
  assert.equal(v.shape, 'noise')
})

test('assessVolume flags a mostly-zero multi-block series as seasonal', () => {
  const series = [...Array(40).fill(0), 30, 80, ...Array(40).fill(0), 25, 90, ...Array(20).fill(0)]
  const v = assessVolume(series)
  assert.equal(v.low, true)
  assert.equal(v.shape, 'seasonal')
})

test('assessVolume treats a healthy sustained series as ok', () => {
  const series = Array.from({ length: 52 }, (_, i) => 54 + (i % 47))
  const v = assessVolume(series)
  assert.equal(v.low, false)
  assert.equal(v.shape, 'ok')
})

test('assessVolume on all zeros is low noise with zeroFraction 1', () => {
  const v = assessVolume([0, 0, 0, 0])
  assert.equal(v.low, true)
  assert.equal(v.zeroFraction, 1)
  assert.equal(v.shape, 'noise')
})

test('assessVolume on an empty series is not low', () => {
  const v = assessVolume([])
  assert.equal(v.low, false)
  assert.equal(v.shape, 'ok')
})

test('assessVolume treats exactly 70% zeros as low (inclusive cutoff)', () => {
  const series = [0, 0, 0, 0, 0, 0, 0, 10, 20, 30]
  const v = assessVolume(series)
  assert.equal(v.low, true)
})

test('assessVolume treats scattered singletons as noise, not seasonal', () => {
  // Isolated non-zero points (no run reaches length 2) are noise, not a periodic pattern.
  const series = [0, 5, 0, 0, 7, 0, 0, 0, 4, 0, 0, 0]
  const v = assessVolume(series)
  assert.equal(v.low, true)
  assert.equal(v.shape, 'noise')
})

test('buildComparison: single keyword across geos yields geo-code labels', () => {
  const { items, labels } = buildComparison(['climatiseur mobile'], ['FR', 'BE', 'CH', 'LU'])
  assert.equal(items.length, 4)
  assert.deepEqual(labels, ['FR', 'BE', 'CH', 'LU'])
  assert.deepEqual(items[0], { keyword: 'climatiseur mobile', geo: 'FR' })
})

test('buildComparison: multiple keywords in one worldwide geo keeps keyword labels', () => {
  const { items, labels } = buildComparison(['pizza', 'sushi'], [''])
  assert.equal(items.length, 2)
  assert.deepEqual(labels, ['pizza', 'sushi'])
})

test('buildComparison: keyword × geo cross-product labels both axes', () => {
  const { labels } = buildComparison(['a', 'b'], ['FR', 'BE'])
  assert.deepEqual(labels, ['a (FR)', 'a (BE)', 'b (FR)', 'b (BE)'])
})

test('buildComparison: worldwide single geo one keyword keeps the keyword label', () => {
  const { labels } = buildComparison(['pizza'], [''])
  assert.deepEqual(labels, ['pizza'])
})

test('buildComparison dedupes repeated geos before counting the cap', () => {
  const { items, labels } = buildComparison(['x'], ['FR', 'FR'])
  assert.equal(items.length, 1)
  assert.deepEqual(labels, ['x']) // single distinct geo → keyword label per KTD4
})

test('buildComparison dedupes repeated keywords so labels/series stay unique', () => {
  // Duplicate keywords would otherwise collapse in JSON output (Object.fromEntries, last wins).
  const { items, labels } = buildComparison(['pizza', 'pizza'], [''])
  assert.equal(items.length, 1)
  assert.deepEqual(labels, ['pizza'])
})

test('buildComparison throws over the 5-series cap', () => {
  assert.throws(
    () => buildComparison(['a', 'b', 'c'], ['FR', 'BE']),
    (e) => e instanceof CliError && /= 6/.test(e.message),
  )
})
