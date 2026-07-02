import type { Command } from 'commander'
import pc from 'picocolors'
import { querySearchAnalytics, type SearchAnalyticsRequest, type SearchAnalyticsRow } from '../api.ts'
import { collect, parsePositiveInt, pickCanonical, resolveSite } from '../cli-util.ts'
import { DEFAULT_DAYS, resolveDateRange } from '../dates.ts'
import { parseFilter } from '../filters.ts'
import { flattenRow, formatCtr, formatInt, formatPosition, renderTable, toCsv } from '../format.ts'

const DIMENSIONS = ['query', 'page', 'country', 'device', 'date', 'searchAppearance'] as const
const TYPES = ['web', 'image', 'video', 'news', 'discover', 'googleNews'] as const
const SORT_FIELDS = ['clicks', 'impressions', 'ctr', 'position'] as const
const OUTPUTS = ['table', 'json', 'csv'] as const

/** With --sort, fetch this many rows before ranking, so the top-N is global rather than a re-ordered top-N-by-clicks. */
const SORT_FETCH_CAP = 100_000

type SortField = (typeof SORT_FIELDS)[number]

interface QueryOptions {
  start?: string
  end?: string
  days: string
  dimensions: string
  type: string
  filter: string[]
  limit: string
  sort?: string
  asc?: boolean
  fresh?: boolean
  output: string
}

export function registerQueryCommand(program: Command): void {
  program
    .command('query')
    .description('Query search analytics: clicks, impressions, CTR and position')
    .argument('[site]', 'property URL (defaults to the site set with `gsc sites use`)')
    .option('-s, --start <date>', 'start date, YYYY-MM-DD')
    .option('-e, --end <date>', `end date, YYYY-MM-DD (default: 3 days ago, the freshest final data)`)
    .option('-d, --days <n>', 'range length when --start is omitted', String(DEFAULT_DAYS))
    .option('--dimensions <list>', `comma-separated: ${DIMENSIONS.join(', ')}`, 'query')
    .option('-t, --type <type>', TYPES.join(' | '), 'web')
    .option('-f, --filter <filter>', '"<dimension> <operator> <expression>" (repeatable, ANDed)', collect, [])
    .option('-n, --limit <n>', 'maximum number of rows', '1000')
    .option('--sort <field>', `rank by ${SORT_FIELDS.join(' | ')} (descending): fetches the full dataset, then keeps the top --limit rows`)
    .option('--asc', 'rank ascending instead of descending (implies --sort clicks when no field is given)')
    .option('--fresh', 'include fresh data that is not yet final')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gsc query sc-domain:example.com
  gsc query --days 90 --dimensions page --sort impressions
  gsc query --dimensions query,page --filter "query contains shoes" --output csv
  gsc query --dimensions date --start 2026-01-01 --end 2026-06-30
Filter operators: contains, equals, notContains, notEquals, includingRegex, excludingRegex`,
    )
    .action(async (siteArg: string | undefined, opts: QueryOptions) => {
      const site = resolveSite(siteArg)
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const type = pickCanonical(opts.type, TYPES, '--type')
      const dimensions = opts.dimensions
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => pickCanonical(d, DIMENSIONS, 'dimension'))
      const limit = parsePositiveInt(opts.limit, '--limit')
      const range = resolveDateRange({
        start: opts.start,
        end: opts.end,
        days: parsePositiveInt(opts.days, '--days'),
      })
      const filters = opts.filter.map(parseFilter)
      const sort: SortField | undefined = opts.sort
        ? (pickCanonical(opts.sort, SORT_FIELDS, '--sort') as SortField)
        : opts.asc
          ? 'clicks'
          : undefined

      const requestBody: SearchAnalyticsRequest = {
        ...range,
        dimensions,
        type,
        ...(filters.length > 0 ? { dimensionFilterGroups: [{ filters }] } : {}),
        ...(opts.fresh ? { dataState: 'all' } : {}),
      }
      // The API only orders by clicks; a global ranking by another metric needs the whole dataset first.
      const fetched = await querySearchAnalytics(site, requestBody, sort ? Math.max(limit, SORT_FETCH_CAP) : limit)

      if (sort) {
        fetched.sort((a: SearchAnalyticsRow, b: SearchAnalyticsRow) => (opts.asc ? a[sort] - b[sort] : b[sort] - a[sort]))
        if (fetched.length >= SORT_FETCH_CAP) {
          console.error(pc.yellow(`Note: ranking computed over the first ${formatInt(SORT_FETCH_CAP)} rows; the dataset is larger.`))
        }
      }
      const rows = fetched.slice(0, limit)

      const flat = rows.map((row) => flattenRow(row, dimensions))
      const headers = [...dimensions, 'clicks', 'impressions', 'ctr', 'position']

      if (output === 'json') {
        console.log(JSON.stringify(flat, null, 2))
        return
      }
      if (output === 'csv') {
        console.log(toCsv(headers, flat.map((row) => headers.map((h) => row[h] ?? ''))))
        return
      }

      if (rows.length === 0) {
        console.error(`No data for ${site} between ${range.startDate} and ${range.endDate}.`)
        return
      }
      const rightAlign = headers.map((h) => ['clicks', 'impressions', 'ctr', 'position'].includes(h))
      console.log(
        renderTable(
          headers.map((h) => h.toUpperCase()),
          flat.map((row) => [
            ...dimensions.map((d) => String(row[d])),
            formatInt(row.clicks as number),
            formatInt(row.impressions as number),
            formatCtr(row.ctr as number),
            formatPosition(row.position as number),
          ]),
          rightAlign,
        ),
      )
      const totalClicks = rows.reduce((sum, r) => sum + r.clicks, 0)
      const totalImpressions = rows.reduce((sum, r) => sum + r.impressions, 0)
      console.error(
        pc.dim(
          `\n${rows.length} row${rows.length === 1 ? '' : 's'} · ${range.startDate} → ${range.endDate} · ${formatInt(totalClicks)} clicks · ${formatInt(totalImpressions)} impressions`,
        ),
      )
    })
}
