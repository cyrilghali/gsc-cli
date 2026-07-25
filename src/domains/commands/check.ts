import type { Command } from 'commander'
import pc from 'picocolors'
import { pickCanonical, sleep } from '../../cli-util.ts'

const OUTPUTS = ['table', 'json'] as const

export const ENDPOINTS: Record<string, string> = {
  com: 'https://rdap.verisign.com/com/v1/domain',
  fr: 'https://rdap.nic.fr/domain',
}

export interface DomainResult {
  domain: string
  status: 'available' | 'registered' | 'error'
  reason?: string
}

/**
 * Expand bare names across tlds; dotted names pass through as-is.
 */
export function expandNames(names: string[], tlds: string[]): string[] {
  const result: string[] = []
  for (const name of names) {
    if (name.includes('.')) {
      result.push(name)
    } else {
      for (const tld of tlds) {
        result.push(`${name}.${tld}`)
      }
    }
  }
  return result
}

/**
 * Check a single domain via RDAP.
 * 404 → available, 200 → registered, anything else → error.
 * Per-domain errors never throw — always resolves.
 */
export async function rdapStatus(rawDomain: string): Promise<DomainResult> {
  const domain = rawDomain.toLowerCase()
  const tld = domain.split('.').pop()!
  const base = ENDPOINTS[tld]
  if (!base) {
    return { domain, status: 'error', reason: `unsupported TLD: ${tld}` }
  }
  const url = `${base}/${domain}`
  for (let attempt = 0; attempt <= 1; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30_000)
    try {
      const res = await fetch(url, { signal: ac.signal })
      if (res.status === 429) {
        if (attempt === 0) {
          await sleep(1_000)
          continue
        }
        return { domain, status: 'error', reason: 'HTTP 429 after retry' }
      }
      if (res.status === 404) return { domain, status: 'available' }
      if (res.status === 200) return { domain, status: 'registered' }
      return { domain, status: 'error', reason: `HTTP ${res.status}` }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { domain, status: 'error', reason: 'request timed out (30 s)' }
      }
      return { domain, status: 'error', reason: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timer)
    }
  }
  return { domain, status: 'error', reason: 'unexpected state after retry' }
}

/** Check all domains sequentially with 250 ms inter-call sleep (anti-429). */
export async function checkDomains(domains: string[]): Promise<DomainResult[]> {
  const results: DomainResult[] = []
  for (let i = 0; i < domains.length; i++) {
    if (i > 0) await sleep(250)
    results.push(await rdapStatus(domains[i]))
  }
  return results
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Check domain availability via RDAP (supports .com and .fr)')
    .argument('<name...>', 'bare names (vetoline) or full domains (vetoline.fr) to check')
    .option('--tlds <list>', 'comma-separated TLDs to expand bare names against', 'com,fr')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gdom check vetoline                    check vetoline.com and vetoline.fr
  gdom check vetoline --tlds com         .com only
  gdom check vetoline.fr other.com -o json`,
    )
    .action(async (names: string[], opts: { tlds: string; output: string }) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const tlds = opts.tlds
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const domains = expandNames(names, tlds)
      const results = await checkDomains(domains)

      if (output === 'json') {
        console.log(JSON.stringify(results))
        return
      }

      for (const { domain, status, reason } of results) {
        if (status === 'available') {
          console.log(`${pc.green('available')}   ${domain}`)
        } else if (status === 'registered') {
          console.log(`${pc.dim('registered')}  ${domain}`)
        } else {
          console.log(`${pc.red('error')}       ${domain}  ${pc.dim(reason ?? '')}`)
        }
      }
    })
}
