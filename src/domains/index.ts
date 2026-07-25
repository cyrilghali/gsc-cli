#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import pc from 'picocolors'
import { CliError } from '../config.ts'

import { registerCheckCommand } from './commands/check.ts'

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }

const program = new Command()

program
  .name('gdom')
  .description('Domain availability checking from the command line (RDAP, no auth required)')
  .version(version)
  .addHelpText(
    'after',
    `
Getting started:
  gdom check vetoline                    check vetoline.com and vetoline.fr
  gdom check vetoline --tlds com         .com only
  gdom check vetoline.fr other.com       check specific domains
  gdom check vetoline -o json            JSON output

Note: hits RDAP registries directly (Verisign for .com, AFNIC for .fr).
Unauthenticated and rate-limited — if you see a 429, wait a moment and retry.`,
  )

registerCheckCommand(program)

program.parseAsync().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(`${pc.red('Error:')} ${err.message}`)
    if (err.hint) console.error(pc.dim(err.hint))
  } else {
    console.error(
      `${pc.red('Unexpected error:')} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    )
  }
  process.exit(1)
})
