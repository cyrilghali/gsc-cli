import { CliError } from './config.ts'

const DAY_MS = 86_400_000

/** Search Console data is only final after ~2-3 days; default the range to end there. */
export const DATA_DELAY_DAYS = 3

export const DEFAULT_DAYS = 28

const pad = (n: number): string => String(n).padStart(2, '0')

export function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function parseIsoDate(value: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CliError(`Invalid ${flag} date "${value}".`, 'Expected YYYY-MM-DD, e.g. 2026-06-01.')
  }
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || toIsoDate(date) !== value) {
    throw new CliError(`Invalid ${flag} date "${value}": not a real calendar date.`)
  }
  return date
}

export interface DateRange {
  startDate: string
  endDate: string
}

export function resolveDateRange(
  opts: { start?: string; end?: string; days?: number },
  today: Date = new Date(),
): DateRange {
  const days = opts.days ?? DEFAULT_DAYS
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const end = opts.end ? parseIsoDate(opts.end, '--end') : new Date(todayUtc - DATA_DELAY_DAYS * DAY_MS)
  const start = opts.start ? parseIsoDate(opts.start, '--start') : new Date(end.getTime() - (days - 1) * DAY_MS)
  if (start.getTime() > end.getTime()) {
    throw new CliError(`--start (${toIsoDate(start)}) is after --end (${toIsoDate(end)}).`)
  }
  return { startDate: toIsoDate(start), endDate: toIsoDate(end) }
}
