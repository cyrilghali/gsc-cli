import assert from 'node:assert/strict'
import test from 'node:test'
import { Command } from 'commander'
import { CliError } from '../src/config.ts'
import { checkDomains, expandNames, rdapStatus, registerCheckCommand } from '../src/domains/commands/check.ts'

const toUrl = (u: string | URL | Request): string =>
  typeof u === 'string' ? u : u instanceof URL ? u.href : (u as Request).url

// ── check command flag validation ─────────────────────────────────────────────

test('check: empty --tlds throws CliError instead of silently checking nothing', async () => {
  const program = new Command()
  registerCheckCommand(program)
  await assert.rejects(
    program.parseAsync(['check', 'foo', '--tlds', ''], { from: 'user' }),
    CliError,
  )
})

// ── expandNames ───────────────────────────────────────────────────────────────

test('expandNames: bare name expands across provided TLDs', () => {
  assert.deepEqual(expandNames(['vetoline'], ['com', 'fr']), ['vetoline.com', 'vetoline.fr'])
})

test('expandNames: dotted name passed through as-is, not re-expanded', () => {
  assert.deepEqual(expandNames(['vetoline.fr'], ['com', 'fr']), ['vetoline.fr'])
})

test('expandNames: mix of bare and dotted names', () => {
  assert.deepEqual(expandNames(['acme', 'vetoline.fr'], ['com', 'fr']), [
    'acme.com',
    'acme.fr',
    'vetoline.fr',
  ])
})

// ── rdapStatus ────────────────────────────────────────────────────────────────

test('rdapStatus: HTTP 404 → available', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  const result = await rdapStatus('example.com')
  assert.equal(result.domain, 'example.com')
  assert.equal(result.status, 'available')
})

test('rdapStatus: HTTP 200 → registered', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }))
  const result = await rdapStatus('taken.fr')
  assert.equal(result.domain, 'taken.fr')
  assert.equal(result.status, 'registered')
})

test('rdapStatus: bare name hits Verisign for .com and AFNIC for .fr', async (t) => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = toUrl(url)
    calls.push(urlStr)
    return new Response('', { status: 404 })
  })

  const domains = expandNames(['test'], ['com', 'fr'])
  for (const domain of domains) {
    await rdapStatus(domain)
  }

  assert.ok(
    calls.some((u) => u.includes('rdap.verisign.com') && u.includes('test.com')),
    `expected Verisign URL for test.com, got: ${JSON.stringify(calls)}`,
  )
  assert.ok(
    calls.some((u) => u.includes('rdap.nic.fr') && u.includes('test.fr')),
    `expected AFNIC URL for test.fr, got: ${JSON.stringify(calls)}`,
  )
})

test('rdapStatus: 429 then 200 → retried once, resolves registered', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls === 1) return new Response('', { status: 429 })
    return new Response('{}', { status: 200 })
  })
  const result = await rdapStatus('example.com')
  assert.equal(result.status, 'registered')
  assert.equal(calls, 2)
})

test('rdapStatus: 429 twice → error status, not a crash', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }))
  const result = await rdapStatus('example.com')
  assert.equal(result.status, 'error')
  assert.ok(result.reason !== undefined && result.reason.length > 0)
})

test('rdapStatus: unsupported TLD (x.dev) → error with reason mentioning the TLD', async (t) => {
  // fetch must NOT be called — no mock needed
  const result = await rdapStatus('x.dev')
  assert.equal(result.domain, 'x.dev')
  assert.equal(result.status, 'error')
  assert.ok(result.reason?.includes('dev'), `reason should mention 'dev': ${result.reason}`)
})

test('rdapStatus: AbortError (timeout) → error, not a crash', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    throw err
  })
  const result = await rdapStatus('example.com')
  assert.equal(result.status, 'error')
  assert.ok(result.reason !== undefined)
})

test('rdapStatus: non-abort network error (ECONNREFUSED) → error with message as reason', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('ECONNREFUSED')
  })
  const result = await rdapStatus('example.com')
  assert.equal(result.status, 'error')
  assert.ok(result.reason?.includes('ECONNREFUSED'), `reason: ${result.reason}`)
})

// ── checkDomains (batch behaviour) ───────────────────────────────────────────

test('checkDomains: 429 twice for one domain, batch continues, all domains appear in output', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = toUrl(url)
    if (urlStr.includes('problem.com')) return new Response('', { status: 429 })
    return new Response('', { status: 404 })
  })
  const results = await checkDomains(['problem.com', 'other.com'])
  assert.equal(results.length, 2, 'both domains must appear in output')
  assert.equal(results[0].domain, 'problem.com')
  assert.equal(results[0].status, 'error')
  assert.equal(results[1].domain, 'other.com')
  assert.equal(results[1].status, 'available')
})

test('checkDomains: unsupported TLD domain errors, batch continues, remaining domains checked', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  const results = await checkDomains(['x.dev', 'valid.com'])
  assert.equal(results.length, 2)
  assert.equal(results[0].domain, 'x.dev')
  assert.equal(results[0].status, 'error')
  assert.ok(results[0].reason?.includes('dev'))
  assert.equal(results[1].domain, 'valid.com')
  assert.equal(results[1].status, 'available')
})

test('checkDomains: non-abort error for one domain, batch continues', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const urlStr = toUrl(url)
    if (urlStr.includes('boom.com')) throw new Error('ECONNREFUSED')
    return new Response('{}', { status: 200 })
  })
  const results = await checkDomains(['boom.com', 'fine.com'])
  assert.equal(results.length, 2)
  assert.equal(results[0].status, 'error')
  assert.equal(results[1].domain, 'fine.com')
  assert.equal(results[1].status, 'registered')
})

// ── JSON output shape ─────────────────────────────────────────────────────────

test('checkDomains result: JSON-serializable array with {domain, status} shape', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  const results = await checkDomains(['example.com'])
  const parsed = JSON.parse(JSON.stringify(results)) as unknown[]
  assert.ok(Array.isArray(parsed))
  const first = parsed[0] as Record<string, unknown>
  assert.equal(first['domain'], 'example.com')
  assert.equal(first['status'], 'available')
  assert.equal(first['reason'], undefined, 'no reason field on clean available result')
})
