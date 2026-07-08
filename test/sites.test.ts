import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSiteExists } from '../src/commands/sites.ts'
import { patchEnv } from './helpers.ts'

function setupTempConfig(): { xdgBase: string; cleanup: () => void } {
  const xdgBase = mkdtempSync(join(tmpdir(), 'gsc-sites-test-'))
  const configDir = join(xdgBase, 'gsc-cli')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, 'tokens.json'),
    JSON.stringify({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expiry: 9_999_999_999_999,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      client_id: 'mock-client-id',
      client_secret: 'mock-client-secret',
    }),
  )
  return { xdgBase, cleanup: () => rmSync(xdgBase, { recursive: true, force: true }) }
}

function patchAuthEnv(xdgBase: string): () => void {
  return patchEnv({ XDG_CONFIG_HOME: xdgBase, GOOGLE_APPLICATION_CREDENTIALS: undefined })
}

function mockSiteList(urls: { siteUrl: string; permissionLevel: string }[]) {
  return async () =>
    new Response(
      JSON.stringify({ siteEntry: urls }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
}

test('validateSiteExists: exact match returns ok: true', async (t) => {
  const { xdgBase, cleanup } = setupTempConfig()
  const restoreEnv = patchAuthEnv(xdgBase)
  t.mock.method(globalThis, 'fetch', mockSiteList([
    { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
  ]))
  try {
    const result = await validateSiteExists('sc-domain:example.com')
    assert.equal(result.ok, true)
    assert.equal(result.nearMiss, undefined)
  } finally {
    restoreEnv()
    cleanup()
  }
})

test('validateSiteExists: non-existent property returns ok: false without nearMiss', async (t) => {
  const { xdgBase, cleanup } = setupTempConfig()
  const restoreEnv = patchAuthEnv(xdgBase)
  t.mock.method(globalThis, 'fetch', mockSiteList([
    { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
  ]))
  try {
    const result = await validateSiteExists('sc-domain:completely-different.com')
    assert.equal(result.ok, false)
    assert.equal(result.nearMiss, undefined)
  } finally {
    restoreEnv()
    cleanup()
  }
})

test('validateSiteExists: trailing-slash variant surfaces as nearMiss', async (t) => {
  const { xdgBase, cleanup } = setupTempConfig()
  const restoreEnv = patchAuthEnv(xdgBase)
  t.mock.method(globalThis, 'fetch', mockSiteList([
    { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
  ]))
  try {
    const result = await validateSiteExists('https://example.com')
    assert.equal(result.ok, false)
    assert.equal(result.nearMiss, 'https://example.com/')
  } finally {
    restoreEnv()
    cleanup()
  }
})
