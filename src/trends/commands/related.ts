import type { Command } from 'commander'
import pc from 'picocolors'
import { parsePositiveInt, pickCanonical } from '../../cli-util.ts'
import { renderTable, toCsv, truncate } from '../../format.ts'
import { type RankedQuery, relatedQueries, validateGeo } from '../api.ts'

const TIMEFRAMES = ['now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all'] as const
const OUTPUTS = ['table', 'json', 'csv'] as const

interface Options {
  geo: string
  time: string
  category: string
  limit: string
  output: string
}

export function registerRelatedCommand(program: Command): void {
  program
    .command('related')
    .description('Related queries for a keyword: top (established) and rising (breakout)')
    .argument('<keyword>', 'the search term to explore')
    .option('-g, --geo <code>', 'two-letter country code, e.g. US, FR (default: worldwide)', '')
    .option('-t, --time <timeframe>', TIMEFRAMES.join(' | '), 'today 12-m')
    .option('-c, --category <id>', 'Google Trends category id (0 = all)', '0')
    .option('-n, --limit <n>', 'rows per list', '15')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gtrends related "electric car"
  gtrends related coffee --geo FR --limit 10`,
    )
    .action(async (keyword: string, opts: Options) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const time = pickCanonical(opts.time, TIMEFRAMES, '--time')
      const category = Number(opts.category) || 0
      const limit = parsePositiveInt(opts.limit, '--limit')
      const geo = opts.geo.trim().toUpperCase()
      validateGeo(geo)

      const { top, rising } = await relatedQueries(keyword, geo, time, category)
      const topN = top.slice(0, limit)
      const risingN = rising.slice(0, limit)

      if (output === 'json') {
        console.log(JSON.stringify({ top: topN, rising: risingN }, null, 2))
        return
      }
      if (output === 'csv') {
        const rows: (string | number)[][] = [
          ...topN.map((q) => ['top', q.query, q.value]),
          ...risingN.map((q) => ['rising', q.query, q.formattedValue]),
        ]
        console.log(toCsv(['list', 'query', 'value'], rows))
        return
      }

      const section = (title: string, list: RankedQuery[], valueOf: (q: RankedQuery) => string): void => {
        console.log(pc.bold(`\n${title}`))
        if (list.length === 0) {
          console.log(pc.dim('  (none)'))
          return
        }
        console.log(renderTable(['QUERY', 'VALUE'], list.map((q) => [truncate(q.query, 48), valueOf(q)]), [false, true]))
      }
      section(`Top — ${keyword}`, topN, (q) => String(q.value))
      section(`Rising — ${keyword}`, risingN, (q) => q.formattedValue)
    })
}
