import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseClientCredentialsFile } from '../src/auth.ts'
import { CliError } from '../src/config.ts'

/** Write a JSON file in a fresh temp dir and return both the dir and file path. */
function tempCreds(content: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gsc-auth-test-'))
  const path = join(dir, 'client_secret.json')
  writeFileSync(path, content)
  return { dir, path }
}

test('valid "installed" key file returns client_id and client_secret', () => {
  const { dir, path } = tempCreds(
    JSON.stringify({ installed: { client_id: 'id-installed', client_secret: 'sec-installed' } }),
  )
  try {
    const creds = parseClientCredentialsFile(path)
    assert.equal(creds.client_id, 'id-installed')
    assert.equal(creds.client_secret, 'sec-installed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('valid "web" key file returns client_id and client_secret', () => {
  const { dir, path } = tempCreds(
    JSON.stringify({ web: { client_id: 'id-web', client_secret: 'sec-web' } }),
  )
  try {
    const creds = parseClientCredentialsFile(path)
    assert.equal(creds.client_id, 'id-web')
    assert.equal(creds.client_secret, 'sec-web')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('missing file throws CliError about cannot read', () => {
  const nonExistent = join(tmpdir(), `gsc-auth-test-missing-${Date.now()}.json`)
  assert.throws(
    () => parseClientCredentialsFile(nonExistent),
    (e: unknown) => e instanceof CliError && e.message.includes('Cannot read'),
  )
})

test('JSON without installed or web key throws CliError about not looking like OAuth', () => {
  const { dir, path } = tempCreds(
    JSON.stringify({ other: { client_id: 'x', client_secret: 'y' } }),
  )
  try {
    assert.throws(
      () => parseClientCredentialsFile(path),
      (e: unknown) => e instanceof CliError && e.message.includes('does not look like'),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('installed entry missing client_secret throws CliError', () => {
  const { dir, path } = tempCreds(
    JSON.stringify({ installed: { client_id: 'only-id' } }),
  )
  try {
    assert.throws(
      () => parseClientCredentialsFile(path),
      (e: unknown) => e instanceof CliError && e.message.includes('does not look like'),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
