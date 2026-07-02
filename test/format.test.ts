import assert from 'node:assert/strict'
import test from 'node:test'
import { csvEscape, flattenRow, formatCtr, formatPosition, renderTable, toCsv, truncate } from '../src/format.ts'

test('csvEscape leaves plain values alone', () => {
  assert.equal(csvEscape('hello'), 'hello')
})

test('csvEscape quotes commas, quotes and newlines', () => {
  assert.equal(csvEscape('a,b'), '"a,b"')
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""')
  assert.equal(csvEscape('line1\nline2'), '"line1\nline2"')
})

test('toCsv renders header and rows', () => {
  assert.equal(
    toCsv(['query', 'clicks'], [['best shoes, cheap', 12], ['socks', 3]]),
    'query,clicks\n"best shoes, cheap",12\nsocks,3',
  )
})

test('renderTable pads and aligns', () => {
  const out = renderTable(['NAME', 'N'], [['ab', '100'], ['abcd', '7']], [false, true])
  assert.equal(out, 'NAME    N\n----  ---\nab    100\nabcd    7')
})

test('formatCtr renders a percentage with two decimals', () => {
  assert.equal(formatCtr(0.1234), '12.34%')
  assert.equal(formatCtr(0), '0.00%')
})

test('formatPosition rounds to one decimal', () => {
  assert.equal(formatPosition(3.14159), '3.1')
})

test('truncate adds an ellipsis only when needed', () => {
  assert.equal(truncate('short', 10), 'short')
  assert.equal(truncate('a'.repeat(12), 10), `${'a'.repeat(9)}…`)
})

test('flattenRow merges keys and metrics', () => {
  const flat = flattenRow(
    { keys: ['shoes', '2026-06-01'], clicks: 5, impressions: 100, ctr: 0.05, position: 2.4 },
    ['query', 'date'],
  )
  assert.deepEqual(flat, {
    query: 'shoes',
    date: '2026-06-01',
    clicks: 5,
    impressions: 100,
    ctr: 0.05,
    position: 2.4,
  })
})

test('flattenRow tolerates missing keys', () => {
  const flat = flattenRow({ clicks: 1, impressions: 2, ctr: 0.5, position: 1 }, ['query'])
  assert.equal(flat.query, '')
})
