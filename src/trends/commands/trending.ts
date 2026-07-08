import type { Command } from 'commander'
import pc from 'picocolors'
import { parsePositiveInt, pickCanonical } from '../../cli-util.ts'
import { renderTable, toCsv, truncate } from '../../format.ts'
import { dailyTrends, validateGeo } from '../api.ts'

const OUTPUTS = ['table', 'json', 'csv'] as const

interface Options {
  geo: string
  limit: string
  output: string
}

export function registerTrendingCommand(program: Command): void {
  program
    .command('trending')
    .description("Today's daily trending searches for a country")
    .option('-g, --geo <code>', 'two-letter country code, e.g. US, FR, GB', 'US')
    .option('-n, --limit <n>', 'maximum rows', '20')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gtrends trending --geo US
  gtrends trending --geo FR --output json`,
    )
    .action(async (opts: Options) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const limit = parsePositiveInt(opts.limit, '--limit')
      const geo = (opts.geo || 'US').toUpperCase()
      validateGeo(geo)

      const trends = (await dailyTrends(geo)).slice(0, limit)
      if (trends.length === 0) {
        console.error(`No trending searches for ${geo}.`)
        return
      }

      if (output === 'json') {
        console.log(JSON.stringify(trends, null, 2))
        return
      }
      if (output === 'csv') {
        console.log(
          toCsv(
            ['rank', 'query', 'traffic', 'related'],
            trends.map((t, i) => [i + 1, t.query, t.traffic, t.relatedQueries.join('; ')]),
          ),
        )
        return
      }

      console.log(
        renderTable(
          ['#', 'QUERY', 'TRAFFIC'],
          trends.map((t, i) => [String(i + 1), truncate(t.query, 40), t.traffic]),
          [true, false, true],
        ),
      )
      console.error(pc.dim(`\n${trends.length} trending searches · ${geo}`))
    })
}
