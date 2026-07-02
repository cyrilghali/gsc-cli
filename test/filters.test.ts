import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFilter } from '../src/filters.ts'

test('parses a simple contains filter', () => {
  assert.deepEqual(parseFilter('query contains shoes'), {
    dimension: 'query',
    operator: 'contains',
    expression: 'shoes',
  })
})

test('expression may contain spaces', () => {
  assert.deepEqual(parseFilter('query contains running shoes for women'), {
    dimension: 'query',
    operator: 'contains',
    expression: 'running shoes for women',
  })
})

test('dimension and operator are case-insensitive, canonicalized', () => {
  assert.deepEqual(parseFilter('PAGE INCLUDINGREGEX ^/blog/'), {
    dimension: 'page',
    operator: 'includingRegex',
    expression: '^/blog/',
  })
  assert.equal(parseFilter('searchappearance equals AMP_BLUE_LINK').dimension, 'searchAppearance')
  assert.equal(parseFilter('query notcontains foo').operator, 'notContains')
})

test('device expressions are uppercased and validated', () => {
  assert.equal(parseFilter('device equals mobile').expression, 'MOBILE')
  assert.throws(() => parseFilter('device equals phone'), /Unknown device/)
})

test('country expressions are lowercased', () => {
  assert.equal(parseFilter('country equals FRA').expression, 'fra')
})

test('unknown dimension throws', () => {
  assert.throws(() => parseFilter('clicks equals 10'), /Unknown filter dimension/)
})

test('date is not a filterable dimension', () => {
  assert.throws(() => parseFilter('date equals 2026-01-01'), /Unknown filter dimension/)
})

test('unknown operator throws', () => {
  assert.throws(() => parseFilter('query matches shoes'), /Unknown filter operator/)
})

test('missing expression throws', () => {
  assert.throws(() => parseFilter('query contains'), /Invalid filter/)
})
