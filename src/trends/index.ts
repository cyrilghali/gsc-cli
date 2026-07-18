#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import pc from 'picocolors'
import { CliError } from '../config.ts'

import { registerInterestCommand } from './commands/interest.ts'
import { registerRelatedCommand } from './commands/related.ts'
import { registerShocksCommand } from './commands/shocks.ts'
import { registerSuggestCommand } from './commands/suggest.ts'
import { registerTrendingCommand } from './commands/trending.ts'

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }

const program = new Command()

program
  .name('gtrends')
  .description('Google Trends from the command line (unofficial, no auth required)')
  .version(version)
  .addHelpText(
    'after',
    `
Getting started:
  gtrends interest "chatgpt" "claude"      compare interest over time
  gtrends related "electric car" --geo US  top & rising related queries
  gtrends suggest "crm" -n 5              autocomplete suggestions via patterns
  gtrends trending --geo FR                today's trending searches

Note: these hit Google Trends' internal endpoints. They are unauthenticated and
rate-limited — if you see a 429, wait a minute and retry.`,
  )

registerInterestCommand(program)
registerRelatedCommand(program)
registerShocksCommand(program)
registerSuggestCommand(program)
registerTrendingCommand(program)

program.parseAsync().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(`${pc.red('Error:')} ${err.message}`)
    if (err.hint) console.error(pc.dim(err.hint))
  } else {
    console.error(`${pc.red('Unexpected error:')} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  }
  process.exit(1)
})
