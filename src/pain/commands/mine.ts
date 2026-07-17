import type { Command } from 'commander'
import pc from 'picocolors'
import { CliError } from '../../config.ts'
import { parsePositiveInt, pickCanonical } from '../../cli-util.ts'
import { renderTable, toCsv, truncate } from '../../format.ts'
import { mineHn } from '../sources/hn.ts'
import { mineDevto } from '../sources/devto.ts'
import type { PainSignal } from '../signal.ts'

const VALID_SOURCES = ['hn', 'devto'] as const
type SourceName = (typeof VALID_SOURCES)[number]

const OUTPUTS = ['table', 'json', 'csv'] as const

export type MinedSignal = PainSignal & { multi_url_pain_match: boolean }

interface Options {
  sources: string
  days: string
  limit: string
  output: string
}

/**
 * Pure helper: merge, dedupe by URL (first wins), sort by weight desc,
 * cap at limit, then flag multi_url_pain_match on all records when the
 * merged set has ≥3 distinct URLs (breadth, not source diversity — read
 * contributing_sources in the score output for cross-source signals).
 */
export function mergeTermSignals(
  term: string,
  results: PromiseSettledResult<PainSignal[]>[],
  limit: number,
): MinedSignal[] {
  const seen = new Set<string>()
  const merged: PainSignal[] = []

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const signal of result.value) {
      if (seen.has(signal.url)) continue
      seen.add(signal.url)
      merged.push({ ...signal, term })
    }
  }

  merged.sort((a, b) => b.weight - a.weight)
  const capped = merged.slice(0, limit)
  const multiMatch = seen.size >= 3

  return capped.map((s) => ({ ...s, multi_url_pain_match: multiMatch }))
}

export function registerMineCommand(program: Command): void {
  program
    .command('mine')
    .description('Mine pain signals for one or more terms across HN and dev.to')
    .argument('<term...>', 'one or more search terms to mine')
    .option('-s, --sources <list>', 'comma-separated sources: hn,devto', 'hn,devto')
    .option('-d, --days <n>', 'look-back window for HN (days)', '30')
    .option('-n, --limit <n>', 'max signals per term', '50')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gpain mine "zapier alternative" -o json
  gpain mine "crm" "saas" --sources hn --days 7 --limit 20`,
    )
    .action(async (terms: string[], opts: Options) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const days = parsePositiveInt(opts.days, '--days')
      const limit = parsePositiveInt(opts.limit, '--limit')

      const requestedSources = opts.sources
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)

      for (const src of requestedSources) {
        if (!(VALID_SOURCES as readonly string[]).includes(src)) {
          throw new CliError(
            `Unknown source "${src}".`,
            `Valid sources: ${VALID_SOURCES.join(', ')}.`,
          )
        }
      }

      const sources = requestedSources as SourceName[]

      const allSignals: MinedSignal[] = []
      const sourcesUsed = new Set<string>()

      for (const term of terms) {
        const tasks = sources.map((src) => {
          if (src === 'hn') return mineHn(term, days)
          return mineDevto(term)
        })

        const results = await Promise.allSettled(tasks)

        results.forEach((result, i) => {
          const src = sources[i]
          if (result.status === 'rejected') {
            const reason =
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            console.error(pc.dim(`[${src}] ${term}: ${reason}`))
          } else {
            sourcesUsed.add(src)
          }
        })

        const termSignals = mergeTermSignals(term, results, limit)
        allSignals.push(...termSignals)
      }

      if (sourcesUsed.size === 0) {
        throw new CliError(
          'All sources failed for every term — no data was mined.',
          'Check connectivity or retry later; see the per-source errors above.',
        )
      }

      console.error(pc.dim(`${allSignals.length} signals · sources: ${[...sourcesUsed].join(', ')}`))

      if (output === 'json') {
        console.log(JSON.stringify(allSignals, null, 2))
        return
      }

      if (output === 'csv') {
        console.log(
          toCsv(
            ['term', 'source', 'weight', 'matched_phrase', 'story_title', 'url', 'multi_url_pain_match'],
            allSignals.map((s) => [
              s.term,
              s.source,
              s.weight,
              s.matched_phrase,
              s.story_title,
              s.url,
              String(s.multi_url_pain_match),
            ]),
          ),
        )
        return
      }

      console.log(
        renderTable(
          ['TERM', 'SOURCE', 'WEIGHT', 'PHRASE', 'TITLE'],
          allSignals.map((s) => [
            truncate(s.term, 20),
            s.source,
            String(s.weight),
            truncate(s.matched_phrase, 30),
            truncate(s.story_title, 50),
          ]),
          [false, false, true, false, false],
        ),
      )
    })
}
