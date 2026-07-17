import type { Command } from 'commander'
import pc from 'picocolors'
import { parsePositiveInt, pickCanonical } from '../../cli-util.ts'
import { renderTable, toCsv } from '../../format.ts'
import { autocomplete } from '../api.ts'

const OUTPUTS = ['table', 'json', 'csv'] as const

export const DEFAULT_PATTERNS = [
  'alternative to {seed}',
  '{seed} for',
  'how to {seed} without',
  '{seed} pricing',
]

export interface SeedExpansion {
  seed: string
  pattern: string
  query: string
}

export interface SuggestRecord {
  seed: string
  pattern: string
  suggestion: string
}

interface Options {
  geo: string
  limit: string
  output: string
  patterns: string
}

/**
 * Expand every seed × every pattern, substituting `{seed}` in the template.
 * Identical query strings are deduplicated (first occurrence wins).
 */
export function expandSeeds(seeds: string[], patterns: string[]): SeedExpansion[] {
  const seen = new Set<string>()
  const result: SeedExpansion[] = []
  for (const seed of seeds) {
    for (const pattern of patterns) {
      const query = pattern.replace(/\{seed\}/g, seed)
      if (!seen.has(query)) {
        seen.add(query)
        result.push({ seed, pattern, query })
      }
    }
  }
  return result
}

/**
 * Deduplicate `suggestion` strings across records. First occurrence wins.
 */
export function dedupeSuggestions(records: SuggestRecord[]): SuggestRecord[] {
  const seen = new Set<string>()
  return records.filter(({ suggestion }) => {
    if (seen.has(suggestion)) return false
    seen.add(suggestion)
    return true
  })
}

export function registerSuggestCommand(program: Command): void {
  program
    .command('suggest')
    .description('Autocomplete-based suggestions for seed terms expanded via configurable patterns')
    .argument('<seed...>', 'one or more seed keywords to expand')
    .option('-g, --geo <code>', 'two-letter country code, e.g. US, FR (default: worldwide)', '')
    .option('-n, --limit <n>', 'max suggestions kept per expanded query', '10')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .option(
      '-p, --patterns <templates>',
      'comma-separated templates with {seed} substitution',
      DEFAULT_PATTERNS.join(','),
    )
    .addHelpText(
      'after',
      `
Examples:
  gtrends suggest "crm" -n 5`,
    )
    .action(async (seeds: string[], opts: Options) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const limit = parsePositiveInt(opts.limit, '--limit')
      const geo = opts.geo.trim().toUpperCase()
      const patterns = opts.patterns
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)

      const expanded = expandSeeds(seeds, patterns)

      const allRecords: SuggestRecord[] = []
      for (let i = 0; i < expanded.length; i++) {
        if (i > 0) await new Promise<void>((r) => setTimeout(r, 300))
        const { seed, pattern, query } = expanded[i]
        const suggestions = await autocomplete(query, geo)
        for (const suggestion of suggestions.slice(0, limit)) {
          allRecords.push({ seed, pattern, suggestion })
        }
      }

      const records = dedupeSuggestions(allRecords)

      const geoNote = geo ? ` · geo: ${geo}` : ''
      console.error(pc.dim(`${records.length} suggestions${geoNote}`))

      if (output === 'json') {
        console.log(JSON.stringify(records))
        return
      }
      if (output === 'csv') {
        console.log(toCsv(['seed', 'pattern', 'suggestion'], records.map((r) => [r.seed, r.pattern, r.suggestion])))
        return
      }

      console.log(
        renderTable(
          ['SEED', 'PATTERN', 'SUGGESTION'],
          records.map((r) => [r.seed, r.pattern, r.suggestion]),
        ),
      )
    })
}
