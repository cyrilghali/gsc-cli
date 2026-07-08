import type { Command } from 'commander'
import pc from 'picocolors'
import { pickCanonical } from '../../cli-util.ts'
import { CliError } from '../../config.ts'
import { renderTable, toCsv, truncate } from '../../format.ts'
import { interestOverTime, validateGeo } from '../api.ts'
import { assessVolume, resample, sparkline } from '../sparkline.ts'

const TIMEFRAMES = ['now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all'] as const
const OUTPUTS = ['table', 'json', 'csv'] as const
const SPARK_WIDTH = 48
const MAX_SERIES = 5

interface Options {
  geo: string
  time: string
  category: string
  output: string
}

/**
 * Build the keyword × geo comparison items (and their display labels) for one `explore`
 * request. Google compares at most 5 items at once, so the cross-product is capped.
 * Labels follow KTD4: a single geo labels by keyword; multiple geos with one keyword label
 * by geo code; multiple geos and multiple keywords label by `keyword (GEO)`.
 */
export function buildComparison(
  keywords: string[],
  geos: string[],
): { items: { keyword: string; geo: string }[]; labels: string[] } {
  const uniqueKeywords = [...new Set(keywords)]
  const uniqueGeos = [...new Set(geos)]
  const total = uniqueKeywords.length * uniqueGeos.length
  if (total > MAX_SERIES) {
    throw new CliError(
      `Too many series to compare: ${uniqueKeywords.length} keyword(s) × ${uniqueGeos.length} geo(s) = ${total}.`,
      `Google Trends compares at most ${MAX_SERIES} series at once. Reduce the keywords or geos.`,
    )
  }
  const multiGeo = uniqueGeos.length > 1
  const multiKeyword = uniqueKeywords.length > 1
  const items: { keyword: string; geo: string }[] = []
  const labels: string[] = []
  for (const keyword of uniqueKeywords) {
    for (const geo of uniqueGeos) {
      items.push({ keyword, geo })
      const geoLabel = geo || 'worldwide'
      labels.push(multiGeo ? (multiKeyword ? `${keyword} (${geoLabel})` : geoLabel) : keyword)
    }
  }
  return { items, labels }
}

export function registerInterestCommand(program: Command): void {
  program
    .command('interest')
    .description('Interest over time for one or more keywords, optionally across geos (0–100, relative to peak)')
    .argument('<keyword...>', 'one or more search terms to compare (keywords × geos ≤ 5)')
    .option('-g, --geo <codes>', 'comma-separated country codes, e.g. FR or FR,BE,CH,LU (default: worldwide)', '')
    .option('-t, --time <timeframe>', TIMEFRAMES.join(' | '), 'today 12-m')
    .option('-c, --category <id>', 'Google Trends category id (0 = all)', '0')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gtrends interest "chatgpt"
  gtrends interest pizza sushi tacos --geo US
  gtrends interest "climatiseur mobile" --geo FR,BE,CH,LU
  gtrends interest bitcoin --time "today 5-y" --output csv`,
    )
    .action(async (keywords: string[], opts: Options) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const time = pickCanonical(opts.time, TIMEFRAMES, '--time')
      const category = Number(opts.category) || 0

      const geos = [...new Set(opts.geo.split(',').map((g) => g.trim().toUpperCase()).filter(Boolean))]
      const geoList = geos.length ? geos : ['']
      for (const g of geoList) validateGeo(g)
      const { items, labels } = buildComparison(keywords, geoList)

      const { points } = await interestOverTime(items, time, category)
      if (points.length === 0) {
        console.error('No interest data for that query.')
      }

      if (output === 'json') {
        console.log(
          JSON.stringify(
            points.map((p) => ({
              time: p.formattedTime,
              ...Object.fromEntries(labels.map((label, i) => [label, p.value?.[i] ?? 0])),
            })),
            null,
            2,
          ),
        )
        return
      }
      if (output === 'csv') {
        const headers = ['time', ...labels]
        console.log(toCsv(headers, points.map((p) => [p.formattedTime, ...labels.map((_, i) => p.value?.[i] ?? 0)])))
        return
      }

      // Table: one sparkline summary row per compared series (keyword or geo).
      if (points.length === 0) return
      let anyLow = false
      const rows = labels.map((label, i) => {
        const series = points.map((p) => p.value?.[i] ?? 0)
        const spark = sparkline(resample(series, SPARK_WIDTH))
        const min = Math.min(...series)
        const max = Math.max(...series)
        const avg = series.reduce((a, b) => a + b, 0) / series.length
        const latest = series[series.length - 1]
        const vol = assessVolume(series)
        if (vol.low) anyLow = true
        const shown = vol.low ? `${truncate(label, 22)} ${vol.shape === 'seasonal' ? '~seasonal' : '⚠noise'}` : truncate(label, 32)
        return [shown, spark, String(min), String(Math.round(avg)), String(max), String(latest)]
      })
      console.log(renderTable(['SERIES', `TREND (${points.length} pts)`, 'MIN', 'AVG', 'MAX', 'NOW'], rows, [false, false, true, true, true, true]))
      const span = `${points[0].formattedTime} → ${points[points.length - 1].formattedTime}`
      const geoLabel = geoList.length === 1 && geoList[0] === '' ? 'worldwide' : geoList.map((g) => g || 'worldwide').join(', ')
      console.error(pc.dim(`\n${span} · ${geoLabel} · values relative to peak (100)`))
      if (anyLow) {
        console.error(
          pc.dim(
            '⚠noise / ~seasonal: series is mostly zero, so values are normalized off a tiny base — “noise” is likely negligible or just emerging, “seasonal” is a term dormant between recurring peaks.',
          ),
        )
      }
    })
}
