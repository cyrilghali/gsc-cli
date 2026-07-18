import type { Command } from 'commander'
import pc from 'picocolors'
import { parsePositiveInt, pickCanonical } from '../../cli-util.ts'
import { renderTable, truncate } from '../../format.ts'
import { CliError } from '../../config.ts'
import { enrichTerms, resolveAuth, saveAuth } from '../sources/dataforseo.ts'

const OUTPUTS = ['table', 'json'] as const

interface Options {
  location: string
  language: string
  output: string
  saveAuth?: string
}

export function registerEnrichCommand(program: Command): void {
  program
    .command('enrich')
    .description('Enrich terms with search volume, CPC and keyword difficulty (DataForSEO, paid)')
    .argument('[term...]', 'terms to enrich (omit with --save-auth to only store credentials)')
    .option('--location <code>', 'DataForSEO location_code (2840 = United States)', '2840')
    .option('--language <code>', 'language code', 'en')
    .option('--save-auth <login:password>', 'store API credentials in ~/.config/gsc-cli/dataforseo.json and exit if no terms given')
    .option('-o, --output <format>', OUTPUTS.join(' | '), 'json')
    .addHelpText(
      'after',
      `
Examples:
  gpain enrich --save-auth 'login@example.com:secret'
  gpain enrich "crm for dentists" "invoicing" -o table
  gpain score signals.json --enrichment-file <(gpain enrich crm -o json)

Costs real money (~$0.05–0.10 per batch of ≤1000 terms); the actual billed
cost is printed on stderr after each run.`,
    )
    .action(async (terms: string[], opts: Options) => {
      const output = pickCanonical(opts.output, OUTPUTS, '--output')
      const location = parsePositiveInt(opts.location, '--location')

      if (opts.saveAuth !== undefined) {
        const sep = opts.saveAuth.indexOf(':')
        if (sep <= 0 || sep === opts.saveAuth.length - 1) {
          throw new CliError('--save-auth expects login:password.')
        }
        const path = saveAuth({ login: opts.saveAuth.slice(0, sep), password: opts.saveAuth.slice(sep + 1) })
        console.error(pc.dim(`credentials saved → ${path}`))
        if (terms.length === 0) return
      }

      if (terms.length === 0) throw new CliError('No terms given.', 'Pass at least one term to enrich.')
      if (terms.length > 1000) throw new CliError('Too many terms (max 1000 per batch).')

      const auth = resolveAuth()
      const { enriched, cost } = await enrichTerms(terms, location, opts.language, auth)

      console.error(pc.dim(`${enriched.length} terms enriched · billed $${cost.toFixed(4)}`))

      if (output === 'json') {
        console.log(JSON.stringify(enriched, null, 2))
        return
      }

      console.log(
        renderTable(
          ['TERM', 'VOLUME', 'CPC', 'COMPETITION', 'DIFFICULTY'],
          enriched.map((e) => [
            truncate(e.term, 30),
            e.search_volume === null ? '—' : String(e.search_volume),
            e.cpc === null ? '—' : `$${e.cpc.toFixed(2)}`,
            e.competition_index === null ? '—' : String(e.competition_index),
            e.keyword_difficulty === null ? '—' : String(e.keyword_difficulty),
          ]),
          [false, true, true, true, true],
        ),
      )
    })
}
