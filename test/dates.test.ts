import assert from 'node:assert/strict'
import test from 'node:test'
import { parseIsoDate, resolveDateRange, toIsoDate } from '../src/dates.ts'

const today = new Date('2026-07-02T10:00:00Z')

test('default range is 28 days ending 3 days ago', () => {
  const range = resolveDateRange({}, today)
  assert.equal(range.endDate, '2026-06-29')
  assert.equal(range.startDate, '2026-06-02')
})

test('--days controls the range length', () => {
  const range = resolveDateRange({ days: 7 }, today)
  assert.equal(range.endDate, '2026-06-29')
  assert.equal(range.startDate, '2026-06-23')
})

test('--days 1 yields a single-day range', () => {
  const range = resolveDateRange({ days: 1 }, today)
  assert.equal(range.startDate, range.endDate)
})

test('explicit start and end are used verbatim', () => {
  const range = resolveDateRange({ start: '2026-01-01', end: '2026-03-31' }, today)
  assert.deepEqual(range, { startDate: '2026-01-01', endDate: '2026-03-31' })
})

test('--end alone derives start from --days', () => {
  const range = resolveDateRange({ end: '2026-06-10', days: 10 }, today)
  assert.deepEqual(range, { startDate: '2026-06-01', endDate: '2026-06-10' })
})

test('--start alone runs to the default end', () => {
  const range = resolveDateRange({ start: '2026-06-20' }, today)
  assert.deepEqual(range, { startDate: '2026-06-20', endDate: '2026-06-29' })
})

test('range crossing a month boundary', () => {
  const range = resolveDateRange({ end: '2026-03-05', days: 10 }, today)
  assert.deepEqual(range, { startDate: '2026-02-24', endDate: '2026-03-05' })
})

test('start after end throws', () => {
  assert.throws(() => resolveDateRange({ start: '2026-06-30', end: '2026-06-01' }, today), /is after/)
})

test('malformed date throws', () => {
  assert.throws(() => resolveDateRange({ start: '06/01/2026' }, today), /Invalid --start/)
  assert.throws(() => resolveDateRange({ end: '2026-6-1' }, today), /Invalid --end/)
})

test('impossible calendar date throws', () => {
  assert.throws(() => parseIsoDate('2026-02-30', '--start'), /not a real calendar date/)
  assert.throws(() => parseIsoDate('2026-13-01', '--start'), /not a real calendar date/)
})

test('leap day is accepted', () => {
  assert.equal(toIsoDate(parseIsoDate('2024-02-29', '--start')), '2024-02-29')
})
