import type { SearchAnalyticsRow } from './api.ts'

export function renderTable(headers: string[], rows: string[][], rightAlign: boolean[] = []): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => (rightAlign[i] ? (cell ?? '').padStart(widths[i]) : (cell ?? '').padEnd(widths[i])))
      .join('  ')
      .trimEnd()
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  return [line(headers), separator, ...rows.map(line)].join('\n')
}

export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]): string => cells.map((c) => csvEscape(String(c))).join(',')
  return [line(headers), ...rows.map(line)].join('\n')
}

export const formatCtr = (ctr: number): string => `${(ctr * 100).toFixed(2)}%`

export const formatPosition = (position: number): string => position.toFixed(1)

export const formatInt = (n: number): string => n.toLocaleString('en-US')

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/** Merge a row's dimension keys and metrics into one flat record, keyed by dimension name. */
export function flattenRow(row: SearchAnalyticsRow, dimensions: string[]): Record<string, string | number> {
  const flat: Record<string, string | number> = {}
  dimensions.forEach((dimension, i) => {
    flat[dimension] = row.keys?.[i] ?? ''
  })
  flat.clicks = row.clicks
  flat.impressions = row.impressions
  flat.ctr = row.ctr
  flat.position = row.position
  return flat
}
