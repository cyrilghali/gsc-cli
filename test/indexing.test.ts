/**
 * Tests for src/commands/indexing.ts.
 * Fully offline: no network calls, no auth setup required.
 * Covers:
 *  - URL validation (rejects relative paths and non-http(s) schemes)
 *  - Notification type mapping (--deleted flag → URL_DELETED, default → URL_UPDATED)
 *  - Status formatter output from a fixture metadata object
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { CliError } from '../src/config.ts'
import {
  formatNotificationStatus,
  mapNotificationType,
  validateAbsoluteHttpUrl,
} from '../src/commands/indexing.ts'
import type { UrlNotificationMetadata } from '../src/api.ts'

// ── URL validation ─────────────────────────────────────────────────────────────

test('validateAbsoluteHttpUrl: accepts http URL', () => {
  assert.doesNotThrow(() => validateAbsoluteHttpUrl('http://example.com/page'))
})

test('validateAbsoluteHttpUrl: accepts https URL', () => {
  assert.doesNotThrow(() => validateAbsoluteHttpUrl('https://example.com/page'))
})

test('validateAbsoluteHttpUrl: rejects relative path', () => {
  assert.throws(
    () => validateAbsoluteHttpUrl('/some/page'),
    (err: unknown) => err instanceof CliError && err.message.includes('not a valid absolute URL'),
  )
})

test('validateAbsoluteHttpUrl: rejects bare path without scheme', () => {
  assert.throws(
    () => validateAbsoluteHttpUrl('example.com/page'),
    (err: unknown) => err instanceof CliError && err.message.includes('not a valid absolute URL'),
  )
})

test('validateAbsoluteHttpUrl: rejects ftp scheme', () => {
  assert.throws(
    () => validateAbsoluteHttpUrl('ftp://example.com/file.txt'),
    (err: unknown) => err instanceof CliError && err.message.includes('not a valid absolute URL'),
  )
})

test('validateAbsoluteHttpUrl: rejects empty string', () => {
  assert.throws(
    () => validateAbsoluteHttpUrl(''),
    (err: unknown) => err instanceof CliError,
  )
})

// ── Notification type mapping ──────────────────────────────────────────────────

test('mapNotificationType: false → URL_UPDATED', () => {
  assert.equal(mapNotificationType(false), 'URL_UPDATED')
})

test('mapNotificationType: true → URL_DELETED', () => {
  assert.equal(mapNotificationType(true), 'URL_DELETED')
})

// ── Status formatter ───────────────────────────────────────────────────────────

test('formatNotificationStatus: includes URL, notifyTime and type from latestUpdate', () => {
  const fixture: UrlNotificationMetadata = {
    url: 'https://example.com/page',
    latestUpdate: {
      url: 'https://example.com/page',
      type: 'URL_UPDATED',
      notifyTime: '2026-01-15T10:30:00Z',
    },
  }
  const output = formatNotificationStatus(fixture)
  assert.ok(output.includes('https://example.com/page'), 'should include the URL')
  assert.ok(output.includes('2026-01-15T10:30:00Z'), 'should include notifyTime')
  assert.ok(output.includes('URL_UPDATED'), 'should include notification type')
})

test('formatNotificationStatus: includes latestRemove when present', () => {
  const fixture: UrlNotificationMetadata = {
    url: 'https://example.com/page',
    latestUpdate: {
      url: 'https://example.com/page',
      type: 'URL_UPDATED',
      notifyTime: '2026-01-15T10:30:00Z',
    },
    latestRemove: {
      url: 'https://example.com/page',
      type: 'URL_DELETED',
      notifyTime: '2025-12-01T08:00:00Z',
    },
  }
  const output = formatNotificationStatus(fixture)
  assert.ok(output.includes('2025-12-01T08:00:00Z'), 'should include latestRemove notifyTime')
  assert.ok(output.includes('Last removed'), 'should include Last removed label')
})

test('formatNotificationStatus: omits missing optional fields', () => {
  const fixture: UrlNotificationMetadata = {}
  const output = formatNotificationStatus(fixture)
  assert.equal(output, '', 'empty metadata should produce empty output')
})

test('formatNotificationStatus: labels are padded to align values', () => {
  const fixture: UrlNotificationMetadata = {
    url: 'https://example.com/page',
    latestUpdate: {
      type: 'URL_UPDATED',
      notifyTime: '2026-01-15T10:30:00Z',
    },
  }
  const lines = formatNotificationStatus(fixture).split('\n')
  // Every non-empty line should have the value starting after position 17
  for (const line of lines) {
    if (!line.trim()) continue
    assert.ok(line.length > 17, `line too short to be padded: "${line}"`)
  }
})
