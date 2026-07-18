#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import pc from 'picocolors'
import { registerAuthCommand } from './commands/auth.ts'
import { registerIndexCommand } from './commands/indexing.ts'
import { registerInspectCommand } from './commands/inspect.ts'
import { registerQueryCommand } from './commands/query.ts'
import { registerSitemapsCommand } from './commands/sitemaps.ts'
import { registerSitesCommand } from './commands/sites.ts'
import { CliError } from './config.ts'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const program = new Command()

program
  .name('gsc')
  .description('Google Search Console from the command line')
  .version(version)
  .addHelpText(
    'after',
    `
Getting started:
  1. gsc auth login --credentials <client_secret.json>   (or --service-account <key.json>)
  2. gsc sites list
  3. gsc sites use sc-domain:example.com
  4. gsc query --days 28`,
  )

registerAuthCommand(program)
registerSitesCommand(program)
registerQueryCommand(program)
registerSitemapsCommand(program)
registerInspectCommand(program)
registerIndexCommand(program)

program.parseAsync().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(`${pc.red('Error:')} ${err.message}`)
    if (err.hint) console.error(pc.dim(err.hint))
  } else {
    console.error(`${pc.red('Unexpected error:')} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  }
  process.exit(1)
})
