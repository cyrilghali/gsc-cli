import type { Command } from 'commander'
import pc from 'picocolors'
import { parsePositiveInt, pickCanonical, sleep } from '../../cli-util.ts'
import { renderTable, truncate } from '../../format.ts'
import { saturateTerm } from '../sources/saturation.ts'
import type { SaturationResult } from '../sources/saturation.ts'

const OUTPUTS = ['table', 'json'] as const

interface Options {
  days: string
  geo: string
  output: string
}

export function registerSaturateCommand(program: Command): void {
  program
    .command('saturate')
    .description('Estimate market saturation per term (autocomplete density + Show HN launch count)')
    .argument('<term...>', 'one or more terms to evaluate')
    .option('-d, --days <n>', 'look-back window for Show HN launches (days)', '730')
    .option('-g, --geo <code>', 'two-letter country code for autocomplete, e.g. US (default: worldwide)', '')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'table')
    .addHelpText(
      'after',
      `
Examples:
  gpain saturate "crm" "crm for dentists" -o json
  gpain score signals.json --saturation-file <(gpain saturate crm -o json)

presence counts autocomplete completions for the term itself — a niche with
presence 0 has no search demand at all, low saturation alone is not enough.`,
    )
    .action(async (terms: string[], opts: Options) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const days = parsePositiveInt(opts.days, '--days')
      const geo = opts.geo.trim().toUpperCase()

      const results: SaturationResult[] = []
      for (let i = 0; i < terms.length; i++) {
        if (i > 0) await sleep(300)
        results.push(await saturateTerm(terms[i], days, geo))
      }

      console.error(pc.dim(`${results.length} terms evaluated · Show HN window: ${days} days`))

      if (output === 'json') {
        console.log(JSON.stringify(results, null, 2))
        return
      }

      console.log(
        renderTable(
          ['TERM', 'SATURATION', 'PRESENCE', 'VS', 'ALTS', 'SHOW HN'],
          results.map((r) => [
            truncate(r.term, 30),
            r.saturation.toFixed(3),
            String(r.presence),
            String(r.vs_count),
            String(r.alternatives_count),
            String(r.show_hn_count),
          ]),
          [false, true, true, true, true, true],
        ),
      )
    })
}
