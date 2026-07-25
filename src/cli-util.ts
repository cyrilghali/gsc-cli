import pc from 'picocolors'
import { CliError, readConfig } from './config.ts'

/** Shared final error handler for every bin's `program.parseAsync().catch(...)`. */
export function handleCliError(err: unknown): never {
  if (err instanceof CliError) {
    console.error(`${pc.red('Error:')} ${err.message}`)
    if (err.hint) console.error(pc.dim(err.hint))
  } else {
    console.error(
      `${pc.red('Unexpected error:')} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    )
  }
  process.exit(1)
}

export function resolveSite(siteArg?: string): string {
  const site = siteArg ?? readConfig().defaultSite
  if (!site) {
    throw new CliError(
      'No site specified.',
      'Pass the property (e.g. sc-domain:example.com or https://example.com/) or set a default with `gsc sites use <site>`.',
    )
  }
  return site
}

export function parsePositiveInt(value: string | number, flag: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) {
    throw new CliError(`${flag} must be a positive integer (got "${value}").`)
  }
  return n
}

/** Case-insensitively match `value` against `allowed`, returning the canonical spelling. */
export function pickCanonical(value: string, allowed: readonly string[], flag: string): string {
  const hit = allowed.find((a) => a.toLowerCase() === String(value).toLowerCase())
  if (!hit) {
    throw new CliError(`Invalid ${flag} "${value}".`, `Valid values: ${allowed.join(', ')}.`)
  }
  return hit
}

/** Collector for repeatable commander options. */
export const collect = (value: string, previous: string[]): string[] => [...previous, value]

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Lowercase, collapse non-alphanumerics to hyphens, trim hyphen edges. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
