import assert from 'node:assert/strict'
import test from 'node:test'
import { resample, sparkline } from '../src/trends/sparkline.ts'

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
