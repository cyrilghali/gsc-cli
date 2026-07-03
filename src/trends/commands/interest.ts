import type { Command } from 'commander'
import pc from 'picocolors'
import { pickCanonical } from '../../cli-util.ts'
import { renderTable, toCsv, truncate } from '../../format.ts'
import { interestOverTime } from '../api.ts'
import { resample, sparkline } from '../sparkline.ts'

const TIMEFRAMES = ['now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all'] as const
const OUTPUTS = ['table', 'json', 'csv'] as const
const SPARK_WIDTH = 48

interface Options {
  geo: string
  time: string
  category: string
  output: string
}

const round = (n: number): number => Math.round(n)

export function registerInterestCommand(program: Command): void {
  program
    .command('interest')
    .description('Interest over time for one or more keywords (0–100, relative to peak)')
    .argument('<keyword...>', 'one or more search terms to compare (up to 5)')
    .option('-g, --geo <code>', 'two-letter country code, e.g. US, FR (default: worldwide)', '')
    .option('-t, --time <timeframe>', TIMEFRAMES.join(' | '), 'today 12-m')
    .option('-c, --category <id>', 'Google Trends category id (0 = all)', '0')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gtrends interest "chatgpt"
  gtrends interest pizza sushi tacos --geo US
  gtrends interest bitcoin --time "today 5-y" --output csv`,
    )
    .action(async (keywords: string[], opts: Options) => {
      if (keywords.length > 5) throw new Error('Google Trends compares at most 5 keywords at once.')
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const time = pickCanonical(opts.time, TIMEFRAMES, '--time')
      const category = Number(opts.category) || 0

      const { points } = await interestOverTime(keywords, opts.geo, time, category)
      if (points.length === 0) {
        console.error('No interest data for that query.')
        return
      }

      if (output === 'json') {
        console.log(
          JSON.stringify(
            points.map((p) => ({
              time: p.formattedTime,
              ...Object.fromEntries(keywords.map((k, i) => [k, p.value[i] ?? 0])),
            })),
            null,
            2,
          ),
        )
        return
      }
      if (output === 'csv') {
        const headers = ['time', ...keywords]
        console.log(toCsv(headers, points.map((p) => [p.formattedTime, ...keywords.map((_, i) => p.value[i] ?? 0)])))
        return
      }

      // Table: one sparkline summary row per keyword.
      const rows = keywords.map((kw, i) => {
        const series = points.map((p) => p.value[i] ?? 0)
        const spark = sparkline(resample(series, SPARK_WIDTH))
        const min = Math.min(...series)
        const max = Math.max(...series)
        const avg = series.reduce((a, b) => a + b, 0) / series.length
        const latest = series[series.length - 1]
        return [truncate(kw, 24), spark, String(min), String(round(avg)), String(max), String(latest)]
      })
      console.log(renderTable(['KEYWORD', `TREND (${points.length} pts)`, 'MIN', 'AVG', 'MAX', 'NOW'], rows, [false, false, true, true, true, true]))
      const span = `${points[0].formattedTime} → ${points[points.length - 1].formattedTime}`
      console.error(pc.dim(`\n${span}${opts.geo ? ` · ${opts.geo}` : ' · worldwide'} · values relative to peak (100)`))
    })
}
