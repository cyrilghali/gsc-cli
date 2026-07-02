import { CliError, readConfig } from './config.ts'

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
