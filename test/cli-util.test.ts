import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePositiveInt, pickCanonical, resolveSite } from '../src/cli-util.ts'
import { CliError } from '../src/config.ts'

// ── pickCanonical ──────────────────────────────────────────────────────────────

test('pickCanonical matches case-insensitively and returns the canonical spelling', () => {
  assert.equal(pickCanonical('TABLE', ['table', 'json'], '--output'), 'table')
  assert.equal(pickCanonical('JSON', ['table', 'json'], '--output'), 'json')
  assert.equal(pickCanonical('table', ['table', 'json'], '--output'), 'table')
  // Canonical spelling is taken from the allowed list, not the input
  assert.equal(pickCanonical('ASC', ['asc', 'desc'], '--sort'), 'asc')
})

test('pickCanonical throws with the flag name in the message when value is invalid', () => {
  assert.throws(
    () => pickCanonical('csv', ['table', 'json'], '--output'),
    (e: unknown) => e instanceof CliError && e.message.includes('--output'),
  )
})

// ── parsePositiveInt ───────────────────────────────────────────────────────────

test("parsePositiveInt: '3' returns 3", () => {
  assert.equal(parsePositiveInt('3', '--limit'), 3)
})

test("parsePositiveInt: '0' throws", () => {
  assert.throws(() => parsePositiveInt('0', '--limit'), CliError)
})

test("parsePositiveInt: '-1' throws", () => {
  assert.throws(() => parsePositiveInt('-1', '--limit'), CliError)
})

test("parsePositiveInt: '1.5' throws", () => {
  assert.throws(() => parsePositiveInt('1.5', '--limit'), CliError)
})

test("parsePositiveInt: 'xyz' throws", () => {
  assert.throws(() => parsePositiveInt('xyz', '--limit'), CliError)
})

// ── resolveSite ────────────────────────────────────────────────────────────────
// resolveSite reads config via configDir() which honours XDG_CONFIG_HOME at
// call-time, so we can redirect it to a temp dir without touching src/**.

test('resolveSite returns the explicit site arg without touching the config', () => {
  assert.equal(resolveSite('https://example.com/'), 'https://example.com/')
  assert.equal(resolveSite('sc-domain:example.com'), 'sc-domain:example.com')
})

test('resolveSite with no arg and no config throws CliError about no site specified', () => {
  // Point XDG_CONFIG_HOME at an empty temp dir → configDir() finds no config.json
  // → readConfig() returns {} → defaultSite is undefined → throws.
  const tempXdg = mkdtempSync(join(tmpdir(), 'gsc-cli-util-test-'))
  const savedXdg = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = tempXdg
  try {
    assert.throws(
      () => resolveSite(undefined),
      (e: unknown) => e instanceof CliError && e.message.includes('No site specified'),
    )
  } finally {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
    rmSync(tempXdg, { recursive: true, force: true })
  }
})

